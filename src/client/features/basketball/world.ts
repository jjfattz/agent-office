import * as THREE from 'three';
import { FLOOR } from '../../../shared/layout';
import { BALL, HOOP, RETURN_AFTER, THREE_POINT, backboard, launch, nearSolids, outOfReach, simulate, type BallHit, type BallShot, type BallSim, type BallState, type Solid } from '../../../shared/hoop';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { mergeByMaterial, mesh, toon, toonUnique } from '../../world/toon';

/** An NBA rim's orange-red, the orange of the key, and the dark steel holding it all up. */
const RIM_ORANGE = '#f2561d';
const STEEL = '#33363f';
const PAD = '#1c1d22';
/** NBA lines on the glass: 2 in wide, round the edge and the 24 by 18 in shooter's square over the rim. */
const LINE = 0.05;
const SQUARE = { w: 0.61, h: 0.457 } as const;

export interface HoopView {
  group: THREE.Group;
  /** The backboard and the arms holding it up, to walk (and jump) into. */
  colliders: Collider[];
  /** The net swings as a ball drops through it. */
  swish(): void;
  update(dt: number): void;
}

/** A rod of radius `r` from `a` to `b`. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

/**
 * The net, as an NBA net is tied: twelve loops off the rim, knotted into rows of diamonds that
 * narrow down to its bottom. Lines from the ring's middle downwards (so it scales from the rim).
 */
function netGeometry(): THREE.BufferGeometry {
  const strands = 12;
  const rows = 6;
  const { r, tube } = HOOP.rim;
  const point = (i: number, j: number): [number, number, number] => {
    const u = i / rows;
    // It narrows quickly under the rim, then hangs nearly straight.
    const rad = THREE.MathUtils.lerp(r - tube, HOOP.net.r, Math.sqrt(u));
    const a = ((j + (i % 2) * 0.5) / strands) * Math.PI * 2;
    return [Math.cos(a) * rad, -u * HOOP.net.depth, Math.sin(a) * rad];
  };
  const v: number[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < strands; j++) {
      // Each knot ties to the two below it, either side, which makes the diamonds.
      const below = i % 2 ? [j, j + 1] : [j - 1, j];
      for (const k of below) v.push(...point(i, j), ...point(i + 1, (k + strands) % strands));
    }
  }
  // The bottom row's knots, tied round.
  for (let j = 0; j < strands; j++) v.push(...point(rows, j), ...point(rows, (j + 1) % strands));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return geo;
}

/**
 * The hoop on the west wall, as an NBA hoop looks: a clear glass backboard with white lines and
 * black padding round its bottom edge, held off the wall by a steel frame you see through the glass,
 * an orange breakaway rim and a white nylon net, over a painted key on the floor with its free-throw
 * circle.
 */
