import * as THREE from 'three';
import { AIM_MAX, BALLS, CORNERS, LANE, RINGS, SKEEBALL, onFace, pathAt, type PathPoint } from '../../../shared/skeeball';
import { mesh, roundedBox, textSprite, toon, toonUnique } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { paintDisplay, paintFace, paintMarquee, type DisplayState } from './paint';

// The skeeball machine: a long cabinet in red with yellow trim, a maple lane up to a hump, and the
// target leaning back behind it under a net, its rings round the 50 in the middle and a 100 pocket
// in each top corner. A lit marquee and a score display stand over it. Its back is against the
// meeting room's west glass, just north of the loft's stairs, and you roll from its front, facing
// east. Everything is built in the machine's own frame (x along the lane, z across it, y up), which
// is the room's own way round, just moved to where the machine stands.

const CABINET = '#d62839';
const TRIM = '#ffd166';
const INK = '#2b2d42';
const MAPLE = '#e0b47c';
const BALL = '#f4f1de';

export interface SkeeballMachine {
  group: THREE.Group;
  colliders: Collider[];
  interactable: Interactable;
  /** Where you stand to roll, and the way you face there (toward the target). */
  readonly spot: { x: number; z: number; facing: number };
  /** A point in the machine's frame (s along the lane, u across it, y up), in the room. */
  toWorld(s: number, u: number, y: number, out: THREE.Vector3): THREE.Vector3;
  /** How many balls wait in the trough at the front. */
  setTrough(n: number): void;
  /** The guide painted up the lane while you aim (null: none). */
  aim(angle: number | null): void;
  /** What the score display says. */
  display(state: DisplayState): void;
  /**
   * Rolls a ball along `path` (see roll in shared/skeeball.ts): `hop` as it leaves the hump, and
   * `drop` once it's gone down its hole.
   */
  launch(path: readonly PathPoint[], hooks: { hop?(): void; drop?(): void }): void;
  /** Lights the marquee up and puts `text` up over the target for a moment. */
  flash(text: string, color: string, big: boolean): void;
  update(dt: number): void;
}

interface Rolling {
  ball: THREE.Mesh;
  path: readonly PathPoint[];
  t: number;
  hopped: boolean;
  hooks: { hop?(): void; drop?(): void };
}

/** A side-view outline (s along, y up), pulled out `thick` across the machine from u = `u0`. */
function slab(points: readonly (readonly [number, number])[], thick: number, u0: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([s, y]) => new THREE.Vector2(s, y))), { depth: thick, bevelEnabled: false });
  geo.translate(0, 0, u0);
  geo.computeVertexNormals();
  return geo;
}

/** A flat panel from (s0, y0) to (s1, y1) in side view, `w` across, `t` thick, its top surface on that line. */
function ramp(s0: number, y0: number, s1: number, y1: number, w: number, t: number, mat: THREE.Material): THREE.Mesh {
  const len = Math.hypot(s1 - s0, y1 - y0);
  const m = mesh(new THREE.BoxGeometry(len, t, w), mat, (s0 + s1) / 2, (y0 + y1) / 2 - t / 2, 0);
  m.rotation.z = Math.atan2(y1 - y0, s1 - s0);
  return m;
}

