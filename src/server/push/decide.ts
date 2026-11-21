// When a worker is worth a push: the team webhook's rule (see webhook.ts). An agent that started
// waiting on input, or finished its turn, and is still that way a few seconds later with nobody at
// its terminal. Each time it starts waiting is pushed once, however many updates it sends meanwhile.
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

export class PushDecider {
  private latest = new Map<string, WorkerInfo>();
  private pending = new Map<string, unknown>();
  private pushed = new Set<string>();

  constructor(
    /** It's time: push `w`, which is `status`. */
    private push: (w: WorkerInfo, status: PushAlert) => void,
    private timers: Timers = realTimers,
    private settleMs = PUSH_SETTLE_MS,
  ) {}

  /** Called with every worker update. */
  onWorker(w: WorkerInfo) {
    const prev = this.latest.get(w.id);
    this.latest.set(w.id, w);
    if (w.kind !== 'agent' || !prev || prev.status === w.status) return;
    this.cancel(w.id);
    if (w.status !== 'needs_input' && w.status !== 'done') return;
    const status = w.status;
    this.pending.set(
      w.id,
      this.timers.set(() => {
        this.pending.delete(w.id);
        const cur = this.latest.get(w.id);
        if (cur && this.due(cur, status)) this.fire(cur, status);
      }, this.settleMs),
    );
  }

  onWorkerGone(id: string) {
    this.cancel(id);
    this.latest.delete(id);
  }

  /** Still waiting, nobody has looked, nobody is at its terminal, and not pushed yet. */
  due(w: WorkerInfo, status: PushAlert): boolean {
    return w.status === status && !w.acked && !w.viewers.length && !this.pushed.has(episode(w, status));
  }

  stop() {
    for (const id of [...this.pending.keys()]) this.cancel(id);
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
