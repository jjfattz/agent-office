import * as THREE from 'three';
import { CORNERS, LANE, RINGS, laneY } from '../../../shared/skeeball';
import { mesh, roundedBox, toon, toonUnique } from '../../world/toon';
import { RING_COLORS, paintFace, paintFront, paintLane, paintMarquee, paintNet, paintShadow, paintSide } from './paint';

// The skeeball machine's cabinet, built in its own frame (x along the lane, z across it, y up): side
// panels in sunset art with chrome along their tops, a maple lane between glass guards with LED strips
// down its rails, the black rubber hump, the target leaning back under its net with its rings' lips
// glowing, the score display and an arched marquee in bulbs over it all, and a coin door at the
// front. Nothing casts a shadow (it stands a hand's width from the stairs, whose wall would flicker
// with it): a soft patch on the floor stands in. No two faces share a plane, for the same reason.

const PANEL = '#240046';
const CHROME = '#dfe7f2';
const RUBBER = '#1b1b2f';

/** The side panels' top edge, front to back (s, y): low along the lane, sweeping up round the target to the marquee. */
export const TOP: readonly (readonly [number, number])[] = [
  [0, 0.9],
  [1.55, 0.98],
  [1.9, 1.1],
  [2.86, 1.94],
  [2.86, 2.1],
  [LANE.length, 2.1],
];
/** Where the score display is (its middle) and how big. */
export const DISPLAY = { s: 3.15, y: 1.67, w: 0.72, h: 0.36 } as const;

export interface Cabinet {
  group: THREE.Group;
  /** The target's own frame: x across it, y up its slope, z out of it. */
  faceFrame: THREE.Group;
  /** Each ring's glowing lip, by its points. */
  rings: Map<number, THREE.MeshToonMaterial>;
  /** The bulbs round the marquee and along the tops of the sides, in order round. */
  bulbs: THREE.MeshToonMaterial[];
  /** The LED strips down the lane, in three groups that chase. */
  leds: THREE.MeshBasicMaterial[];
  displayCanvas: HTMLCanvasElement;
  displayTex: THREE.CanvasTexture;
}

/** A frame along the slope from (s0, y0) to (s1, y1): its x runs along it, y square off it. */
function along(s0: number, y0: number, s1: number, y1: number): { frame: THREE.Group; len: number } {
  const frame = new THREE.Group();
  frame.position.set(s0, y0, 0);
  frame.rotation.z = Math.atan2(y1 - y0, s1 - s0);
  return { frame, len: Math.hypot(s1 - s0, y1 - y0) };
}

/** A tube from a to b (in the machine's frame). */
function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const m = mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 10), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, false);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

function bulb(mats: THREE.MeshToonMaterial[]): THREE.MeshToonMaterial {
  const m = toonUnique('#fff3b0');
  m.emissive = new THREE.Color('#ffb703');
  m.emissiveIntensity = 0.3;
  mats.push(m);
  return m;
}

