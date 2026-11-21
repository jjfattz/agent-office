// The skeeball machine by the loft's stairs: where it stands, what it's made of, and where a roll goes.
// A roll is two numbers (which way it's aimed and how hard it's rolled), and every page on the floor
// works out the same path and the same score from them, as golf does (see features/skeeball).

import { MEETING_ROOM, STAIRS } from './layout.js';

/**
 * The machine, in its own frame: `s` along the lane from its front edge toward the target, `u`
 * across it (to the right as you face the target), and y up from the floor. Measured in meters.
 */
export const LANE = {
  /** How long the whole machine is, front to back, and how wide outside. */
  length: 3.2,
  width: 0.86,
  /** Inside the side rails: what the ball rolls between. */
  inner: 0.62,
  /** The ball trough across the front, where the balls wait. */
  trough: 0.28,
  /** The lane's surface: from the trough up to the foot of the hump. */
  start: { s: 0.28, y: 0.66 },
  foot: { s: 2.05, y: 0.82 },
  /** The top of the hump, and the angle it throws the ball up at. */
  hump: { s: 2.2, y: 0.9, angle: (32 * Math.PI) / 180 },
  /** The target: a board leaning back at `angle`, from its bottom edge at (s, y), `long` up its slope. */
  face: { s: 2.38, y: 0.78, angle: (40 * Math.PI) / 180, long: 0.95 },
  ball: 0.045,
} as const;

/** Where the machine stands: its back to the meeting room's west glass, just north of the stairs, the lane pointing east (+x). */
export const SKEEBALL = {
  /** The front edge, where you stand to roll. */
  x: MEETING_ROOM.minX - 0.1 - LANE.length,
  z: STAIRS.minZ - 0.16 - LANE.width / 2,
} as const;

/** Balls a game. */
export const BALLS = 9;
/** How far either way you can aim (radians off straight up the lane). */
export const AIM_MAX = 0.1;

/** The rings on the target, out from the middle of it: (d up the face, 0 across), each worth its points. */
export const RINGS = { d: 0.56, bands: [[0.07, 50], [0.135, 40], [0.2, 30], [0.27, 20]] } as const;
/** The two pockets in the top corners, worth 100. */
export const CORNERS = { d: 0.86, u: 0.235, r: 0.05 } as const;

const G = 9.8;
/** How quickly the lane slows a ball rolling up it (m/s²): the slope, for a rolling ball, and what the lane takes. */
const DRAG = G * ((5 / 7) * ((LANE.foot.y - LANE.start.y) / (LANE.foot.s - LANE.start.s)) + 0.025);

/** How fast a ball leaves your hand for how hard you rolled it (0–1 on the meter). */
export const speedOf = (power: number) => 1.8 + 6.4 * Math.min(1, Math.max(0, power));

/** What a roll scored: its points, what it's called, and where on the face it ended up (d up it, u across). */
export interface Outcome {
  points: number;
  label: string;
  /** Where it landed on the face (null: it never got over the hump), and the hole it dropped into. */
  land: { d: number; u: number } | null;
  hole: { d: number; u: number };
}

/** A point of the ball's path, in the machine's frame. */
export interface PathPoint {
  t: number;
  s: number;
  u: number;
  y: number;
}

/** Bounced back and forth between the rails: where something moving freely across ends up between ±half. */
export function fold(u: number, half: number): number {
  const span = 4 * half;
  const k = (((u + half) % span) + span) % span;
  return k <= 2 * half ? k - half : 3 * half - k;
}

/** Where a point d up the face and u across it is, in the machine's frame. */
export function onFace(d: number, u: number): { s: number; u: number; y: number } {
  const f = LANE.face;
  return { s: f.s + d * Math.cos(f.angle), u, y: f.y + d * Math.sin(f.angle) };
}

/** The lane's surface height at s, below the hump. */
function laneY(s: number): number {
  const { start, foot, hump } = LANE;
  if (s <= foot.s) return start.y + ((s - start.s) * (foot.y - start.y)) / (foot.s - start.s);
  const k = Math.min(1, (s - foot.s) / (hump.s - foot.s));
  return foot.y + (hump.y - foot.y) * k * k;
}

/** What a ball that lands at (d, u) on the face (or off it) scores, and the hole it rolls down into. */
export function scoreAt(d: number, u: number): Outcome {
  const land = { d, u };
  if (d > LANE.face.long) return { points: 10, label: 'Off the back', land, hole: { d: 0.03, u: u * 0.5 } };
  if (d < 0) return { points: 10, label: '10', land, hole: { d: 0.03, u } };
  for (const side of [-1, 1]) if (Math.hypot(d - CORNERS.d, u - side * CORNERS.u) < CORNERS.r) return { points: 100, label: '100', land, hole: { d: CORNERS.d, u: side * CORNERS.u } };
  const r = Math.hypot(d - RINGS.d, u);
  let inner = 0;
  for (const [outer, points] of RINGS.bands) {
    if (r < outer) {
      // It rolls down its ring to the bottom of it, and drops in (the 50's cup is in the middle).
      if (points === 50) return { points, label: '50', land, hole: { d: RINGS.d, u: 0 } };
      const mid = (inner + outer) / 2;
      const across = Math.max(-mid * 0.9, Math.min(mid * 0.9, u));
      return { points, label: String(points), land, hole: { d: RINGS.d - Math.sqrt(mid * mid - across * across), u: across } };
    }
    inner = outer;
  }
  return { points: 10, label: '10', land, hole: { d: 0.03, u } };
}