export function buildHoop(): HoopView {
  const group = new THREE.Group();
  const parts = new THREE.Group();
  const { z, face, board, rim } = HOOP;
  const steel = toon(STEEL);
  const back = face - board.thick;
  const height = board.top - board.bottom;
  const midY = (board.bottom + board.top) / 2;

  // The glass: clear with a little blue in it, and its edges greener, as thick glass looks edge on.
  const glassMat = toonUnique('#d4ecf4');
  glassMat.transparent = true;
  glassMat.opacity = 0.22;
  glassMat.depthWrite = false;
  const glass = mesh(new THREE.BoxGeometry(board.thick, height, board.width), glassMat, face - board.thick / 2, midY, z, false);
  glass.renderOrder = 2;
  group.add(glass);
  const edgeMat = toon('#8fcfbf', { opacity: 0.7 });
  const edge = 0.015;
  for (const s of [-1, 1]) {
    parts.add(mesh(new THREE.BoxGeometry(board.thick + 0.002, edge, board.width), edgeMat, face - board.thick / 2, midY + s * (height / 2 - edge / 2), z, false));
    parts.add(mesh(new THREE.BoxGeometry(board.thick + 0.002, height, edge), edgeMat, face - board.thick / 2, midY, z + s * (board.width / 2 - edge / 2), false));
  }

  // Glare on the glass: two light streaks slanting across its top corner, as a toon draws glass.
  const glareMat = toon('#ffffff', { opacity: 0.28 });
  const streak = (u0: number, w: number) => {
    const h = height - 0.16;
    const lean = 0.3;
    const shape = new THREE.Shape();
    shape.moveTo(u0, -h / 2);
    shape.lineTo(u0 + w, -h / 2);
    shape.lineTo(u0 + w + lean, h / 2);
    shape.lineTo(u0 + lean, h / 2);
    shape.closePath();
    const m = mesh(new THREE.ShapeGeometry(shape), glareMat, face + 0.008, midY, z, false);
    m.rotation.y = Math.PI / 2;
    parts.add(m);
  };
  streak(0.42, 0.09);
  streak(0.56, 0.035);

  // The white lines on its front: round the edge, and the shooter's square, its base level with the top of the rim.
  const white = toon('#ffffff');
  const line = (w: number, h: number, y: number, dz: number) => parts.add(mesh(new THREE.BoxGeometry(0.006, h, w), white, face + 0.003, y, z + dz, false));
  const inset = 0.02;
  const bw = board.width - 2 * inset;
  const bh = height - 2 * inset;
  line(bw, LINE, board.top - inset - LINE / 2, 0);
  line(bw, LINE, board.bottom + inset + LINE / 2, 0);
  for (const s of [-1, 1]) line(LINE, bh, midY, s * (bw / 2 - LINE / 2));
  const sqBottom = rim.y + rim.tube - LINE;
  line(SQUARE.w, LINE, sqBottom + LINE / 2, 0);
  line(SQUARE.w, LINE, sqBottom + SQUARE.h - LINE / 2, 0);
  for (const s of [-1, 1]) line(LINE, SQUARE.h, sqBottom + SQUARE.h / 2, s * (SQUARE.w / 2 - LINE / 2));

  // Black padding wrapped round the bottom edge and up the sides a way.
  const pad = toon(PAD);
  const padT = 0.05;
  const padX = face - board.thick / 2;
  const padD = board.thick + 2 * 0.025;
  parts.add(mesh(new THREE.BoxGeometry(padD, padT + 0.02, board.width + 2 * padT), pad, padX, board.bottom + 0.01, z));
  const sideH = 0.38;
  for (const s of [-1, 1]) parts.add(mesh(new THREE.BoxGeometry(padD, sideH, padT), pad, padX, board.bottom + sideH / 2, z + s * (board.width / 2 + padT / 2)));

  // The steel frame behind the glass, as on an NBA stanchion: a box behind the shooter's square, and
  // the plate the rim bolts through to. You see it through the glass.
  const frameX = back - 0.025;
  const post = { dz: 0.3, lo: board.bottom + 0.06, hi: sqBottom + SQUARE.h - 0.04 };
  for (const s of [-1, 1]) parts.add(mesh(new THREE.BoxGeometry(0.05, post.hi - post.lo, 0.05), steel, frameX, (post.lo + post.hi) / 2, z + s * post.dz));
  for (const y of [post.lo + 0.025, post.hi - 0.025]) parts.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 2 * post.dz), steel, frameX, y, z));
  parts.add(mesh(new THREE.BoxGeometry(0.03, 0.26, 0.32), steel, back - 0.015, rim.y - 0.07, z));

  // Arms from a plate on the wall out to the frame, crossed between, all of it hidden behind the board.
  const armY = [post.lo + 0.1, post.hi - 0.05];
  parts.add(mesh(new THREE.BoxGeometry(0.04, armY[1] - armY[0] + 0.2, 0.8), steel, FLOOR.minX + 0.02, (armY[0] + armY[1]) / 2, z));
  const reach = frameX - 0.025 - FLOOR.minX;
  for (const dz of [-post.dz, post.dz]) {
    for (const y of armY) parts.add(mesh(new THREE.BoxGeometry(reach, 0.06, 0.06), steel, FLOOR.minX + reach / 2, y, z + dz));
    parts.add(rod(new THREE.Vector3(FLOOR.minX + 0.04, armY[0], z + dz), new THREE.Vector3(frameX - 0.025, armY[1], z + dz), 0.018, steel));
  }

  // The rim: the ring, the plate under it out to the glass, two struts and the breakaway housing on the glass.
  const orange = toon(RIM_ORANGE);
  const ring = mesh(new THREE.TorusGeometry(rim.r, rim.tube, 8, 40), orange, rim.x, rim.y, rim.z);
  ring.rotation.x = Math.PI / 2;
  parts.add(ring);
  const gap = rim.x - rim.r - face;
  parts.add(mesh(new THREE.BoxGeometry(gap + 0.05, 0.012, 0.15), orange, face + (gap + 0.05) / 2, rim.y - rim.tube - 0.006, z));
  parts.add(mesh(new THREE.BoxGeometry(0.07, 0.2, 0.24), orange, face + 0.035, rim.y - 0.08, z));
  for (const s of [-1, 1]) {
    const a = new THREE.Vector3(face + 0.06, rim.y - 0.17, z + s * 0.08);
    const b = new THREE.Vector3(rim.x - rim.r * 0.55, rim.y - rim.tube, z + s * rim.r * 0.8);
    parts.add(rod(a, b, 0.009, orange));
  }
  // The little hooks under the ring the net's loops hang from.
  for (let j = 0; j < 12; j++) {
    const a = (j / 12) * Math.PI * 2;
    parts.add(mesh(new THREE.BoxGeometry(0.012, 0.025, 0.012), orange, rim.x + Math.cos(a) * rim.r, rim.y - rim.tube - 0.01, rim.z + Math.sin(a) * rim.r, false));
  }
  group.add(mergeByMaterial(parts));

  // The net: white nylon, in diamonds, hanging from the rim.
  const net = new THREE.LineSegments(netGeometry(), new THREE.LineBasicMaterial({ color: '#ffffff' }));
  net.position.set(rim.x, rim.y - rim.tube, rim.z);
  group.add(net);

  // The key painted on the floor, out to the free-throw line, and the circle round the line.
  const lineX = face + HOOP.line;
  const keyW = 2.6;
  const paint = (geo: THREE.BufferGeometry, color: string, y: number) => {
    // Lit like the floor it's on (and not outlined: it's flat on it), and drawn over the planks.
    const mat = toonUnique(color);
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.userData.outlineParameters = { visible: false };
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.receiveShadow = true;
    m.renderOrder = 1;
    group.add(m);
    return m;
  };
  const keyLen = lineX - FLOOR.minX;
  const key = paint(new THREE.PlaneGeometry(keyLen, keyW), '#ee9a5d', 0.013);
  key.position.set(FLOOR.minX + keyLen / 2, key.position.y, z);
  const w = 0.06;
  const stripe = (len: number, x: number, sz: number, alongZ: boolean) => {
    const s = paint(new THREE.PlaneGeometry(alongZ ? w : len, alongZ ? len : w), '#ffffff', 0.015);
    s.position.set(x, s.position.y, sz);
  };
  stripe(keyLen, FLOOR.minX + keyLen / 2, z - keyW / 2, false);
  stripe(keyLen, FLOOR.minX + keyLen / 2, z + keyW / 2, false);
  stripe(keyW, lineX, z, true);
  // Half a circle, out past the line.
  const arc = paint(new THREE.RingGeometry(keyW / 2 - w, keyW / 2, 40, 1, -Math.PI / 2, Math.PI), '#ffffff', 0.015);
  arc.position.set(lineX, arc.position.y, z);

  const colliders: Collider[] = [backboard(), { minX: FLOOR.minX, maxX: back, minZ: z - post.dz - 0.04, maxZ: z + post.dz + 0.04, bottom: post.lo, top: post.hi }];

  // The net's swing: stretched down as the ball goes through, springing back.
  let stretch = 0;
  let speed = 0;
  return {
    group,
    colliders,
    swish() {
      speed -= 5;
    },
    update(dt) {
      // A damped spring.
      speed += (-60 * stretch - 7 * speed) * dt;
      stretch += speed * dt;
      net.scale.set(1 + stretch * 0.25, 1 - stretch * 0.9, 1 + stretch * 0.25);
    },
  };
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The basketball hoop on the west wall (the ball is features/basketball's: see Basketball below). */
    hoop: HoopView;
  }
}

