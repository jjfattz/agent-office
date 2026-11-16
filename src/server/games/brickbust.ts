// How the office follows a game of BRICKBUST (see referee.ts).
import { MOST_POINTS, bonusBefore, bricksBefore, bricksIn, standing, type BrickFrame } from '../../shared/games/brickbust.js';
import type { Referee, Tally } from './referee.js';

/**
 * The fastest a player knocks bricks down, per second, over all their games: more than a multi-ball
 * keeps up, with a wall to put back up and a ball to launch between levels. And how many more they
 * can knock down in a burst on top of that: a couple of walls' worth.
 */
export const BRICKS_PER_SECOND = 6;
export const BRICK_BURST = 120;

interface BrickTally extends Tally {
  kills: number;
}

/**
 * A frame adds up when nothing in it went down, the bricks still standing are ones its level's wall
 * has (with none back that were knocked down), its bricks knocked down are every one of the levels
 * before it and the ones gone from this wall, its score is no more than they'd be worth all at the
 * most a brick is and every wall's bonus before it, and its player has knocked down no more bricks
 * than BRICKS_PER_SECOND lets them, give or take a BRICK_BURST, across all their games.
 */
export const brickbust: Referee<BrickFrame, BrickTally> = {
  burst: BRICK_BURST,
  perSecond: BRICKS_PER_SECOND,
  fresh: () => ({ score: 0, level: 1, kills: 0 }),
  follow(g, f, left) {
    const kills = f.kills - g.kills;
    const up = standing(f.wall, f.level);
    const adds =
      f.level >= g.level &&
      kills >= 0 &&
      kills <= left &&
      f.score >= g.score &&
      up >= 0 &&
      f.kills === bricksBefore(f.level) + bricksIn(f.level) - up &&
      f.score <= f.kills * MOST_POINTS + bonusBefore(f.level);
    return adds ? { tally: { score: f.score, level: f.level, kills: f.kills }, used: kills } : null;
  },
};
