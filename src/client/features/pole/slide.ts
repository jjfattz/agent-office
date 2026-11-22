import * as THREE from 'three';
import { POLE, SLIDE, slideSpeed } from '../../../shared/pole';

// Going down the fire pole, for you and for a worker sent home alike: up over the railing in a hop and
// onto the pole, down it (picking up speed, turning slowly round it, braking at the bottom), and a
// step off the mat onto the lot.

/** Seconds climbing over the railing onto the pole, and stepping off it at the bottom. */
const OVER = 0.8;
const OFF = 0.4;
/** How far from the pole you step off it, clear of it. */
const STEP_OFF = 0.65;

export type SlidePhase = 'over' | 'down' | 'off' | 'done';

export class Slide {
  phase: SlidePhase = 'over';
  /** Seconds into the phase. */
  private t = 0;
  /** How fast it's going down (m/s). */
  speed = 0;
  /** Where round the pole it is (0 is its south side, as a heading): it starts on the balcony's side. */
  private angle = Math.PI / 2;
  private readonly from: THREE.Vector3;
  /** Which way it faces (rotation round y, 0 is +z): at the pole while it's on it. */
  heading: number;

  /** From `from` (on the balcony, by its railing) down to `land`, the height it ends up at on the street. */
  constructor(
    from: THREE.Vector3,
    private readonly land: number,
    heading: number,
  ) {
    this.from = from.clone();
    this.heading = heading;
  }

  /** Where on the pole it hangs at `angle` round it, `y` up. */
  private on(pos: THREE.Vector3, y: number, r: number = POLE.hold) {
    pos.set(POLE.x + Math.sin(this.angle) * r, y, POLE.z + Math.cos(this.angle) * r);
  }

  /** Moves `pos` along by `dt`: false once it's off the pole and on its feet. */
  step(pos: THREE.Vector3, dt: number): boolean {
    this.t += dt;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const face = (to: number, rate: number) => (this.heading += wrap(to - this.heading) * Math.min(1, dt * rate));
    if (this.phase === 'over') {
      // A hop up over the top rail, and down onto the pole just outside it.
      const p = Math.min(1, this.t / OVER);
      const e = p * p * (3 - 2 * p);
      const hang = this.from.y - 0.25;
      this.on(pos, 0);
      pos.x = THREE.MathUtils.lerp(this.from.x, pos.x, e);
      pos.z = THREE.MathUtils.lerp(this.from.z, pos.z, e);
      pos.y = THREE.MathUtils.lerp(this.from.y, hang, e) + Math.sin(p * Math.PI) * (POLE.railTop + 0.3);
      face(this.angle + Math.PI, 9);
      if (p < 1) return true;
      this.phase = 'down';
      this.t = 0;
      return true;
    }
    if (this.phase === 'down') {
      this.speed = slideSpeed(this.speed, pos.y - this.land, dt);
      const y = Math.max(this.land, pos.y - this.speed * dt);
      // Turning slowly round the pole on the way down, the faster the further.
      this.angle += SLIDE.spin * dt * (this.speed / SLIDE.max);
      this.on(pos, y);
      face(this.angle + Math.PI, 12);
      if (y > this.land) return true;
      this.phase = 'off';
      this.t = 0;
      return true;
    }
    if (this.phase === 'off') {
      // Let go, and a step back off the mat, turning away from the pole.
      const p = Math.min(1, this.t / OFF);
      this.on(pos, this.land, THREE.MathUtils.lerp(POLE.hold, STEP_OFF, p * (2 - p)));
      face(this.angle, 8);
      if (p < 1) return true;
      this.phase = 'done';
    }
    return false;
  }
}
