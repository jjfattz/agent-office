import * as THREE from 'three';
import { HOLES, yawTo } from '../../../shared/course';
import { BALL_R, CLUBS, CLUB_ORDER, TEE_H, fullReach, pinText, type Club, type Flight, type Shot } from '../../../shared/golf';
import { isTyping, type PlayerController } from '../../player';
import { $, h, modalOpen } from '../../ui/dom';
import { IMPACT, type Person } from '../../world/character';
import type { Ball } from './round';

// Over your ball on the course (E at it, or at a tee): you stand square to the line with a club, and
// the camera goes down low behind the ball, looking down the line at the pin. The mouse (or A and D)
// aims, W and S pick the loft, C changes club, and holding Space takes the club back while the power
// meter runs up and down: let go to hit it. The camera follows the ball out to wherever it stops,
// then the round says what's next (see index.ts). E steps away from the ball.

/** The power meter runs from nothing to full in this long, then back down again. */
const METER = 1.3;
/** A and D (and the arrow keys) turn the aim this fast, in radians a second; W and S change the loft. */
const TURN = 0.3;
const LOFT_RATE = THREE.MathUtils.degToRad(25);
/** How far off line (radians) and off the power meter (a fraction of it) a shot can come off the club, either way in all. */
const MISHIT_AIM = THREE.MathUtils.degToRad(1.4);
const MISHIT_POWER = 0.025;
/** The office takes one shot from you at a time, this far apart (in ms): no swinging again before then. */
const BETWEEN_SHOTS = 1000;
/** Let go with the meter under this and it's a practice swing: nothing happens. */
const MIN_POWER = 0.03;
/** Following the ball: this far behind it, and this far up. */
const CHASE_BACK = 4.5;
const CHASE_UP = 1.7;
/** The golfer stands this far from the ball, square to the line. */
export const STANCE = 0.57;
/** Behind the ball at address, by club: back along the line, out to the right (away from the golfer), and up. */
const BEHIND: Record<Club, { back: number; side: number; up: number; ahead: number }> = {
  iron: { back: 3.6, side: 0.9, up: 1.9, ahead: 40 },
  wedge: { back: 3.1, side: 0.8, up: 1.7, ahead: 20 },
  putter: { back: 2.5, side: 0.6, up: 1.35, ahead: 6 },
};

export type GolfStage = 'aim' | 'charge' | 'swing' | 'watch';

export interface GolfHooks {
  /** You're over the ball with a club, or stepped away: everyone else sees it. */
  holding(on: boolean): void;
  /** You hit it: off it goes, here and for everyone else. */
  hit(shot: Shot): void;
  /** Your ball on its way, or where it stopped (`still` seconds ago), in the street's frame, for the camera to follow. */
  ball(): { at: THREE.Vector3; flight: Flight; still: number } | null;
  /** How far down the street is from this floor (see streetBelow). */
  street(): number;
  /** Space while you watch it: don't wait for the camera to have its look. */
  skip(): void;
  /** You stepped away from the ball. */
  done(): void;
}

const lookAt = new THREE.Matrix4();
const want = new THREE.Vector3();
const target = new THREE.Vector3();
const turn = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** Wraps an angle into -π..π. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Where the golfer stands for a shot heading `yaw` from (x, z), and which way they face: across the line, with the hole on their left. */
export function stance(x: number, z: number, yaw: number): { x: number; z: number; facing: number } {
  return { x: x + Math.cos(yaw) * STANCE, z: z - Math.sin(yaw) * STANCE, facing: yaw - Math.PI / 2 };
}

