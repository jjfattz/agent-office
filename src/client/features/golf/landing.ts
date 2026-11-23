import * as THREE from 'three';
import { carry, type Club } from '../../../shared/golf';

// Where a full shot's meant to come down, over the ball: a circle on the ground out along your aim, as
// wide as how far off it'll roughly be, with a dotted arc up from the ball to it, the flight a swing
// stopped at the meter's notch would take through still air. While you hold Space, a gold ring runs
// out and back along the line with the meter: where you'd land it if you let go now. Trees, walls,
// the bounce and the roll aren't in it; the ball's own flight is in shared/golf.ts.

/** The circle's radius: this much of the distance out, and never less than this. */
const SPREAD = 0.05;
const LEAST = 1;
/** A dot on the arc this far apart (in its own points, 1/20 s each), and no more of them than this. */
const MOST = 160;
/** Just over the grass. */
const LIFT = 0.06;

export interface Landing {
  /** The ball, in the street's frame, and how high it sits (on a tee or the grass). */
  at: { x: number; z: number };
  y: number;
  /** The heading (0 is +z) and how far out. */
  yaw: number;
  dist: number;
  club: Club;
  loft: number;
  /** The meter's notch, the power that carries it `dist`. */
  power: number;
  /** While the meter runs: how far it'd carry if you let go now. */
  now: number | null;
}

export class LandingMark {
  readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh;
  private readonly fill: THREE.Mesh;
  private readonly dot: THREE.Mesh;
  private readonly now: THREE.Mesh;
  private readonly arc: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly pts: number[] = [];
  private arcKey = '';

  constructor() {
    const mat = (color: string, opacity: number, depthTest = false) => {
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest });
      m.userData.outlineParameters = { visible: false };
      return m;
    };
    const flat = (g: THREE.BufferGeometry) => g.rotateX(-Math.PI / 2);
    // A unit circle, scaled to the spread.
    this.ring = new THREE.Mesh(flat(new THREE.RingGeometry(0.9, 1, 48)), mat('#fffaf3', 0.95));
    this.fill = new THREE.Mesh(flat(new THREE.CircleGeometry(0.9, 48)), mat('#fffaf3', 0.18));
    this.dot = new THREE.Mesh(flat(new THREE.CircleGeometry(0.22, 16)), mat('#fffaf3', 0.95));
    this.now = new THREE.Mesh(flat(new THREE.RingGeometry(0.35, 0.6, 24)), mat('#ffd166', 1));
    this.arc = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 4), mat('#fffaf3', 0.7, true), MOST);
    this.arc.frustumCulled = false;
    this.group.add(this.fill, this.ring, this.dot, this.now, this.arc);
    for (const o of this.group.children) o.renderOrder = 3;
    this.group.visible = false;
  }

  /** Over the ball, `street` below the floor, aiming as `l` says; null hides it. */
  show(l: Landing | null, street: number): void {
    this.group.visible = !!l;
    if (!l) return;
    const sx = Math.sin(l.yaw);
    const sz = Math.cos(l.yaw);
    const r = Math.max(LEAST, l.dist * SPREAD);
    const y = street + LIFT;
    for (const o of [this.ring, this.fill, this.dot]) o.position.set(l.at.x + sx * l.dist, y, l.at.z + sz * l.dist);
    this.ring.scale.setScalar(r);
    this.fill.scale.setScalar(r);
    this.now.visible = l.now !== null;
    if (l.now !== null) this.now.position.set(l.at.x + sx * l.now, y + 0.01, l.at.z + sz * l.now);
    // The arc only changes with the club, the loft and the notch.
    const key = `${l.club}|${l.loft.toFixed(3)}|${l.power.toFixed(4)}`;
    if (key !== this.arcKey) {
      this.arcKey = key;
      this.pts.length = 0;
      carry(l.club, l.loft, l.power, this.pts);
    }
    const n = Math.min(MOST, this.pts.length / 2);
    for (let i = 0; i < n; i++) {
      const along = this.pts[i * 2];
      this.m.makeTranslation(l.at.x + sx * along, street + l.y + this.pts[i * 2 + 1], l.at.z + sz * along);
      this.arc.setMatrixAt(i, this.m);
    }
    this.arc.count = n;
    this.arc.instanceMatrix.needsUpdate = true;
  }
}
