/**
 * Sending a worker home, as the 3D office (X at its desk) and the 2D view (🏠 on its card and in its
 * terminal) both ask it: the meeting it's in, what becomes of its worktree and branch, or a plain
 * "are you sure". No three.js here: the 2D view imports it.
 */
import type { Net } from '../net';
import type { WorkerInfo } from '../../shared/protocol';
import { store } from '../state';
import { confirmDialog, sendHomeDialog } from '../ui/prompt';
import { providerLabel } from '../ui/provider';

/** Where the worker sits: its desk's label. */
export interface HomeDesk {
  label: string;
}

/** Asks before sending `w` home, then tells the office. */
export function askSendHome(net: Net, w: WorkerInfo, desk: HomeDesk | undefined) {
  const where = desk?.label ?? 'the desk';
  const session = w.kind === 'shell' ? 'shared shell' : `${providerLabel(w.provider, store.project)} session`;
  if (w.meeting) {
    // The meeting's worktree is the whole table's: it's tidied away once they've all gone.
    const m = store.meeting.current;
    const on = m?.id === w.meeting && m.status === 'running';
    confirmDialog(`Send ${w.name} home?`, on ? `${w.name} is in the meeting on “${m.title}”, which stops without it.` : `${w.name} leaves the meeting room.`, 'Send home', () => net.send({ t: 'worker.kill', workerId: w.id }));
    return;
  }
  if (w.worktree) {
    // A worker with its own worktree: choose what becomes of the worktree and its branch.
    sendHomeDialog({
      workerId: w.id,
      name: w.name,
      where,
      worktree: w.worktree,
      repos: w.repos?.length ? [w.worktree.path.split(/[\\/]/).pop() ?? 'its own', ...w.repos.map((r) => r.name)] : undefined,
      ask: () => net.send({ t: 'worker.worktree', workerId: w.id }),
      onConfirm: (cleanup) => net.send({ t: 'worker.kill', workerId: w.id, cleanup }),
    });
    return;
  }
  const body = `This stops the ${session} at ${where} for everyone and frees the desk.`;
  confirmDialog(`Send ${w.name} home?`, body, 'Send home', () => net.send({ t: 'worker.kill', workerId: w.id }));
}
