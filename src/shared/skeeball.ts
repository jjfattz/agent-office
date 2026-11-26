// The skeeball machine by the loft's stairs: where it stands, what it's made of, and where a roll goes.
// A roll is two numbers (where across the target it's aimed and how hard it's rolled), and the ball
// is simulated step by step from them: rolling up the lane and slowing, launched off the hump,
// bouncing on the target, knocked back by the rings' lips, and rolling down until it drops into a
// hole. Every page on the floor runs the same simulation, as golf does (see features/skeeball).

import { meterAt } from './bargames.js';
import { MEETING_ROOM, STAIRS } from './layout.js';

/**
 * The machine, in its own frame: `s` along the lane from its front edge toward the target, `u`
 * across it (to the right as you face the target), and y up from the floor. Measured in meters.
 */
export const LANE = {
  /** How long the whole machine is, front to back, and how wide outside. */
  length: 3.22,
  width: 1.26,
  /** Inside the side rails: what the ball rolls between. */
  inner: 1.0,
  /** The ball trough across the front, where the balls wait. */
  trough: 0.3,
  /** The lane's surface: from the trough up to the foot of the hump. */
  start: { s: 0.3, y: 0.68 },
  foot: { s: 2.0, y: 0.84 },
  /** The top of the hump, and the angle it throws the ball up at. */
  hump: { s: 2.2, y: 0.93, angle: (30 * Math.PI) / 180 },
  /** The floor of the pit between the hump and the target, where a short ball drops into the 10. */
  pit: 0.6,
  /** The target: a board leaning back at `angle`, from its bottom edge at (s, y), `long` up its slope. */
  face: { s: 2.36, y: 0.8, angle: (38 * Math.PI) / 180, long: 1.0 },
  /** The back wall the target leans against (its front, along the lane). */
  back: 3.155,
  /** The net over the target: from (s, y) at its front up to its back, where the display is. */
  net: { s0: 1.9, y0: 1.06, s1: 2.88, y1: 1.86 },
  ball: 0.036,
} as const;

/**
 * How much bigger the machine stands in the room than its own frame measures: everything about it,
 * the ball's roll included, is worked out in LANE's meters and drawn this much bigger.
 */
export const SIZE = 1.1;

/** Where the machine stands: its back to the meeting room's west glass, just north of the stairs, the lane pointing east (+x). */
export const SKEEBALL = {
  /** The front edge, where you stand to roll. */
  x: MEETING_ROOM.minX - 0.1 - LANE.length * SIZE,
  z: STAIRS.minZ - 0.16 - (LANE.width * SIZE) / 2,
  /** How long and wide it stands in the room. */
  length: LANE.length * SIZE,
  width: LANE.width * SIZE,
} as const;

/** Balls a game. */
export const BALLS = 9;
/** The points a ball can score. */
export const POINTS = [0, 10, 20, 30, 40, 50, 100] as const;

/** The rings on the target round (d up the face, 0 across): each lip's radius, and what lands inside it (and outside the next one in) scores. */
export const RINGS = { d: 0.55, bands: [[0.06, 50], [0.15, 40], [0.24, 30], [0.33, 20]] } as const;
/** The two pockets up in the corners, outside the rings and in from the rails, worth 100. */
export const CORNERS = { d: 0.82, u: 0.39, r: 0.055 } as const;
/** How far round from straight down the hole in each band reaches, either way (radians). */
export const HOLE_SPREAD = 0.85;

/**
 * How far across the target you can aim (meters either side of the middle of the rings): from rail
 * to rail. Out at the ends the ball runs into the rail and dies against it; the way to a 100 is the
 * narrow gap between the rings and the rail, rolled just hard enough to stop over the pocket.
 */
export const AIM_MAX = 0.46;

/** The aim slider crosses the bar from one end to the other in this long (s), then comes back. */
export const SWEEP = 0.55;

