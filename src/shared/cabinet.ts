// The arcade cabinet in the lounge: the games it plays, what its screen shows while someone plays,
// shared by the browser that plays (which sends it), the office (which passes it on to everyone else
// on the floor) and the browsers that watch. And its high-score tables, one a game, which are the
// whole building's (see server/cabinet.ts).
//
// A game is a module in shared/games/ (its frame, and checking one), one in server/games/ (how the
// office follows it), and one in client/features/cabinet/ (playing and drawing it); TITLES, GAME_NAMES
// and CHECKS here, REFEREES there and CARTS in the client are the lists it joins.
import { checkBlocksFrame, type BlocksFrame } from './games/blockfall.js';
import { checkBrickFrame, type BrickFrame } from './games/brickbust.js';
import { checkSwarmFrame, type SwarmFrame } from './games/bugswarm.js';
import { SCORE_MAX, int } from './games/common.js';

export type { PlayState } from './games/common.js';

/** The games on the cabinet, in the order its menu lists them. */
export const TITLES = ['blockfall', 'bugswarm', 'brickbust'] as const;
export type Title = (typeof TITLES)[number];
/** Each game's name, as it's up in lights. */
export const GAME_NAMES: Readonly<Record<Title, string>> = { blockfall: 'BLOCKFALL', bugswarm: 'BUGSWARM', brickbust: 'BRICKBUST' };

export const isTitle = (v: unknown): v is Title => (TITLES as readonly unknown[]).includes(v);

/** One picture of the cabinet's screen while someone plays: whichever game it is, by its `title`. */
export type CabinetFrame = BlocksFrame | SwarmFrame | BrickFrame;
/** The frame of game `T`. */
export type FrameOf<T extends Title> = Extract<CabinetFrame, { title: T }>;

const CHECKS: { readonly [T in Title]: (f: Record<string, unknown>) => FrameOf<T> | null } = { blockfall: checkBlocksFrame, bugswarm: checkSwarmFrame, brickbust: checkBrickFrame };

/** How many games each high-score table keeps. */
export const SCORES_KEPT = 10;

/** A game on a high-score table. */
export interface HighScore {
  /** Which game: the office names each one as it starts (see Arcade in server/cabinet.ts), and its score only ever goes up. */
  game: string;
  name: string;
  color: string;
  score: number;
  /** The level (or wave) it got to. */
  level: number;
  at: number;
}

/** The high-score tables, a game each. */
export type Scores = Record<Title, HighScore[]>;

export const noScores = (): Scores => Object.fromEntries(TITLES.map((t) => [t, []])) as unknown as Scores;

/** Who's at the cabinet on your floor (and which game they're on), and the building's high scores. */
export interface CabinetState {
  player: { id: string; name: string; title: Title; game: string } | null;
  scores: Scores;
}

/** The cabinet for someone walking onto the floor: its screen too, when a game's on. */
export interface CabinetView extends CabinetState {
  frame: CabinetFrame | null;
}

/** 12,400 */
export function scoreText(n: number): string {
  return n.toLocaleString('en-US');
}

const GAME_RE = /^[a-z0-9]{8,32}$/;

/** A frame a browser sent, if it is one: of a game the cabinet plays, and making sense for it. */
export function checkFrame(raw: unknown): CabinetFrame | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  return isTitle(f.title) ? CHECKS[f.title](f) : null;
}

/** A score read back from disk, if it is one. */
export function checkScore(raw: { game?: unknown; score?: unknown; level?: unknown }): Pick<HighScore, 'game' | 'score' | 'level'> | null {
  const game = typeof raw.game === 'string' && GAME_RE.test(raw.game) ? raw.game : null;
  const score = int(raw.score, 0, SCORE_MAX);
  const level = int(raw.level, 1, 9999);
  if (game === null || score === null || level === null) return null;
  return { game, score, level };
}
