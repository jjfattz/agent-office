// How the office follows a game of BUGSWARM (see referee.ts).
import { MOST_POINTS, SWARM_SIZE, type SwarmFrame } from '../../shared/games/bugswarm.js';
import type { Referee, Tally } from './referee.js';

/**
 * Every wave takes at least this long, in seconds, from the one before it going to its last bug
 * flying in (the game takes longer: see WAVE_PAUSE and the swarm's flight plan in
 * client/features/cabinet/bugswarm.ts), so nobody gets through waves faster than one in WAVE_SECONDS
 * over all their games. And how many more they can be through in a burst on top of that.
 */
export const WAVE_SECONDS = 6;
export const WAVE_BURST = 2;

interface SwarmTally extends Tally {
  kills: number;
}

/**
 * A frame adds up when nothing in it went down, its bugs shot down are every one of the waves before
 * it and no more than the one it's on has, its score is no more than they'd be worth all shot on the
 * wing, and its player is through no more waves than WAVE_SECONDS lets them, give or take a
 * WAVE_BURST, across all their games.
 */
export const bugswarm: Referee<SwarmFrame, SwarmTally> = {
  burst: WAVE_BURST,
  perSecond: 1 / WAVE_SECONDS,
  fresh: () => ({ score: 0, level: 1, kills: 0 }),
  follow(g, f, left) {
    const waves = f.wave - g.level;
    const adds =
      waves >= 0 &&
      waves <= left &&
      f.kills >= g.kills &&
      f.score >= g.score &&
      f.kills >= (f.wave - 1) * SWARM_SIZE &&
      f.kills <= f.wave * SWARM_SIZE &&
      f.score <= f.kills * MOST_POINTS;
    return adds ? { tally: { score: f.score, level: f.wave, kills: f.kills }, used: waves } : null;
  },
};
