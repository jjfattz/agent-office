import * as THREE from 'three';
import { meterAt } from '../../../shared/bargames';
import { AIM_MAX, BALLS, aimSweep, landingGauge } from '../../../shared/skeeball';
import { isTyping, type PlayerController } from '../../player';
import { $, h, modalOpen } from '../../ui/dom';
import type { SkeeballMachine } from './world';
import './ui.css';

// Stepping up to the skeeball machine (E there): you stand at its front with a ball in hand, and the
// camera looks straight up the lane from just over your head (you're out of the way, see index.ts).
// A roll is two holds of Space (or the mouse button). The first sends a slider back and forth across
// the aim bar, from one end or the other, and the mark on the target with it: let go to aim there.
// The second runs a slider up and down the power bar, and the mark up and down the target with it,
// to where a ball rolled that hard first comes down: let go to roll. Both move quickly, so it's in
// the timing, never a mouse placed just so. Nine balls a game. E steps back.

/** The meter runs from nothing to full in this long, then back down. */
const METER = 0.8;
/** Let go with the meter under this and you didn't roll after all. */
const MIN_POWER = 0.03;
/** Seconds from one roll to having the next ball in hand. */
const BETWEEN = 0.7;
/** The camera: back from where you stand, up, and how wide it sees (degrees), looking `at` up the lane (s along it, y up, in the machine's own frame). */
const CAM = { back: 0, up: 1.9, fov: 50, at: { s: 2.45, y: 1.0 } };

/**
 * Where a roll is: waiting to aim, the aim slider sweeping, aimed and waiting to roll, the meter
 * running, or the ball away and the next one not in hand yet.
 */
export type RollStage = 'aim' | 'sweep' | 'aimed' | 'wind' | 'wait';

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

export class Roller {
  private machine: SkeeballMachine | null = null;
  private stage: RollStage = 'aim';
  private aimAt = 0;
  /** Which end the slider sets off from this ball (−1: left, 1: right), and when it did. */
  private from = -1;
  private sweepAt = 0;
  private windAt = 0;
  private readyAt = 0;
  /** Balls rolled this game. */
  private n = 0;
  private lastPower = -1;
  private lastAim: number | null = null;
  /** Where on the target the ball first comes down for each step of the meter, aimed where you've aimed (see landingGauge). */
  private gauge: { d: number; u: number }[] = [];
  private camPos = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  private readonly panel: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly aimLast: HTMLElement;
  private readonly powerKnob: HTMLElement;
  private readonly mark: HTMLElement;
  private readonly infoEl: HTMLElement;
  private shown = '';
  private info = '';

