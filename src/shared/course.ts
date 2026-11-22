import { ROAD } from './layout.js';
import { FARM } from './scenic.js';

// The golf course across the street: three par 3s round a triangle south of the neighbours, so the
// last green comes back to the first tee. You come in off the street through the gap between the
// neighbours, past the cart park, and the course runs out from there:
//
//   1. Lily Pond: east of the last green, out south-east over a pond to a green tucked in by the trees.
//   2. Island Green: back west along the top of the triangle to a green out in a lake, with a footbridge.
//   3. Skyline: north-east, home toward the office and the city, a waste bunker halfway and the street
//      out of bounds past the green.
//
// It's all numbers here, so the page that draws it, the flight every page works out (shared/golf.ts),
// the carts (shared/garage.ts) and the tests agree on it. Everything's on the street, y 0 at the grass.

export interface At {
  x: number;
  z: number;
}

/** A circle of something on the ground: a blob of fairway, a bunker. */
export interface Round {
  x: number;
  z: number;
  r: number;
}

/** Water: an ellipse, `rx` across x and `rz` along z. */
export interface Pond {
  x: number;
  z: number;
  rx: number;
  rz: number;
}

export interface Hole {
  /** 1, 2 or 3. */
  n: number;
  name: string;
  /** A line about it for the sign on its tee. */
  blurb: string;
  par: number;
  /** The tee box's middle, where the ball's teed up. */
  tee: At;
  pin: At;
  /** The green's radius round the pin, and which way it runs downhill (m/s² a ball rolling on it picks up). */
  green: number;
  slope: At;
  /** The fairway, as blobs from the tee up to the green. */
  fairway: Round[];
  bunkers: Round[];
  water: Pond[];
  /** Where you play your next from after going in the water, a stroke added. */
  drop: At;
  /** The flag's colour. */
  flag: string;
}

/** The grass round a green that's cut a little longer, a collar this wide. */
export const FRINGE = 0.7;
/** How far round a tee's middle counts as the tee box (it's drawn square, this many across). */
export const TEE_BOX = 3.2;

export const HOLES: readonly Hole[] = [
  {
    n: 1,
    name: 'Lily Pond',
    blurb: 'Carry the pond. Short is wet.',
    par: 3,
    tee: { x: 10, z: 63 },
    pin: { x: 38, z: 120 },
    green: 6,
    slope: { x: -0.18, z: -0.22 },
    fairway: [
      { x: 13, z: 71, r: 4.5 },
      { x: 16, z: 80, r: 6 },
      { x: 20, z: 89, r: 6 },
      { x: 21, z: 96, r: 4 },
      { x: 35, z: 112, r: 4 },
    ],
    bunkers: [
      { x: 45, z: 124, r: 2 },
      { x: 31.5, z: 124.5, r: 1.7 },
    ],
    water: [
      { x: 30, z: 104, rx: 8.5, rz: 5.5 },
      { x: 36, z: 102.5, rx: 4.5, rz: 3.5 },
    ],
    drop: { x: 22, z: 95 },
    flag: '#ef476f',
  },
  {
    n: 2,
    name: 'Island Green',
    blurb: 'All carry. Hit the island.',
    par: 3,
    tee: { x: 29, z: 137 },
    pin: { x: -42, z: 143 },
    green: 7.5,
    slope: { x: 0.12, z: -0.16 },
    fairway: [
      { x: 21, z: 138, r: 4.5 },
      { x: 12, z: 139, r: 6 },
      { x: 2, z: 140, r: 6 },
      { x: -8, z: 141, r: 5.5 },
      { x: -16, z: 142, r: 4 },
    ],
    bunkers: [{ x: -49, z: 148.5, r: 1.6 }],
    water: [{ x: -42, z: 143, rx: 17.5, rz: 14.5 }],
    drop: { x: -20, z: 143 },
    flag: '#ffd166',
  },
  {
    n: 3,
    name: 'Skyline',
    blurb: 'Home to the office. Long is the street.',
    par: 3,
    tee: { x: -56, z: 123 },
    pin: { x: -5, z: 58 },
    green: 5.5,
    slope: { x: 0.14, z: 0.2 },
    fairway: [
      { x: -51, z: 115, r: 4.5 },
      { x: -45, z: 107, r: 6 },
      { x: -38, z: 98, r: 6 },
      { x: -20, z: 77, r: 6 },
      { x: -14, z: 69, r: 5 },
    ],
    bunkers: [
      { x: -28.5, z: 88.5, r: 2.5 },
      { x: -25.6, z: 85.5, r: 1.9 },
      { x: -12.6, z: 60, r: 1.8 },
      { x: -4.4, z: 65.9, r: 1.6 },
      { x: 0.6, z: 61.2, r: 1.6 },
    ],
    water: [],
    drop: { x: -5, z: 58 },
    flag: '#118ab2',
  },
];

/** The trees round the course, which a ball can clip: [x, z, size]. A size-1 tree's crown is CROWN.r across, CROWN.y up. */
export const COURSE_TREES: readonly [number, number, number][] = [
  // Round the first: down the left past the pond, behind the green.
  [3, 84, 1.1],
  [6, 99, 1.2],
  [12, 110, 1.0],
  [31, 80, 0.95],
  [42, 94, 1.05],
  [50, 110, 1.15],
  [53, 124, 1],
  [40, 133, 1.2],
  // Round the second, down its south side and on the far shore.
  [18, 127, 1.05],
  [-2, 130, 0.9],
  [10, 151, 1.15],
  [-12, 152, 1.1],
  [-62, 150, 1.25],
  [-66, 135, 1.05],
  // Round the third.
  [-66, 112, 1.2],
  [-54, 94, 1.1],
  [-46, 80, 1],
  [-30, 112, 1.05],
  [-18, 98, 1.15],
  [-6, 84, 1.0],
  [-20, 62, 1.05],
  // In the middle of the triangle.
  [-14, 118, 1.3],
  [4, 106, 1.1],
];
/** A tree's crown: a ball through it is slowed right down. Its trunk knocks it back. */
export const CROWN = { y: 3.4, r: 1.75 } as const;
export const TRUNK = { r: 0.3, h: 2.2 } as const;

