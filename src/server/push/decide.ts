// When a worker is worth a push: an agent that started waiting on input, or finished its turn, and is
// still that way a few seconds later with nobody at its terminal. Each time it starts waiting is pushed
// once, however many updates it sends meanwhile. Unlike the team webhook (webhook.ts), it looks again
// whenever that changes: someone closing the terminal, or a phone with it open locking its screen
// (`away`), so a worker left waiting still gets through to the phone in your pocket.
import type { WorkerInfo, WorkerStatus } from '../../shared/protocol.js';

/** How long a worker has to stay put before it's pushed, so a flicker never buzzes anyone. */
export const PUSH_SETTLE_MS = 5_000;
/** Episodes remembered, so one isn't pushed twice; older ones are forgotten. */
const REMEMBER = 500;

export type PushAlert = Extract<WorkerStatus, 'needs_input' | 'done'>;

interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(t: unknown): void;
}

const realTimers: Timers = {
  set(fn, ms) {
    const t = setTimeout(fn, ms);
    t.unref();
    return t;
  },
  clear: (t) => clearTimeout(t as NodeJS.Timeout),
};

/** One time a worker started waiting on someone: the same one is never pushed twice. */
const episode = (w: WorkerInfo, status: PushAlert) => `${w.id}:${status}:${w.waitingSince ?? 0}`;

const waiting = (s: WorkerStatus): s is PushAlert => s === 'needs_input' || s === 'done';

export class PushDecider {
  private latest = new Map<string, WorkerInfo>();
  private pending = new Map<string, unknown>();
  private pushed = new Set<string>();
  /** Workers whose turn ended with only away viewers at the terminal: the office counts that as seen, a phone shouldn't. */
  private unseen = new Set<string>();

  constructor(
    /** It's time: push `w`, which is `status`. */
    private push: (w: WorkerInfo, status: PushAlert) => void,
    private timers: Timers = realTimers,
    private settleMs = PUSH_SETTLE_MS,
    /** Whether a connection with a terminal open isn't really looking: its 2D view is off screen. */
    private away: (clientId: string) => boolean = () => false,
  ) {}

  /** Called with every worker update. */
  onWorker(w: WorkerInfo) {
    const prev = this.latest.get(w.id);
    this.latest.set(w.id, w);
    if (w.kind !== 'agent' || !prev) return;
    if (prev.status !== w.status) {
      this.cancel(w.id);
      this.unseen.delete(w.id);
      // A meeting's worker that ends its part is waiting on the meeting, not on anyone.
      if (w.status === 'done' && w.acked && !w.meeting && w.viewerIds.length && !this.looking(w)) this.unseen.add(w.id);
    }
    if (this.looking(w)) this.unseen.delete(w.id);
    this.consider(w);
  }

  onWorkerGone(id: string) {
    this.cancel(id);
    this.latest.delete(id);
    this.unseen.delete(id);
  }

  /** Looks at every worker again: someone with a terminal open went away. */
  recheck() {
    for (const w of this.latest.values()) if (w.kind === 'agent') this.consider(w);
  }

  /** The latest of a worker, if it's still `status` and still waiting on whoever isn't looking. */
  stillWaiting(id: string, status: PushAlert): WorkerInfo | undefined {
    const w = this.latest.get(id);
    return w && w.status === status && (!w.acked || this.unseen.has(id)) && !this.looking(w) ? w : undefined;
  }

  /** Still waiting, nobody has looked, nobody is at its terminal, and not pushed yet. */
  private due(w: WorkerInfo, status: PushAlert): boolean {
    return !this.pushed.has(episode(w, status)) && !!this.stillWaiting(w.id, status);
  }

  stop() {
    for (const id of [...this.pending.keys()]) this.cancel(id);
  }

  private looking(w: WorkerInfo): boolean {
    return w.viewerIds.some((id) => !this.away(id));
  }

  /** Starts the settle clock on a worker that would be pushed now, unless it's running already. */
  private consider(w: WorkerInfo) {
    const status = w.status;
    if (!waiting(status) || this.pending.has(w.id) || !this.due(w, status)) return;
    this.pending.set(
      w.id,
      this.timers.set(() => {
        this.pending.delete(w.id);
        const cur = this.latest.get(w.id);
        if (cur && this.due(cur, status)) this.fire(cur, status);
      }, this.settleMs),
    );
  }

  private fire(w: WorkerInfo, status: PushAlert) {
    this.pushed.add(episode(w, status));
    if (this.pushed.size > REMEMBER) this.pushed.delete(this.pushed.values().next().value!);
    this.push(w, status);
  }

  private cancel(id: string) {
    const t = this.pending.get(id);
    if (t === undefined) return;
    this.timers.clear(t);
    this.pending.delete(id);
  }
}