/** The basketball hoop, on the west wall by the exit door. */
export const hoop: Fixture<'hoop'> = (site) => {
  const built = buildHoop();
  site.wall('west', HOOP.z, (HOOP.board.bottom - 0.6 + HOOP.board.top + 0.1) / 2, HOOP.board.width + 0.3, HOOP.board.top - HOOP.board.bottom + 0.7);
  return { group: built.group, colliders: built.colliders, update: (_t, dt) => built.update(dt), handle: { hoop: built } };
};

// ---- The ball ------------------------------------------------------------------------------------------

let ballTexture: THREE.CanvasTexture | null = null;
/** Orange leather with the black seams: round its middle, over the top, and the two curves either side. */
function texture(): THREE.CanvasTexture {
  if (ballTexture) return ballTexture;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8742a';
  g.fillRect(0, 0, 256, 128);
  // A little pebbling.
  for (let i = 0; i < 900; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
    g.fillRect(Math.random() * 256, Math.random() * 128, 2, 2);
  }
  g.strokeStyle = '#1d1d1d';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(0, 64);
  g.lineTo(256, 64);
  for (const x of [2, 128]) {
    g.moveTo(x, 0);
    g.lineTo(x, 128);
  }
  g.stroke();
  g.beginPath();
  for (const [x0, dir] of [
    [64, 1],
    [192, -1],
  ]) {
    for (let v = 0; v <= 128; v += 4) {
      const x = x0 + dir * 30 * Math.sin((Math.PI * v) / 128);
      if (v === 0) g.moveTo(x, v);
      else g.lineTo(x, v);
    }
  }
  g.stroke();
  ballTexture = new THREE.CanvasTexture(c);
  ballTexture.colorSpace = THREE.SRGBColorSpace;
  ballTexture.anisotropy = 4;
  return ballTexture;
}

