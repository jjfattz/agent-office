// Pairing a phone: a link in a QR code that signs a new device in to an account that's already
// signed in somewhere (or to the shared password's session), and the devices signed in that way.
//
// A pairing link (https://<office>.ts.net/pair#<token>) works once, for ten minutes. Only a hash of
// its token is kept. Each device it signs in gets a session of its own (Auth.issue with the device's
// id), which ends at once when the device is signed out here. Both live in .agent-office/devices.json,
// which `agent-office phone pair` writes too, so it's re-read when it changes.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PAIR_TTL_MS = 10 * 60_000;
/** Links not used yet; making another forgets the oldest. */
const MAX_PAIRINGS = 20;
const MAX_DEVICES = 200;
/** How often a device's last-seen time is written down. */
const SEEN_EVERY_MS = 60_000;
const NAME_MAX = 40;

/** A device signed in by a pairing link. */
export interface Device {
  id: string;
  /** The account it's signed in as; none means the shared office password. */
  owner?: string;
  name: string;
  /** Its browser's user agent, as it paired (for a guess at what it is). */
  ua: string;
  pairedAt: number;
  lastSeenAt?: number;
}

interface Pairing {
  hash: string;
  owner?: string;
  expiresAt: number;
}

interface Saved {
  devices: Device[];
  pairings: Pairing[];
}

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

/** A device's name, cleaned like an account's: no control characters, one space at a time. */
export function cleanDeviceName(v: unknown): string {
  return typeof v === 'string'
    ? v
        .replace(/[\p{C}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, NAME_MAX)
    : '';
}

/** A guess at what a device is from its user agent: "iPhone", "Android phone"… */
export function guessDevice(ua: string): string {
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows computer';
  if (/Linux/.test(ua)) return 'Linux computer';
  return 'Device';
}

export class Devices {
  private data: Saved = { devices: [], pairings: [] };
  private readonly file: string;
  private stamp = '';
  /** Last-seen times not written down yet. */
  private seen = new Map<string, number>();

  constructor(
    dataDir: string,
    /** The list changed: a device paired, was signed out, renamed, or connected for the first time. */
    private changed: () => void = () => {},
    private now: () => number = Date.now,
  ) {
    this.file = path.join(dataDir, 'devices.json');
    this.sync();
  }

  /**
   * Whether a device's session still counts (it hasn't been signed out), noting that it was seen.
   * Auth asks on every request a device makes.
   */
  live(id: string): boolean {
    this.sync();
    const d = this.data.devices.find((x) => x.id === id);
    if (!d) return false;
    const now = this.now();
    const first = !d.lastSeenAt && !this.seen.has(id);
    if (first || now - (this.seen.get(id) ?? d.lastSeenAt ?? 0) >= SEEN_EVERY_MS) {
      this.seen.set(id, now);
      d.lastSeenAt = now;
      this.save();
      if (first) this.changed();
    }
    return true;
  }

  get(id: string | undefined): Device | undefined {
    if (!id) return undefined;
    this.sync();
    return this.data.devices.find((d) => d.id === id);
  }

  /** Every device, or only those signed in as `owner` (null: the shared password's). */
  list(owner?: string | null): Device[] {
    this.sync();
    return this.data.devices.filter((d) => owner === undefined || (d.owner ?? null) === owner);
  }

  /** A pairing link's token, for `owner` (none: the shared password). Only its hash is kept. */
  pair(owner?: string): { token: string; expiresAt: number } {
    this.sync();
    this.dropExpired();
    const token = randomBytes(24).toString('base64url');
    const expiresAt = this.now() + PAIR_TTL_MS;
    this.data.pairings.push({ hash: hashOf(token), ...(owner ? { owner } : {}), expiresAt });
    while (this.data.pairings.length > MAX_PAIRINGS) this.data.pairings.shift();
    this.save();
    return { token, expiresAt };
  }

  /** Uses up a pairing link: the new device, signed in as whoever made the link. Undefined when it's used, expired or made up. */
  redeem(token: string, ua: string, name?: string): Device | undefined {
    if (!token || token.length > 128) return undefined;
    this.sync();
    this.dropExpired();
    const i = this.data.pairings.findIndex((p) => p.hash === hashOf(token));
    if (i < 0) return undefined;
    const [p] = this.data.pairings.splice(i, 1);
    return this.enroll(p.owner, ua, name);
  }

  /**
   * A device of `owner`'s (none: the shared password's), signed in already: the office as an app on
   * a phone's home screen (see http/routes/app.ts), which then stays signed in the way a paired one does.
   */
  enroll(owner: string | undefined, ua: string, name?: string): Device {
    this.sync();
    const ua2 = String(ua).slice(0, 300);
    const device: Device = { id: randomBytes(9).toString('base64url'), ...(owner ? { owner } : {}), name: cleanDeviceName(name) || guessDevice(ua2), ua: ua2, pairedAt: this.now() };
    this.data.devices.push(device);
    // The oldest go first, if someone pairs a great many.
    while (this.data.devices.length > MAX_DEVICES) this.data.devices.shift();
    this.save();
    this.changed();
    return device;
  }

  rename(id: string, name: string): Device | undefined {
    const d = this.get(id);
    const n = cleanDeviceName(name);
    if (!d || !n) return undefined;
    d.name = n;
    this.save();
    this.changed();
    return d;
  }

  /** Signs a device out: its session stops working at once. */
  revoke(id: string): Device | undefined {
    this.sync();
    const i = this.data.devices.findIndex((d) => d.id === id);
    if (i < 0) return undefined;
    const [d] = this.data.devices.splice(i, 1);
    this.seen.delete(id);
    this.save();
    this.changed();
    return d;
  }

  private dropExpired() {
    const now = this.now();
    this.data.pairings = this.data.pairings.filter((p) => p.expiresAt > now);
  }

  /** Re-reads the file when someone else (`agent-office phone pair`) changed it. */
  private sync() {
    let stamp = '';
    try {
      const st = statSync(this.file);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      // not made yet
    }
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    if (!stamp) return;
    try {
      const v = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Saved>;
      this.data = { devices: Array.isArray(v.devices) ? v.devices : [], pairings: Array.isArray(v.pairings) ? v.pairings : [] };
    } catch {
      // half-written by someone else: the next look reads it whole
      this.stamp = '';
    }
  }

  private save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
    try {
      const st = statSync(this.file);
      this.stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      this.stamp = '';
    }
  }
}
