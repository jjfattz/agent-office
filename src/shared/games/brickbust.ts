// BRICKBUST on the arcade cabinet (client/features/cabinet/brickbust.ts): bounce a ball off your
// paddle and knock down a wall of bricks, a new wall a level. Its walls, its scoring, and what its
// screen shows while someone plays, which the office checks and passes on to everyone watching.
//
// The walls are here, not in the game, so the office knows every one: how many bricks each level
// has, and which bricks can still be standing on it (see server/games/brickbust.ts).
import { SCORE_MAX, int, ints, isPlayState, type PlayState } from './common.js';

/** The field the ball flies in, in the screen's 800×600 units: down the middle, the screen's whole height. */
export const FIELD_W = 440;
export const FIELD_H = 600;
/** The wall: 10 bricks across, at most 10 rows of them. */
export const WALL_COLS = 10;
export const WALL_ROWS = 10;
/**
 * The bricks, by their character in a wall: '0' none, '1'–'6' a brick of that color (6 at the top
 * of the first wall, worth the most), '7' a hard one that takes two hits, '8' a hard one that's been
 * hit once, and '9' one that never breaks.
 */
export const BRICK_POINTS: readonly number[] = [0, 50, 60, 70, 80, 90, 100, 250, 250, 0];
/** The most one brick is worth. */
export const MOST_POINTS = Math.max(...BRICK_POINTS);
/** Points for knocking down a whole wall, on `level`. */
export const wallBonus = (level: number): number => 500 * Math.min(level, 20);
/** Balls a game starts with, the most you can have, and the points between extra ones. */
export const START_BALLS = 3;
export const MAX_BALLS = 5;
export const EXTRA_BALL = 20_000;
/** Balls in play at once, at most (a multi-ball splits each one in three). */
export const MAX_IN_PLAY = 8;
/** The pills that fall from bricks now and then: catch one on your paddle for what it does. */
export const DROPS = ['', 'WIDE', 'MULTI', 'SLOW', '+BALL'] as const;
export type DropKind = 1 | 2 | 3 | 4;

/** The walls, a level each, then round again (harder: see wallFor). Each is rows from the top, a character a brick. */
export const WALLS: readonly (readonly string[])[] = [
  // Stripes.
  ['0000000000', '6666666666', '5555555555', '4444444444', '3333333333', '2222222222', '1111111111'],
  // A pyramid, its top hard.
  ['0000770000', '0006666000', '0055555500', '0444444440', '3333333333', '2222222222', '1111111111'],
  // Checks, under a hard row.
  ['7070707070', '0606060606', '5050505050', '0404040404', '3030303030', '0202020202', '1010101010', '0101010101'],
  // A fort: steel walls either side, a roof and a floor to break in through, and a hard core.
  ['0000000000', '9666666669', '9500000059', '9507777059', '9504444059', '9500000059', '9333333339', '0222002220', '1111001111'],
  // A diamond, its heart hard.
  ['6600000066', '5500660055', '0005555000', '0044774400', '0337777330', '0022772200', '0001111000', '1100110011'],
  // A V, hard at its foot.
  ['1000000001', '2100000012', '3210000123', '4321001234', '5432112345', '6543223456', '7654334567'],
  // A vault: a steel box with a way in at the top, between two walls of bricks.
  ['3333333333', '0999009990', '0966666690', '0965555690', '0964444690', '0999999990', '2222222222', '1111111111'],
  // A target, ringed in hard bricks.
  ['0000770000', '0007667000', '0076556700', '0765445670', '7654334567', '0765445670', '0076556700', '0007667000', '0000770000'],
];

const breakable = (ch: string) => ch >= '1' && ch <= '8';

/** Breakable bricks in each wall: the same every time round, however many of them have turned hard. */
const COUNTS = WALLS.map((rows) => [...rows.join('')].filter(breakable).length);
const ROUND = COUNTS.reduce((a, b) => a + b, 0);

/**
 * The wall on `level`, row by row from the top, a character a brick (WALL_COLS × WALL_ROWS of them).
 * The first time round the walls are as they're drawn; each time round after, more of their bricks
 * are hard.
 */
