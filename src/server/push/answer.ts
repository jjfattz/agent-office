// Answering a worker that's waiting on a choice (WorkerInfo.choices) from its card in the 2D view, or
// from a notification's button, without opening its terminal: the key that picks it is typed into
// its terminal, the same as the terminal's key row would.
import type { Ctx } from '../office/context.js';
import { str } from '../office/input.js';

/** Picks choice `key` for worker `workerId` as `by`. Returns why it couldn't, if it couldn't. */
export function answerWorker(ctx: Ctx, workerId: unknown, key: unknown, by: string): string | undefined {
  const id = str(workerId, 32);
  const floor = ctx.workerFloor(id);
  const w = floor?.workers.get(id);
  if (!floor || !w) return 'That worker has gone home';
  const choice = w.status === 'needs_input' ? w.choices?.find((c) => c.key === key) : undefined;
  // Only a choice it's offering right now: a stale tap mustn't type a stray "1" into its next prompt.
  if (!choice) return `${w.name} isn't asking that any more`;
  floor.workers.write(id, choice.key, by);
  console.log(`  ${by} answered ${w.name}: ${choice.key}. ${choice.label}`);
  return undefined;
}
