import './cards.css';
// A card per worker in the 2D view, the ones waiting on someone first: who it is, what it's on and
// doing, and what it needs from you. One that's asking a numbered question (a permission prompt, say)
// shows the choices as buttons, answered from here without opening its terminal; one that's done
// shows ✍️ Reply, and 🔀 its pull request when it has one. One that's done or asleep has 🏠 to send it
// home (any other has it in its terminal). Tapping the card opens its terminal.
import { store } from '../state';
import { DESK_BY_ID } from '../../shared/layout';
import { isAsleep } from '../../shared/status';
import type { WorkerInfo } from '../../shared/protocol';
import { clip, h, STATUS_LABEL, timeAgo } from '../ui/dom';
import { modelBadge, providerLabel } from '../ui/provider';
import { waitingOnSomeone } from '../notify';

export interface CardActions {
  open(workerId: string): void;
  prompt(workerId: string): void;
  /** Picks one of the choices it's offering (WorkerInfo.choices). */
  answer(workerId: string, key: string): void;
  pr(workerId: string): void;
  /** Asks before sending it home (shared/send-home.ts). */
  home(workerId: string): void;
}

/** Answers sent and not yet taken: their buttons stay pressed until the worker moves on. */
const sent = new Map<string, string>();

export function workerCard(w: WorkerInfo, a: CardActions): HTMLElement {
  const desk = DESK_BY_ID.get(w.deskId);
  const waiting = waitingOnSomeone(w);
  const asleep = isAsleep(w.status);
  const badge = w.kind === 'agent' ? modelBadge(w.provider, w.model, w.effort, w.usage?.model) : undefined;
  const task = w.task?.name ?? w.title ?? (w.prompt ? clip(w.prompt, 90) : undefined);
  // What it's asking, doing or did, in a line.
  const now = w.lost
    ? '🌿 Its worktree was deleted outside agent-office: open it to fix it'
    : w.status === 'needs_input'
      ? `🙋 ${w.activity ?? 'Waiting on an answer'}`
      : asleep
        ? '💤 Asleep: open it to wake it up'
        : w.status === 'done'
          ? w.task?.summary && `✅ ${w.task.summary}`
          : (w.task?.summary ?? w.activity);
  const sub = [
    w.kind === 'agent' ? `⚙️ ${providerLabel(w.provider, store.project)}${badge ? ` · ${badge}` : ''}` : '🐚 shell',
    w.account && store.accountName(w.account) && `🪪 ${store.accountName(w.account)}`,
    desk && (desk.station ? `📌 ${desk.label}` : desk.label),
    w.worktree && `🌿 ${w.worktree.branch}`,
    w.pr && `🔀 PR #${w.pr.number}`,
    w.lastInput && `⌨️ ${w.lastInput.by} ${timeAgo(w.lastInput.at)}`,
  ].filter(Boolean);
  const asking = w.status === 'needs_input' && !w.lost && w.choices?.length ? w.choices : undefined;
  if (!asking) sent.delete(w.id);
  const done = w.status === 'done' && !w.lost;
  // One whose worktree was deleted is sent home from the window that opens to fix it.
  const restful = asleep && !w.lost;
  return h(
    'li.lite-worker',
    { class: `${w.status}${waiting ? ' waiting' : ''}` },
    h(
      'button.lite-card',
      { type: 'button', onclick: () => a.open(w.id), 'aria-label': `${w.name}, ${STATUS_LABEL[w.status] ?? w.status}: open its terminal` },
      h('span.dot', { style: `background:${w.color}` }),
      h(
        'span.lite-info',
        {},
        h('span.lite-name', {}, w.name),
        task ? h('span.lite-task', {}, task) : null,
        now ? h('span.lite-now', {}, now) : null,
        h('span.lite-sub', {}, sub.join(' · ')),
      ),
      h('span.lite-state', {}, h('span.pill', { class: w.status }, STATUS_LABEL[w.status] ?? w.status), waiting && w.waitingSince ? h('small', {}, timeAgo(w.waitingSince)) : null),
    ),
    // One that's asking something without choices to tap is answered in its terminal, where the question is.
    asleep || w.lost || w.status === 'needs_input' || done ? null : h('button.btn.lite-say', { type: 'button', title: `Send ${w.name} a prompt`, 'aria-label': `Send ${w.name} a prompt`, onclick: () => a.prompt(w.id) }, '✍️'),
    asking ? answers(w, asking, a) : null,
    done || restful
      ? h(
          'div.lite-actions',
          {},
          done ? h('button.btn', { type: 'button', onclick: () => a.prompt(w.id) }, '✍️ Reply') : null,
          done && w.pr ? h('button.btn', { type: 'button', onclick: () => a.pr(w.id) }, `🔀 PR #${w.pr.number}`) : null,
          h('button.btn.lite-home', { type: 'button', title: `Send ${w.name} home`, 'aria-label': `Send ${w.name} home`, onclick: () => a.home(w.id) }, done ? '🏠' : '🏠 Send home'),
        )
      : null,
  );
}

function answers(w: WorkerInfo, choices: NonNullable<WorkerInfo['choices']>, a: CardActions): HTMLElement {
  const picked = sent.get(w.id);
  return h(
    'div.lite-answers',
    { role: 'group', 'aria-label': `Answer ${w.name}` },
    ...choices.map((c, i) =>
      h(
        'button.btn',
        {
          type: 'button',
          class: `${i === 0 ? 'primary' : ''}${picked === c.key ? ' sent' : ''}`,
          disabled: !!picked,
          title: `Pick ${c.key}: ${c.label}`,
          onclick: () => {
            sent.set(w.id, c.key);
            a.answer(w.id, c.key);
          },
        },
        h('span.lite-key', {}, c.key),
        h('span', {}, c.label),
      ),
    ),
  );
}
