import * as THREE from 'three';
import { meterAt } from '../../../shared/bargames';
import { AIM_MAX, BALLS, LANE } from '../../../shared/skeeball';
import { isTyping, type PlayerController } from '../../player';
import { $, h, modalOpen } from '../../ui/dom';
import type { SkeeballMachine } from './world';

// Stepping up to the skeeball machine (E there): you stand at its front with a ball in hand, and the
// camera looks over your head up the lane. The mouse (or A and D, or the arrows) turns the dotted
// guide up the lane the way the ball will go. Holding Space (or the mouse button) runs the meter up
// and down; let go to roll, harder the fuller it is. Nine balls a game. E steps back.

/** The meter runs from nothing to full in this long, then back down. */
const METER = 1.25;
/** Let go with the meter under this and you didn't roll after all. */
const MIN_POWER = 0.03;
/** Seconds from one roll to having the next ball in hand. */
const BETWEEN = 0.7;
/** How fast the keys turn your aim (radians a second), and how far a pixel of the mouse does while it's captured. */
const KEYS = 0.09;
const MOUSE = 0.0005;
/**
 * The camera: back from where you stand, out to your left (the stairs are on your right), up, and how
 * wide it sees (degrees), looking `at` up the lane (s along it, y up).
 */
const CAM = { back: 0.5, left: 0.65, up: 2.1, fov: 50, at: { s: 2.1, y: 0.95 } };

export type RollStage = 'aim' | 'wind' | 'wait';

export interface RollHooks {
  /** You let go of ball `n` of your game, aimed `aim` and rolled `power` hard. */
  roll(aim: number, power: number, n: number): void;
  /** Stepped back from the machine. */
  done(): void;
}

const want = new THREE.Vector3();
const look = new THREE.Vector3();
const lookAt = new THREE.Matrix4();
const turn = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -LANE.foot.y);
const hit = new THREE.Vector3();

export class Roller {
  private machine: SkeeballMachine | null = null;
  private stage: RollStage = 'aim';
  private aimAt = 0;
  private windAt = 0;
  private readyAt = 0;
  /** Balls rolled this game. */
  private n = 0;
  private lastPower = -1;
  private camPos = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  private readonly panel: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly mark: HTMLElement;
  private readonly infoEl: HTMLElement;
  private shown = '';
  private info = '';

  constructor(
    private readonly player: PlayerController,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLElement,
    private readonly hooks: RollHooks,
  ) {
    this.titleEl = h('div.throw-title');
    this.fill = h('span.throw-fill');
    this.mark = h('span.throw-last');
    this.infoEl = h('div.throw-info');
    this.panel = h('div.throw.panel.hidden', { id: 'skeeball', 'aria-label': 'Skeeball' }, this.titleEl, h('div.throw-meter', {}, this.fill, this.mark), this.infoEl);
    $('hud').append(this.panel);
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    canvas.addEventListener('pointerdown', (e) => {
      // In first person, the click that captures the mouse isn't a roll.
      const capturing = e.pointerType === 'mouse' && player.canLock && !player.locked;
      if (this.machine && e.button === 0 && !modalOpen() && !capturing) this.windUp();
    });
    window.addEventListener('pointerup', (e) => {
      if (this.machine && e.button === 0) this.letGo();
    });
    window.addEventListener('pointermove', (e) => this.pointer(e));
    // Tabbed away while winding up: the key never comes back up, so it's no roll.
    window.addEventListener('blur', () => this.stage === 'wind' && (this.stage = 'aim'));
  }

  get active(): boolean {
    return this.machine !== null;
  }

  get doing(): RollStage | null {
    return this.machine ? this.stage : null;
  }

  get fov(): number {
    return CAM.fov;
  }

  /** Which ball of the game is next (from 1), or 0 with the game's balls all rolled. */
  get next(): number {
    return this.n < BALLS ? this.n + 1 : 0;
  }

  /** How far the meter is up right now (0–1), while you wind up. */
  get power(): number {
    return this.stage === 'wind' ? meterAt((performance.now() - this.windAt) / 1000, METER) : 0;
  }

  /** Up to the front of `machine` with a ball in hand, aiming straight up the lane, at the start of a game. */
  start(machine: SkeeballMachine): void {
    if (this.machine) return;
    this.machine = machine;
    this.stage = 'aim';
    this.aimAt = 0;
    this.n = 0;
    this.lastPower = -1;
    this.info = '';
    const p = this.player;
    p.rig = () => this.stand();
    p.mouseLook = false;
    this.stand();
    this.camPos.copy(this.camera.position);
    this.camQuat.copy(this.camera.quaternion);
    this.panel.classList.remove('hidden');
    this.shown = '';
  }

