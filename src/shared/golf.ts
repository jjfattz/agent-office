import { COURSE_TREES, CROWN, HOLES, TRUNK, lieAt, onCourseGround, type At, type Lie } from './course.js';

// Where a golf ball goes, on the course across the street (shared/course.ts). A shot is where it's
// played from, the club, a heading, a loft and how hard it's hit, and the ball is worked out step by
// step from those: up through the air with a little drag, through a tree's crown or off its trunk,
// off a neighbour's wall, then bouncing and rolling on whatever it comes down on (with the green's
// slope pulling it as it rolls), until it stops, drops in the cup or goes in the water. Every page on
// the floor works out the same flight from the same numbers, so the shot is all that's sent round.
// Everything's in the street's frame: y 0 is the grass.

export type Club = 'iron' | 'wedge' | 'putter';

const deg = (d: number) => (d * Math.PI) / 180;

/**
 * The clubs in the bag: how fast the ball leaves each at full power (m/s), the lofts it can be hit
 * at, and the loft it starts at. A putter rolls it along the ground.
 */
export const CLUBS: Record<Club, { name: string; speed: number; loft: readonly [number, number]; start: number }> = {
  iron: { name: 'Iron', speed: 32, loft: [deg(18), deg(55)], start: deg(36) },
  wedge: { name: 'Wedge', speed: 17, loft: [deg(30), deg(66)], start: deg(50) },
  putter: { name: 'Putter', speed: 8.5, loft: [0, 0], start: 0 },
};
export const CLUB_ORDER: readonly Club[] = ['iron', 'wedge', 'putter'];

/** The ball's radius. A real one's is 2.1 cm; this one's bigger, so it can be seen from further off. */
export const BALL_R = 0.05;
/** How high a tee holds the ball up off the grass. */
export const TEE_H = 0.03;
/** How far from the pin a ball drops in: rolling in slower than CUP_SPEED, or landing straight in. */
export const CUP = 0.13;
const CUP_SPEED = 1.9;

/** A shot: hole `hole` (0 is the first), from (x, z), with `club`. Heading 0 is +z, turning toward +x. */
export interface Shot {
  hole: number;
  x: number;
  z: number;
  club: Club;
  yaw: number;
  loft: number;
  /** 0–1, how far up the power meter. */
  power: number;
}

/** Where a ball stopped: on the course somewhere, on a neighbour's roof, or gone. */
export type Rest = Lie | 'roof';

/** A neighbour's building standing on the street: its footprint and how tall it is. */
export interface Obstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
}

export interface Hit {
  /** Seconds after the shot. */
  t: number;
  kind: 'bounce' | 'wall' | 'tree' | 'cup' | 'splash';
  at: { x: number; y: number; z: number };
  /** How hard, in m/s. */
  speed: number;
  lie?: Rest;
}

export interface Flight {
  shot: Shot;
  /** Where the ball is, every 1/60 s from the moment it's hit: x, y, z. */
  path: Float32Array;
  hits: Hit[];
  /** From the hit until it stops. */
  seconds: number;
  rest: { x: number; y: number; z: number };
  holed: boolean;
  lie: Rest;
  /** How far from the pin it stopped, or NaN if it's in the water or out of bounds. */
  fromPin: number;
}

/** Steps a second the flight's worked out in, and every how many of them the path keeps a point (60 a second). */
export const STEPS = 240;
const KEEP = 4;
const GRAVITY = 9.81;
/** Air slows it a little. */
const DRAG = 0.05;
/** Coming down slower than this, it stops bouncing and rolls. */
const ROLL_V = 1.2;
/** Longest a ball's followed. */
const MAX_SECONDS = 25;

/** How each surface takes a ball: how much of its fall it bounces back up, how much speed along it keeps on a bounce, and how fast it slows a rolling ball (m/s²). */
const GROUND: Record<Lie, { bounce: number; keep: number; roll: number }> = {
  tee: { bounce: 0.3, keep: 0.5, roll: 2.6 },
  green: { bounce: 0.26, keep: 0.42, roll: 2.4 },
  fringe: { bounce: 0.26, keep: 0.42, roll: 3.4 },
  fairway: { bounce: 0.32, keep: 0.55, roll: 2.6 },
  rough: { bounce: 0.2, keep: 0.3, roll: 6 },
  sand: { bounce: 0.03, keep: 0.08, roll: 22 },
  water: { bounce: 0, keep: 0, roll: 99 },
  out: { bounce: 0.45, keep: 0.75, roll: 1.4 },
};

/** The hole whose green (x, z) is on, if it's on one. */
function greenOf(x: number, z: number) {
  return HOLES.find((h) => Math.hypot(x - h.pin.x, z - h.pin.z) < h.green);
}