export function buildCabinet(): Cabinet {
  const { length: L, width: W, inner } = LANE;
  const rail = (W - inner) / 2;
  const fit = inner - 0.004;
  const group = new THREE.Group();
  const chrome = toon(CHROME, { emissive: '#3a4250' });
  const bulbs: THREE.MeshToonMaterial[] = [];
  const bulbGeo = new THREE.SphereGeometry(0.02, 8, 6);

  // The side panels, with their art on the outside and chrome along the top.
  const outline = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(L, 0), ...[...TOP].reverse().map(([s, y]) => new THREE.Vector2(s, y))]);
  const slab = new THREE.ExtrudeGeometry(outline, { depth: rail, bevelEnabled: false });
  const panel = toon(PANEL);
  const art = new THREE.MeshToonMaterial({ map: paintSide(L, 2.1), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap, side: THREE.DoubleSide });
  const decal = new THREE.ShapeGeometry(outline);
  for (const side of [-1, 1]) {
    group.add(mesh(slab, panel, 0, 0, side < 0 ? -W / 2 : inner / 2, false));
    group.add(mesh(decal, art, 0, 0, side * (W / 2 + 0.003), false));
    const u = side * (inner / 2 + rail / 2);
    for (let i = 0; i + 1 < TOP.length; i++) {
      const [s0, y0] = TOP[i];
      const [s1, y1] = TOP[i + 1];
      group.add(tube(new THREE.Vector3(s0, y0, u), new THREE.Vector3(s1, y1, u), 0.022, chrome));
    }
    // Bulbs up the sweep round the target.
    const [[a0, b0], [a1, b1]] = [TOP[2], TOP[3]];
    for (let i = 0; i < 6; i++) {
      const k = (i + 0.5) / 6;
      group.add(mesh(bulbGeo, bulb(bulbs), a0 + (a1 - a0) * k, b0 + (b1 - b0) * k + 0.04, u, false));
    }
    // A glass guard along the lane, on top of the side.
    const [s0, y0] = TOP[0];
    const [s1, y1] = TOP[1];
    const g = along(s0 + 0.25, y0 + 0.02, s1, y1 + 0.02);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(g.len, 0.16), new THREE.MeshBasicMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
    glass.position.set(g.len / 2, 0.08, u);
    g.frame.add(glass);
    g.frame.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, g.len, 8).rotateZ(Math.PI / 2), chrome, g.len / 2, 0.165, u, false));
    group.add(g.frame);
  }

  // Under the lane, the trough across the front with its chrome lip, and the coin door under that.
  const body = toon('#3c096c');
  group.add(mesh(new THREE.BoxGeometry(LANE.hump.s, 0.6, fit), body, LANE.hump.s / 2, 0.3, 0, false));
  group.add(mesh(new THREE.BoxGeometry(LANE.trough - 0.01, 0.075, fit), toon(RUBBER), 0.01 + (LANE.trough - 0.01) / 2, 0.66 - 0.0375, 0, false));
  group.add(mesh(roundedBox(0.05, 0.2, fit, 0.015), chrome, 0.005, 0.68, 0, false));
  const front = new THREE.Mesh(new THREE.PlaneGeometry(fit, 0.58), new THREE.MeshToonMaterial({ map: paintFront(fit, 0.58), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  front.rotation.y = -Math.PI / 2;
  front.position.set(-0.004, 0.29, 0);
  group.add(front);
  group.add(mesh(new THREE.BoxGeometry(0.02, 0.07, W + 0.01), chrome, -0.012, 0.035, 0, false));

  // The lane: maple, with LED strips along the foot of each rail.
  const { start, foot, hump, face } = LANE;
  const lane = along(start.s - 0.02, laneY(start.s - 0.02), foot.s, foot.y);
  lane.frame.add(mesh(new THREE.BoxGeometry(lane.len, 0.05, fit), toon('#c98d4f'), lane.len / 2, -0.027, 0, false));
  const wood = new THREE.Mesh(new THREE.PlaneGeometry(lane.len, fit).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ map: paintLane(lane.len, fit), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  wood.position.x = lane.len / 2;
  lane.frame.add(wood);
  const leds = ['#4cc9f0', '#4cc9f0', '#4cc9f0'].map((c) => new THREE.MeshBasicMaterial({ color: c }));
  const segs = 16;
  for (const side of [-1, 1])
    for (let i = 0; i < segs; i++) lane.frame.add(new THREE.Mesh(new THREE.BoxGeometry((lane.len / segs) * 0.7, 0.012, 0.006), leds[i % 3]).translateX(((i + 0.5) * lane.len) / segs).translateY(0.05).translateZ(side * (inner / 2 - 0.004)));
  group.add(lane.frame);
  // The hump, in black rubber with a yellow edge.
  const humpShape = new THREE.Shape();
  humpShape.moveTo(foot.s, 0.6);
  for (let i = 0; i <= 12; i++) {
    const s = foot.s + ((hump.s - foot.s) * i) / 12;
    humpShape.lineTo(s, laneY(s));
  }
  humpShape.lineTo(hump.s, 0.6);
  group.add(mesh(new THREE.ExtrudeGeometry(humpShape, { depth: fit, bevelEnabled: false }), toon(RUBBER), 0, 0, -fit / 2, false));
  group.add(mesh(new THREE.BoxGeometry(0.02, 0.02, fit + 0.002), toon('#ffbe0b'), hump.s - 0.012, hump.y - 0.012, 0, false));
  // The pit between the hump and the target, and what holds the target up.
  group.add(mesh(new THREE.BoxGeometry(face.s - hump.s + 0.05, 0.04, fit), toon('#0b0820'), (hump.s + face.s + 0.05) / 2, LANE.pit - 0.02, 0, false));
  group.add(mesh(new THREE.BoxGeometry(L - 0.06 - hump.s, 0.54, fit), body, (hump.s + L - 0.06) / 2, 0.27, 0, false));

  // The target, in its own frame (x across, y up the slope, z out of it).
  const faceFrame = new THREE.Group();
  faceFrame.position.set(face.s, face.y, 0);
  faceFrame.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.cos(face.angle), Math.sin(face.angle), 0), new THREE.Vector3(-Math.sin(face.angle), Math.cos(face.angle), 0)),
  );
  group.add(faceFrame);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(fit, face.long).translate(0, face.long / 2, 0), new THREE.MeshToonMaterial({ map: paintFace(fit, face.long), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  faceFrame.add(board);
  faceFrame.add(mesh(new THREE.BoxGeometry(fit, face.long, 0.04).translate(0, face.long / 2, -0.023), toon('#0b0820'), 0, 0, 0, false));
  const rings = new Map<number, THREE.MeshToonMaterial>();
  for (const [r, points] of RINGS.bands) {
    const m = toonUnique(RING_COLORS[points]);
    m.emissive = new THREE.Color(RING_COLORS[points]);
    m.emissiveIntensity = 0.35;
    rings.set(points, m);
    faceFrame.add(mesh(new THREE.TorusGeometry(r, 0.011, 8, 64), m, 0, RINGS.d, 0.008, false));
  }
  const gold = toon('#ffd166', { emissive: '#a06a00' });
  for (const side of [-1, 1]) faceFrame.add(mesh(new THREE.TorusGeometry(CORNERS.r, 0.011, 8, 32), gold, side * CORNERS.u, CORNERS.d, 0.008, false));

  // The net over the target.
  const netTex = paintNet();
  netTex.repeat.set(26, 14);
  const n0 = [TOP[2][0], TOP[2][1] - 0.03];
  const n1 = [TOP[3][0], TOP[3][1] - 0.03];
  const net = new THREE.Mesh(new THREE.PlaneGeometry(Math.hypot(n1[0] - n0[0], n1[1] - n0[1]), inner).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: netTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  net.rotation.z = Math.atan2(n1[1] - n0[1], n1[0] - n0[0]);
  net.position.set((n0[0] + n1[0]) / 2, (n0[1] + n1[1]) / 2, 0);
  group.add(net);

  // The back, with the score display in a chrome bezel.
  group.add(mesh(new THREE.BoxGeometry(L - DISPLAY.s - 0.01, 2.1 - 0.55, fit), toon('#10002b'), (DISPLAY.s + 0.01 + L) / 2, (0.55 + 2.1) / 2, 0, false));
  const displayCanvas = document.createElement('canvas');
  displayCanvas.width = 512;
  displayCanvas.height = 256;
  const displayTex = new THREE.CanvasTexture(displayCanvas);
  displayTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(DISPLAY.w, DISPLAY.h), new THREE.MeshBasicMaterial({ map: displayTex }));
  screen.rotation.y = -Math.PI / 2;
  screen.position.set(DISPLAY.s + 0.002, DISPLAY.y, 0);
  group.add(screen);
  for (const [dy, dz, h, w] of [
    [DISPLAY.h / 2 + 0.015, 0, 0.03, DISPLAY.w + 0.06],
    [-DISPLAY.h / 2 - 0.015, 0, 0.03, DISPLAY.w + 0.06],
    [0, DISPLAY.w / 2 + 0.015, DISPLAY.h, 0.03],
    [0, -DISPLAY.w / 2 - 0.015, DISPLAY.h, 0.03],
  ])
    group.add(mesh(new THREE.BoxGeometry(0.03, h, w), chrome, DISPLAY.s - 0.005, DISPLAY.y + dy, dz, false));

  // The marquee: an arch in lights over the front of the back box.
  const MW = W + 0.06;
  const MH = MW / 2;
  const marquee = new THREE.Mesh(new THREE.PlaneGeometry(MW, MH), new THREE.MeshBasicMaterial({ map: paintMarquee(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
  marquee.rotation.y = -Math.PI / 2;
  marquee.position.set(TOP[3][0] - 0.03, 2.1 + MH / 2 - 0.04, 0);
  group.add(marquee);
  group.add(mesh(new THREE.BoxGeometry(L - TOP[3][0] + 0.01, 0.2, W - 0.02), toon('#10002b'), (TOP[3][0] + L) / 2, 2.17, 0, false));
  // Bulbs round the arch, as paintMarquee draws it.
  const k = MW / 1024;
  const r = 504 * k;
  const cy = -MH / 2 + (512 - 504 * 0.62) * k;
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * Math.PI;
    group.add(mesh(bulbGeo, bulb(bulbs), marquee.position.x - 0.025, marquee.position.y + cy + Math.sin(a) * r * 0.62 * 0.95 * 0.93, Math.cos(a) * r * 0.93, false));
  }

  // A soft shadow on the floor under it all.
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.5, W + 0.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: paintShadow(), transparent: true, depthWrite: false }));
  shadow.position.set(L / 2, 0.004, 0);
  shadow.renderOrder = -1;
  group.add(shadow);

  return { group, faceFrame, rings, bulbs, leds, displayCanvas, displayTex };
}