export class Golfer {
  private stage: GolfStage | null = null;
  /** The ball you're over, and the hole you're playing. */
  private at: Ball = { x: 0, z: 0, teed: false };
  private hole = 0;
  /** The club in your hands, which way you aim (a heading: 0 is +z, turning toward +x), and the loft you've picked. */
  club: Club = 'iron';
  aim = 0;
  loft = CLUBS.iron.start;
  /** When the power meter started running (performance.now()), while Space is held down. */
  private chargeAt = 0;
  /** How hard the last shot was hit, marked on the meter. */
  private lastPower = -1;
  /** The shot on its way down through the ball, and how far into the downswing that is. */
  private shot: Shot | null = null;
  private swingT = 0;
  /** When the last one was hit (performance.now()). */
  private hitAt = -Infinity;
  /** The camera's own place and turn, while it's the golf camera. */
  private camPos = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  private readonly panel: HTMLElement;
  private readonly title: HTMLElement;
  /** Covers the meter from the right, down to how hard you'd hit it. */
  private readonly rest: HTMLElement;
  private readonly mark: HTMLElement;
  private readonly info: HTMLElement;
  private shown = '';
  /** How far a full swing goes with the club and loft you've got, worked out when either changes. */
  private reach = { key: '', m: 0 };

  constructor(
    private readonly player: PlayerController,
    private readonly me: Person,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly hooks: GolfHooks,
    /** What the title over the meter says: the hole and the stroke. */
    private readonly heading: () => string,
  ) {
    this.title = h('div.golf-title');
    this.rest = h('span.golf-rest');
    this.mark = h('span.golf-last');
    this.info = h('div.golf-info');
    this.panel = h('div.golf.panel.hidden', { id: 'golf', 'aria-label': 'Golf' }, this.title, h('div.golf-meter', {}, this.rest, this.mark), this.info);
    $('hud').append(this.panel);
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    // Tabbed away mid-swing: the key never comes back up, so it's no swing.
    window.addEventListener('blur', () => this.stage === 'charge' && this.putBack());
  }

  get active(): boolean {
    return this.stage !== null;
  }

  /** The ball you're over. */
  get ball(): Readonly<Ball> {
    return this.at;
  }

  /** What you're doing over the ball, or null when you're not at it. */
  get doing(): GolfStage | null {
    return this.stage;
  }

  /** How far the power meter is up right now (0–1), while Space is held. */
  get power(): number {
    if (this.stage !== 'charge') return 0;
    const p = ((performance.now() - this.chargeAt) / 1000 / METER) % 2;
    return p > 1 ? 2 - p : p;
  }

  /** Up to the ball on hole `hole` with `club`, aiming at the pin. */
  start(ball: Ball, hole: number, club: Club): void {
    const fresh = !this.stage;
    this.stage = 'aim';
    this.at = { ...ball };
    this.hole = hole;
    this.setClub(club);
    this.aim = yawTo(ball, HOLES[hole].pin);
    this.lastPower = -1;
    const p = this.player;
    p.rig = () => this.stand();
    this.stand();
    p.camYaw = this.aim + Math.PI;
    if (fresh) {
      this.camPos.copy(this.camera.position);
      this.camQuat.copy(this.camera.quaternion);
      this.me.setGolf(true);
      this.hooks.holding(true);
    }
    this.panel.classList.remove('hidden');
    this.shown = '';
  }

  /** The club back in the bag, and you back on your feet beside the ball. */
  stop(): void {
    if (!this.stage) return;
    this.stage = null;
    this.shot = null;
    const p = this.player;
    p.rig = null;
    p.lookPitch = -0.08;
    // In third person, the camera goes round behind you, looking down the line.
    if (p.view === 'third') p.camYaw = p.facing + Math.PI;
    this.me.setGolf(false);
    this.hooks.holding(false);
    this.panel.classList.add('hidden');
    this.hooks.done();
  }

  /** The next club in the bag (C). */
  nextClub(): void {
    if (this.stage !== 'aim') return;
    this.setClub(CLUB_ORDER[(CLUB_ORDER.indexOf(this.club) + 1) % CLUB_ORDER.length]);
  }

  private setClub(club: Club) {
    this.club = club;
    this.loft = CLUBS[club].start;
  }

