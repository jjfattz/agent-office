import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BRIDGE, COURSE_TREES, FRINGE, HOLES, TRUNK, type Pond } from '../../../shared/course';
import { CUP } from '../../../shared/golf';
import { STREET_Y } from '../../../shared/layout';
import type { Collider } from '../../world/types';
import { bulb, streetLamp, tree, type NightParts } from '../../world/outside';
import { canvasTexture } from '../../world/texture';
import { mergeByMaterial, mesh, toon } from '../../world/toon';

// The golf course across the street, as it's drawn (the numbers are shared/course.ts's): the mown
// fairways, the greens with their collars, cups and flags, the bunkers, the ponds (lily pads on the
// first, the island green's lake with its footbridge on the second) and the trees round it all.
// The tees, the signs and the way in are tees.ts's.

const G = STREET_Y;
/** Every layer a little over the one under it, so none of them fight. */
const LAYER = { fairway: 0.006, bank: 0.009, water: 0.012, fringe: 0.016, green: 0.02, lip: 0.024, sand: 0.028, cup: 0.032 } as const;
/** The flagstick, taller than a real one so it shows up from across the course. */
export const STICK = 3.4;

const gradient = () => (toon('#fff') as THREE.MeshToonMaterial).gradientMap;

/** A flat disc (or an ellipse, `rz` along z) lying on the grass at height `y` over it. */
function disc(x: number, z: number, r: number, y: number, rz = r, segments = 40): THREE.BufferGeometry {
  return new THREE.CircleGeometry(1, segments)
    .scale(r, rz, 1)
    .rotateX(-Math.PI / 2)
    .translate(x, G + y, z);
}

/** Gives a ground geometry texture coordinates from where it lies, `per` meters to a repeat, so stripes run on from one piece to the next. */
function worldUV(geo: THREE.BufferGeometry, per: number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / per;
    uv[i * 2 + 1] = pos.getZ(i) / per;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function flatMesh(geos: THREE.BufferGeometry[], mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)))!, mat);
  m.receiveShadow = true;
  return m;
}

/** Stripes mown across the grass, `stripes` light and dark ones to a repeat. */
function mown(light: string, dark: string, stripes: number): THREE.CanvasTexture {
  return canvasTexture(
    128,
    128,
    (g) => {
      for (let i = 0; i < stripes; i++) {
        g.fillStyle = i % 2 ? dark : light;
        g.fillRect((i * 128) / stripes, 0, 128 / stripes + 1, 128);
      }
    },
    [1, 1],
  );
}

/** Water: a deep blue with pale ripples on it, which drift. */
function waterTexture(): THREE.CanvasTexture {
  return canvasTexture(
    256,
    256,
    (g) => {
      g.fillStyle = '#3fa7d6';
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 3;
      for (let i = 0; i < 26; i++) {
        const x = (i * 97) % 256;
        const y = (i * 53) % 256;
        g.beginPath();
        g.arc(x, y, 10 + (i % 4) * 4, Math.PI * 1.15, Math.PI * 1.85);
        g.stroke();
      }
    },
    [1, 1],
  );
}

/** The flag for hole `n`: its colour, with the number on it. */
function flagTexture(n: number, color: string): THREE.CanvasTexture {
  return canvasTexture(128, 80, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, 128, 80);
    g.fillStyle = '#fffaf3';
    g.font = '900 58px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), 60, 44);
  });
}

/** Points round the edge of pond `w`, `out` meters further out, about every `step` meters. */
function round(w: Pond, out: number, step: number): { x: number; z: number }[] {
  const rx = w.rx + out;
  const rz = w.rz + out;
  const n = Math.ceil((Math.PI * (rx + rz)) / step);
  return Array.from({ length: n }, (_, i) => ({ x: w.x + Math.cos((i / n) * Math.PI * 2) * rx, z: w.z + Math.sin((i / n) * Math.PI * 2) * rz }));
}

export interface Course {
  /** The flags flap and the water drifts. */
  update(t: number): void;
  /** Hole `hole`'s flagstick out of the cup and laid on the green beside it, for putting, or back in. */
  pin(hole: number, out: boolean): void;
}

/** Where a flagstick that's out lies: this far from the cup, and turned this way. */
const LAID = { x: 1.1, z: 0.9, yaw: 0.6 } as const;

