import { fullReach, powerFor, type Club } from '../../../shared/golf';
import type { PlayerController } from '../../player';

// Where you mean the ball to come down, over a full shot (not a putt): a distance out along your aim,
// marked on the course by a landing circle (landing.ts) and on the power meter by the notch to stop
// it at. Holding the right mouse button (or Z, which is the touch button too) lifts the view up over
// that spot, and there the mouse moves it: across turns your aim as it always does, and up and down
// takes it further and nearer, as do W and S.

/** The nearest you can aim to land it, in meters. */
const NEAREST = 2;
/** W and S move it this many times the club's full reach a second; a pixel of the mouse, about this many reaches a radian of look. */
const KEY_RATE = 0.35;
const MOUSE_RATE = 0.55;
/** Where the look sits while it's read for the mouse's up and down (first person, and third). */
const LOOK_REST = 0;
const ORBIT_REST = 0.6;

export class ShotTarget {
  /** How far out along your aim you mean it to land, in meters. */
  dist = 0;
  /** The right mouse button, held. */
  private rmb = false;
  /** The view's up over where it lands, and what the look was before it went up (put back after). */
  private up = false;
  private was = { look: 0, orbit: 0 };
  private full = { key: '', m: 0 };
  private power = { key: '', p: 0 };

  constructor(
    private readonly player: PlayerController,
    /** Whether you're over the ball with a club. */
    active: () => boolean,
  ) {
    window.addEventListener('mousedown', (e) => e.button === 2 && (this.rmb = true));
    window.addEventListener('mouseup', (e) => e.button === 2 && (this.rmb = false));
    window.addEventListener('blur', () => (this.rmb = false));
    // No menu for the right button over the ball.
    window.addEventListener('contextmenu', (e) => active() && e.preventDefault());
  }

  /** Whether the view's up over where it lands. */
  get aerial(): boolean {
    return this.up;
  }

  /** Aiming `toPin` meters out with `club` at `loft`: at the pin, or as far as it goes. */
  reset(club: Club, loft: number, toPin: number): void {
    this.dist = Math.max(NEAREST, Math.min(toPin, this.reach(club, loft)));
  }

  /**
   * How far a full swing carries with `club` at `loft`. A target out at the end of it stays there as
   * the loft changes; one nearer stays put, unless the club can't get there any more.
   */
  reach(club: Club, loft: number): number {
    const key = `${club}|${loft.toFixed(3)}`;
    if (this.full.key !== key) {
      const atEnd = this.full.key !== '' && this.dist >= this.full.m - 0.5;
      this.full = { key, m: fullReach(club, loft) };
      if (atEnd) this.dist = this.full.m;
    }
    this.dist = Math.max(NEAREST, Math.min(this.full.m, this.dist));
    return this.full.m;
  }

  /** How far up the power meter to let go for it to land at the target. */
  powerFor(club: Club, loft: number): number {
    const key = `${club}|${loft.toFixed(3)}|${this.dist.toFixed(2)}`;
    if (this.power.key !== key) this.power = { key, p: powerFor(club, loft, this.dist) };
    return this.power.p;
  }

  /**
   * Every frame over the ball: up over where it lands while the right button or Z is held (and `can`,
   * not for a putt or once it's hit), moving the target with the mouse's up and down and W and S.
   */
  update(dt: number, club: Club, loft: number, can: boolean): void {
    const p = this.player;
    const want = can && (this.rmb || p.holding('KeyZ'));
    if (want && !this.up) {
      this.up = true;
      this.was = { look: p.lookPitch, orbit: p.camPitch };
      p.lookPitch = LOOK_REST;
      p.camPitch = ORBIT_REST;
    } else if (!want && this.up) this.leave();
    if (!this.up) return;
    const reach = this.reach(club, loft);
    // The mouse up (looking up in first person, orbiting lower in third) takes it further.
    const push = p.lookPitch - LOOK_REST - (p.camPitch - ORBIT_REST);
    p.lookPitch = LOOK_REST;
    p.camPitch = ORBIT_REST;
    let d = this.dist + push * reach * MOUSE_RATE;
    if (p.holding('KeyW', 'ArrowUp')) d += reach * KEY_RATE * dt;
    if (p.holding('KeyS', 'ArrowDown')) d -= reach * KEY_RATE * dt;
    this.dist = Math.max(NEAREST, Math.min(reach, d));
  }

  /** Back down behind the ball, the look as it was. */
  leave(): void {
    if (!this.up) return;
    this.up = false;
    this.player.lookPitch = this.was.look;
    this.player.camPitch = this.was.orbit;
  }
}
