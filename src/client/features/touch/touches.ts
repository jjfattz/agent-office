// The touch controls' arithmetic, kept apart from the page so the tests run it under Node: the stick
// a thumb makes, which finger is doing what, and which keys the hint bar is offering.

import type { Stick } from '../../player/stick';

/** Closer to the middle than this (a share of the stick's radius), the stick stays put: a resting thumb doesn't creep. */
export const DEAD_ZONE = 0.12;
/** Pushed this far out (a share of the radius) or more, you run (Shift). */
export const RUN_AT = 0.85;
/** The share of the screen's width, from the left, where a touch starts the stick. */
export const STICK_ZONE = 0.4;

/**
 * The stick for a thumb `dx`, `dy` px from where it landed, on a stick `radius` px across, written
 * into `out` (no garbage while the thumb moves). Inside the dead zone it's still; from there to
 * RUN_AT its length goes from 0 to 1, a walk from a crawl to full speed, and past RUN_AT it's a run.
 * Screen down is back (z +), as S is.
 */
export function stickFrom(dx: number, dy: number, radius: number, out: Stick): Stick {
  const d = Math.hypot(dx, dy);
  const at = d / radius;
  if (!(at >= DEAD_ZONE)) {
    out.x = 0;
    out.z = 0;
    out.run = false;
    return out;
  }
  const len = Math.min(1, (Math.min(at, 1) - DEAD_ZONE) / (RUN_AT - DEAD_ZONE));
  out.x = (dx / d) * len;
  out.z = (dy / d) * len;
  out.run = at >= RUN_AT;
  return out;
}

/** What a finger on the scene is doing: walking (the stick) or looking around. */
export type TouchRole = 'stick' | 'look';

/**
 * Which finger is which, by pointer id, so two thumbs never fight over one job: the first touch in
 * the stick's zone walks, and every other touch looks (two of them pinch).
 */
export class Touches {
  private roles = new Map<number, TouchRole>();

  /** A finger landed at `x` on a screen `width` wide: what it's for, now it's down. */
  start(id: number, x: number, width: number): TouchRole {
    const role: TouchRole = x < width * STICK_ZONE && !this.has('stick') ? 'stick' : 'look';
    this.roles.set(id, role);
    return role;
  }

  /** What finger `id` is doing, if it's one of ours. */
  role(id: number): TouchRole | undefined {
    return this.roles.get(id);
  }

  /** Finger `id` came up (or the browser took it: pointercancel): what it was doing. */
  end(id: number): TouchRole | undefined {
    const role = this.roles.get(id);
    this.roles.delete(id);
    return role;
  }

  /** Whether some finger is doing `role`. */
  has(role: TouchRole): boolean {
    for (const r of this.roles.values()) if (r === role) return true;
    return false;
  }

  /** How many fingers are doing `role`. */
  count(role: TouchRole): number {
    let n = 0;
    for (const r of this.roles.values()) if (r === role) n++;
    return n;
  }

  /** Every finger lets go at once (the tab hidden, the window losing focus, a window opening). */
  clear() {
    this.roles.clear();
  }

  get size(): number {
    return this.roles.size;
  }
}

/** A key the hint bar offers, with what it says it does. */
export interface HintKey {
  /** KeyboardEvent.code of the key to press. */
  code: string;
  /** What's on its key cap in the hint bar: E, Space, Q… */
  cap: string;
  /** What the hint bar says it does: "Open terminal", "Hold to throw". */
  label: string;
}

/**
 * The key a hint bar key cap stands for, or null for one the touch controls do otherwise (the stick
 * stands for W A S D, a drag for the mouse). "E / Click" is E.
 */
export function codeOf(cap: string): string | null {
  const k = cap.split(' / ')[0].trim();
  if (/^[A-Z]$/.test(k) && !'WASD'.includes(k)) return `Key${k}`;
  if (/^[0-9]$/.test(k)) return `Digit${k}`;
  if (k === 'Space') return 'Space';
  if (k === 'Esc') return 'Escape';
  if (k === 'Enter') return 'Enter';
  return null;
}

/** The keys in a hint, from its key caps and what each says, in order, each key once. */
export function hintKeys(entries: Iterable<{ cap: string; label: string }>): HintKey[] {
  const out: HintKey[] = [];
  for (const { cap, label } of entries) {
    const code = codeOf(cap);
    if (code && !out.some((k) => k.code === code)) out.push({ code, cap: cap.split(' / ')[0].trim(), label: label.trim() });
  }
  return out;
}