  /** Back from the machine. */
  stop(): void {
    const m = this.machine;
    if (!m) return;
    this.machine = null;
    m.aim(null);
    const p = this.player;
    p.rig = null;
    p.mouseLook = true;
    // Facing the machine: in third person, the camera goes round behind you.
    p.camYaw = m.spot.facing + Math.PI;
    p.lookPitch = -0.08;
    this.panel.classList.add('hidden');
    this.hooks.done();
  }

  /** Your game's last ball has dropped: the next roll starts a new one. */
  newGame(): void {
    this.n = 0;
  }

  /** The panel's bottom line. */
  setInfo(text: string): void {
    this.info = text;
  }

  /** Every frame, once the player has moved: aiming, winding up, the guide up the lane and the camera. */
  update(dt: number): void {
    const m = this.machine;
    if (!m) return;
    const p = this.player;
    if (this.stage === 'aim' || this.stage === 'wind') {
      const k = KEYS * dt;
      if (p.holding('KeyA', 'ArrowLeft')) this.aimAt -= k;
      if (p.holding('KeyD', 'ArrowRight')) this.aimAt += k;
      this.aimAt = THREE.MathUtils.clamp(this.aimAt, -AIM_MAX, AIM_MAX);
    }
    if (this.stage === 'wait' && performance.now() >= this.readyAt) this.stage = 'aim';
    m.aim(this.stage === 'wait' || !this.next ? null : this.aimAt);
    this.placeCamera(dt, m);
    this.render();
  }

  private stand() {
    const s = this.machine!.spot;
    const p = this.player;
    p.pos.set(s.x, 0, s.z);
    p.facing = s.facing;
    p.moving = false;
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (!this.machine || e.code !== 'Space') return;
    if (down && (e.repeat || isTyping(e) || modalOpen() || e.metaKey || e.ctrlKey || e.altKey)) return;
    if (down) this.windUp();
    else this.letGo();
  }

  private windUp() {
    if (this.stage !== 'aim' || !this.next || performance.now() < this.readyAt) return;
    this.stage = 'wind';
    this.windAt = performance.now();
  }

  private letGo() {
    if (this.stage !== 'wind' || !this.machine) return;
    const power = this.power;
    if (power < MIN_POWER) {
      this.stage = 'aim';
      return;
    }
    this.n++;
    this.lastPower = power;
    this.stage = 'wait';
    this.readyAt = performance.now() + BETWEEN * 1000;
    this.hooks.roll(this.aimAt, power, this.n);
  }

  /** The mouse turns your aim: by how far it moved while it's captured, or toward wherever it points up the lane. */
  private pointer(e: PointerEvent) {
    const m = this.machine;
    if (!m || modalOpen()) return;
    if (this.player.locked) {
      this.aimAt += THREE.MathUtils.clamp(e.movementX, -250, 250) * MOUSE;
    } else {
      if (e.target !== this.canvas) return;
      const r = this.canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      if (!ray.ray.intersectPlane(plane, hit)) return;
      const start = m.toWorld(LANE.start.s, 0, 0, want);
      const ahead = hit.x - start.x;
      if (ahead < 0.2) return;
      this.aimAt = Math.atan2(hit.z - start.z, ahead);
    }
    this.aimAt = THREE.MathUtils.clamp(this.aimAt, -AIM_MAX, AIM_MAX);
  }

  /** Over your left shoulder, looking up the lane at the target. */
  private placeCamera(dt: number, m: SkeeballMachine) {
    const s = m.spot;
    const fx = Math.sin(s.facing);
    const fz = Math.cos(s.facing);
    // Your left, facing (fx, fz), is (fz, -fx).
    want.set(s.x - fx * CAM.back + fz * CAM.left, CAM.up, s.z - fz * CAM.back - fx * CAM.left);
    m.toWorld(CAM.at.s, 0, CAM.at.y, look);
    const k = 1 - Math.exp(-dt * 7);
    this.camPos.lerp(want, k);
    lookAt.lookAt(this.camPos, look, UP);
    turn.setFromRotationMatrix(lookAt);
    this.camQuat.slerp(turn, k);
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(this.camQuat);
  }

  /** The meter, which ball's next, and the game so far. */
  private render() {
    const power = this.power;
    this.fill.style.width = `${power * 100}%`;
    this.mark.style.left = `${this.lastPower * 100}%`;
    this.mark.classList.toggle('hidden', this.lastPower < 0);
    const next = this.next;
    const title = next ? `🎳 Skeeball · ball ${next} of ${BALLS}` : '🎳 Skeeball · last ball rolling';
    const text = `${title}|${this.info}`;
    if (text === this.shown) return;
    this.shown = text;
    this.titleEl.textContent = title;
    this.infoEl.textContent = this.info || 'Aim with the mouse · hold Space and let go';
  }
}
