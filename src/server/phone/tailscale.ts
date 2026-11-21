// Tailscale, run by the office for 📱 Use on your phone: finding its command line, reading what it
// says (`tailscale status --json`, `tailscale serve status --json`), and the few commands the office
// ever gives it. Serve puts the office on https://<computer>.<tailnet>.ts.net for the person's own
// devices only. Funnel, which would put it on the internet, is never used: whoever signs in can run
// commands on this computer through its workers.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** What a run of the command line said. `code` is null when it was stopped (a timeout). */
export interface RunResult {
  code: number | null;
  out: string;
  err: string;
}

export interface RunOptions {
  timeoutMs?: number;
  /** Each piece of output as it comes, for a command that waits on the person (a sign-in link). */
  onOutput?: (text: string) => void;
  /** Stops it early. */
  signal?: AbortSignal;
}

/** Runs Tailscale's command line with these arguments. */
export type Run = (args: string[], opts?: RunOptions) => Promise<RunResult>;

/** Where Tailscale's command line may be, after the PATH. */
const KNOWN: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale'],
  win32: ['C:\\Program Files\\Tailscale\\tailscale.exe'],
  linux: ['/usr/bin/tailscale', '/usr/local/bin/tailscale'],
};

/**
 * Tailscale's command line on this computer: $AGENT_OFFICE_TAILSCALE_CLI, `tailscale` on the PATH,
 * then where each OS's installer puts it (on a Mac, the App Store and standalone apps carry it
 * inside the app). Undefined when Tailscale isn't installed.
 */
export function findTailscale(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = existsSync): string | undefined {
  if (env.AGENT_OFFICE_TAILSCALE_CLI) return exists(env.AGENT_OFFICE_TAILSCALE_CLI) ? env.AGENT_OFFICE_TAILSCALE_CLI : undefined;
  const sep = platform === 'win32' ? ';' : ':';
  const name = platform === 'win32' ? 'tailscale.exe' : 'tailscale';
  for (const dir of (env.PATH ?? '').split(sep).filter(Boolean)) {
    const p = path.join(dir, name);
    if (exists(p)) return p;
  }
  return (KNOWN[platform] ?? []).find(exists);
}

/**
 * Whether the office may give Tailscale these arguments: reading its status, signing in, and
 * Serve on HTTPS ports. Never Funnel, `up --reset`, `serve reset` (which drops everyone else's
 * handlers too) or anything that changes the tailnet's own settings.
 */
export function allowed(args: readonly string[]): boolean {
  if (args.some((a) => /funnel|reset/i.test(a))) return false;
  const [cmd, ...rest] = args;
  if (cmd === 'version' || cmd === 'login') return rest.length === 0;
  if (cmd === 'status') return rest.length === 1 && rest[0] === '--json';
  if (cmd === 'serve') return (rest.length === 2 && rest[0] === 'status' && rest[1] === '--json') || isServeOn(rest) || isServeOff(rest);
  return false;
}
const HTTPS_PORT = /^--https=\d{1,5}$/;
const isServeOn = (a: string[]) => a.length === 4 && a[0] === '--bg' && a[1] === '--yes' && HTTPS_PORT.test(a[2]) && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(a[3]);
const isServeOff = (a: string[]) => (a.length === 2 && HTTPS_PORT.test(a[0]) && a[1] === 'off') || (a.length === 3 && HTTPS_PORT.test(a[0]) && a[1] === '--set-path=/' && a[2] === 'off');

/** Serves the office at `/` of HTTPS port `port` on the tailnet, in the background (it outlives the command). */
export const serveOn = (port: number, officePort: number) => ['serve', '--bg', '--yes', `--https=${port}`, `http://127.0.0.1:${officePort}`];
/** Stops serving HTTPS port `port`, or only its `/` when other paths on it are someone else's. */
export const serveOff = (port: number, onlyRoot = false) => ['serve', `--https=${port}`, ...(onlyRoot ? ['--set-path=/'] : []), 'off'];

/** A runner for the command line at `bin`, which refuses anything `allowed` doesn't. */
export function cliRunner(bin: string): Run {
  return (args, opts = {}) =>
    new Promise((resolve) => {
      if (!allowed(args)) return resolve({ code: 1, out: '', err: `the office doesn't run "tailscale ${args.join(' ')}"` });
      let out = '';
      let err = '';
      let done = false;
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const finish = (code: number | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', stop);
        resolve({ code, out, err });
      };
      const stop = () => {
        child.kill();
        finish(null);
      };
      const timer = setTimeout(stop, opts.timeoutMs ?? 15_000);
      opts.signal?.addEventListener('abort', stop);
      child.stdout.on('data', (b: Buffer) => {
        out += b;
        opts.onOutput?.(b.toString());
      });
      child.stderr.on('data', (b: Buffer) => {
        err += b;
        opts.onOutput?.(b.toString());
      });
      child.on('error', (e) => {
        err += e.message;
        finish(1);
      });
      child.on('close', (code) => finish(code));
    });
}

/** A device on the tailnet besides this computer. */
export interface TsPeer {
  name: string;
  os: string;
  online: boolean;
  lastSeen?: string;
  /** Its Tailscale account's login, when the status says. */
  user?: string;
}

/** What `tailscale status --json` says, cut down to what the 📱 window needs. */
export interface TsStatus {
  /** down: the daemon isn't answering. off: switched off. login: signed out. approve: waiting on the tailnet's admin. */
  state: 'down' | 'off' | 'login' | 'approve' | 'starting' | 'running';
  /** This computer's name on the tailnet, e.g. my-mac.tail1234.ts.net. */
  host?: string;
  /** The account it's signed in as. */
  user?: string;
  magicDns: boolean;
  /** HTTPS certificates are on for the tailnet. */
  https: boolean;
  /** Tailscale's own sign-in page, while it's waiting for one. */
  authUrl?: string;
  peers: TsPeer[];
}

