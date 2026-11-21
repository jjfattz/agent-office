// 📱 Use on your phone: the office puts itself on the person's Tailscale network, pairs their phone
// with a QR code, and keeps the computer awake, all from one window (src/client/ui/phone.ts).
//
// The office stays on 127.0.0.1. Tailscale Serve, run by the office (tailscale.ts, access.ts), gives
// it an https://<computer>.<tailnet>.ts.net address that only the person's own devices can open,
// with a real certificate. Nothing goes on the public internet. While Serve is in front of it, the
// office believes the X-Forwarded-* headers that come from this computer (http/util.ts), and serves
// workers' web servers on the tailnet too (tailnet.ts).
//
// On a server set up with `deploy/provision.sh --tailscale` (AGENT_OFFICE_TAILSCALE_HOST), all that
// is done already: the window goes straight to pairing a phone.
import { existsSync } from 'node:fs';
import os from 'node:os';
import type { Accounts } from '../accounts.js';
import type { Auth } from '../auth.js';
import type { Config } from '../config.js';
import type { Tailnet } from '../tailnet.js';
import type { PhoneOs, PhoneState } from '../../shared/protocol.js';
import { firstLine, lookAt, serveOffice, syncWorkerPorts, unserve, type Looked } from './access.js';
import { KeepAwake, laptopNote } from './awake.js';
import { Devices } from './pairing.js';
import { readPhone, writePhone, type PhoneSaved } from './saved.js';
import { cliRunner, findTailscale, isPhone, loginLink, officeUrl, portUse, type Run } from './tailscale.js';

/** How often Tailscale is looked at while someone has the 📱 window open, and otherwise. */
const WATCHING_MS = 3000;
const IDLE_MS = 60_000;
/** A sign-in started from the window waits this long for the person. */
const LOGIN_WAIT_MS = 10 * 60_000;
/** At most this often, access that's on but not served (Tailscale restarted, the port went) is put back. */
const FIX_EVERY_MS = 60_000;

/** Who's looking: what they see depends on it. */
export interface Viewer {
  admin: boolean;
  accountId?: string;
}

export interface PhoneOptions {
  cfg: Config;
  auth: Auth;
  accounts: Accounts;
  tailnet: Tailnet;
  /** The ports workers' web servers are on now. */
  workerPorts: () => number[];
  /** What anyone looking at it sees may have changed. */
  changed: () => void;
  /** For tests: how Tailscale is run, or null for "not installed"; the keep-awake; the OS. */
  run?: Run | null;
  awake?: KeepAwake;
  platform?: NodeJS.Platform;
}

const osOf = (p: NodeJS.Platform): PhoneOs => (p === 'darwin' ? 'mac' : p === 'win32' ? 'windows' : p === 'linux' ? 'linux' : 'other');

export class Phone {
  readonly devices: Devices;
  /** Already on the tailnet, set up by deploy/provision.sh --tailscale. */
  readonly managed: boolean;
  private run?: Run;
  private saved: PhoneSaved;
  private look?: Looked;
  private busy = false;
  private problem?: string;
  private moved = false;
  private loginUrl?: string;
  private loginAbort?: AbortController;
  private enableUrl?: string;
  private serveAbort?: AbortController;
  private operator?: string;
  private lastFix = 0;
  private looking?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private watchers = new Set<string>();
  /** The connections that asked what the 📱 window shows, and hear when it changes. */
  private subscribers = new Set<string>();
  private readonly os: PhoneOs;
  private readonly awake: KeepAwake;
  private readonly laptop?: string;
  private readonly brew: boolean;

  constructor(private o: PhoneOptions) {
    const platform = o.platform ?? process.platform;
    this.os = osOf(platform);
    this.managed = !!o.cfg.tailnet;
    this.devices = new Devices(o.cfg.dataDir, () => o.changed());
    o.auth.useDevices((id) => this.devices.live(id));
    this.saved = readPhone(o.cfg.dataDir);
    this.awake = o.awake ?? new KeepAwake(platform);
    this.laptop = this.managed ? undefined : laptopNote(platform);
    this.brew = platform === 'darwin' && !this.managed && hasBrew();
    if (o.run !== undefined) this.run = o.run ?? undefined;
  }

  /** Looks at Tailscale, and puts access back if it was on when the office last stopped. */
  start() {
    if (this.managed) return;
    void this.refresh().finally(() => this.schedule());
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.loginAbort?.abort();
    this.serveAbort?.abort();
    this.awake.hold(false);
  }

  /** This connection hears from now on whenever what it sees changes. */
  subscribe(clientId: string) {
    this.subscribers.add(clientId);
  }

  subscribed(clientId: string): boolean {
    return this.subscribers.has(clientId);
  }

  /** It left. */
  forget(clientId: string) {
    this.subscribers.delete(clientId);
    this.watch(clientId, false);
  }

  /** Someone has the 📱 window open (or closed it): look every few seconds while anyone does. */
  watch(clientId: string, on: boolean) {
    const had = this.watchers.size;
    if (on) this.watchers.add(clientId);
    else this.watchers.delete(clientId);
    if (!had && this.watchers.size) void this.refresh().finally(() => this.schedule());
  }

