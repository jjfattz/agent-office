// Golf on the course across the street (see shared/course.ts, shared/golf.ts and features/golf).

import type { Club } from '../golf.js';

export type GolfClientMsg =
  /**
   * You hit a golf ball: on hole `hole` (0 is the first), from (x, z) on the street, with `club`, its
   * heading (0 is +z, turning toward +x), loft (radians) and power (0–1). Everyone on your floor
   * works out where it goes the same way (fly in shared/golf.ts).
   */
  { t: 'golf'; hole: number; x: number; z: number; club: Club; yaw: number; loft: number; power: number };

export type GolfServerMsg =
  /** Someone on your floor hit a golf ball (see the client's 'golf'). */
  { t: 'golf'; id: string; hole: number; x: number; z: number; club: Club; yaw: number; loft: number; power: number };
