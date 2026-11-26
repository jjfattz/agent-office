import * as THREE from 'three';
import { BALLS, LANE, RINGS, SIZE, SKEEBALL, aimAngle, laneY, onFace, pathAt, type PathPoint, type RollEvent } from '../../../shared/skeeball';
import { mesh, textSprite, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { buildCabinet } from './model';
import { paintDisplay, type DisplayState } from './paint';

// The skeeball machine by the loft's stairs: its cabinet (model.ts), and what moves on it: the balls
// waiting in the trough and rolling up the lane, the guide up the lane and the marks on the target
// while you aim, the score popping up, the rings and bulbs lighting up, and the display. Its back is
// against the meeting room's west glass, just north of the stairs, and you roll from its front,
// facing east. It's built in its own frame (x along the lane, z across it, y up), which is the room's
// own way round, moved to where the machine stands and drawn SIZE times bigger.

const INK = '#14112b';
const BALL = '#f4f1de';
/** The two marks on the target: where you're aiming across it, and how far up it the roll comes down. The panel's sliders match. */
export const AIM_COLOR = '#22d3ee';
export const POWER_COLOR = '#ff7b1c';
/** How far each mark on the target reaches out from its middle. */
const MARK_R = 0.078;

export interface SkeeballMachine {
  group: THREE.Group;
  colliders: Collider[];
  interactable: Interactable;
  /** Where you stand to roll, and the way you face there (toward the target). */
  readonly spot: { x: number; z: number; facing: number };
  /** A point in the machine's frame (s along the lane, u across it, y up), in the room. */
  toWorld(s: number, u: number, y: number, out: THREE.Vector3): THREE.Vector3;
  /** How many balls wait in the trough at the front; more than there were roll in from the side. */
  setTrough(n: number): void;
  /**
   * The aim mark on the target, where the line to `aimU` across it reaches the rings (null: none),
   * and with `guide`, the dotted line up the lane there.
   */
  aim(aimU: number | null, guide?: boolean): void;
  /**
   * The power mark on the target, at `at` (d up it, u across; null: none), and with `guide`, the
   * dotted line up the target to it from where the aim line meets its foot.
   */
  power(at: { d: number; u: number } | null, guide?: boolean): void;
  /** The next ball sitting at the foot of the lane, ready to roll. */
  ready(on: boolean): void;
  /** What the score display says. */
  display(state: DisplayState): void;
  /** Rolls a ball along `path` (see roll in shared/skeeball.ts), with `hit` as it does each of `events`, and `done` once it's gone down its hole. */
  launch(path: readonly PathPoint[], events: readonly RollEvent[], hit: (e: RollEvent, at: THREE.Vector3) => void, done: () => void): void;
  /** What a ball just scored: its ring lights up, the bulbs chase, and `text` pops up over the target. */
  flash(points: number, text: string, color: string): void;
  update(dt: number): void;
}

interface Rolling {
  ball: THREE.Mesh;
  path: readonly PathPoint[];
  events: readonly RollEvent[];
  next: number;
  t: number;
  hit: (e: RollEvent, at: THREE.Vector3) => void;
  done: () => void;
}

/** Where ball `i` of the trough rests, across the front. */
function slot(i: number): THREE.Vector3 {
  const span = LANE.inner - 0.14;
  return new THREE.Vector3(0.12 + (i % 2) * 0.09, 0.66 + LANE.ball, -span / 2 + (i * span) / (BALLS - 1));
}

export function buildSkeeball(): SkeeballMachine {
  const cab = buildCabinet();
  const group = cab.group;
  group.position.set(SKEEBALL.x, 0, SKEEBALL.z);
  group.scale.setScalar(SIZE);
  const { start } = LANE;

  // The balls: the ones waiting in the trough, the one in your hand, and the ones rolling.
  const ballGeo = new THREE.SphereGeometry(LANE.ball, 18, 12);
  const ballMat = toon(BALL);
  const trough = Array.from({ length: BALLS }, (_, i) => {
    const b = mesh(ballGeo, ballMat, 0, 0, 0, false);
    b.position.copy(slot(i));
    group.add(b);
    return { mesh: b, wait: 0 };
  });
  let shown = BALLS;
  const handBall = mesh(ballGeo, ballMat, start.s + 0.04, laneY(start.s + 0.04) + LANE.ball, 0, false);
  handBall.visible = false;
  group.add(handBall);
  const rolling: Rolling[] = [];
  const spare: THREE.Mesh[] = [];

  // The guide up the lane while you aim: dots the way the ball will go; and on the target, a ring of
  // each color, for where it's aimed across and how far up it'll come down, with dots of its own
  // color up the target to the power one while the power slider runs.
  const guide = new THREE.Group();
  const dotMat = new THREE.MeshBasicMaterial({ color: AIM_COLOR, transparent: true, opacity: 0.9, depthWrite: false });
  const dots = Array.from({ length: 13 }, () => new THREE.Mesh(new THREE.CircleGeometry(0.016, 12).rotateX(-Math.PI / 2), dotMat));
  guide.add(...dots);
  const powerDotMat = new THREE.MeshBasicMaterial({ color: POWER_COLOR, transparent: true, opacity: 0.9, depthWrite: false });
  const powerDots = Array.from({ length: 12 }, () => {
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.014, 12), powerDotMat);
    dot.renderOrder = 2;
    dot.visible = false;
    cab.faceFrame.add(dot);
    return dot;
  });
  /** Across the target where the aim line meets its foot, for the power dots to start from. */
  let footU = 0;
  const ring = (color: string) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.045, 0.068, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }));
    m.add(new THREE.Mesh(new THREE.RingGeometry(0.068, MARK_R, 32), new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.8, depthWrite: false })));
    m.renderOrder = 2;
    m.visible = false;
    cab.faceFrame.add(m);
    return m;
  };
  const aimMark = ring(AIM_COLOR);
  const powerMark = ring(POWER_COLOR);
  // The power mark over the aim one where they meet.
  powerMark.position.z = 0.024;
  guide.visible = false;
  group.add(guide);

  // The score that pops up over the target, and how lit up everything is.
  let pop: { sprite: THREE.Sprite; t: number } | null = null;
  let chase = 0;
  const ringGlow = new Map<number, number>();
  const clock = { t: 0 };
  const at = new THREE.Vector3();
  const axis = new THREE.Vector3();

  const { length: L, width: W } = SKEEBALL;
  const collider: Collider = { minX: SKEEBALL.x, maxX: SKEEBALL.x + L, minZ: SKEEBALL.z - W / 2, maxZ: SKEEBALL.z + W / 2, top: 2.6 * SIZE };
  const interactable: Interactable = { kind: 'skeeball', x: SKEEBALL.x - 0.3, z: SKEEBALL.z, radius: 1.4 };
  group.userData.interact = interactable;
  const toWorld = (s: number, u: number, y: number, out: THREE.Vector3) => out.set(SKEEBALL.x + s * SIZE, y * SIZE, SKEEBALL.z + u * SIZE);

  const machine: SkeeballMachine = {
    group,
    colliders: [collider],
    interactable,
    spot: { x: SKEEBALL.x - 0.6, z: SKEEBALL.z, facing: Math.PI / 2 },
    toWorld,
    setTrough(n) {
      trough.forEach((b, i) => {
        const on = i < n;
        // One coming back rolls in from the side, after the one before it.
        if (on && !b.mesh.visible) {
          b.wait = Math.max(0, i - shown) * 0.09;
          b.mesh.position.copy(slot(i)).setZ(LANE.inner / 2 + 0.2);
        }
        b.mesh.visible = on;
      });
      shown = n;
    },
    aim(aimU, withGuide = true) {
      aimMark.visible = aimU !== null;
      guide.visible = aimU !== null && withGuide;
      if (aimU === null) return;
      const a = aimAngle(aimU);
      footU = (LANE.face.s - start.s) * Math.tan(a);
      const half = LANE.inner / 2 - LANE.ball;
      dots.forEach((dot, i) => {
        const run = 0.12 + i * 0.14;
        const s = start.s + run * Math.cos(a);
        dot.position.set(s, laneY(s) + 0.004, THREE.MathUtils.clamp(run * Math.sin(a), -half, half));
        dot.visible = s < LANE.foot.s;
      });
      // Where the line reaches the rings, up the target.
      const target = onFace(RINGS.d, 0);
      aimMark.position.set((target.s - start.s) * Math.tan(a), RINGS.d, 0.02);
      aimMark.scale.setScalar(1 + 0.12 * Math.sin(clock.t * 6));
    },
    power(at, withGuide = false) {
      powerMark.visible = at !== null;
      if (!at) {
        for (const dot of powerDots) dot.visible = false;
        return;
      }
      // Kept clear of the target's top edge, and of its bottom one behind the gutter's lip, so it's all in sight.
      const low = MARK_R + 0.04;
      const x = at.u;
      const y = THREE.MathUtils.clamp(at.d, low, LANE.face.long - MARK_R);
      powerMark.position.x = x;
      powerMark.position.y = y;
      powerMark.scale.setScalar(1 + 0.12 * Math.sin(clock.t * 6 + 1.5));
      // From the foot of the target up to the mark, a dot every so often, stopping short of the ring.
      const len = Math.hypot(x - footU, y - low * 0.5);
      powerDots.forEach((dot, i) => {
        const k = ((i + 0.5) * 0.07) / (len || 1);
        dot.visible = withGuide && k * len < len - MARK_R;
        dot.position.set(footU + (x - footU) * k, low * 0.5 + (y - low * 0.5) * k, 0.022);
      });
    },
    ready(on) {
      handBall.visible = on;
    },
    display(state) {
      paintDisplay(cab.displayCanvas, state);
      cab.displayTex.needsUpdate = true;
    },
    launch(path, events, hit, done) {
      const ball = spare.pop() ?? mesh(ballGeo, ballMat, 0, 0, 0, false);
      group.add(ball);
      ball.visible = true;
      const p = path[0];
      ball.position.set(p.s, p.y, p.u);
      rolling.push({ ball, path, events, next: 0, t: 0, hit, done });
    },
    flash(points, text, color) {
      if (pop) dropPop();
      const big = points >= 50;
      const sprite = textSprite(text, { bg: color, color: '#fff', border: INK, size: big ? 72 : 56 });
      sprite.scale.multiplyScalar(big ? 0.4 : 0.32);
      const p = onFace(RINGS.d + 0.42, 0);
      sprite.position.set(p.s - 0.25, p.y, 0);
      group.add(sprite);
      pop = { sprite, t: 0 };
      if (points) ringGlow.set(points, 1);
      chase = big ? 2.5 : points ? 1 : 0;
    },
    update(dt) {
      clock.t += dt;
      for (let i = rolling.length - 1; i >= 0; i--) {
        const r = rolling[i];
        const before = pathAt(r.path, r.t);
        r.t += dt;
        const p = pathAt(r.path, r.t);
        r.ball.position.set(p.s, p.y, p.u);
        // Spinning the way it rolls.
        const ds = p.s - before.s;
        const du = p.u - before.u;
        const dist = Math.hypot(ds, du, p.y - before.y);
        if (dist > 1e-5 && Math.hypot(ds, du) > 1e-6) r.ball.rotateOnWorldAxis(axis.set(du, 0, -ds).normalize(), -dist / LANE.ball);
        while (r.next < r.events.length && r.events[r.next].t <= r.t) r.hit(r.events[r.next++], toWorld(p.s, p.u, p.y, at));
        if (r.t >= r.path[r.path.length - 1].t) {
          rolling.splice(i, 1);
          r.ball.visible = false;
          r.ball.removeFromParent();
          spare.push(r.ball);
          r.done();
        }
      }
      // Balls rolling back into the trough.
      for (const [i, b] of trough.entries()) {
        if (!b.mesh.visible) continue;
        if (b.wait > 0) {
          b.wait -= dt;
          continue;
        }
        const want = slot(i).z;
        const z = b.mesh.position.z;
        if (Math.abs(z - want) > 1e-3) {
          const step = Math.sign(want - z) * Math.min(Math.abs(want - z), dt * 1.6);
          b.mesh.position.z += step;
          b.mesh.rotation.x += step / LANE.ball;
        }
      }
      if (pop) {
        pop.t += dt;
        pop.sprite.position.y += dt * 0.12;
        pop.sprite.material.opacity = Math.min(1, 3 * (1.5 - pop.t));
        if (pop.t > 1.5) dropPop();
      }
      // The rings glow, the one just scored brightest; the bulbs chase after a score, or twinkle.
      for (const [points, m] of cab.rings) {
        const g = ringGlow.get(points) ?? 0;
        ringGlow.set(points, g * Math.exp(-dt * 1.6));
        m.emissiveIntensity = 0.3 + 0.1 * Math.sin(clock.t * 2 + points) + g * (Math.floor(clock.t * 8) % 2 ? 1.6 : 0.6);
      }
      chase = Math.max(0, chase - dt);
      const t = clock.t;
      cab.bulbs.forEach((m, i) => (m.emissiveIntensity = chase > 0 ? (((Math.floor(t * 12 - i) % 3) + 3) % 3 === 0 ? 1.6 : 0.15) : 0.35 + 0.25 * Math.max(0, Math.sin(t * 1.2 + i * 0.7))));
      cab.leds.forEach((m, i) => {
        const k = rolling.length || chase > 0 ? (Math.floor(t * 14) % 3 === i ? 1 : 0.25) : 0.55 + 0.15 * Math.sin(t * 1.5 + i * 2);
        m.color.setRGB(0.3 * k, 0.79 * k, 0.94 * k);
      });
    },
  };

  function dropPop() {
    if (!pop) return;
    pop.sprite.removeFromParent();
    pop.sprite.material.map?.dispose();
    pop.sprite.material.dispose();
    pop = null;
  }

  machine.display({ kind: 'idle', best: null });
  return machine;
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The skeeball machine by the loft's stairs. */
    skeeball: SkeeballMachine;
  }
}

/** The skeeball machine, its back to the meeting room's glass just north of the stairs. */
export const skeeball: Fixture<'skeeball'> = () => {
  const built = buildSkeeball();
  return { group: built.group, colliders: built.colliders, interactables: [built.interactable], update: (_t, dt) => built.update(dt), handle: { skeeball: built } };
};