/** The club, loft and power a shot can really have: what's sent round is clamped to these first. */
export function fairShot(s: Shot): Shot {
  const club = CLUBS[s.club] ? s.club : 'iron';
  const [lo, hi] = CLUBS[club].loft;
  const hole = Math.max(0, Math.min(HOLES.length - 1, Math.round(s.hole) || 0));
  return { hole, x: s.x, z: s.z, club, yaw: Math.atan2(Math.sin(s.yaw), Math.cos(s.yaw)), loft: Math.min(hi, Math.max(lo, s.loft)), power: Math.min(1, Math.max(0, s.power)) };
}

/** Whether `s` is a shot anyone could have played: a club in the bag, from somewhere on the course, as hard and as lofted as it goes. */
export function shotOk(s: { hole: unknown; x: unknown; z: unknown; club: unknown; yaw: unknown; loft: unknown; power: unknown }): s is Shot {
  const n = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!n(s.hole) || !n(s.x) || !n(s.z) || !n(s.yaw) || !n(s.loft) || !n(s.power)) return false;
  if (typeof s.club !== 'string' || !Object.hasOwn(CLUBS, s.club)) return false;
  const [lo, hi] = CLUBS[s.club as Club].loft;
  return Number.isInteger(s.hole) && s.hole >= 0 && s.hole < HOLES.length && onCourseGround(s.x, s.z) && Math.abs(s.yaw) <= 7 && s.loft >= lo - 1e-6 && s.loft <= hi + 1e-6 && s.power >= 0 && s.power <= 1;
}

/** Where a shot goes (see the top of this file). The same shot always goes the same way. */
export function fly(input: Shot, obstacles: readonly Obstacle[] = []): Flight {
  const shot = fairShot(input);
  const club = CLUBS[shot.club];
  const pin: At = HOLES[shot.hole].pin;
  const v = club.speed * shot.power;
  const putt = shot.club === 'putter';
  let x = shot.x;
  let z = shot.z;
  let y = BALL_R + (!putt && lieAt(x, z) === 'tee' ? TEE_H : 0);
  let vx = v * Math.cos(shot.loft) * Math.sin(shot.yaw);
  let vy = v * Math.sin(shot.loft);
  let vz = v * Math.cos(shot.loft) * Math.cos(shot.yaw);
  const dt = 1 / STEPS;
  const path: number[] = [x, y, z];
  const hits: Hit[] = [];
  let rolling = putt;
  let holed = false;
  let lie: Rest = lieAt(x, z);
  let step = 0;
  /** The crowns the ball's in now, so going through one only rustles once. */
  const inCrown = new Set<number>();
  const hit = (kind: Hit['kind'], speed: number, at?: Rest) => hits.push({ t: step * dt, kind, at: { x, y, z }, speed, lie: at });

  for (; step < MAX_SECONDS * STEPS; step++) {
    if (!rolling) {
      vy -= GRAVITY * dt;
      const k = 1 - DRAG * dt;
      vx *= k;
      vy *= k;
      vz *= k;
    }
    let nx = x + vx * dt;
    const ny = y + vy * dt;
    let nz = z + vz * dt;

    // The trees: through a crown it's slowed right down and knocked about a little; a trunk sends it back.
    for (let i = 0; i < COURSE_TREES.length; i++) {
      const [tx, tz, s] = COURSE_TREES[i];
      const dx = nx - tx;
      const dz = nz - tz;
      if (Math.abs(dx) > CROWN.r * s + 0.5 || Math.abs(dz) > CROWN.r * s + 0.5) continue;
      const crown = Math.hypot(dx, ny - CROWN.y * s, dz) < CROWN.r * s;
      if (crown) {
        if (!inCrown.has(i)) {
          inCrown.add(i);
          hit('tree', Math.hypot(vx, vy, vz));
          // Which way a leafy branch knocks it is down to just where it went in.
          const kick = Math.sin(tx * 12.9898 + tz * 78.233 + nx * 3.1 + nz * 5.7) * 0.6;
          const c = Math.cos(kick);
          const sn = Math.sin(kick);
          [vx, vz] = [vx * c - vz * sn, vx * sn + vz * c];
        }
        const k = 1 - 7 * dt;
        vx *= k;
        vz *= k;
        if (vy > 0) vy *= k;
      } else inCrown.delete(i);
      const d = Math.hypot(dx, dz);
      const r = TRUNK.r * s + BALL_R;
      if (d < r && ny < TRUNK.h * s + 0.3) {
        const ux = dx / (d || 1);
        const uz = dz / (d || 1);
        const into = vx * ux + vz * uz;
        if (into < 0) {
          hit('wall', -into);
          vx -= 1.4 * into * ux;
          vz -= 1.4 * into * uz;
          vx *= 0.6;
          vz *= 0.6;
        }
        nx = tx + ux * r;
        nz = tz + uz * r;
      }
    }

    // Off the side of a neighbour's building, or down onto its roof.
    let roof = -Infinity;
    for (const b of obstacles) {
      if (nx <= b.minX || nx >= b.maxX || nz <= b.minZ || nz >= b.maxZ) continue;
      if (y - BALL_R >= b.top - 0.05) {
        roof = Math.max(roof, b.top);
        continue;
      }
      if (x <= b.minX || x >= b.maxX) {
        nx = x <= b.minX ? b.minX : b.maxX;
        hit('wall', Math.abs(vx));
        vx = -vx * 0.35;
        vz *= 0.7;
      } else {
        nz = z <= b.minZ ? b.minZ : b.maxZ;
        hit('wall', Math.abs(vz));
        vz = -vz * 0.35;
        vx *= 0.7;
      }
    }

    x = nx;
    y = ny;
    z = nz;
    const ground = Math.max(0, roof);
    const on: Rest = roof > 0 ? 'roof' : lieAt(x, z);
    if (y - BALL_R <= ground) {
      y = ground + BALL_R;
      lie = on;
      if (on === 'water') {
        hit('splash', Math.hypot(vx, vy, vz), on);
        y = -0.15;
        break;
      }
      if (on === 'roof') {
        hit('bounce', -vy, on);
        break;
      }
      const g = GROUND[on];
      const fromPin = Math.hypot(x - pin.x, z - pin.z);
      if (-vy > ROLL_V) {
        // Straight into the cup.
        if (on === 'green' && fromPin < CUP) {
          holed = true;
          break;
        }
        hit('bounce', -vy, on);
        vy = -vy * g.bounce;
        vx *= g.keep;
        vz *= g.keep;
        rolling = false;
      } else {
        vy = 0;
        rolling = true;
        // Down the green's slope, as it rolls.
        const sloped = on === 'green' ? greenOf(x, z) : undefined;
        if (sloped) {
          vx += sloped.slope.x * dt;
          vz += sloped.slope.z * dt;
        }
        const speed = Math.hypot(vx, vz);
        if (on === 'green' && fromPin < CUP && speed < CUP_SPEED) {
          holed = true;
          break;
        }
        const slow = g.roll * dt;
        if (speed <= slow) break;
        vx *= (speed - slow) / speed;
        vz *= (speed - slow) / speed;
      }
    } else if (rolling && y - BALL_R > ground + 0.01) rolling = false; // off an edge
    if (Math.abs(x) > 400 || Math.abs(z) > 400 || y < -1) {
      lie = 'out';
      break;
    }
    if ((step + 1) % KEEP === 0) path.push(x, y, z);
  }
  if (holed) {
    x = pin.x;
    z = pin.z;
    y = BALL_R - 0.12;
    lie = 'green';
    hit('cup', 0, 'green');
  }
  path.push(x, y, z);
  const inPlay = lie !== 'water' && lie !== 'out' && lie !== 'roof';
  return {
    shot,
    path: Float32Array.from(path),
    hits,
    seconds: (path.length / 3 - 1) / (STEPS / KEEP),
    rest: { x, y, z },
    holed,
    lie,
    fromPin: holed ? 0 : inPlay ? Math.hypot(x - pin.x, z - pin.z) : NaN,
  };
}

