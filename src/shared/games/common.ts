// What every game on the arcade cabinet has in common (see shared/cabinet.ts): how a game stands,
// and checking the numbers a browser sends in its frames.

export type PlayState = 'play' | 'paused' | 'over';

/** The most any game scores. */
export const SCORE_MAX = 99_999_999;

export const isPlayState = (v: unknown): v is PlayState => v === 'play' || v === 'paused' || v === 'over';

/** `v` if it's a whole number from `min` to `max`, else null. */
export const int = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

/**
 * `v` if it's a flat list of whole numbers in groups of `ranges.length` (a thing's x, y and so on),
 * at most `most` groups of them, each number in its place's [min, max]; else null.
 */
export function ints(v: unknown, most: number, ranges: readonly (readonly [number, number])[]): number[] | null {
  const n = ranges.length;
  if (!Array.isArray(v) || v.length % n || v.length > most * n) return null;
  for (let i = 0; i < v.length; i++) if (int(v[i], ranges[i % n][0], ranges[i % n][1]) === null) return null;
  return v as number[];
}
