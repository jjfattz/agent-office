// DUSTBOT on the arcade cabinet (client/features/cabinet/dustbot.ts): you're the office's robot
// vacuum, hoovering every crumb off the floor while the office cats hunt you. Catch a battery and the
// vacuum roars: the cats scatter, and you can chase them back to their bed. Its maze, its scoring,
// and what its screen shows while someone plays, which the office checks and passes on to everyone
// watching.
//
// The maze is here, not in the game, so the office knows every crumb on it (see server/games/dustbot.ts).
import { SCORE_MAX, int, ints, isPlayState, type PlayState } from './common.js';

/** The field the maze is in, in the screen's 800×600 units: down the middle, the screen's whole height. */
export const FIELD_W = 440;
export const FIELD_H = 600;
/** A tile of the maze, and where its top-left corner is in the field. */
export const TILE = 20;
export const MAZE_X = 10;
export const MAZE_Y = 30;

/**
 * The office floor, row by row from the top: '#' desks and partitions, '.' a crumb, 'o' a battery,
 * ' ' bare floor, 'P' the cats' room, and '-' its cat flap (cats only). The row with open ends is a
 * corridor out one side of the floor and back in the other.
 */
export const MAZE: readonly string[] = [
  '#####################',
  '#o.....#PPPPP#.....o#',
  '#.##.#.#PPPPP#.#.##.#',
  '#.##.#.#PPPPP#.#.##.#',
  '#......###-###......#',
  '#.##.#.........#.##.#',
  '#.##.#.###.###.#.##.#',
  '#....#.#.....#.#....#',
  '####.#.#.###.#.#.####',
  '####.............####',
  '####.#####.#####.####',
  '####.###.....###.####',
  '####.###.###.###.####',
  '.........###.........',
  '####.###.###.###.####',
  '####.###.....###.####',
  '####.#####.#####.####',
  '####.............####',
  '#....#.###.###.#....#',
  '#.##.#.........#.##.#',
  '#o.#.#.##.#.##.#.#.o#',
  '##.#...... ......#.##',
  '##.#.#.###.###.#.#.##',
  '#....#...#.#...#....#',
  '#.######.#.#.######.#',
  '#...................#',
  '#####################',
];
export const MAZE_COLS = MAZE[0].length;
export const MAZE_ROWS = MAZE.length;
/** Where the vacuum starts, where the cats come out of their room, and where their bed is in it. */
export const START: readonly [number, number] = [10, 21];
export const EXIT: readonly [number, number] = [10, 5];
export const BED: readonly [number, number] = [10, 2];
/** Where a donut turns up now and then. */
export const DONUT: readonly [number, number] = [10, 17];

/** Points for a crumb, a battery, each cat caught in a row on one battery, and the most those come to. */
export const CRUMB = 10;
export const BATTERY = 50;
export const CAT_POINTS: readonly number[] = [250, 500, 750, 1000];
export const CHAIN_MOST = CAT_POINTS.reduce((a, b) => a + b, 0);
/** Points for a donut on `level`, the most one's worth, and how many turn up a level. */
export const donutPoints = (level: number): number => 100 * Math.min(level + 2, 15);
export const DONUT_MOST = donutPoints(Infinity);
export const DONUTS = 2;
/** Vacuums a game starts with, the most you can have, and the points between extra ones. */
export const START_LIVES = 3;
export const MAX_LIVES = 5;
export const EXTRA_LIFE = 10_000;

/** The floor at the start of every level, a character a tile: '0' nothing, '1' a crumb, '2' a battery. */
export const FLOOR = MAZE.join('').replace(/[^.o]/g, '0').replace(/\./g, '1').replace(/o/g, '2');
/** Crumbs and batteries on the floor at the start of a level. */
export const ITEMS = [...FLOOR].filter((ch) => ch !== '0').length;
export const BATTERIES = [...FLOOR].filter((ch) => ch === '2').length;

/** What's left on `floor` (a frame's), if it could be left on the maze: crumbs and batteries, and batteries. Null if not. */
export function leftOn(floor: string): { items: number; batteries: number } | null {
  let items = 0;
  let batteries = 0;
  for (let i = 0; i < FLOOR.length; i++) {
    if (floor[i] === '0') continue;
    if (floor[i] !== FLOOR[i]) return null;
    items++;
    if (floor[i] === '2') batteries++;
  }
  return { items, batteries };
}

/** What a cat's up to, as a frame says: hunting you, scared (and nearly over it), running home, napping, in its room, or distracted. */
export const MOOD = { hunt: 0, scared: 1, calming: 2, home: 3, nap: 4, room: 5, lull: 6 } as const;

/** One picture of the cabinet's screen while someone plays DUSTBOT. Everything is in whole field units. */
export interface MazeFrame {
  title: 'dustbot';
  /** What's still on the floor (see FLOOR). */
  floor: string;
  /** The vacuum: x, y, the way it faces (0 right, 1 down, 2 left, 3 up), and how far it's got through being pounced on (0 not; 1–9). */
  bot: number[];
  /** Four numbers a cat: which (1–4), x, y and its MOOD. */
  cats: number[];
  /** 1 while a donut's out, else 0. */
  donut: number;
  /** Three a pop-up of points: x, y and the points. */
  pops: number[];
  score: number;
  /** Crumbs and batteries hoovered up this game: the office goes by these and the level. */
  eaten: number;
  level: number;
  /** Vacuums left, the one on the floor too. */
  lives: number;
  /** Said over the maze: 1 READY, 2 the floor's clean, 0 nothing. */
  cue: number;
  state: PlayState;
}

const X: [number, number] = [-40, FIELD_W + 40];
const Y: [number, number] = [-40, FIELD_H + 40];
const FLOOR_RE = new RegExp(`^[0-2]{${FLOOR.length}}$`);

/** A DUSTBOT frame a browser sent, if it is one. */
export function checkMazeFrame(f: Record<string, unknown>): MazeFrame | null {
  const floor = typeof f.floor === 'string' && FLOOR_RE.test(f.floor) ? f.floor : null;
  const bot = ints(f.bot, 1, [X, Y, [0, 3], [0, 9]]);
  const cats = ints(f.cats, 4, [[1, 4], X, Y, [0, 6]]);
  const donut = int(f.donut, 0, 1);
  const pops = ints(f.pops, 8, [X, Y, [0, 9999]]);
  const score = int(f.score, 0, SCORE_MAX);
  const eaten = int(f.eaten, 0, SCORE_MAX);
  const level = int(f.level, 1, 9999);
  const lives = int(f.lives, 0, MAX_LIVES);
  const cue = int(f.cue, 0, 2);
  const state = isPlayState(f.state) ? f.state : null;
  if (floor === null || bot?.length !== 4 || !cats || donut === null || !pops || score === null || eaten === null || level === null || lives === null || cue === null || !state) return null;
  return { title: 'dustbot', floor, bot, cats, donut, pops, score, eaten, level, lives, cue, state };
}
