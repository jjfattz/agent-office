// What web push keeps on disk, in .agent-office/push.json: the office's VAPID key pair, made the
// first time it's needed so there's no account to set up anywhere, and each device that asked to be
// notified, per account (none: the shared password) and per browser.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeVapidKeys, validTarget, validVapidKeys, knownPushService, vapidPublicKey, type PushTarget, type VapidKeys } from './webpush.js';

/** A device that gets pushes. */
export interface PushSub extends PushTarget {
  id: string;
  /** The account it's for; none means the shared office password. */
  owner?: string;
  /** The paired device (phone/pairing.ts) it was subscribed from, so signing that out stops its pushes too. */
  device?: string;
  /** "iPhone · Safari". */
  name: string;
  createdAt: number;
  lastPushAt?: number;
  /** Why the last push didn't get through, if it didn't. */
  error?: string;
}

interface Saved {
  vapid?: VapidKeys;
  subs?: PushSub[];
}

const MAX_SUBS = 200;
const MAX_PER_OWNER = 20;
const NAME_MAX = 40;

export class PushStore {
  private data: { vapid: VapidKeys; subs: PushSub[] };
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'push.json');
    const saved = this.read();
    const vapid = validVapidKeys(saved.vapid) ? saved.vapid : undefined;
    // A new key pair makes every old subscription useless: browsers tie theirs to the key.
    this.data = { vapid: vapid ?? makeVapidKeys(), subs: vapid && Array.isArray(saved.subs) ? saved.subs.filter(isSub) : [] };
    if (!vapid) this.save();
  }

  get keys(): VapidKeys {
    return this.data.vapid;
  }

  /** The key browsers subscribe with (applicationServerKey). */
  get publicKey(): string {
    return vapidPublicKey(this.data.vapid);
  }

  all(): PushSub[] {
    return [...this.data.subs];
  }

  /** Someone's devices: an account's, or (null) the shared password's. */
  of(owner: string | null): PushSub[] {
    return this.data.subs.filter((s) => (s.owner ?? null) === owner);
  }

  get(id: string): PushSub | undefined {
    return this.data.subs.find((s) => s.id === id);
  }

  /**
   * Adds a device, or updates the one with the same endpoint (the same browser subscribing again,
   * or another account signing in on it, which takes it over). Returns why it can't, if it can't.
   */
  add(target: PushTarget, who: { owner?: string; device?: string }, name: string, now = Date.now()): PushSub | string {
    if (!knownPushService(target.endpoint)) return "That browser's push service isn't one the office sends to";
    if (!validTarget(target)) return "That browser's push keys aren't right";
    const clean = name.replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || 'Device';
    const had = this.data.subs.find((s) => s.endpoint === target.endpoint);
    if (had) {
      Object.assign(had, { keys: { ...target.keys }, owner: who.owner, device: who.device, name: clean, error: undefined });
      if (!who.owner) delete had.owner;
      if (!who.device) delete had.device;
      this.save();
      return had;
    }
    const owner = who.owner ?? null;
    if (this.of(owner).length >= MAX_PER_OWNER) return `You already have ${MAX_PER_OWNER} devices getting notifications: remove one first`;
    if (this.data.subs.length >= MAX_SUBS) return 'The office has too many devices getting notifications';
    const sub: PushSub = {
      id: randomBytes(6).toString('hex'),
      endpoint: target.endpoint,
      keys: { p256dh: target.keys.p256dh, auth: target.keys.auth },
      ...(who.owner ? { owner: who.owner } : {}),
      ...(who.device ? { device: who.device } : {}),
      name: clean,
      createdAt: now,
    };
    this.data.subs.push(sub);
    this.save();
    return sub;
  }

  remove(id: string): PushSub | undefined {
    const i = this.data.subs.findIndex((s) => s.id === id);
    if (i < 0) return undefined;
    const [gone] = this.data.subs.splice(i, 1);
    this.save();
    return gone;
  }

  /** How the last push to it went. */
  noteResult(id: string, error: string | undefined, now = Date.now()) {
    const s = this.get(id);
    if (!s) return;
    if (error) s.error = error;
    else {
      delete s.error;
      s.lastPushAt = now;
    }
    this.save();
  }

  private read(): Saved {
    if (!existsSync(this.file)) return {};
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Saved;
    } catch {
      return {};
    }
  }

  private save() {
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}

function isSub(s: unknown): s is PushSub {
  const o = s as PushSub;
  return !!o && typeof o.id === 'string' && typeof o.endpoint === 'string' && typeof o.name === 'string' && typeof o.keys?.p256dh === 'string' && typeof o.keys?.auth === 'string';
}
