// The numbered choices a waiting agent's prompt offers, read off its screen, so it can be answered
// from its card in the 2D view or a notification's button (see WorkerInfo.choices). Claude Code's
// permission prompt and its questions, and Codex's approvals, are a list with a cursor on one line:
//
//   Do you want to proceed?
//   ❯ 1. Yes
//     2. Yes, and don't ask again for npm test commands in /work/app
//     3. No, and tell Claude what to do differently (esc)
//
// Typing the number picks it, which is what the terminal's key row sends too. Anything else, or a
// numbered list without a cursor (an agent's own answer), gives none: then it's answered in its terminal.
import type { WorkerChoice } from '../../shared/protocol.js';
import type { Worker, WorkerEvents } from './types.js';
import { screenText } from './terminal.js';

/** Only a prompt's own list counts: it's near the bottom of the screen. */
const LOOK_BACK = 16;
const MAX_CHOICES = 9;
const LABEL_MAX = 60;

/** "│ ❯ 1. Yes │" → cursor, number, label. Box sides and the cursor are optional. */
const LINE = /^[\s│┃|]*([❯›>▶→➤])?\s*(\d)[.)]\s+(.+?)[\s│┃|]*$/;

/** The choices a prompt on `text` (a screen, top to bottom) offers, or undefined when there's no prompt list. */
export function readChoices(text: string): WorkerChoice[] | undefined {
  const lines = text.split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const tail = lines.slice(-LOOK_BACK);
  // The last run of consecutive numbered lines (wrapped labels in between are let through).
  let best: { n: number; label: string; cursor: boolean }[] = [];
  let run: typeof best = [];
  for (const line of tail) {
    const m = LINE.exec(line);
    if (m && Number(m[2]) === run.length + 1) {
      run.push({ n: Number(m[2]), label: m[3], cursor: !!m[1] });
    } else if (m && m[2] === '1') {
      run = [{ n: 1, label: m[3], cursor: !!m[1] }];
    } else if (!run.length || !line.trim() || /^[\s│┃|]*[╰└─]/.test(line)) {
      if (run.length) best = run;
      run = [];
      continue;
    } else continue; // a label that wrapped onto the next line
    if (run.length >= 2) best = run;
  }
  if (best.length < 2 || best.length > MAX_CHOICES || !best.some((c) => c.cursor)) return undefined;
  return best.map((c) => ({ key: String(c.n), label: clip(c.label) }));
}

const clip = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > LABEL_MAX ? `${t.slice(0, LABEL_MAX - 1)}…` : t;
};

const same = (a: WorkerChoice[] | undefined, b: WorkerChoice[] | undefined) =>
  (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((c, i) => c.key === b![i].key && c.label === b![i].label);

/**
 * Looks at a worker's screen as it's sent (see flushScreens): while it needs input, what it offers;
 * once it doesn't, nothing. Tells everyone when that changed.
 */
export function watchChoices(w: Worker, events: Pick<WorkerEvents, 'update'>) {
  const asking = w.info.status === 'needs_input' && w.info.kind === 'agent' && !!w.pty && !!w.term;
  const now = asking ? readChoices(screenText(w.term!)) : undefined;
  if (same(now, w.info.choices)) return;
  if (now) w.info.choices = now;
  else delete w.info.choices;
  events.update({ ...w.info });
}