/**
 * A roll, aimed `aim` radians off straight (positive: to the right) and rolled `power` (0–1): the
 * ball's path through the machine, a point every 1/60 s, and what it scored. Too soft, and it never
 * gets over the hump and rolls back to you, for nothing.
 */
export function roll(aim: number, power: number): { path: PathPoint[]; outcome: Outcome } {
  const a = Math.max(-AIM_MAX, Math.min(AIM_MAX, aim));
  const v0 = speedOf(power);
  const vf = v0 * Math.cos(a);
  const vu = v0 * Math.sin(a);
  const half = LANE.inner / 2 - LANE.ball;
  const r = LANE.ball;
  const dt = 1 / 60;
  const path: PathPoint[] = [];
  const at = (t: number, s: number, u: number, y: number) => path.push({ t, s, u, y });
  const run = LANE.hump.s - LANE.start.s;
  // Up the lane: slowing all the way, bouncing off the rails.
  const reach = (vf * vf) / (2 * DRAG);
  if (reach < run) {
    // Too soft: it slows, stops and rolls back down to the trough.
    const tUp = vf / DRAG;
    const tDown = Math.sqrt((2 * reach) / DRAG);
    for (let t = 0; t < tUp + tDown; t += dt) {
      const back = t > tUp;
      const s = LANE.start.s + (back ? reach - (DRAG * (t - tUp) ** 2) / 2 : vf * t - (DRAG * t * t) / 2);
      at(t, s, fold(vu * Math.min(t, tUp), half), laneY(s) + r);
    }
    const end = path[path.length - 1];
    at(tUp + tDown, LANE.start.s, end.u, LANE.start.y + r);
    return { path, outcome: { points: 0, label: 'Too soft', land: null, hole: { d: 0, u: end.u } } };
  }
  const v1 = Math.sqrt(vf * vf - 2 * DRAG * run);
  const tLane = (vf - v1) / DRAG;
  for (let t = 0; t < tLane; t += dt) {
    const s = LANE.start.s + vf * t - (DRAG * t * t) / 2;
    at(t, s, fold(vu * t, half), laneY(s) + r);
  }
  // Off the hump and through the air, onto the face (or short of it, or over it).
  const { hump, face } = LANE;
  const vs = v1 * Math.cos(hump.angle);
  const vy = v1 * Math.sin(hump.angle);
  const tan = Math.tan(face.angle);
  const s0 = hump.s;
  const y0 = hump.y + r;
  // Solve y(t) = the face's surface under it: (g/2)t² + (vs·tan − vy)t + (faceY(s0) − y0) = 0.
  const c = face.y + r / Math.cos(face.angle) + (s0 - face.s) * tan - y0;
  const b = vs * tan - vy;
  const disc = b * b - 2 * G * c;
  let tAir = disc >= 0 ? (-b + Math.sqrt(disc)) / G : 0;
  // Over the top of the face: it hits the back, and drops off it.
  const top = face.s + face.long * Math.cos(face.angle);
  const tBack = (top + 0.02 - s0) / vs;
  if (tAir <= 0 || tAir > tBack) tAir = Math.min(tBack, Math.max(tAir, 0.05));
  const u0 = vu * tLane;
  for (let t = 0; t < tAir; t += dt) at(tLane + t, s0 + vs * t, fold(u0 + vu * t, half), y0 + vy * t - (G * t * t) / 2);
  const sLand = s0 + vs * tAir;
  const uLand = fold(u0 + vu * tAir, half);
  const dLand = (sLand - face.s) / Math.cos(face.angle);
  const outcome = scoreAt(sLand > top ? face.long + 0.1 : dLand, uLand);
  // Down the face to its hole, and in.
  const t0 = tLane + tAir;
  const from = sLand > top ? { s: top, u: uLand, y: face.y + face.long * Math.sin(face.angle) + 0.3 } : onFace(Math.max(0, dLand), uLand);
  if (sLand <= top) from.y += r;
  const to = onFace(outcome.hole.d, outcome.hole.u);
  const settle = 0.45;
  for (let t = 0; t <= settle; t += dt) {
    const k = t / settle;
    const e = k * k;
    at(t0 + t, from.s + (to.s - from.s) * e, from.u + (to.u - from.u) * e, from.y + (to.y + r - from.y) * e);
  }
  // And down through the hole.
  for (let t = dt; t <= 0.15; t += dt) at(t0 + settle + t, to.s, to.u, to.y + r - t * 2);
  return { path, outcome };
}

/** Where along `path` the ball is at time t (s since it was let go), between its points. */
export function pathAt(path: readonly PathPoint[], t: number): PathPoint {
  if (t <= path[0].t) return path[0];
  const last = path[path.length - 1];
  if (t >= last.t) return last;
  let lo = 0;
  let hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = path[lo];
  const b = path[hi];
  const k = (t - a.t) / (b.t - a.t || 1);
  return { t, s: a.s + (b.s - a.s) * k, u: a.u + (b.u - a.u) * k, y: a.y + (b.y - a.y) * k };
}

/** Whether a roll from the wire is one anybody could have rolled. */
export function rollOk(m: { aim: unknown; power: unknown; n: unknown }): m is { aim: number; power: number; n: number } {
  return (
    typeof m.aim === 'number' &&
    Number.isFinite(m.aim) &&
    Math.abs(m.aim) <= AIM_MAX &&
    typeof m.power === 'number' &&
    Number.isFinite(m.power) &&
    m.power >= 0 &&
    m.power <= 1 &&
    Number.isInteger(m.n) &&
    (m.n as number) >= 1 &&
    (m.n as number) <= BALLS
  );
}
