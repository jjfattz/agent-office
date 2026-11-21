// A worker's terminal on a phone (the 2D view's keypad terminal, see TerminalOptions.keypad): A− and
// A+ for a font size you can read, kept for next time; scrolling back with one finger; and holding a
// finger on a line to select it, with a 📋 Copy that copies it (or the whole screen).
import type { Terminal } from '@xterm/xterm';
import { h, toast } from './dom';

const SIZE_KEY = 'agent-office.term-font';
const MIN = 9;
const MAX = 20;
/** Readable at 390px without too few columns. */
const PHONE_SIZE = 13;
const HOLD_MS = 500;

/** The font size a phone's terminal opens with: the last one picked, or the default. */
export function phoneFontSize(): number {
  try {
    const n = Number(localStorage.getItem(SIZE_KEY));
    return n >= MIN && n <= MAX ? n : PHONE_SIZE;
  } catch {
    return PHONE_SIZE;
  }
}

/**
 * Adds A− and A+ to `keys` (the key row), and one-finger scrolling and hold-to-copy to `host`.
 * `refit` sizes the terminal to its window again after the font changed.
 */
export function termTouch(term: Terminal, host: HTMLElement, keys: HTMLElement, refit: () => void) {
  const size = (d: number) => {
    const n = Math.min(MAX, Math.max(MIN, (term.options.fontSize ?? PHONE_SIZE) + d));
    term.options.fontSize = n;
    try {
      localStorage.setItem(SIZE_KEY, String(n));
    } catch {
      // storage blocked: just this time then
    }
    refit();
  };
  for (const [label, d, title] of [['A−', -1, 'Smaller text'], ['A+', 1, 'Bigger text']] as const) {
    const b = h('button.btn.term-size', { type: 'button', title, 'aria-label': title }, label);
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => size(d));
    keys.append(b);
  }

  const copyBar = h('div.term-copy', { hidden: true });
  host.append(copyBar);
  const hideCopy = () => {
    copyBar.hidden = true;
    term.clearSelection();
  };
  const copy = async (text: string) => {
    hideCopy();
    try {
      await navigator.clipboard.writeText(text.replace(/[ \t]+$/gm, ''));
      toast('📋 Copied');
    } catch {
      toast('The browser wouldn’t copy that', 'warn');
    }
  };
  const showCopy = () => {
    const line = h('button.btn.primary', { type: 'button', onclick: () => void copy(term.getSelection()) }, '📋 Copy');
    const all = h('button.btn', { type: 'button', onclick: () => (term.selectAll(), void copy(term.getSelection())) }, 'Copy all');
    const x = h('button.btn', { type: 'button', 'aria-label': 'Cancel', onclick: hideCopy }, '✕');
    copyBar.replaceChildren(line, all, x);
    copyBar.hidden = false;
  };

  /** The buffer row under a point on the screen. */
  const rowAt = (y: number): number | undefined => {
    const screen = host.querySelector('.xterm-screen');
    if (!screen) return undefined;
    const r = screen.getBoundingClientRect();
    const row = Math.floor(((y - r.top) / r.height) * term.rows);
    return row >= 0 && row < term.rows ? term.buffer.active.viewportY + row : undefined;
  };

  let startY = 0;
  let lastY = 0;
  let moved = false;
  let carry = 0;
  let hold: ReturnType<typeof setTimeout> | undefined;
  host.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1 || copyBar.contains(e.target as Node)) return;
      startY = lastY = e.touches[0].clientY;
      moved = false;
      carry = 0;
      clearTimeout(hold);
      hold = setTimeout(() => {
        if (moved) return;
        const row = rowAt(startY);
        if (row === undefined) return;
        navigator.vibrate?.(15);
        term.selectLines(row, row);
        showCopy();
      }, HOLD_MS);
    },
    { passive: true },
  );
  host.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      if (Math.abs(y - startY) > 8) {
        moved = true;
        clearTimeout(hold);
      }
      // Scrolling back through what it printed, a line at a time as the finger goes.
      if (term.buffer.active.type !== 'normal') return;
      const cell = (host.querySelector('.xterm-screen')?.getBoundingClientRect().height ?? 0) / term.rows || 16;
      carry += (lastY - y) / cell;
      lastY = y;
      const lines = Math.trunc(carry);
      if (lines) {
        term.scrollLines(lines);
        carry -= lines;
      }
      e.preventDefault();
    },
    { passive: false },
  );
  host.addEventListener('touchend', () => clearTimeout(hold), { passive: true });
}