export function buildSkeeball(): SkeeballMachine {
  const { length: L, width: W, inner } = LANE;
  const group = new THREE.Group();
  group.position.set(SKEEBALL.x, 0, SKEEBALL.z);
  const cabinet = toon(CABINET);
  const trim = toon(TRIM);
  const ink = toon(INK);
  const rail = (W - inner) / 2;

  // The side panels: low along the lane, rising round the target to the marquee.
  const side: [number, number][] = [
    [0, 0],
    [L, 0],
    [L, 2.42],
    [L - 0.32, 2.42],
    [L - 0.32, 1.86],
    [LANE.foot.s - 0.1, 1.02],
    [LANE.foot.s - 0.25, 0.98],
    [LANE.start.s, 0.8],
    [0, 0.8],
  ];
  for (const u0 of [-W / 2, W / 2 - rail]) {
    group.add(mesh(slab(side, rail, u0), cabinet, 0, 0, 0));
    // A yellow stripe along the top of the rail, and down its front.
    const top = side.slice(4);
    for (let i = 0; i + 1 < top.length; i++) {
      const [s0, y0] = top[i];
      const [s1, y1] = top[i + 1];
      group.add(ramp(s1, y1 + 0.03, s0, y0 + 0.03, rail + 0.02, 0.03, trim).translateZ(u0 + rail / 2));
    }
  }
  // The body under the lane, the trough across the front, and the back.
  group.add(mesh(new THREE.BoxGeometry(L - 0.02, 0.6, inner), cabinet, L / 2, 0.3, 0));
  group.add(mesh(new THREE.BoxGeometry(LANE.trough, 0.08, inner), ink, LANE.trough / 2, 0.62, 0, false));
  group.add(mesh(new THREE.BoxGeometry(0.05, 0.18, inner), trim, 0.025, 0.69, 0, false));
  group.add(mesh(new THREE.BoxGeometry(0.06, 2.42 - 0.6, inner), ink, L - 0.03, 0.6 + (2.42 - 0.6) / 2, 0));

  // The lane: maple, with arrows down the middle, up to the black rubber hump.
  const { start, foot, hump, face } = LANE;
  group.add(ramp(start.s, start.y, foot.s, foot.y, inner, 0.04, toon(MAPLE)));
  const laneTilt = Math.atan2(foot.y - start.y, foot.s - start.s);
  for (const k of [0.25, 0.42, 0.59]) {
    const s = start.s + (foot.s - start.s) * k;
    const y = start.y + (foot.y - start.y) * k + 0.003;
    for (const du of [-0.11, 0, 0.11]) {
      // A flat triangle, pointing up the lane.
      const arrow = mesh(new THREE.CircleGeometry(0.035, 3).rotateX(-Math.PI / 2), ink, s, y, du, false);
      arrow.rotation.z = laneTilt;
      group.add(arrow);
    }
  }
  group.add(mesh(slab([[foot.s, foot.y], [hump.s, hump.y], [hump.s, 0.6], [foot.s, 0.6]], inner, -inner / 2), ink, 0, 0, 0));
  // The pit between the hump and the target, where a short ball drops to the 10.
  group.add(mesh(new THREE.BoxGeometry(face.s - hump.s + 0.06, 0.02, inner), toon('#1b1b2f'), (hump.s + face.s) / 2, face.y - 0.04, 0, false));

  // The target: a board leaning back, in its own frame (x across, y up the slope, z out of it).
  const faceFrame = new THREE.Group();
  faceFrame.position.set(face.s, face.y, 0);
  faceFrame.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.cos(face.angle), Math.sin(face.angle), 0), new THREE.Vector3(-Math.sin(face.angle), Math.cos(face.angle), 0)),
  );
  group.add(faceFrame);
  const faceTex = paintFace(inner, face.long);
  const board = mesh(new THREE.PlaneGeometry(inner, face.long).translate(0, face.long / 2, 0), new THREE.MeshToonMaterial({ map: faceTex, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }), 0, 0, 0, false);
  faceFrame.add(board);
  faceFrame.add(mesh(new THREE.BoxGeometry(inner, face.long, 0.04).translate(0, face.long / 2, -0.021), ink, 0, 0, 0, false));
  // The rings' lips, standing proud of the board, and the corner pockets' rims.
  const lip = toon('#f8f9fa');
  for (const [r] of RINGS.bands) faceFrame.add(mesh(new THREE.TorusGeometry(r, 0.008, 6, 48), lip, 0, RINGS.d, 0.004, false));
  for (const side of [-1, 1]) faceFrame.add(mesh(new THREE.TorusGeometry(CORNERS.r, 0.008, 6, 24), trim, side * CORNERS.u, CORNERS.d, 0.004, false));

  // The net over the target, so nothing flies out.
  const netTex = paintNet();
  const net = new THREE.MeshBasicMaterial({ map: netTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const n0: [number, number] = [LANE.foot.s - 0.1, 1.02];
  const n1: [number, number] = [L - 0.32, 1.86];
  const netPlane = new THREE.Mesh(new THREE.PlaneGeometry(Math.hypot(n1[0] - n0[0], n1[1] - n0[1]), inner + 0.02).rotateX(-Math.PI / 2), net);
  netPlane.rotation.z = Math.atan2(n1[1] - n0[1], n1[0] - n0[0]);
  netPlane.position.set((n0[0] + n1[0]) / 2, (n0[1] + n1[1]) / 2 + 0.01, 0);
  netTex.repeat.set(16, 9);
  group.add(netPlane);

  // Over the target: the score display, and the lit marquee on top.
  const displayCanvas = document.createElement('canvas');
  displayCanvas.width = 512;
  displayCanvas.height = 256;
  const displayTex = new THREE.CanvasTexture(displayCanvas);
  displayTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(inner - 0.04, (inner - 0.04) / 2), new THREE.MeshBasicMaterial({ map: displayTex }));
  screen.rotation.y = -Math.PI / 2;
  screen.position.set(L - 0.075, 1.62 + (inner - 0.04) / 4, 0);
  group.add(screen);
  group.add(mesh(new THREE.BoxGeometry(0.03, (inner - 0.04) / 2 + 0.06, inner), ink, L - 0.05, screen.position.y, 0, false));
  const marquee = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.4), new THREE.MeshBasicMaterial({ map: paintMarquee() }));
  marquee.rotation.y = -Math.PI / 2;
  marquee.position.set(L - 0.33, 2.2, 0);
  group.add(marquee);
  group.add(mesh(roundedBox(0.34, 0.1, W + 0.06, 0.03), trim, L - 0.17, 2.46, 0));
  // Bulbs round the marquee, which chase when somebody scores.
  const bulbs: THREE.MeshToonMaterial[] = [];
  const bulbGeo = new THREE.SphereGeometry(0.022, 8, 6);
  for (let i = 0; i < 12; i++) {
    const mat = toonUnique('#fff3b0');
    mat.emissive = new THREE.Color('#ffb703');
    mat.emissiveIntensity = 0.2;
    bulbs.push(mat);
    const along = (i + 0.5) / 12;
    group.add(mesh(bulbGeo, mat, L - 0.34, along < 0.5 ? 2.02 : 2.38, (((i % 6) + 0.5) / 6 - 0.5) * (W - 0.1), false));
  }

  // The balls: the ones waiting in the trough, and the ones rolling.
  const ballGeo = new THREE.SphereGeometry(LANE.ball, 14, 10);
  const ballMat = toon(BALL);
  const trough: THREE.Mesh[] = [];
  for (let i = 0; i < BALLS; i++) {
    const b = mesh(ballGeo, ballMat, 0.13 + (i % 2) * 0.07, 0.66 + LANE.ball - 0.01, -inner / 2 + 0.07 + (i * (inner - 0.14)) / (BALLS - 1), false);
    group.add(b);
    trough.push(b);
  }
  const rolling: Rolling[] = [];
  const spare: THREE.Mesh[] = [];

  // The guide up the lane while you aim: a dotted line the way the ball will go.
  const guide = new THREE.Group();
  const dotMat = new THREE.MeshBasicMaterial({ color: '#06d6a0', transparent: true, opacity: 0.85, depthWrite: false });
  for (let i = 0; i < 9; i++) guide.add(new THREE.Mesh(new THREE.CircleGeometry(0.014, 10).rotateX(-Math.PI / 2), dotMat));
  guide.visible = false;
  group.add(guide);

  // The score that pops up over the target.
  let pop: { sprite: THREE.Sprite; t: number } | null = null;
  let glow = 0;
  let chase = 0;

  const half = inner / 2 - LANE.ball;
  const front = SKEEBALL.x - 0.5;
  const collider: Collider = { minX: SKEEBALL.x, maxX: SKEEBALL.x + L, minZ: SKEEBALL.z - W / 2, maxZ: SKEEBALL.z + W / 2, top: 2.5 };
  const interactable: Interactable = { kind: 'skeeball', x: SKEEBALL.x - 0.3, z: SKEEBALL.z, radius: 1.2 };
  group.userData.interact = interactable;

  const toWorld = (s: number, u: number, y: number, out: THREE.Vector3) => out.set(SKEEBALL.x + s, y, SKEEBALL.z + u);

  const machine: SkeeballMachine = {
    group,
    colliders: [collider],
    interactable,
    spot: { x: front, z: SKEEBALL.z, facing: Math.PI / 2 },
    toWorld,
    setTrough(n) {
      trough.forEach((b, i) => (b.visible = i < n));
    },
    aim(angle) {
      guide.visible = angle !== null;
      if (angle === null) return;
      const a = THREE.MathUtils.clamp(angle, -AIM_MAX, AIM_MAX);
      guide.children.forEach((dot, i) => {
        const run = 0.15 + i * 0.17;
        const s = start.s + run * Math.cos(a);
        const u = THREE.MathUtils.clamp(run * Math.sin(a), -half, half);
        dot.position.set(s, start.y + ((s - start.s) * (foot.y - start.y)) / (foot.s - start.s) + 0.004, u);
      });
    },
    display(state) {
      paintDisplay(displayCanvas, state);
      displayTex.needsUpdate = true;
    },
    launch(path, hooks) {
      const ball = spare.pop() ?? mesh(ballGeo, ballMat, 0, 0, 0, false);
      group.add(ball);
      ball.visible = true;
      const p = path[0];
      ball.position.set(p.s, p.y, p.u);
      rolling.push({ ball, path, t: 0, hopped: false, hooks });
    },
    flash(text, color, big) {
      if (pop) {
        pop.sprite.removeFromParent();
        pop.sprite.material.map?.dispose();
        pop.sprite.material.dispose();
      }
      const sprite = textSprite(text, { bg: color, color: '#fff', border: INK, size: big ? 72 : 56 });
      sprite.scale.multiplyScalar(big ? 0.36 : 0.3);
      const at = onFace(RINGS.d, 0);
      sprite.position.set(at.s - 0.2, at.y + 0.05, 0);
      group.add(sprite);
      pop = { sprite, t: 0 };
      glow = big ? 1 : 0.6;
      chase = big ? 3 : 1.2;
    },
    update(dt) {
      for (let i = rolling.length - 1; i >= 0; i--) {
        const r = rolling[i];
        const before = r.t;
        r.t += dt;
        const p = pathAt(r.path, r.t);
        const was = pathAt(r.path, before);
        r.ball.position.set(p.s, p.y, p.u);
        // Spinning the way it rolls.
        const ds = p.s - was.s;
        const du = p.u - was.u;
        const d = Math.hypot(ds, du);
        if (d > 1e-5) r.ball.rotateOnWorldAxis(new THREE.Vector3(du / d, 0, -ds / d), -d / LANE.ball);
        if (!r.hopped && p.s >= hump.s) {
          r.hopped = true;
          r.hooks.hop?.();
        }
        if (r.t >= r.path[r.path.length - 1].t) {
          rolling.splice(i, 1);
          r.ball.visible = false;
          r.ball.removeFromParent();
          spare.push(r.ball);
          r.hooks.drop?.();
        }
      }
      if (pop) {
        pop.t += dt;
        pop.sprite.position.y += dt * 0.15;
        pop.sprite.material.opacity = Math.min(1, 3 * (1.6 - pop.t));
        if (pop.t > 1.6) {
          pop.sprite.removeFromParent();
          pop.sprite.material.map?.dispose();
          pop.sprite.material.dispose();
          pop = null;
        }
      }
      chase = Math.max(0, chase - dt);
      glow *= Math.exp(-dt * 1.5);
      const t = performance.now() / 1000;
      bulbs.forEach((m, i) => (m.emissiveIntensity = chase > 0 ? (Math.floor(t * 10 + i) % 3 === 0 ? 1.4 : 0.15) : 0.25 + glow + 0.08 * Math.sin(t * 1.3 + i)));
    },
  };
  machine.display({ kind: 'idle', best: null });
  return machine;
}

/** A net: a fine grid of dark cord, see-through between. */
function paintNet(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(30,30,40,.55)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
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