/** About how far a full swing of `club` at `loft` goes: through the air for the iron and the wedge, along a green for the putter. */
export function fullReach(club: Club, loft: number): number {
  const v = CLUBS[club].speed;
  if (club === 'putter') return (v * v) / (2 * GROUND.green.roll);
  let x = 0;
  let y = 0;
  let vx = v * Math.cos(loft);
  let vy = v * Math.sin(loft);
  const dt = 1 / 120;
  for (let i = 0; i < 2400 && (vy > 0 || y > 0); i++) {
    vy -= GRAVITY * dt;
    vx *= 1 - DRAG * dt;
    vy *= 1 - DRAG * dt;
    x += vx * dt;
    y += vy * dt;
  }
  return x;
}

/** The club a ball lying at (x, z) on hole `hole` is played with to begin with: the putter on the green, a wedge near it, else the iron. */
export function clubFor(hole: number, x: number, z: number): Club {
  const h = HOLES[hole];
  const lie = lieAt(x, z);
  if (lie === 'green' || lie === 'fringe') return 'putter';
  return Math.hypot(x - h.pin.x, z - h.pin.z) < 34 ? 'wedge' : 'iron';
}

/** A distance to the pin, as it's read out: "40 cm", "3.4 m", "27 m". */
export function pinText(m: number): string {
  if (m < 1) return `${Math.round(m * 100)} cm`;
  return m < 10 ? `${m.toFixed(1)} m` : `${Math.round(m)} m`;
}

/** Where a ball stopped, in words. */
export function lieText(f: Flight): string {
  if (f.holed) return 'In the hole!';
  switch (f.lie) {
    case 'water':
      return 'In the water';
    case 'out':
    case 'roof':
      return 'Out of bounds';
    case 'sand':
      return `In the bunker · ${pinText(f.fromPin)}`;
    case 'green':
      return `On the green · ${pinText(f.fromPin)}`;
    case 'rough':
      return `In the rough · ${pinText(f.fromPin)}`;
    default:
      return `${pinText(f.fromPin)} from the pin`;
  }
}