  /** Every frame, once the player has moved: aiming, the swing, and the camera. */
  update(dt: number): void {
    if (!this.stage) return;
    const p = this.player;
    if (this.stage === 'aim' || this.stage === 'charge') {
      // The mouse turns your view as it always does (camYaw); that's the aim, along with the keys.
      let aim = wrap(p.camYaw - Math.PI);
      if (p.holding('KeyA', 'ArrowLeft')) aim += TURN * dt;
      if (p.holding('KeyD', 'ArrowRight')) aim -= TURN * dt;
      this.aim = aim;
      const [lo, hi] = CLUBS[this.club].loft;
      if (p.holding('KeyW', 'ArrowUp')) this.loft = Math.min(hi, this.loft + LOFT_RATE * dt);
      if (p.holding('KeyS', 'ArrowDown')) this.loft = Math.max(lo, this.loft - LOFT_RATE * dt);
    }
    p.camYaw = this.aim + Math.PI;
    // A putt's only a little way back.
    if (this.stage === 'charge') this.me.golfBack(this.club === 'putter' ? this.power * 0.35 : this.power);
    if (this.stage === 'swing') {
      this.swingT += dt;
      if (this.swingT >= IMPACT && this.shot) {
        this.hitAt = performance.now();
        this.hooks.hit(this.shot);
        this.shot = null;
        this.stage = 'watch';
      }
    }
    // Watching it go until the round says what's next (see index.ts), which puts you over the ball again or lets you go.
    this.placeCamera(dt);
    this.render();
  }

  /** Where you stand for the aim you've got: square to the line, over the ball. */
  private stand() {
    const s = stance(this.at.x, this.at.z, this.aim);
    const p = this.player;
    p.pos.set(s.x, this.hooks.street(), s.z);
    p.facing = s.facing;
    p.moving = false;
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (!this.stage || e.code !== 'Space') return;
    if (down && (e.repeat || isTyping(e) || modalOpen() || e.metaKey || e.ctrlKey || e.altKey)) return;
    if (down && this.stage === 'aim') {
      if (performance.now() - this.hitAt < BETWEEN_SHOTS) return;
      this.stage = 'charge';
      this.chargeAt = performance.now();
    } else if (down && this.stage === 'watch') this.hooks.skip();
    else if (!down && this.stage === 'charge') {
      const power = this.power;
      if (power < MIN_POWER) return this.putBack();
      // Nobody hits it exactly the same way twice: a touch off line, a touch more or less.
      const yaw = this.aim + (Math.random() - 0.5) * MISHIT_AIM * (this.club === 'putter' ? 0.4 : 1);
      this.shot = { hole: this.hole, x: this.at.x, z: this.at.z, club: this.club, yaw, loft: this.loft, power: Math.min(1, power * (1 + (Math.random() - 0.5) * MISHIT_POWER)) };
      this.lastPower = power;
      this.stage = 'swing';
      this.swingT = 0;
      this.me.golfHit();
    }
  }

  /** A swing you didn't follow through: the club goes back down to the ball. */
  private putBack() {
    this.stage = 'aim';
    this.me.golfBack(0);
  }

