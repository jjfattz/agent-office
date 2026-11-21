import * as THREE from 'three';
import { meterAt } from '../../../shared/bargames';
import { AIM_MAX, BALLS, LANE, RINGS, onFace } from '../../../shared/skeeball';
import { isTyping, type PlayerController } from '../../player';
import { $, h, modalOpen } from '../../ui/dom';
import type { SkeeballMachine } from './world';

// Stepping up to the skeeball machine (E there): you stand at its front with a ball in hand, and the
// camera looks straight up the lane from just over your head (you're out of the way, see index.ts).
// The mouse (or A and D, or the arrows) slides a mark across the target, and the dotted guide up the
// lane turns to it. Holding Space (or the mouse button) runs the meter up and down; let go to roll,
// harder the fuller it is. Nine balls a game. E steps back.

/** The meter runs from nothing to full in this long, then back down. */
const METER = 1.25;
/** Let go with the meter under this and you didn't roll after all. */
const MIN_POWER = 0.03;
/** Seconds from one roll to having the next ball in hand. */
const BETWEEN = 0.7;
/**
 * How fast the keys slide the mark across the target (m/s), and how far a pixel of the mouse does
 * while it's captured: the whole width in about a hand's sweep.
 */
const KEYS = 0.55;
const MOUSE = 0.0011;
/** The camera: back from where you stand, up, and how wide it sees (degrees), looking `at` up the lane (s along it, y up). */
const CAM = { back: 0.12, up: 1.78, fov: 58, at: { s: 2.3, y: 0.95 } };
/** From the foot of the lane up to the rings, along it: what the mark across the target is scaled by. */
const RUN = onFace(RINGS.d, 0).s - LANE.start.s;
/** The target, as a plane in the machine's frame. */
const FACE_NORMAL = new THREE.Vector3(-Math.sin(LANE.face.angle), Math.cos(LANE.face.angle), 0);

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
const plane = new THREE.Plane();
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
    m.ready(false);
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
    const aiming = this.stage !== 'wait' && this.next > 0;
    m.aim(aiming ? this.aimAt : null);
    m.ready(aiming);
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

  /** The mouse slides your mark across the target: by how far it moved while it's captured, or to wherever it points on it. */
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
      plane.setFromNormalAndCoplanarPoint(FACE_NORMAL, m.toWorld(LANE.face.s, 0, LANE.face.y, want));
      if (!ray.ray.intersectPlane(plane, hit)) return;
      // Pointing at the target, or up the lane short of it: the line from the foot of the lane through there, where it meets the rings.
      const start = m.toWorld(LANE.start.s, 0, 0, want);
      const ahead = hit.x - start.x;
      if (ahead < 0.3) return;
      this.aimAt = ((hit.z - start.z) * RUN) / ahead;
    }
    this.aimAt = THREE.MathUtils.clamp(this.aimAt, -AIM_MAX, AIM_MAX);
  }

  /** Square behind the lane, just over your head, looking up it at the target. */
  private placeCamera(dt: number, m: SkeeballMachine) {
    const s = m.spot;
    want.set(s.x - Math.sin(s.facing) * CAM.back, CAM.up, s.z - Math.cos(s.facing) * CAM.back);
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
    this.infoEl.textContent = this.info || 'Move the mouse to aim · hold Space and let go';
  }
}
