// 🔔 Notify this phone: web push, so a phone hears about a worker that needs you with the office
// closed and the screen locked. The browser subscribes through its service worker (src/client/push/),
// the office keeps each device it's given (store.ts), decides when a worker is worth a push the way
// the team webhook does (decide.ts), and sends it, encrypted, through the browser's own push service
// (webpush.ts). There's no account to set up anywhere: the office makes its own VAPID keys.
import type { PushDevice, PushPayload, PushState, WorkerInfo } from '../../shared/protocol.js';
import { alertDetail } from '../../shared/status.js';
import { PushDecider, type PushAlert } from './decide.js';
import { PushStore, type PushSub } from './store.js';
import { sendPush, type PushResult, type PushTarget, type VapidKeys } from './webpush.js';

/** Who's asking: an account (none: the shared password), on a paired device or not. */
export interface PushWho {
  owner?: string;
  device?: string;
}

export interface PushOptions {
  dataDir: string;
  /** The floor a worker is on: its id (for the link) and its project's name. */
  floorOf(workerId: string): { id: string; name: string } | undefined;
  /** Whether a device still gets pushes: its account wasn't revoked, its paired device wasn't signed out. */
  allowed(sub: PushSub): boolean;
  /** `owner`'s list changed (null: the shared password's). */
  changed(owner: string | null): void;
  /** For tests: how a push is sent, and the decider's settle time. */
  send?: (keys: VapidKeys, target: PushTarget, payload: object, opts: { ttl?: number; topic?: string }) => Promise<PushResult>;
  settleMs?: number;
}

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** A push service's topic is at most 32 URL-safe characters. */
const topicOf = (workerId: string) => `w${workerId}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);

/** What the push for a worker says, and where tapping it goes. */
export function workerPayload(w: WorkerInfo, status: PushAlert, floor?: { id: string; name: string }): PushPayload {
  const detail = alertDetail(w);
  const title = status === 'needs_input' ? `🙋 ${w.name} needs you` : `✅ ${w.name} is done`;
  const task = w.task?.name && w.task.name !== detail ? w.task.name : undefined;
  const body = [detail && oneLine(detail, 180), [task && oneLine(task, 60), floor?.name].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
  const q = new URLSearchParams({ worker: w.id, ...(floor ? { floor: floor.id } : {}) });
  // Two buttons is what Android shows: the first choice (Allow) and the last (Deny).
  const c = status === 'needs_input' ? (w.choices ?? []) : [];
  const actions = c.length >= 2 ? [c[0], c[c.length - 1]].map((x) => ({ key: x.key, label: oneLine(x.label, 24) })) : undefined;
  return { title, body: body || (status === 'done' ? 'Finished its turn' : 'Waiting on an answer'), tag: `worker-${w.id}`, url: `/lite?${q}`, worker: w.id, floor: floor?.id, actions, sticky: status === 'needs_input' };
}

export class Push {
  readonly store: PushStore;
  private decider: PushDecider;
  /** Each connection whose 2D view is on screen, and its device's endpoint. */
  private visible = new Map<string, string>();
  private send: NonNullable<PushOptions['send']>;

  constructor(private o: PushOptions) {
    this.store = new PushStore(o.dataDir);
    this.send = o.send ?? sendPush;
    this.decider = new PushDecider((w, status) => void this.alert(w, status), undefined, o.settleMs);
  }

  onWorker(w: WorkerInfo) {
    this.decider.onWorker(w);
  }

  onWorkerGone(id: string) {
    this.decider.onWorkerGone(id);
  }

  stop() {
    this.decider.stop();
  }

  /** What 🔔 shows `who`: the key to subscribe with, and their devices. */
  view(who: PushWho): PushState {
    return { key: this.store.publicKey, devices: this.mine(who).map(deviceView) };
  }

  /** Adds this browser for `who`. Returns why it can't, if it can't. */
  subscribe(who: PushWho, target: PushTarget, name: string | undefined): string | undefined {
    const before = this.store.all().find((s) => s.endpoint === target.endpoint);
    const sub = this.store.add(target, who, name?.trim() || 'Device');
    if (typeof sub === 'string') return sub;
    // The browser moved to another account: the one it was is told it's gone from their list.
    if (before && (before.owner ?? null) !== (who.owner ?? null)) this.o.changed(before.owner ?? null);
    this.o.changed(who.owner ?? null);
    return undefined;
  }

  /** Stops pushes to one of `who`'s devices (an admin: anyone's). */
  unsubscribe(who: PushWho, id: string, admin = false): boolean {
    const sub = this.store.get(id);
    if (!sub || (!admin && (sub.owner ?? null) !== (who.owner ?? null))) return false;
    this.store.remove(id);
    this.o.changed(sub.owner ?? null);
    return true;
  }

  /** A connection has the 2D view on screen (with its device's endpoint), or stopped having it. */
  here(clientId: string, endpoint: string | undefined, visible: boolean) {
    if (visible && endpoint) this.visible.set(clientId, endpoint);
    else this.visible.delete(clientId);
  }

  forget(clientId: string) {
    this.visible.delete(clientId);
  }

  /** A test push to `who`'s devices. Resolves to how many it reached, or why none. */
  async test(who: PushWho): Promise<{ sent: number; error?: string }> {
    const subs = this.mine(who);
    if (!subs.length) return { sent: 0, error: 'No device of yours gets notifications yet' };
    const payload: PushPayload = { title: '🔔 It works!', body: 'This is how the office gets your attention when a worker needs you.', tag: 'office-test', url: '/lite' };
    const results = await Promise.all(subs.map((s) => this.deliver(s, payload)));
    const sent = results.filter((r) => r.ok).length;
    const failed = results.find((r): r is Extract<PushResult, { ok: false }> => !r.ok);
    return { sent, error: sent ? undefined : `The push didn't get through (${failed?.error ?? 'unknown'})` };
  }

  /** Everyone's devices but the ones looking at the 2D view right now. */
  private async alert(w: WorkerInfo, status: PushAlert) {
    const looking = new Set(this.visible.values());
    const subs = this.store.all().filter((s) => !looking.has(s.endpoint) && this.o.allowed(s));
    if (!subs.length) return;
    const payload = workerPayload(w, status, this.o.floorOf(w.id));
    await Promise.all(subs.map((s) => this.deliver(s, payload, topicOf(w.id))));
  }

  private async deliver(sub: PushSub, payload: PushPayload, topic?: string): Promise<PushResult> {
    const r = await this.send(this.store.keys, sub, payload, { ttl: 6 * 3600, topic });
    if (!this.store.get(sub.id)) return r;
    if (!r.ok && r.gone) {
      // Unsubscribed in the browser, or expired: it'll subscribe again from 🔔 if it wants to.
      this.store.remove(sub.id);
      console.log(`agent-office: push: dropped "${sub.name}" (${r.error})`);
    } else {
      if (!r.ok) console.error(`agent-office: push to "${sub.name}" failed: ${r.error}`);
      const before = sub.error;
      this.store.noteResult(sub.id, r.ok ? undefined : r.error);
      if (before === sub.error && r.ok) return r;
    }
    this.o.changed(sub.owner ?? null);
    return r;
  }

  private mine(who: PushWho): PushSub[] {
    return this.store.of(who.owner ?? null).filter((s) => this.o.allowed(s));
  }
}

const deviceView = (s: PushSub): PushDevice => ({ id: s.id, name: s.name, endpoint: s.endpoint, createdAt: s.createdAt, lastPushAt: s.lastPushAt, error: s.error });