/** A basketball, `r` meters round (its own size unless given): in the room, or in your hands. */
export function ballMesh(r: number = BALL.r): THREE.Mesh {
  const mat = new THREE.MeshToonMaterial({ map: texture(), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  const m = mesh(new THREE.SphereGeometry(r, 20, 14), mat);
  m.rotation.z = 0.4;
  return m;
}

/** How a basket went in: who threw it, from how far, and whether it touched anything on the way. */
export interface Basket {
  by: string;
  distance: number;
  swish: boolean;
  bank: boolean;
  three: boolean;
}

/** Where the ball sits between someone's hands, in their character's own space (forward is +z). */
export const IN_HANDS = new THREE.Vector3(0, 0.95, 0.42);

const tmp = new THREE.Vector3();
const axis = new THREE.Vector3();
const spin = new THREE.Quaternion();

/**
 * The floor's basketball, as everyone on the floor sees it: in someone's hands, flying from a throw
 * (worked out the same way on every page, from the throw the office passed on), or lying where it
 * stopped. `set` takes the office's word for it; `throwNow` is your own throw, before the office hears.
 */
export class Basketball {
  readonly group = new THREE.Group();
  readonly interactable: Interactable = { kind: 'ball', x: BALL.home.x, y: 0, z: BALL.home.z, radius: 1.4 };
  readonly interactables = [this.interactable];
  /** Who has it (a peer id), or null while it's loose. */
  holder: string | null = null;
  private ball: THREE.Mesh;
  /** What rays pick it by: off while it's in someone's hands. */
  private pick: THREE.Mesh;
  private sim: BallSim | null = null;
  private shot: BallShot | null = null;
  /** performance.now() when the throw left their hands, on this page's clock. */
  private t0 = 0;
  private solids: Solid[] = [];
  /** The throw's end has been told about (a basket or a miss). */
  private settled = false;
  private last = new THREE.Vector3(BALL.home.x, BALL.r, BALL.home.z);
  /** It bounced off something (for the sounds). */
  onHit: ((hit: BallHit, at: THREE.Vector3) => void) | null = null;
  /** Someone threw it (not you: yours you know about): their character's arms go up. */
  onThrow: ((by: string) => void) | null = null;
  onBasket: ((b: Basket) => void) | null = null;
  /** A throw of `by`'s came to nothing: it stopped, or somebody took it, without going in. */
  onMiss: ((by: string) => void) | null = null;

  constructor(private colliders: () => readonly Solid[]) {
    this.ball = ballMesh();
    // Rays pick the ball by a bigger, invisible ball round it, so it's easy to point at.
    this.ball.raycast = () => {};
    const pick = (this.pick = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), new THREE.MeshBasicMaterial({ visible: false })));
    pick.userData.interact = this.interactable;
    this.group.add(this.ball, pick);
    this.group.position.copy(this.last);
  }

  /** Where the ball is now, flying or lying (not in anyone's hands). */
  get at(): THREE.Vector3 {
    return this.group.position;
  }

  /** Loose and not flying about any more. */
  get still(): boolean {
    return !this.holder && (!this.sim || this.sim.still);
  }

  /** The office's word on where the ball is, as of `now` (performance.now()). */
  set(state: BallState, now: number) {
    if (state.holder) {
      if (this.holder === state.holder) return;
      this.endThrow();
      this.holder = state.holder;
      this.sim = null;
      return;
    }
    this.holder = null;
    const s = state.shot;
    if (!s) {
      this.endThrow();
      this.sim = null;
      return;
    }
    // A throw that's already flying here (your own, back from the office).
    if (this.shot && same(this.shot, s)) return;
    this.endThrow();
    this.start(s, now - s.elapsed);
    // Catch up with it quietly: what it hit before you saw it is over and done with.
    simulate(this.sim!, (now - this.t0) / 1000, this.solids);
    if (this.sim!.t < 0.3) this.onThrow?.(s.by);
    this.settled = this.sim!.scored || this.sim!.still || this.sim!.lost;
  }

  /** You throw it (or drop it): it's out of your hands now, whatever the office says in a moment. */
  throwNow(s: Omit<BallShot, 'elapsed'>, now: number) {
    this.endThrow();
    this.holder = null;
    this.start({ ...s, elapsed: 0 }, now);
  }

  /** You (`id`) take it, before the office says so. */
  takeNow(id: string) {
    this.endThrow();
    this.holder = id;
    this.sim = null;
  }

  private start(s: BallShot, t0: number) {
    this.shot = s;
    this.t0 = t0;
    this.solids = nearSolids(this.colliders());
    this.sim = launch(s);
    this.settled = false;
  }

  /** A throw is over (someone took it, or threw again): if it hadn't gone in, that's a miss. */
  private endThrow() {
    if (this.shot && !this.settled && !this.sim?.scored) this.onMiss?.(this.shot.by);
    this.settled = true;
    this.shot = null;
  }

  /**
   * Moves the ball on to `now`: flying or rolling along, or in the hands of whoever has it
   * (`handsOf` says where those are, or null when they're not in view).
   */
  update(now: number, handsOf: (id: string, out: THREE.Vector3) => THREE.Vector3 | null) {
    const it = this.interactable;
    const pos = this.group.position;
    if (this.holder) {
      const at = handsOf(this.holder, tmp);
      this.group.visible = !!at;
      if (at) pos.copy(at);
      it.off = true;
      this.pick.visible = false;
      this.last.copy(pos);
      return;
    }
    const s = this.sim;
    if (s) {
      const hits: BallHit[] = [];
      const was = s.scored;
      simulate(s, (now - this.t0) / 1000, this.solids, hits);
      pos.set(s.x, s.y, s.z);
      for (const h of hits) this.onHit?.(h, pos);
      if (s.scored && !was && this.shot) {
        this.settled = true;
        const distance = Math.hypot(this.shot.x - HOOP.rim.x, this.shot.z - HOOP.rim.z);
        this.onBasket?.({ by: this.shot.by, distance, swish: !s.touched.rim && !s.touched.board, bank: s.touched.board, three: distance > THREE_POINT });
      }
      const gone = s.lost || (s.still && outOfReach(s));
      if ((s.still || s.lost) && !this.settled) {
        this.settled = true;
        if (this.shot) this.onMiss?.(this.shot.by);
      }
      // Out of reach (or out of the building) for a moment, it turns up back under the hoop.
      if (gone && (now - this.t0) / 1000 > s.t + RETURN_AFTER) {
        this.sim = null;
        this.shot = null;
      }
      this.group.visible = !s.lost;
    }
    if (!this.sim) {
      pos.set(BALL.home.x, BALL.r, BALL.home.z);
      this.group.visible = true;
    }
    // It rolls round the way it goes.
    tmp.subVectors(pos, this.last);
    const d = Math.hypot(tmp.x, tmp.z);
    if (d > 1e-5 && d < 2) {
      axis.set(tmp.z, 0, -tmp.x).normalize();
      this.ball.quaternion.premultiply(spin.setFromAxisAngle(axis, d / BALL.r));
    }
    this.last.copy(pos);
    it.off = !this.group.visible;
    this.pick.visible = true;
    it.x = pos.x;
    it.z = pos.z;
    // Caught about chest high: the floor it's over is a meter under it.
    it.y = Math.max(0, pos.y - 1);
  }
}

function same(a: BallShot, b: BallShot): boolean {
  return a.by === b.by && a.x === b.x && a.y === b.y && a.z === b.z && a.vx === b.vx && a.vy === b.vy && a.vz === b.vz;
}
