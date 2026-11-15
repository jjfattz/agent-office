// BLOCKFALL on the arcade cabinet (client/features/cabinet/blocks.ts): its well, its scoring, and
// what its screen shows while someone plays, which the office checks and passes on to everyone watching.
import { SCORE_MAX, int, isPlayState, type PlayState } from './common.js';

/** The well the blocks fall into: 10 wide, 20 deep. */
export const WELL_COLS = 10;
export const WELL_ROWS = 20;
/** Points for clearing 1–4 lines at once, times the level they're cleared on. */
export const CLEAR_POINTS = [0, 100, 300, 500, 800];

/** The level a game is on with `lines` cleared: up one every ten, to 99. */
export function levelFor(lines: number): number {
  return Math.min(99, 1 + Math.floor(lines / 10));
}

/** One picture of the cabinet's screen while someone plays BLOCKFALL. */
export interface BlocksFrame {
  title: 'blockfall';
  /** The well row by row from the top, a character per cell: '0' empty, '1'–'7' a block's color, '8' where the falling piece will land. */
  cells: string;
  /** The piece that comes next (1–7), and the one put on hold (0 for none). */
  next: number;
  hold: number;
  score: number;
  lines: number;
  level: number;
  /** Pieces landed this game: one more is a thud, for anyone watching. */
  pieces: number;
  state: PlayState;
}

const CELLS_RE = new RegExp(`^[0-8]{${WELL_COLS * WELL_ROWS}}$`);

/** A BLOCKFALL frame a browser sent, if it is one. */
export function checkBlocksFrame(f: Record<string, unknown>): BlocksFrame | null {
  const cells = typeof f.cells === 'string' && CELLS_RE.test(f.cells) ? f.cells : null;
  const next = int(f.next, 1, 7);
  const hold = int(f.hold, 0, 7);
  const score = int(f.score, 0, SCORE_MAX);
  const lines = int(f.lines, 0, SCORE_MAX);
  const level = int(f.level, 1, 99);
  const pieces = int(f.pieces, 0, SCORE_MAX);
  const state = isPlayState(f.state) ? f.state : null;
  if (cells === null || next === null || hold === null || score === null || lines === null || level === null || pieces === null || !state) return null;
  return { title: 'blockfall', cells, next, hold, score, lines, level, pieces, state };
}