/** The course, built into the street's `ground` (with what's in the way there). */
export function buildCourse(ground: THREE.Group, colliders: Collider[], night: NightParts): Course {
  const fairways: THREE.BufferGeometry[] = [];
  const parts = new THREE.Group();
  for (const h of HOLES) for (const f of h.fairway) fairways.push(worldUV(disc(f.x, f.z, f.r, LAYER.fairway), 6));
  const fairTex = mown('#93d672', '#80c763', 2);
  ground.add(flatMesh(fairways, new THREE.MeshToonMaterial({ map: fairTex, gradientMap: gradient() })));

  // The ponds: a muddy bank round each, the water drifting in it, and lily pads on the first.
  const water = waterTexture();
  const ponds: THREE.BufferGeometry[] = [];
  for (const h of HOLES) {
    for (const w of h.water) {
      parts.add(new THREE.Mesh(disc(w.x, w.z, w.rx + 0.5, LAYER.bank, w.rz + 0.5, 56), toon('#6b9b4f')));
      ponds.push(worldUV(disc(w.x, w.z, w.rx, LAYER.water, w.rz, 56), 9));
      // A ring of posts round it you can't walk through, all on its muddy bank (so nothing stops you
      // short of it on the grass), but for the bridge over to the island.
      for (const p of round(w, 0.15, 0.6)) {
        if (Math.abs(p.z - BRIDGE.z) < BRIDGE.half + 0.3 && p.x > BRIDGE.x1 - 1 && p.x < BRIDGE.x0 + 1) continue;
        colliders.push({ minX: p.x - 0.3, maxX: p.x + 0.3, minZ: p.z - 0.3, maxZ: p.z + 0.3, bottom: G, top: G + 0.9 });
      }
    }
  }
  // And round the island's shore, so you stay on it once you're over the bridge.
  for (const h of HOLES) {
    if (!h.water.some((w) => Math.hypot(w.x - h.pin.x, w.z - h.pin.z) < 1)) continue;
    const r = h.green + FRINGE + 0.6;
    for (const p of round({ x: h.pin.x, z: h.pin.z, rx: r, rz: r }, 0.35, 0.6)) {
      if (Math.abs(p.z - BRIDGE.z) < BRIDGE.half + 0.3 && p.x > BRIDGE.x1 - 1 && p.x < BRIDGE.x0 + 1) continue;
      colliders.push({ minX: p.x - 0.3, maxX: p.x + 0.3, minZ: p.z - 0.3, maxZ: p.z + 0.3, bottom: G, top: G + 0.9 });
    }
  }
  const waterMesh = flatMesh(ponds, new THREE.MeshToonMaterial({ map: water, gradientMap: gradient() }));
  ground.add(waterMesh);
  const pads: [number, number, number][] = [
    [26, 102, 0.6],
    [27.5, 106.5, 0.45],
    [33, 101, 0.55],
    [36.5, 103.5, 0.4],
    [24.5, 105, 0.35],
    [-55, 140, 0.5],
    [-31, 152, 0.45],
  ];
  for (const [x, z, r] of pads) {
    parts.add(new THREE.Mesh(new THREE.CircleGeometry(r, 14, 0.4, Math.PI * 1.8).rotateX(-Math.PI / 2).translate(x, G + LAYER.water + 0.006, z), toon('#3f8f45')));
    if (r > 0.5) parts.add(mesh(new THREE.SphereGeometry(0.12, 8, 6), toon('#ff8fab'), x + 0.1, G + 0.08, z - 0.05, false));
  }
  // Reeds at the edges.
  for (const [x, z] of [
    [21.5, 101],
    [38.5, 106],
    [-24.5, 136],
    [-58, 148],
  ]) {
    for (let k = 0; k < 6; k++) parts.add(mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.9 + (k % 3) * 0.25, 4), toon('#5c8a3a'), x + Math.cos(k * 2.4) * 0.35, G + 0.5, z + Math.sin(k * 2.4) * 0.35, false));
  }

  // The greens, each with its collar, cup and flagstick, and the bunkers.
  const flags: { geo: THREE.PlaneGeometry; rest: Float32Array; mesh: THREE.Mesh; pole: THREE.Group; stick: Collider; out: boolean }[] = [];
  for (const h of HOLES) {
    const { x, z } = h.pin;
    const island = h.water.length > 0 && h.water.some((w) => Math.hypot(w.x - x, w.z - z) < 1);
    if (island) parts.add(new THREE.Mesh(disc(x, z, h.green + FRINGE + 0.6, LAYER.fringe - 0.002, undefined, 48), toon('#7fbf5a')));
    parts.add(new THREE.Mesh(disc(x, z, h.green + FRINGE, LAYER.fringe, undefined, 48), toon('#6cc24a')));
    parts.add(new THREE.Mesh(disc(x, z, h.green, LAYER.green, undefined, 48), toon('#9be07a')));
    for (const b of h.bunkers) {
      parts.add(new THREE.Mesh(disc(b.x, b.z, b.r + 0.14, LAYER.lip, undefined, 32), toon('#d9c48a')));
      parts.add(new THREE.Mesh(disc(b.x, b.z, b.r, LAYER.sand, undefined, 32), toon('#f3e3b3')));
    }
    parts.add(new THREE.Mesh(disc(x, z, CUP + 0.05, LAYER.cup, undefined, 24), toon('#fffaf3')));
    parts.add(new THREE.Mesh(disc(x, z, CUP, LAYER.cup + 0.003, undefined, 24), toon('#1d1d1d')));
    // The flagstick, its knob and its flag, together so it can come out of the cup.
    const pole = new THREE.Group();
    pole.rotation.order = 'YXZ';
    pole.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, STICK, 8), toon('#fffaf3'), 0, STICK / 2, 0));
    pole.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), toon('#ffd166'), 0, STICK + 0.03, 0));
    pole.position.set(x, G, z);
    ground.add(pole);
    const stick: Collider = { minX: x - 0.05, maxX: x + 0.05, minZ: z - 0.05, maxZ: z + 0.05, bottom: G, top: G + STICK };
    colliders.push(stick);
    // The flag: off the top of the stick, rippling.
    const geo = new THREE.PlaneGeometry(1.2, 0.75, 8, 1);
    geo.translate(0.6, 0, 0);
    // Its two sides, so the number reads the right way round from either.
    const front = flagTexture(h.n, h.flag);
    const back = front.clone();
    back.wrapS = THREE.RepeatWrapping;
    back.repeat.x = -1;
    const flag = mesh(geo, new THREE.MeshToonMaterial({ map: front, gradientMap: gradient() }), 0.03, STICK - 0.42, 0, false);
    flag.add(mesh(geo, new THREE.MeshToonMaterial({ map: back, side: THREE.BackSide, gradientMap: gradient() }), 0, 0, 0, false));
    pole.add(flag);
    flags.push({ geo, rest: Float32Array.from(geo.getAttribute('position').array), mesh: flag, pole, stick, out: false });
  }

  // The footbridge out to the island: planks on two beams, a rail either side.
  const { x0, x1, z: bz, half } = BRIDGE;
  const wood = toon('#a47148');
  const len = x0 - x1;
  parts.add(mesh(new THREE.BoxGeometry(len, 0.1, half * 2), wood, (x0 + x1) / 2, G + 0.07, bz));
  for (let x = x1 + 0.2; x < x0; x += 0.45) parts.add(mesh(new THREE.BoxGeometry(0.06, 0.02, half * 2 + 0.02), toon('#8a5a3b'), x, G + 0.13, bz, false));
  for (const s of [-1, 1]) {
    const rz = bz + s * (half - 0.05);
    parts.add(mesh(new THREE.BoxGeometry(len, 0.07, 0.07), wood, (x0 + x1) / 2, G + 0.95, rz));
    for (let x = x1; x <= x0 + 0.01; x += len / 4) parts.add(mesh(new THREE.BoxGeometry(0.1, 0.95, 0.1), wood, x, G + 0.5, rz));
    colliders.push({ minX: x1, maxX: x0, minZ: rz - 0.08, maxZ: rz + 0.08, bottom: G, top: G + 1 });
  }
  colliders.push({ minX: x1, maxX: x0, minZ: bz - half, maxZ: bz + half, bottom: G - 1, top: G + 0.12 });

  // The trees, whose trunks you (and a cart) can't go through.
  const forest = new THREE.Group();
  for (const [x, z, s] of COURSE_TREES) {
    const t = tree(s);
    t.position.set(x, G, z);
    forest.add(t);
    const r = TRUNK.r * s;
    colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, bottom: G, top: G + TRUNK.h * s });
  }
  ground.add(mergeByMaterial(forest));
  ground.add(mergeByMaterial(parts));

  // Lamps by the greens and tees nearest the street, so the way round's lit after dark.
  const lamps = new THREE.Group();
  const glass = bulb(night, '#fff3d6');
  streetLamp(lamps, night, glass, colliders, HOLES[2].pin.x + 1.5, HOLES[2].pin.z + 7.6, -1);
  streetLamp(lamps, night, glass, colliders, HOLES[0].tee.x + 3.2, HOLES[0].tee.z - 2, 1);
  ground.add(mergeByMaterial(lamps));

  return {
    update(t: number) {
      water.offset.set(Math.sin(t * 0.15) * 0.05, t * 0.01);
      for (const f of flags) {
        // Lying on the green, it lies still.
        if (f.out) continue;
        const pos = f.geo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const u = f.rest[i * 3];
          // Pinned at the stick, flapping more toward its tail, and swinging round a little in the wind.
          pos.setZ(i, Math.sin(t * 5 - u * 4) * 0.12 * u);
          pos.setY(i, f.rest[i * 3 + 1] - u * u * 0.06);
        }
        pos.needsUpdate = true;
        f.geo.computeVertexNormals();
        f.mesh.rotation.y = -0.5 + Math.sin(t * 0.7) * 0.25;
      }
    },
    pin(hole: number, out: boolean) {
      const f = flags[hole];
      if (!f || f.out === out) return;
      f.out = out;
      const { x, z } = HOLES[hole].pin;
      // Laid flat on its side on the green, flag and all; or standing in the cup.
      f.pole.position.set(out ? x + LAID.x : x, G + (out ? 0.04 : 0), out ? z + LAID.z : z);
      f.pole.rotation.set(out ? -Math.PI / 2 : 0, out ? LAID.yaw : 0, 0);
      if (out) {
        f.mesh.rotation.y = 0;
        (f.geo.getAttribute('position') as THREE.BufferAttribute).copyArray(f.rest).needsUpdate = true;
        f.geo.computeVertexNormals();
      }
      f.stick.top = (f.stick.bottom ?? 0) + (out ? 0 : STICK);
    },
  };
}
