import * as THREE from 'three';
import { COURSE, ENTRY } from '../../../shared/course';
import { STREET_Y } from '../../../shared/layout';
import type { Collider } from '../../world/types';
import { mergeByMaterial, mesh, toon } from '../../world/toon';

// A white post-and-rail fence round the course: out of bounds is past it, and it's what stops a golf
// cart (or you) going further, rather than nothing you can see. It's open where the way in comes up
// from the street between the neighbours, with a taller post either side of the gap.

const G = STREET_Y;
/** How high it stands, how far apart its posts are, and the two rails' heights. */
const HEIGHT = 1;
const EVERY = 2.6;
const RAILS = [0.45, 0.85] as const;

/** One straight run of fence from (x0, z0) to (x1, z1). */
function run(parts: THREE.Group, colliders: Collider[], x0: number, z0: number, x1: number, z1: number) {
  const white = toon('#fffaf3');
  const len = Math.hypot(x1 - x0, z1 - z0);
  const along = x1 !== x0;
  const n = Math.max(1, Math.round(len / EVERY));
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    parts.add(mesh(new THREE.BoxGeometry(0.14, HEIGHT, 0.14), white, x0 + (x1 - x0) * k, G + HEIGHT / 2, z0 + (z1 - z0) * k, false));
  }
  for (const y of RAILS) parts.add(mesh(new THREE.BoxGeometry(along ? len : 0.07, 0.1, along ? 0.07 : len), white, (x0 + x1) / 2, G + y, (z0 + z1) / 2, false));
  const t = 0.12;
  colliders.push({ minX: Math.min(x0, x1) - t, maxX: Math.max(x0, x1) + t, minZ: Math.min(z0, z1) - t, maxZ: Math.max(z0, z1) + t, bottom: G, top: G + HEIGHT });
}

/** The fence round the course, built into the street's `ground` (with what's in the way there). */
export function buildFence(ground: THREE.Group, colliders: Collider[]): void {
  const parts = new THREE.Group();
  const { minX, maxX, minZ, maxZ } = COURSE;
  run(parts, colliders, minX, maxZ, maxX, maxZ);
  run(parts, colliders, minX, minZ, minX, maxZ);
  run(parts, colliders, maxX, minZ, maxX, maxZ);
  // Along the street side, either side of the way in.
  run(parts, colliders, minX, minZ, ENTRY.minX, minZ);
  run(parts, colliders, ENTRY.maxX, minZ, maxX, minZ);
  for (const x of [ENTRY.minX, ENTRY.maxX]) {
    parts.add(mesh(new THREE.BoxGeometry(0.26, 1.5, 0.26), toon('#fffaf3'), x, G + 0.75, minZ));
    parts.add(mesh(new THREE.SphereGeometry(0.17, 10, 8), toon('#ef476f'), x, G + 1.62, minZ, false));
  }
  ground.add(mergeByMaterial(parts));
}