/** Where the aim slider is `secs` into a sweep that set off from the `from` end (−1: left, 1: right), as an aim across the target. */
export const aimSweep = (secs: number, from: number) => from * AIM_MAX * (1 - 2 * meterAt(secs, SWEEP));

const G = 9.81;
const R = LANE.ball;
const SIN_A = Math.sin(LANE.face.angle);
const COS_A = Math.cos(LANE.face.angle);
const TAN_A = SIN_A / COS_A;
/** How hard the lane is going up, as a slope. */
const K_LANE = (LANE.foot.y - LANE.start.y) / (LANE.foot.s - LANE.start.s);
const K_HUMP = Math.tan(LANE.hump.angle);
/** Where along the lane the ball's aimed from: the middle of the rings, as far up as the lane goes. */
const AIM_RUN = LANE.face.s + RINGS.d * COS_A - LANE.start.s;
/** A ball's rolling resistance on the maple, and on the target's felt (as a part of g). */
const ROLL_LANE = 0.012;
const ROLL_FACE = 0.06;
/** How much bounce a ball keeps off the target, the back wall, the rails and a ring's lip. */
const BOUNCE = { face: 0.22, back: 0.55, rail: 0.1, lip: 0.35, net: 0.3 };
/**
 * Each ring stands a step higher than the one round it, so its lip is a little wall from outside and
 * a drop from inside. Into one from outside, a ball has to be going this fast square on (m/s) to hop
 * up over it; out of one anywhere but its hole, this fast.
 */
const HOP_IN = 1.8;
const HOP_OUT = 2.2;
/** Faster than this (m/s), a ball skips over a pocket's hole instead of dropping in. */
const SKIP = 1.1;
/** Slower than this (m/s) at the bottom of its band, a ball drops through the hole there. */
const DROP = 1.6;
const DT = 1 / 240;
/** Every how many steps a point of the path is kept (1/60 s). */
const KEEP = 4;
/** Longest a ball is followed (s) before it's called where it is. */
const MAX_T = 6;

/** How fast a ball leaves your hand for how hard you rolled it (0–1 on the meter). */
export const speedOf = (power: number) => 1.2 + 7.3 * Math.min(1, Math.max(0, power));

/** What a roll scored, what that's called, and the hole it dropped into (d up the face, u across; d < 0 is the gutter). */
export interface Outcome {
  points: number;
  label: string;
  hole: { d: number; u: number };
}

/** A point of the ball's path, in the machine's frame (its middle). */
export interface PathPoint {
  t: number;
  s: number;
  u: number;
  y: number;
}

/** Something the ball did on its way, for a sound: off the hump, onto the target, off a lip, the back wall or a rail, or down a hole. */
export interface RollEvent {
  t: number;
  kind: 'hop' | 'land' | 'lip' | 'back' | 'rail' | 'drop';
  /** How hard (m/s). */
  speed: number;
}

/** The lane's surface height at s, from the trough to the top of the hump (a smooth curve up from its foot). */
export function laneY(s: number): number {
  const { start, foot, hump } = LANE;
  if (s <= foot.s) return start.y + (s - start.s) * K_LANE;
  const h = hump.s - foot.s;
  const k = Math.min(1, (s - foot.s) / h);
  // Cubic Hermite from (foot, K_LANE) to (hump, K_HUMP).
  const h00 = 2 * k ** 3 - 3 * k ** 2 + 1;
  const h10 = k ** 3 - 2 * k ** 2 + k;
  const h01 = -2 * k ** 3 + 3 * k ** 2;
  const h11 = k ** 3 - k ** 2;
  return h00 * foot.y + h10 * h * K_LANE + h01 * hump.y + h11 * h * K_HUMP;
}

/** How high the net over the target is at s (the ball's top can't go past it). */
function netY(s: number): number {
  const n = LANE.net;
  if (s <= n.s0) return 9;
  return n.y0 + ((Math.min(s, n.s1) - n.s0) * (n.y1 - n.y0)) / (n.s1 - n.s0);
}