export function wallFor(level: number): string {
  const rows = WALLS[(level - 1) % WALLS.length];
  const round = Math.floor((level - 1) / WALLS.length);
  let out = '';
  for (let r = 0; r < WALL_ROWS; r++) {
    for (let c = 0; c < WALL_COLS; c++) {
      const ch = rows[r]?.[c] ?? '0';
      out += round && ch >= '1' && ch <= '6' && (r * 3 + c + level) % Math.max(2, 6 - round) === 0 ? '7' : ch;
    }
  }
  return out;
}

/** The bricks to knock down on `level`. */
export function bricksIn(level: number): number {
  return COUNTS[(level - 1) % WALLS.length];
}

/** The bricks on every level before `level`. */
export function bricksBefore(level: number): number {
  const done = level - 1;
  let n = Math.floor(done / WALLS.length) * ROUND;
  for (let i = 0; i < done % WALLS.length; i++) n += COUNTS[i];
  return n;
}

/** The bonuses for every wall before `level`. */
export function bonusBefore(level: number): number {
  let n = 0;
  for (let l = 1; l < Math.min(level, 21); l++) n += wallBonus(l);
  return n + Math.max(0, level - 21) * wallBonus(20);
}

/** The bricks still standing in `wall` (a frame's), if they could be standing on `level`; else -1. */
export function standing(wall: string, level: number): number {
  const was = wallFor(level);
  let n = 0;
  for (let i = 0; i < was.length; i++) {
    const [now, then] = [wall[i], was[i]];
    if (now === then || (now === '8' && then === '7')) n += breakable(now) ? 1 : 0;
    else if (now !== '0' || then === '9') return -1;
  }
  return n;
}

/** One picture of the cabinet's screen while someone plays BRICKBUST. Everything is in whole field units. */
export interface BrickFrame {
  title: 'brickbust';
  /** The wall row by row from the top, a character a brick (see BRICK_POINTS). */
  wall: string;
  /** Where the middle of the paddle is across the field, and how wide it is. */
  paddle: number;
  width: number;
  /** Two numbers a ball in play: x and y. */
  balls: number[];
  /** Three a falling pill: its kind (DROPS), x and y. */
  drops: number[];
  /** Four a burst: x, y, how far it's gone (0–9), and the brick it was (1–8; 0 for a ball lost off the bottom). */
  pops: number[];
  score: number;
  /** Bricks knocked down this game: the office goes by these and the level. */
  kills: number;
  level: number;
  /** Balls left, the one in play too. */
  lives: number;
  /** Said over the field: 1 the level's coming up, 2 waiting for you to launch the ball, 0 nothing. */
  cue: number;
  state: PlayState;
}

const X: [number, number] = [-40, FIELD_W + 40];
const Y: [number, number] = [-40, FIELD_H + 40];
const WALL_RE = new RegExp(`^[0-9]{${WALL_COLS * WALL_ROWS}}$`);

/** A BRICKBUST frame a browser sent, if it is one. */
export function checkBrickFrame(f: Record<string, unknown>): BrickFrame | null {
  const wall = typeof f.wall === 'string' && WALL_RE.test(f.wall) ? f.wall : null;
  const paddle = int(f.paddle, 0, FIELD_W);
  const width = int(f.width, 20, 200);
  const balls = ints(f.balls, MAX_IN_PLAY, [X, Y]);
  const drops = ints(f.drops, 8, [[1, 4], X, Y]);
  const pops = ints(f.pops, 40, [X, Y, [0, 9], [0, 8]]);
  const score = int(f.score, 0, SCORE_MAX);
  const kills = int(f.kills, 0, SCORE_MAX);
  const level = int(f.level, 1, 9999);
  const lives = int(f.lives, 0, MAX_BALLS);
  const cue = int(f.cue, 0, 2);
  const state = isPlayState(f.state) ? f.state : null;
  if (wall === null || paddle === null || width === null || !balls || !drops || !pops || score === null || kills === null || level === null || lives === null || cue === null || !state) return null;
  return { title: 'brickbust', wall, paddle, width, balls, drops, pops, score, kills, level, lives, cue, state };
}