const DOWN: TsStatus = { state: 'down', magicDns: false, https: false, peers: [] };

const clean = (dns: unknown) => (typeof dns === 'string' && dns ? dns.replace(/\.$/, '').toLowerCase() : undefined);

/** Reads `tailscale status --json`; anything it can't make sense of is the daemon being down. */
export function parseStatus(json: string): TsStatus {
  let s: any;
  try {
    s = JSON.parse(json);
  } catch {
    return DOWN;
  }
  if (!s || typeof s !== 'object') return DOWN;
  const states: Record<string, TsStatus['state']> = { Running: 'running', Starting: 'starting', Stopped: 'off', NeedsLogin: 'login', NoState: 'login', NeedsMachineAuth: 'approve' };
  const users = (s.User && typeof s.User === 'object' ? s.User : {}) as Record<string, { LoginName?: string }>;
  const loginOf = (id: unknown) => (id !== undefined && id !== null ? users[String(id)]?.LoginName : undefined);
  const peers: TsPeer[] = Object.values((s.Peer && typeof s.Peer === 'object' ? s.Peer : {}) as Record<string, any>)
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      name: String(p.HostName || clean(p.DNSName)?.split('.')[0] || 'device'),
      os: String(p.OS ?? ''),
      online: !!p.Online,
      ...(typeof p.LastSeen === 'string' && !p.LastSeen.startsWith('0001') ? { lastSeen: p.LastSeen } : {}),
      ...(loginOf(p.UserID) ? { user: loginOf(p.UserID) } : {}),
    }));
  const certs = Array.isArray(s.CertDomains) ? s.CertDomains : [];
  return {
    state: states[s.BackendState] ?? 'down',
    host: clean(s.Self?.DNSName),
    user: loginOf(s.Self?.UserID),
    magicDns: !!s.CurrentTailnet?.MagicDNSEnabled,
    https: certs.length > 0,
    ...(typeof s.AuthURL === 'string' && /^https:\/\//.test(s.AuthURL) ? { authUrl: s.AuthURL } : {}),
    peers,
  };
}

/** A phone or tablet, by what Tailscale says it runs. */
export const isPhone = (p: TsPeer) => /^(ios|android|ipados)$/i.test(p.os);

/** Serve's settings, as `tailscale serve status --json` prints them. */
export interface ServeConfig {
  TCP?: Record<string, { HTTPS?: boolean; HTTP?: boolean; TCPForward?: string } | undefined>;
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string; Path?: string; Text?: string } | undefined> } | undefined>;
  AllowFunnel?: Record<string, boolean>;
}

export function parseServe(json: string): ServeConfig {
  try {
    const v = JSON.parse(json || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** The handlers on HTTPS port `port` for this computer's name, by path. */
function handlersAt(cfg: ServeConfig, host: string, port: number) {
  for (const [key, web] of Object.entries(cfg.Web ?? {})) if (key.toLowerCase() === `${host}:${port}`) return web?.Handlers ?? {};
  return {};
}

/** What Serve does with port `port`: nothing ('free'), the office's own at `/` ('office'), or something else ('other'). */
export function portUse(cfg: ServeConfig, host: string, port: number, officePort: number): 'free' | 'office' | 'other' {
  const handlers = handlersAt(cfg, host, port);
  if (pointsAt(handlers['/']?.Proxy, officePort)) return 'office';
  return cfg.TCP?.[String(port)] || Object.keys(handlers).length ? 'other' : 'free';
}

/** Whether port `port` has handlers besides the office's `/` (someone else's paths, left alone when the office lets go). */
export const sharesPort = (cfg: ServeConfig, host: string, port: number) => Object.keys(handlersAt(cfg, host, port)).some((p) => p !== '/');

/** Whether a Serve proxy target is this office: http://127.0.0.1:<port> or localhost. */
export function pointsAt(target: string | undefined, officePort: number): boolean {
  if (!target) return false;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(target) ? target : `http://${target}`);
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && Number(u.port || 80) === officePort;
  } catch {
    return false;
  }
}

/** The HTTPS ports the office tries for itself, in order: 443 gives the address with no port in it. */
export const OFFICE_PORTS = [443, 8443, 10000] as const;

/**
 * The HTTPS port to serve the office on: one already serving it, else the first one free. Never
 * one that serves something else. Undefined when they all do.
 */
export function pickPort(cfg: ServeConfig, host: string, officePort: number): { port: number; already: boolean } | undefined {
  for (const port of OFFICE_PORTS) if (portUse(cfg, host, port, officePort) === 'office') return { port, already: true };
  for (const port of OFFICE_PORTS) if (portUse(cfg, host, port, officePort) === 'free') return { port, already: false };
  return undefined;
}

/** The office's address on the tailnet when it's served on `port`. */
export const officeUrl = (host: string, port: number) => `https://${host}${port === 443 ? '' : `:${port}`}`;

/** Tailscale's page that turns HTTPS (and MagicDNS) on for the tailnet, from what `tailscale serve` printed while it waits. */
export function enableLink(text: string): string | undefined {
  return /https:\/\/login\.tailscale\.com\/f\/[^\s"'<>]+/.exec(text)?.[0];
}

/** The page to open to sign in, from what `tailscale login` printed. */
export function loginLink(text: string): string | undefined {
  return /https:\/\/[^\s"'<>]+/.exec(text)?.[0];
}

/** Serve was refused because this user may not change Tailscale's settings (Linux, without an operator). */
export const needsOperator = (text: string) => /access denied|permission denied|not permitted|--operator|must be root|use 'sudo/i.test(text);