  /** The office's address on the tailnet while it's served there. */
  get url(): string | undefined {
    if (this.managed) return `https://${this.o.cfg.tailnet}`;
    const host = this.look?.status.host;
    return host && this.serving ? officeUrl(host, this.saved.port!) : undefined;
  }

  private get serving(): boolean {
    const l = this.look;
    return !!l?.status.host && l.status.state === 'running' && !!this.saved.port && portUse(l.serve, l.status.host, this.saved.port, this.o.cfg.port) === 'office';
  }

  /** What the 📱 window shows `who`. */
  view(who: Viewer): PhoneState {
    const st = this.look?.status;
    const ownerName = (id: string | undefined) => (id ? this.o.accounts.get(id)?.name : undefined);
    const devices = this.devices
      .list()
      .filter((d) => who.admin || (d.owner ?? undefined) === who.accountId)
      .map((d) => ({ id: d.id, name: d.name, ...(d.owner ? { owner: ownerName(d.owner) ?? 'a removed account' } : {}), mine: (d.owner ?? undefined) === who.accountId, pairedAt: d.pairedAt, ...(d.lastSeenAt ? { lastSeenAt: d.lastSeenAt } : {}) }));
    return {
      admin: who.admin,
      managed: this.managed,
      os: this.os,
      on: this.managed || this.saved.on,
      busy: this.busy,
      ...(this.url ? { url: this.url } : {}),
      ...(who.admin && this.problem ? { problem: this.problem } : {}),
      ...(this.moved && this.serving ? { movedPort: true } : {}),
      ...(who.admin && !this.managed
        ? {
            tailscale: {
              state: !this.run ? 'missing' : (st?.state ?? 'starting'),
              ...(st?.user ? { user: st.user } : {}),
              ...(st?.host ? { host: st.host } : {}),
              magicDns: !!st?.magicDns,
              https: !!st?.https,
              ...(this.loginUrl ? { loginUrl: this.loginUrl } : {}),
              ...(this.enableUrl ? { enableUrl: this.enableUrl } : {}),
              brew: this.brew,
              ...(this.operator ? { operator: this.operator } : {}),
              phones: (st?.peers ?? []).filter(isPhone),
            },
          }
        : {}),
      awake: { on: this.saved.awake, holding: this.awake.holding, supported: !this.managed && this.awake.supported, ...(this.laptop ? { laptop: this.laptop } : {}) },
      devices,
    };
  }

  /** Turns phone access on or off (an admin did). Resolves once it's done. */
  async setAccess(on: boolean): Promise<void> {
    if (this.managed || (this.busy && on)) return;
    this.saved = { ...readPhone(this.o.cfg.dataDir), on };
    writePhone(this.o.cfg.dataDir, this.saved);
    this.problem = undefined;
    if (on) await this.turnOn();
    else await this.turnOff();
  }

  setAwake(on: boolean) {
    if (this.managed) return;
    this.saved = { ...readPhone(this.o.cfg.dataDir), awake: on };
    writePhone(this.o.cfg.dataDir, this.saved);
    this.applyServing();
    this.o.changed();
  }

  /** Starts Tailscale's sign-in on this computer; its page shows up in the window as `loginUrl`. */
  login() {
    const run = this.run;
    if (!run || this.loginAbort) return;
    if (this.look?.status.authUrl) {
      this.loginUrl = this.look.status.authUrl;
      return this.o.changed();
    }
    const ac = new AbortController();
    this.loginAbort = ac;
    void run(['login'], {
      timeoutMs: LOGIN_WAIT_MS,
      signal: ac.signal,
      onOutput: (t) => {
        const link = loginLink(t);
        if (link && !this.loginUrl) {
          this.loginUrl = link;
          this.o.changed();
        }
      },
    }).then((r) => {
      if (this.loginAbort === ac) this.loginAbort = undefined;
      this.loginUrl = undefined;
      if (r.code && !ac.signal.aborted) this.problem = `Tailscale’s sign-in didn’t finish: ${firstLine(`${r.err}\n${r.out}`)}`;
      void this.refresh();
    });
  }

  /** A link that signs a phone in as `who`, for the QR code; undefined until the office is reachable. */
  pairLink(who: Viewer): { url: string; expiresAt: number } | undefined {
    const url = this.url;
    if (!url) return undefined;
    const { token, expiresAt } = this.devices.pair(who.accountId);
    return { url: `${url}/pair#${token}`, expiresAt };
  }

  /** Looks at Tailscale now (once at a time), and tells everyone looking what changed. */
  refresh(): Promise<void> {
    if (this.managed || this.stopped) return Promise.resolve();
    this.looking ??= this.lookNow().finally(() => (this.looking = undefined));
    return this.looking;
  }