  private placeCamera(dt: number) {
    const street = this.hooks.street();
    const b = this.stage === 'watch' ? this.hooks.ball() : null;
    const pin = HOLES[this.hole].pin;
    if (b && b.still >= 0 && Number.isFinite(b.flight.fromPin)) {
      // Down: back from it and the pin, from where it was hit, far enough to see both (and the whole flag, when it's in).
      const holed = b.flight.holed;
      const yaw = yawTo(b.flight.shot, pin);
      target.set((b.at.x + pin.x) / 2, street + (holed ? 1.4 : 0.4), (b.at.z + pin.z) / 2);
      const back = Math.min(22, (holed ? 8 : 4) + b.flight.fromPin * 0.9);
      want.set(target.x - Math.sin(yaw) * back, street + 1.6 + back * 0.35, target.z - Math.cos(yaw) * back);
    } else if (b && b.still >= 0) {
      // In the water or out of bounds: from up behind it, looking down at where it went.
      const { yaw } = b.flight.shot;
      target.set(b.at.x, street + Math.max(0, b.at.y), b.at.z);
      want.set(b.at.x - Math.sin(yaw) * 7, street + 4, b.at.z - Math.cos(yaw) * 7);
    } else if (b) {
      // Behind the ball the way it was hit, a little above it, looking at it.
      const { yaw } = b.flight.shot;
      const far = b.flight.shot.club === 'putter' ? 0.55 : 1;
      want.set(b.at.x - Math.sin(yaw) * CHASE_BACK * far, street + b.at.y + CHASE_UP * far, b.at.z - Math.cos(yaw) * CHASE_BACK * far);
      target.set(b.at.x, street + b.at.y, b.at.z);
    } else {
      // Down low behind the ball, looking down the line: the ball low in the view, the pin further up it.
      const c = BEHIND[this.club];
      const sin = Math.sin(this.aim);
      const cos = Math.cos(this.aim);
      const ball = street + BALL_R + (this.at.teed ? TEE_H : 0);
      want.set(this.at.x - sin * c.back - cos * c.side, ball + c.up, this.at.z - cos * c.back + sin * c.side);
      const ahead = Math.min(c.ahead, Math.hypot(pin.x - this.at.x, pin.z - this.at.z) + 2);
      target.set(this.at.x + sin * ahead, street + (this.club === 'putter' ? 0 : 0.6), this.at.z + cos * ahead);
    }
    const k = 1 - Math.exp(-dt * (b ? 5 : 7));
    this.camPos.lerp(want, k);
    lookAt.lookAt(this.camPos, target, UP);
    turn.setFromRotationMatrix(lookAt);
    this.camQuat.slerp(turn, k);
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(this.camQuat);
  }

  /** The power meter, the club and loft, and where you're aiming. */
  private render() {
    const power = this.stage === 'charge' ? this.power : this.stage === 'aim' ? 0 : this.lastPower;
    this.rest.style.width = `${(1 - Math.max(0, power)) * 100}%`;
    this.mark.style.left = `${this.lastPower * 100}%`;
    this.mark.classList.toggle('hidden', this.lastPower < 0);
    const h = HOLES[this.hole];
    const off = THREE.MathUtils.radToDeg(wrap(this.aim - yawTo(this.at, h.pin)));
    const aim = Math.abs(off) < 0.5 ? 'at the pin' : `${Math.abs(off).toFixed(0)}° ${off > 0 ? 'left' : 'right'}`;
    const key = `${this.club}|${this.loft.toFixed(2)}`;
    if (this.reach.key !== key) this.reach = { key, m: fullReach(this.club, this.loft) };
    const club = CLUBS[this.club];
    const pin = pinText(Math.hypot(h.pin.x - this.at.x, h.pin.z - this.at.z));
    const loft = this.club === 'putter' ? '' : ` · ${THREE.MathUtils.radToDeg(this.loft).toFixed(0)}°`;
    const text = `${club.name}${loft} · full ≈ ${Math.round(this.reach.m)} m · pin ${pin} · aim ${aim}${this.club === 'putter' ? this.breaks() : ''}`;
    const title = this.heading();
    if (text === this.shown && title === this.title.textContent) return;
    this.shown = text;
    this.info.textContent = text;
    this.title.textContent = title;
  }

  /** Which way a putt along your aim breaks, on a sloping green. */
  private breaks(): string {
    const s = HOLES.find((h) => Math.hypot(this.at.x - h.pin.x, this.at.z - h.pin.z) < h.green + 1)?.slope;
    if (!s) return '';
    // Across the line: + pulls it toward your left (+x when you face +z).
    const across = s.x * Math.cos(this.aim) - s.z * Math.sin(this.aim);
    return Math.abs(across) < 0.05 ? '' : ` · breaks ${across > 0 ? 'left' : 'right'}`;
  }
}
