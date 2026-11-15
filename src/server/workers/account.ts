// Moving a worker already at its desk to another provider account (WorkerInfo.account): one hired
// before its floor picked the account, say (see provider-accounts/move.ts). Its conversation is
// copied into the new account's folder, and one that's running starts over there carrying it on, as
// it would after the office restarted.
import path from 'node:path';
import { midTurn } from './lifecycle.js';
import type { Worker, WorkerContext } from './types.js';

/** How long the run it's on gets to end before it starts over on the new account anyway. */
export const MOVE_EXIT_WAIT_MS = 10_000;

/**
 * Copies session `sessionId` (none: it hasn't one yet) into the new account's folder. Returns the
 * folder it was copied from and the one it went to, or none when there was nothing to copy.
 */
export type Carry = (sessionId: string | undefined) => [from: string, to: string] | undefined;

/**
 * Puts worker `id` on account `account` (none: the machine's own login). One that isn't running just
 * takes it, for whenever it's resumed; one that is ends this run, then `carry` copies the finished
 * conversation and it's resumed on the new account. Says why it can't.
 */
export function moveAccount(ctx: WorkerContext, id: string, account: string | undefined, carry: Carry): string | undefined {
  const w = ctx.workers.get(id);
  if (!w) return 'No such worker';
  if (w.dsh) return `${w.info.name} runs no provider account`;
  w.info.account = account;
  const proc = w.pty;
  if (!proc) {
    rehome(w, carry(w.info.sessionId));
    ctx.emit(w);
    ctx.persist();
    return undefined;
  }
  // Copied now as well as once it ends, so an office that stops before then still resumes it on the
  // new account with its conversation there.
  carry(w.info.sessionId);
  // Cut off mid-turn, it carries on with it (see WorkerManager.resume).
  if (midTurn(w)) w.interrupted = true;
  // This run ending is the move, not the worker stopping: its exit is left to us (see WorkerManager.follow).
  w.pty = undefined;
  ctx.setStatus(w, 'starting');
  ctx.persist();
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    clearTimeout(timer);
    // Sent home meanwhile, started by someone else, or the office is closing (the next one resumes it).
    if (ctx.workers.get(id) !== w || w.pty || w.dsh || ctx.closing) return;
    rehome(w, carry(w.info.sessionId));
    const err = ctx.resume(id);
    if (err) ctx.events.toast(`${w.info.name} couldn't start on its new account: ${err}`, 'warn');
  };
  const timer = setTimeout(start, MOVE_EXIT_WAIT_MS);
  proc.onExit(start);
  try {
    proc.kill();
  } catch {
    // already gone
  }
  return undefined;
}

/**
 * Points its usage at the copied transcripts, read from as far as the old ones were, so the spend
 * already counted isn't counted again.
 */
function rehome(w: Worker, moved: [string, string] | undefined) {
  if (!moved) return;
  const [from, to] = moved;
  const t = w.tracker;
  const under = (f: string) => (f.startsWith(from + path.sep) ? to + f.slice(from.length) : f);
  t.files = Object.fromEntries(Object.entries(t.files).map(([f, cur]) => [under(f), cur]));
  if (t.transcript) t.transcript = under(t.transcript);
}
