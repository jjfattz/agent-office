// BUGSWARM on the arcade cabinet (client/features/cabinet/bugswarm.ts): a swarm of bugs flies in,
// settles into rows and dives at your ship, and you shoot them down. Its scoring, and what its screen
// shows while someone plays, which the office checks and passes on to everyone watching.
import { SCORE_MAX, int, ints, isPlayState, type PlayState } from './common.js';

/** The field the bugs fly in, in the screen's 800×600 units: down the middle, the screen's whole height. */
export const FIELD_W = 440;
export const FIELD_H = 600;
/** The bugs in a wave. Every one of them has to go before the next wave comes in. */
export const SWARM_SIZE = 36;
/** The kinds of bug: a gnat, a wasp and a beetle (which takes two hits); 4 is a beetle that's been hit once. */
export type BugKind = 1 | 2 | 3;
/** What a bug is worth, by kind: sitting in the swarm, and on the wing (flying in, diving at you, going back). */
export const BUG_POINTS: Readonly<Record<BugKind, readonly [number, number]>> = { 1: [40, 80], 2: [60, 150], 3: [120, 300] };
/** The most one bug is worth. */
export const MOST_POINTS = Math.max(...Object.values(BUG_POINTS).flat());
/** Ships a game starts with, the most you can have, and the points between extra ones. */
export const START_SHIPS = 3;
export const MAX_SHIPS = 5;
export const EXTRA_SHIP = 10_000;

/** One picture of the cabinet's screen while someone plays BUGSWARM. Everything is in whole field units. */
export interface SwarmFrame {
  title: 'bugswarm';
  /** Where the ship is across the field, or -1 while it's gone. */
  ship: number;
  /** Four numbers a bug: its kind (1–4), x, y, and the way it's heading in degrees (90 is straight down). */
  bugs: number[];
  /** Two a shot: your shots going up, and the bugs' stings coming down. */
  shots: number[];
  stings: number[];
  /** Four a burst: x, y, how far it's gone (0–9), and 1 for a bug, 2 for your ship. */
  pops: number[];
  score: number;
  /** Bugs shot down this game: the office goes by these and the wave. */
  kills: number;
  wave: number;
  /** Ships left, the one on the field too. */
  ships: number;
  state: PlayState;
}

const X: [number, number] = [-80, FIELD_W + 80];
const Y: [number, number] = [-80, FIELD_H + 80];

/** A BUGSWARM frame a browser sent, if it is one. */
export function checkSwarmFrame(f: Record<string, unknown>): SwarmFrame | null {
  const ship = int(f.ship, -1, FIELD_W);
  const bugs = ints(f.bugs, SWARM_SIZE, [[1, 4], X, Y, [0, 359]]);
  const shots = ints(f.shots, 4, [X, Y]);
  const stings = ints(f.stings, 40, [X, Y]);
  const pops = ints(f.pops, 40, [X, Y, [0, 9], [1, 2]]);
  const score = int(f.score, 0, SCORE_MAX);
  const kills = int(f.kills, 0, SCORE_MAX);
  const wave = int(f.wave, 1, 9999);
  const ships = int(f.ships, 0, MAX_SHIPS);
  const state = isPlayState(f.state) ? f.state : null;
  if (ship === null || !bugs || !shots || !stings || !pops || score === null || kills === null || wave === null || ships === null || !state) return null;
  return { title: 'bugswarm', ship, bugs, shots, stings, pops, score, kills, wave, ships, state };
}
