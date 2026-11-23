import * as THREE from 'three';

// The line on the green over a putt: a row of dots from your ball the way you're aiming, out as far
// as the pin while you line it up, and then, while you hold Space, as far as the putt you'd hit if
// you let go now would roll on the flat (the slope will bend it; the info line says which way).

/** A dot this far apart, and no more of them than this. */
const GAP = 0.22;
const MOST = 80;
/** Just over the green, so it never fights with it. */
const LIFT = 0.035;

export class PuttGuide {
  readonly group = new THREE.Group();
  private readonly dots: THREE.InstancedMesh;
  private readonly end: THREE.Mesh;
  private readonly mat = new THREE.MeshBasicMaterial({ color: '#fffaf3', transparent: true, opacity: 0.85, depthWrite: false });
  private readonly m = new THREE.Matrix4();

  constructor() {
    this.mat.userData.outlineParameters = { visible: false };
    this.dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.035, 10).rotateX(-Math.PI / 2), this.mat, MOST);
    this.dots.frustumCulled = false;
    this.end = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.2, 24).rotateX(-Math.PI / 2), this.mat);
    this.group.add(this.dots, this.end);
    this.group.visible = false;
    this.group.renderOrder = 2;
  }

  /**
   * The line from the ball at (x, z), `street` below the floor, heading `yaw` (0 is +z) for `length`
   * meters: white lining it up, gold while the meter runs. Null hides it.
   */
  show(at: { x: number; z: number } | null, street: number, yaw: number, length: number, charging: boolean): void {
    this.group.visible = !!at;
    if (!at) return;
    this.mat.color.set(charging ? '#ffd166' : '#fffaf3');
    const sx = Math.sin(yaw);
    const sz = Math.cos(yaw);
    const n = Math.min(MOST, Math.floor(length / GAP));
    // From a little in front of the ball, so it doesn't sit on it.
    for (let i = 0; i < n; i++) {
      const d = 0.2 + i * GAP;
      this.m.makeTranslation(at.x + sx * d, street + LIFT, at.z + sz * d);
      this.dots.setMatrixAt(i, this.m);
    }
    this.dots.count = n;
    this.dots.instanceMatrix.needsUpdate = true;
    this.end.position.set(at.x + sx * Math.max(0.2, length), street + LIFT, at.z + sz * Math.max(0.2, length));
  }
}