  private async lookNow() {
    const before = JSON.stringify(this.view({ admin: true }));
    this.saved = readPhone(this.o.cfg.dataDir); // `agent-office phone on|off` may have changed it
    this.run ??= this.o.run === undefined ? findRun() : undefined;
    this.look = this.run ? await lookAt(this.run) : undefined;
    const st = this.look?.status;
    if (st && st.state !== 'login') {
      this.loginAbort?.abort();
      this.loginUrl = undefined;
    }
    if (st?.https) this.enableUrl = undefined;
    this.applyServing();
    // On, but not served (the office restarted, or Tailscale did): put it back. Off, with ports
    // the office couldn't take back while Tailscale was down: take them back now.
    const due = !this.busy && st?.state === 'running' && Date.now() - this.lastFix > FIX_EVERY_MS;
    if (due && this.saved.on && !this.serving) void this.turnOn();
    else if (due && !this.saved.on && (this.saved.port || this.saved.workerPorts.length)) void this.turnOff();
    if (JSON.stringify(this.view({ admin: true })) !== before) this.o.changed();
  }

  /** Believes Serve's headers, serves workers' servers on the tailnet and holds the computer awake while the office is served. */
  private applyServing() {
    const { cfg, tailnet } = this.o;
    const host = this.look?.status.host;
    if (this.serving && host) {
      cfg.localProxy = true;
      tailnet.attach(host, this.servePorts, this.o.workerPorts());
    } else if (cfg.localProxy) {
      cfg.localProxy = false;
      tailnet.detach();
    }
    this.awake.hold(this.saved.on && this.saved.awake && !this.stopped);
  }

  private servePorts = async (ports: number[]): Promise<string> => {
    const host = this.look?.status.host;
    if (!this.run || !host) return 'Tailscale isn’t running';
    const saved = readPhone(this.o.cfg.dataDir);
    const r = await syncWorkerPorts(this.run, host, this.o.cfg.port, saved.port ? [saved.port] : [], saved.workerPorts, ports);
    this.saved = { ...readPhone(this.o.cfg.dataDir), workerPorts: r.owned };
    writePhone(this.o.cfg.dataDir, this.saved);
    return r.error;
  };

  private async turnOn() {
    const run = this.run;
    if (!run) {
      this.problem = 'Install Tailscale first (step 1).';
      return this.o.changed();
    }
    this.busy = true;
    this.lastFix = Date.now();
    this.o.changed();
    const ac = new AbortController();
    this.serveAbort = ac;
    try {
      this.look = await lookAt(run);
      const r = await serveOffice(run, this.look, this.o.cfg.port, {
        signal: ac.signal,
        onEnableLink: (url) => {
          this.enableUrl = url;
          this.o.changed();
        },
      });
      if ('error' in r) {
        if (r.aborted) return;
        this.problem = r.error;
        this.operator = r.operator ? `sudo tailscale set --operator=${os.userInfo().username}` : undefined;
        return;
      }
      this.operator = undefined;
      this.enableUrl = undefined;
      this.problem = undefined;
      this.moved = r.moved;
      this.saved = { ...readPhone(this.o.cfg.dataDir), port: r.port };
      writePhone(this.o.cfg.dataDir, this.saved);
    } finally {
      if (this.serveAbort === ac) this.serveAbort = undefined;
      this.busy = false;
      await this.lookNow();
      this.o.changed();
    }
  }

  /** Removes exactly what the office added to Serve, and nothing else. */
  private async turnOff() {
    this.serveAbort?.abort();
    this.busy = true;
    this.lastFix = Date.now();
    this.o.changed();
    try {
      const run = this.run;
      const host = this.look?.status.state === 'running' ? this.look.status.host : undefined;
      const saved = readPhone(this.o.cfg.dataDir);
      // With Tailscale down, its ports are kept, and taken back once it's running again (lookNow).
      if (run && host) {
        const err = await unserve(run, host, this.o.cfg.port, [...(saved.port ? [saved.port] : []), ...saved.workerPorts]);
        if (err) this.problem = `Tailscale couldn’t stop serving the office: ${err}`;
        else {
          const { port: _port, ...rest } = saved;
          this.saved = { ...rest, on: false, workerPorts: [] };
          writePhone(this.o.cfg.dataDir, this.saved);
        }
      }
      this.o.cfg.localProxy = false;
      this.o.tailnet.detach();
    } finally {
      this.busy = false;
      await this.lookNow();
      this.o.changed();
    }
  }

  private schedule() {
    clearTimeout(this.timer);
    if (this.stopped || this.managed) return;
    // While Tailscale is there, a look a minute notices `agent-office phone on|off` too.
    const ms = this.watchers.size ? WATCHING_MS : this.run ? IDLE_MS : 0;
    if (!ms) return;
    this.timer = setTimeout(() => void this.refresh().finally(() => this.schedule()), ms);
    this.timer.unref();
  }
}

function findRun(): Run | undefined {
  const bin = findTailscale();
  return bin ? cliRunner(bin) : undefined;
}

/** Homebrew, where its installer puts it (Apple silicon, then Intel). */
const hasBrew = () => ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].some(existsSync);