/** The lane's slope at s. */
function laneSlope(s: number): number {
  const a = Math.max(LANE.start.s, s - 0.002);
  const b = Math.min(LANE.hump.s, s + 0.002);
  return (laneY(b) - laneY(a)) / (b - a);
}

/** Where a point d up the face and u across it is in the machine's frame, `lift` out from its surface. */
export function onFace(d: number, u: number, lift = 0): { s: number; u: number; y: number } {
  const f = LANE.face;
  return { s: f.s + d * COS_A - lift * SIN_A, u, y: f.y + d * SIN_A + lift * COS_A };
}

/** What the target scores for a ball dropping at (d, u): the pockets, the rings, or the 10. */
export function scoreAt(d: number, u: number): number {
  for (const side of [-1, 1]) if (Math.hypot(d - CORNERS.d, u - side * CORNERS.u) < CORNERS.r) return 100;
  const r = Math.hypot(d - RINGS.d, u);
  for (const [outer, points] of RINGS.bands) if (r < outer) return points;
  return 10;
}

/** Which way to roll to hit `aimU` across the target (radians off straight up the lane). */
export const aimAngle = (aimU: number) => Math.atan2(Math.max(-AIM_MAX, Math.min(AIM_MAX, aimU)), AIM_RUN);

/**
 * A roll aimed at `aimU` across the target (meters from its middle, positive: right) and rolled
 * `power` hard (0–1): the ball's path through the machine, a point every 1/60 s, what it did on the
 * way, and what it scored. Too soft, and it never gets over the hump and rolls back to you, for nothing.
 */
