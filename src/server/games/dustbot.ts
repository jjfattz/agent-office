// How the office follows a game of DUSTBOT (see referee.ts).
import { BATTERIES, BATTERY, CHAIN_MOST, CRUMB, DONUTS, DONUT_MOST, ITEMS, leftOn, type MazeFrame } from '../../shared/games/dustbot.js';
import type { Referee, Tally } from './referee.js';

/**
 * The fastest a player hoovers things up, per second, over all their games: a crumb a tile, and the
 * vacuum never goes as fast as this many tiles a second. And how many more they can in a burst on
 * top of that, for frames that come in bunched up.
 */
export const ITEMS_PER_SECOND = 11;
export const ITEM_BURST = 60;

interface MazeTally extends Tally {
  eaten: number;
}

/** The most a game can have scored by frame `f`, with `batteries` of its batteries hoovered up. */
function most(f: MazeFrame, batteries: number): number {
  return f.eaten * CRUMB + batteries * (BATTERY - CRUMB + CHAIN_MOST) + f.level * DONUTS * DONUT_MOST;
}

/**
 * A frame adds up when nothing in it went down, what's left on its floor could be left on the maze,
 * what it's hoovered up is every crumb and battery of the levels before it and the ones gone from
 * this floor, its score is no more than they and every cat and donut there could have been are worth,
 * and its player has hoovered up no more than ITEMS_PER_SECOND lets them, give or take an
 * ITEM_BURST, across all their games.
 */
export const dustbot: Referee<MazeFrame, MazeTally> = {
  burst: ITEM_BURST,
  perSecond: ITEMS_PER_SECOND,
  fresh: () => ({ score: 0, level: 1, eaten: 0 }),
  follow(g, f, left) {
    const eaten = f.eaten - g.eaten;
    const floor = leftOn(f.floor);
    const adds =
      floor !== null &&
      f.level >= g.level &&
      eaten >= 0 &&
      eaten <= left &&
      f.score >= g.score &&
      f.eaten === f.level * ITEMS - floor.items &&
      f.score <= most(f, f.level * BATTERIES - floor.batteries);
    return adds ? { tally: { score: f.score, level: f.level, eaten: f.eaten }, used: eaten } : null;
  },
};