  constructor(
    private readonly player: PlayerController,
    private readonly camera: THREE.PerspectiveCamera,
    canvas: HTMLElement,
    private readonly hooks: RollHooks,
  ) {
    this.titleEl = h('div.throw-title');
    this.knob = h('span.skee-knob');
    this.aimLast = h('span.throw-last');
    this.powerKnob = h('span.skee-knob');
    this.mark = h('span.throw-last');
    this.infoEl = h('div.throw-info');
    this.panel = h(
      'div.throw.skee.panel.hidden',
      { id: 'skeeball', 'aria-label': 'Skeeball' },
      this.titleEl,
      h('div.skee-row', {}, h('span.skee-label', {}, 'Aim'), h('div.skee-bar.skee-aim', {}, h('span.skee-mid'), this.aimLast, this.knob)),
      h('div.skee-row', {}, h('span.skee-label', {}, 'Power'), h('div.skee-bar.skee-power', {}, this.mark, this.powerKnob)),
      this.infoEl,
    );
    $('hud').append(this.panel);
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    canvas.addEventListener('pointerdown', (e) => {
      // In first person, the click that captures the mouse isn't a roll.
      const capturing = e.pointerType === 'mouse' && player.canLock && !player.locked;
      if (this.machine && e.button === 0 && !modalOpen() && !capturing) this.press();
    });
    window.addEventListener('pointerup', (e) => {
      if (this.machine && e.button === 0) this.letGo();
    });
    // Tabbed away mid-hold: the key never comes back up, so it's neither an aim nor a roll.
    window.addEventListener('blur', () => {
      if (this.stage === 'sweep') this.stage = 'aim';
      else if (this.stage === 'wind') this.stage = 'aimed';
    });
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

  /** Where the aim slider is right now (meters across the target, positive: right). */
  get aim(): number {
    return this.stage === 'sweep' ? aimSweep((performance.now() - this.sweepAt) / 1000, this.from) : this.aimAt;
  }

  /** How far the meter is up right now (0–1), while you wind up. */
  get power(): number {
    return this.stage === 'wind' ? meterAt((performance.now() - this.windAt) / 1000, METER) : 0;
  }

  /** Up to the front of `machine` with a ball in hand, at the start of a game. */
  start(machine: SkeeballMachine): void {
    if (this.machine) return;
    this.machine = machine;
    this.n = 0;
    this.lastPower = -1;
    this.lastAim = null;
    this.nextBall();
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

  /** Every frame, once the player has moved: the slider, the meter, the guide up the lane and the camera. */
  update(dt: number): void {
    const m = this.machine;
    if (!m) return;
    if (this.stage === 'wait' && performance.now() >= this.readyAt) this.nextBall();
    const aiming = this.stage !== 'wait' && this.next > 0;
    // Aimed: the mark drops to the foot of the target and rides up and down it with the meter.
    const gauging = this.stage === 'aimed' || this.stage === 'wind';
    m.aim(aiming ? this.aim : null, gauging ? this.gaugeAt(this.power) : undefined);
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
    if (down) this.press();
    else this.letGo();
  }

  /** A new ball in hand: the slider waits at one end or the other, so where it'll be when you let go is in your timing, not a habit. */
  private nextBall() {
    this.stage = 'aim';
    this.from = Math.random() < 0.5 ? -1 : 1;
    this.aimAt = this.from * AIM_MAX;
  }

  /** Space (or the mouse button) down: the slider sets off, or with the aim set, the meter starts. */
  private press() {
    if (!this.next || performance.now() < this.readyAt) return;
    if (this.stage === 'aim') {
      this.stage = 'sweep';
      this.sweepAt = performance.now();
    } else if (this.stage === 'aimed') {
      this.stage = 'wind';
      this.windAt = performance.now();
    }
  }

  /** And up again: aimed where the slider is, or rolled as hard as the meter says. */
  private letGo() {
    if (!this.machine) return;
    if (this.stage === 'sweep') {
      this.aimAt = this.aim;
      this.gauge = landingGauge(this.aimAt);
      this.stage = 'aimed';
      return;
    }
    if (this.stage !== 'wind') return;
    const power = this.power;
    if (power < MIN_POWER) {
      this.stage = 'aimed';
      return;
    }
    this.n++;
    this.lastPower = power;
    this.lastAim = this.aimAt;
    this.stage = 'wait';
    this.readyAt = performance.now() + BETWEEN * 1000;
    this.hooks.roll(this.aimAt, power, this.n);
  }

  /** Where on the target the gauge is for `power` on the meter, between its steps. */
  private gaugeAt(power: number): { d: number; u: number } | undefined {
    const g = this.gauge;
    if (!g.length) return undefined;
    const x = Math.min(1, Math.max(0, power)) * (g.length - 1);
    const i = Math.min(g.length - 2, Math.floor(x));
    const k = x - i;
    return { d: g[i].d + (g[i + 1].d - g[i].d) * k, u: g[i].u + (g[i + 1].u - g[i].u) * k };
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

  /** The two sliders, which ball's next, and the game so far. */
  private render() {
    // Inside the bars' rounded ends, so the sliders are still in sight at either end.
    const along = (k: number) => `calc(6px + (100% - 12px) * ${k})`;
    const across = (u: number) => along((u / AIM_MAX + 1) / 2);
    this.knob.style.left = across(this.aim);
    this.knob.classList.toggle('set', this.stage === 'aimed' || this.stage === 'wind');
    this.aimLast.style.left = across(this.lastAim ?? 0);
    this.aimLast.classList.toggle('hidden', this.lastAim === null);
    this.powerKnob.style.left = along(this.power);
    this.powerKnob.classList.toggle('hidden', this.stage !== 'aimed' && this.stage !== 'wind');
    this.mark.style.left = along(this.lastPower);
    this.mark.classList.toggle('hidden', this.lastPower < 0);
    const next = this.next;
    const title = next ? `🎳 Skeeball · ball ${next} of ${BALLS}` : '🎳 Skeeball · last ball rolling';
    const text = `${title}|${this.info}`;
    if (text === this.shown) return;
    this.shown = text;
    this.titleEl.textContent = title;
    this.infoEl.textContent = this.info || 'Hold Space and let go to aim, then again to roll';
  }
}