/** Where the course is, inside its white fence: past it a ball's out of bounds (and a cart can't go). */
export const COURSE = { minX: -74, maxX: 57, minZ: 53, maxZ: 162 } as const;
/**
 * The way in off the street: the cart path across the far sidewalk, and the bit between the
 * neighbours where the carts are parked, up to the last green.
 */
export const ENTRY = { minX: -14.5, maxX: 3.5, minZ: ROAD.maxZ, maxZ: 54 } as const;
export const CART_PATH = { minX: -9, maxX: -5, minZ: ROAD.maxZ, maxZ: 42 } as const;
/** Where the carts are parked, side by side, noses toward the course. */
export const CART_PARK: readonly At[] = [
  { x: -1.6, z: 46 },
  { x: 1.4, z: 46 },
];

export type Lie = 'tee' | 'green' | 'fringe' | 'fairway' | 'rough' | 'sand' | 'water' | 'out';

const inPond = (w: Pond, x: number, z: number, grow = 0) => ((x - w.x) / (w.rx + grow)) ** 2 + ((z - w.z) / (w.rz + grow)) ** 2 < 1;
const inBox = (b: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;

/** Whether (x, z) is on the course or the way in to it. */
export function onCourseGround(x: number, z: number): boolean {
  return inBox(COURSE, x, z) || inBox(ENTRY, x, z);
}

/** What's underfoot at (x, z), and the hole it belongs to (the nearest one, for the rough). */
export function lieAt(x: number, z: number): Lie {
  if (!onCourseGround(x, z) || z < ROAD.maxZ + 2.5 || inBox(FARM.pasture, x, z)) return 'out';
  for (const h of HOLES) {
    // The island's green is in its lake: it comes before the water.
    const d = Math.hypot(x - h.pin.x, z - h.pin.z);
    if (d < h.green + FRINGE + 0.6 && h.water.some((w) => inPond(w, h.pin.x, h.pin.z))) {
      for (const b of h.bunkers) if (Math.hypot(x - b.x, z - b.z) < b.r) return 'sand';
      return d < h.green ? 'green' : d < h.green + FRINGE ? 'fringe' : 'rough';
    }
  }
  for (const h of HOLES) for (const w of h.water) if (inPond(w, x, z)) return 'water';
  for (const h of HOLES) for (const b of h.bunkers) if (Math.hypot(x - b.x, z - b.z) < b.r) return 'sand';
  for (const h of HOLES) {
    const d = Math.hypot(x - h.pin.x, z - h.pin.z);
    if (d < h.green) return 'green';
    if (d < h.green + FRINGE) return 'fringe';
  }
  for (const h of HOLES) if (Math.abs(x - h.tee.x) < TEE_BOX / 2 && Math.abs(z - h.tee.z) < TEE_BOX / 2) return 'tee';
  for (const h of HOLES) for (const f of h.fairway) if (Math.hypot(x - f.x, z - f.z) < f.r) return 'fairway';
  return 'rough';
}

/** Whether (x, z) is in any of the course's water (`grow` meters further out, to keep clear of it). */
export function inWater(x: number, z: number, grow = 0): boolean {
  return HOLES.some((h) => h.water.some((w) => inPond(w, x, z, grow)));
}

/** The island green's lake has a footbridge over it from the east shore: [x0, x1] along z, `half` wide. */
export const BRIDGE = { x0: -23.6, x1: -33.4, z: 143, half: 1.8 } as const;

/**
 * Whether a cart can drive at (x, z): anywhere inside the course's fence (see COURSE) or the way in
 * off the street, greens and bunkers and all, but not into the water (bar over the footbridge).
 */
export function cartGround(x: number, z: number): boolean {
  if (inBox({ minX: BRIDGE.x1, maxX: BRIDGE.x0, minZ: BRIDGE.z - BRIDGE.half, maxZ: BRIDGE.z + BRIDGE.half }, x, z)) return true;
  if (!onCourseGround(x, z) || inBox(FARM.pasture, x, z)) return false;
  // Over the far sidewalk (out of bounds for a ball), anywhere between the neighbours.
  if (z < ROAD.maxZ + 2.5) return true;
  return lieAt(x, z) !== 'water';
}

/** How far it is from hole `h`'s tee to its pin. */
export function holeLength(h: Hole): number {
  return Math.hypot(h.pin.x - h.tee.x, h.pin.z - h.tee.z);
}

/** The heading from (x, z) to the pin of hole `h` (0 is +z, turning toward +x). */
export function yawTo(from: At, to: At): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/** What a score on a hole is called: "Hole in one!", "Birdie", "Par", "Double bogey"… */
export function scoreName(strokes: number, par: number): string {
  if (strokes === 1) return 'Hole in one!';
  const over = strokes - par;
  if (over <= -3) return 'Albatross';
  if (over === -2) return 'Eagle';
  if (over === -1) return 'Birdie';
  if (over === 0) return 'Par';
  if (over === 1) return 'Bogey';
  if (over === 2) return 'Double bogey';
  if (over === 3) return 'Triple bogey';
  return `+${over}`;
}

/** A score against par, as a card shows it: "E", "+2", "-1". */
export function toPar(n: number): string {
  return n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`;
}
