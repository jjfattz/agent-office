import { BALCONY } from './layout.js';

// The fire pole: a way out of the building, and only out. It stands just off the west end of the
// balconies, outside their railings, and runs from over the top floor's balcony down past every one
// of them to the lot in front of the garage. From any floor you climb over the railing onto it and
// slide all the way down to the street; it never stops at the floors on the way, and nobody climbs
// up it from the street.

export const POLE = {
  /** Where it stands: clear of the balconies' west ends, which the slide goes down past. */
  x: BALCONY.minX - 0.65,
  z: (BALCONY.minZ + BALCONY.maxZ) / 2,
  radius: 0.05,
  /** How far over the top floor's balcony it goes, where it ends in a cap. */
  top: 2.9,
  /** On the balcony, inside the railing, where you (or a worker) climb over to it from. */
  grab: { x: BALCONY.minX + 0.45, z: (BALCONY.minZ + BALCONY.maxZ) / 2 },
  /** The railing's top, which you climb up onto on the way over. */
  railTop: 1.09,
  /** How far from the pole's middle your body is while you hang on it. */
  hold: 0.3,
} as const;

/** How the slide goes: gravity less the grip, as fast as `max` (m/s), braking over the last `brake` meters to `land`. */
export const SLIDE = { accel: 7.5, max: 9, brake: 1.6, land: 1.6, spin: 1.1 } as const;

/**
 * How fast you're going down the pole (m/s), with `left` meters still to go and `v` the speed so far,
 * after `dt` more seconds: picking up speed, then braking at the bottom so you land on your feet.
 */
export function slideSpeed(v: number, left: number, dt: number): number {
  const faster = Math.min(SLIDE.max, v + SLIDE.accel * dt);
  if (left > SLIDE.brake) return faster;
  // The grip tightens near the bottom: no faster than it takes to come down to `land` at the mat.
  const cap = SLIDE.land + ((SLIDE.max - SLIDE.land) * Math.max(0, left)) / SLIDE.brake;
  return Math.min(faster, cap);
}