export function roll(aimU: number, power: number): { path: PathPoint[]; events: RollEvent[]; outcome: Outcome } {
  const a = aimAngle(aimU);
  const v0 = speedOf(power);
  const half = LANE.inner / 2 - R;
  const path: PathPoint[] = [];
  const events: RollEvent[] = [];
  let t = 0;
  let step = 0;
  // Where it is and how it's going: on the lane (v along it), in the air (vs, vy), or on the face (d, vd).
  let mode: 'lane' | 'air' | 'face' = 'lane';
  let s: number = LANE.start.s;
  let u = 0;
  let y = laneY(s) + R;
  let v = v0 * Math.cos(a);
  let vu = v0 * Math.sin(a);
  let vs = 0;
  let vy = 0;
  let d = 0;
  let vd = 0;
  const keep = (force = false) => {
    if (force || step % KEEP === 0) path.push({ t, s, u, y });
  };
  /** Off a rail, back the other way. */
  const rails = () => {
    if (Math.abs(u) <= half) return;
    if (Math.abs(vu) > 0.25) events.push({ t, kind: 'rail', speed: Math.abs(vu) });
    u = Math.sign(u) * (2 * half - Math.abs(u));
    vu = -vu * BOUNCE.rail;
  };
  const done = (points: number, label: string, hole: { d: number; u: number }) => {
    keep(true);
    // Down through the hole, or off the bottom of the target into the gutter.
    const at = hole.d < 0 ? { s: LANE.hump.s + 0.08, u: hole.u, y: LANE.pit } : onFace(hole.d, hole.u, R);
    const from = { ...path[path.length - 1] };
    const frames = 13;
    for (let k = 1; k <= frames; k++) {
      const f = k / frames;
      path.push({ t: t + f * 0.22, s: from.s + (at.s - from.s) * f, u: from.u + (at.u - from.u) * f, y: from.y + (at.y - R * 1.5 - from.y) * f * f });
    }
    events.push({ t: t + 0.08, kind: 'drop', speed: 1 });
    return { path, events, outcome: { points, label, hole } };
  };
  keep(true);
  while (t < MAX_T) {
    t += DT;
    step++;
    if (mode === 'lane') {
      const k = laneSlope(s);
      const c = 1 / Math.sqrt(1 + k * k);
      // Rolling: 5/7 of gravity down the slope, and the lane's resistance against the way it's going.
      v += (-(5 / 7) * G * k * c - Math.sign(v) * ROLL_LANE * G * c) * DT;
      vu -= Math.sign(vu) * Math.min(Math.abs(vu), ROLL_LANE * G * 0.3 * DT);
      s += v * c * DT;
      u += vu * DT;
      rails();
      if (s <= LANE.start.s && v < 0) {
        s = LANE.start.s;
        y = laneY(s) + R;
        return done(0, 'Too soft', { d: -1, u });
      }
      if (s >= LANE.hump.s) {
        // Off the end of the hump and into the air, the way it was going.
        const c2 = 1 / Math.sqrt(1 + K_HUMP * K_HUMP);
        vs = v * c2;
        vy = v * K_HUMP * c2;
        s = LANE.hump.s;
        y = LANE.hump.y + R;
        mode = 'air';
        events.push({ t, kind: 'hop', speed: v });
      } else y = laneY(s) + R;
    } else if (mode === 'air') {
      vy -= G * DT;
      s += vs * DT;
      y += vy * DT;
      u += vu * DT;
      rails();
      if (s + R > LANE.back) {
        events.push({ t, kind: 'back', speed: Math.abs(vs) });
        s = LANE.back - R;
        vs = -vs * BOUNCE.back;
      }
      const top = netY(s);
      if (y + R > top && vy > 0) {
        y = top - R;
        vy = -vy * BOUNCE.net;
        vs *= 0.7;
      }
      if (s < LANE.face.s && y - R <= LANE.pit) return done(10, '10', { d: -1, u });
      if (s < LANE.hump.s && y - R <= laneY(s)) {
        // Back over the hump and onto the lane: it rolls back down to you.
        mode = 'lane';
        v = Math.min(0, vs);
        y = laneY(s) + R;
        continue;
      }
      if (s >= LANE.face.s - R) {
        // Square to the target: how far off it, and how fast toward it and along it.
        const off = (y - (LANE.face.y + (s - LANE.face.s) * TAN_A)) * COS_A;
        if (off <= R) {
          const vt = vs * COS_A + vy * SIN_A;
          let vn = -vs * SIN_A + vy * COS_A;
          d = (s - LANE.face.s) * COS_A + (y - LANE.face.y) * SIN_A;
          if (vn < 0) {
            events.push({ t, kind: 'land', speed: -vn });
            vn = -vn * BOUNCE.face;
          }
          const p = onFace(d, u, R);
          s = p.s;
          y = p.y;
          if (vn < 0.5 || d < 0) {
            mode = 'face';
            vd = vt * 0.6;
            vu *= 0.6;
          } else {
            vs = vt * 0.85 * COS_A - vn * SIN_A;
            vy = vt * 0.85 * SIN_A + vn * COS_A;
          }
        }
      }
    } else {
      // On the target: down its slope, and its felt slowing it whichever way it goes.
      const sp = Math.hypot(vd, vu);
      vd -= (5 / 7) * G * SIN_A * DT;
      if (sp > 1e-6) {
        const k = Math.max(0, sp - ROLL_FACE * G * COS_A * DT) / sp;
        vd *= k;
        vu *= k;
      }
      const pd = d;
      const pu = u;
      d += vd * DT;
      u += vu * DT;
      rails();
      if (d + R > LANE.face.long) {
        if (vd > 0.25) events.push({ t, kind: 'back', speed: vd });
        d = LANE.face.long - R;
        vd = -vd * BOUNCE.back;
      }
      // The rings' lips: square into one slowly and it knocks the ball back; faster, over it goes.
      const r0 = Math.hypot(pd - RINGS.d, pu);
      const r1 = Math.hypot(d - RINGS.d, u);
      for (const [lip] of RINGS.bands) {
        if ((r0 - lip) * (r1 - lip) >= 0) continue;
        const nd = (pd - RINGS.d) / (r0 || 1);
        const nu = pu / (r0 || 1);
        const vr = vd * nd + vu * nu;
        // Out through the hole round the bottom of the band is the way down, not a lip to bounce off.
        const out = r1 > r0;
        const atHole = out && Math.abs(Math.atan2(u, RINGS.d - d)) < HOLE_SPREAD;
        if (atHole) break;
        if (Math.abs(vr) < (out ? HOP_OUT : HOP_IN)) {
          if (Math.abs(vr) > 0.15) events.push({ t, kind: 'lip', speed: Math.abs(vr) });
          vd -= (1 + BOUNCE.lip) * vr * nd;
          vu -= (1 + BOUNCE.lip) * vr * nu;
          d = pd;
          u = pu;
          // Leaning on a lip, it rolls off round it, downhill (off to the right from dead on top).
          if (Math.abs(vr) < 0.4) {
            const side = Math.abs(nu) < 1e-3 ? (nd > 0 ? 1 : -1) : Math.sign(nu) * (nd > 0 ? 1 : -1);
            vd += 0.12 * -nu * side;
            vu += 0.12 * nd * side;
          }
        } else {
          vd *= 0.8;
          vu *= 0.8;
        }
        break;
      }
      const p = onFace(d, u, R);
      s = p.s;
      y = p.y;
      // Into a pocket, the 50's cup, or the hole round the bottom of its band; or off the bottom into the gutter.
      const speed = Math.hypot(vd, vu);
      for (const side of [-1, 1]) if (speed < SKIP && Math.hypot(d - CORNERS.d, u - side * CORNERS.u) < CORNERS.r - R * 0.6) return done(100, '100', { d: CORNERS.d, u: side * CORNERS.u });
      const r = Math.hypot(d - RINGS.d, u);
      if (r < RINGS.bands[0][0] - R * 0.6 && speed < SKIP) return done(50, '50', { d: RINGS.d, u: 0 });
      const band = RINGS.bands.find(([outer]) => r < outer);
      if (band && band[1] !== 50 && r > band[0] - R * 1.15 && Math.abs(Math.atan2(u, RINGS.d - d)) < HOLE_SPREAD && speed < DROP) return done(band[1], String(band[1]), { d, u });
      if (d < R * 0.5 && vd <= 0) return done(10, '10', { d: -1, u });
    }
    keep();
  }
  // It never settled: wherever it is, that's where it drops.
  const points = mode === 'face' ? scoreAt(d, u) : 10;
  return done(points, String(points), mode === 'face' ? { d, u } : { d: -1, u });
}

