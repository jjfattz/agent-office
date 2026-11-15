// How the office follows a game of BLOCKFALL (see referee.ts).
import { CLEAR_POINTS, WELL_ROWS, levelFor, type BlocksFrame } from '../../shared/games/blockfall.js';
import type { Referee, Tally } from './referee.js';

/**
 * The fastest a player lands pieces, per second, over all their games: about as fast as anyone keeps
 * it up on these keys (a line a second, if every one went in a four-line clear). And how many more
 * they can land in a burst on top of that.
 */
export const PIECES_PER_SECOND = 2.5;
export const PIECE_BURST = 10;
/**
 * The most a piece scores on its way down: the one before it soft-dropped the whole well (a point a
 * row) and then held, and this one hard-dropped the whole well (2 a row).
 */
export const DROP_POINTS = 3 * (WELL_ROWS + 2);

/**
 * The most `lines` lines can score, cleared by `pieces` pieces landing after `before` lines: each
 * landing clears up to four at once, for their CLEAR_POINTS times the level it's on then. -Infinity
 * if that many pieces can't clear that many lines.
 */
export function clearPoints(before: number, lines: number, pieces: number): number {
  if (!lines) return 0;
  if (lines > pieces * 4) return -Infinity;
  // most[n]: the most the first n of the lines score, cleared in `landings` landings exactly.
  let most = [0, ...new Array<number>(lines).fill(-Infinity)];
  let best = -Infinity;
  for (let landings = 1; landings <= Math.min(pieces, lines); landings++) {
    const was = most;
    most = was.map((_, n) => {
      let m = -Infinity;
      for (let k = 1; k <= Math.min(4, n); k++) m = Math.max(m, was[n - k] + CLEAR_POINTS[k] * levelFor(before + n - k));
      return m;
    });
    best = Math.max(best, most[lines]);
  }
  return best;
}

interface BlocksTally extends Tally {
  lines: number;
  pieces: number;
  /** The most its cleared lines could have scored between them. */
  clears: number;
}

/**
 * A frame adds up when nothing in it went down, its level is the one its lines make, it hasn't
 * cleared more lines than its pieces could fill or scored more than they (and the lines, cleared the
 * best way they could have been) could, and its player has landed no more pieces than
 * PIECES_PER_SECOND lets them, give or take a PIECE_BURST, across all their games.
 */
export const blockfall: Referee<BlocksFrame, BlocksTally> = {
  burst: PIECE_BURST,
  perSecond: PIECES_PER_SECOND,
  fresh: () => ({ score: 0, level: 1, lines: 0, pieces: 0, clears: 0 }),
  follow(g, f, left) {
    const pieces = f.pieces - g.pieces;
    const lines = f.lines - g.lines;
    const adds = pieces >= 0 && lines >= 0 && f.score >= g.score && pieces <= left && f.lines * 10 <= f.pieces * 4 && f.level === levelFor(f.lines);
    if (!adds) return null;
    const clears = g.clears + clearPoints(g.lines, lines, pieces);
    if (f.score > DROP_POINTS * (f.pieces + 1) + clears) return null;
    return { tally: { score: f.score, level: f.level, lines: f.lines, pieces: f.pieces, clears }, used: pieces };
  },
};