/** Where a roll first comes down on the target (d up it, u across), or null if it never gets there (too soft, or short into the pit). */
export function landing(aimU: number, power: number): { d: number; u: number } | null {
  const { path, events } = roll(aimU, power);
  const land = events.find((e) => e.kind === 'land');
  if (!land) return null;
  const p = pathAt(path, land.t);
  return { d: Math.max(0, (p.s - LANE.face.s) * COS_A + (p.y - LANE.face.y) * SIN_A), u: p.u };
}

/**
 * The power gauge on the target for a roll aimed at `aimU`: where the ball first comes down for each
 * step of the meter, from nothing (0) to full (`steps`). Too soft to get there is the bottom edge, on
 * the aim line, and it only ever climbs, so the mark on the target rides up and down with the meter.
 */
export function landingGauge(aimU: number, steps = 100): { d: number; u: number }[] {
  const foot = Math.tan(aimAngle(aimU)) * (LANE.face.s - LANE.start.s);
  const out: { d: number; u: number }[] = [];
  let last = { d: 0, u: foot };
  for (let i = 0; i <= steps; i++) {
    const at = landing(aimU, i / steps);
    if (at && at.d >= last.d) last = at;
    out.push(last);
  }
  return out;
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
export function rollOk(m: { aim: unknown; power: unknown; n: unknown; points: unknown }): m is { aim: number; power: number; n: number; points: number } {
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
    (m.n as number) <= BALLS &&
    (POINTS as readonly unknown[]).includes(m.points)
  );
}
