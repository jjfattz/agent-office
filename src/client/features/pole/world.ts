import * as THREE from 'three';
import { BALCONY, SLAB, STOREY, streetBelow } from '../../../shared/layout';
import { POLE } from '../../../shared/pole';
import { mergeByMaterial, mesh, textPlane, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';

// The fire pole off the west end of the balconies (see shared/pole.ts): a brass pole from over the
// top floor's balcony down to a crash mat on the lot, held to each balcony's edge by a bracket, with
// a sign on your floor's railing and another at the bottom saying it's the way out, and only out.
// It's rebuilt for the floor you're on, since the street is that much further down the higher it is.

export interface FirePole {
  group: THREE.Group;
  interactable: Interactable;
  /** Where the street is under the floor you're on: the bottom of the pole. */
  readonly bottom: number;
}

const BRASS = '#e2b33c';
/** Where the street is under the bottom floor, until the office says which floor you're on. */
const STREET_FALLBACK = streetBelow(0);

/** Builds the pole and hands it back, with its collider for the floor's list. */
export function buildPole(): { pole: FirePole; collider: Collider; setLevel(index: number, count: number): void } {
  const group = new THREE.Group();
  const interactable: Interactable = { kind: 'pole', x: POLE.x, z: POLE.z, radius: 1.9 };
  const collider: Collider = { minX: POLE.x - 0.08, maxX: POLE.x + 0.08, minZ: POLE.z - 0.08, maxZ: POLE.z + 0.08, bottom: STREET_FALLBACK, top: POLE.top };
  let bottom: number = STREET_FALLBACK;
  let built: THREE.Object3D[] = [];

  // What's the same on every floor: the sign on the railing beside it, inside the balcony.
  const sign = textPlane('🚒 Fire pole · exit only', { bg: '#d62828', color: '#fffaf3', size: 44, border: '#fffaf3' });
  sign.scale.multiplyScalar(0.55);
  sign.rotation.y = Math.PI / 2;
  sign.position.set(BALCONY.minX + 0.11, 0.62, POLE.z);
  group.add(sign);

  const setLevel = (index: number, count: number) => {
    for (const o of built) {
      o.removeFromParent();
      o.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).geometry.dispose();
      });
    }
    built = [];
    const street = streetBelow(index);
    const top = (Math.max(count, index + 1) - 1 - index) * STOREY + POLE.top;
    bottom = street;
    collider.bottom = street;
    collider.top = top;

    // The shaft, the one thing here you can use: it carries what E is about, so aiming at it finds it.
    const shaft = mesh(new THREE.CylinderGeometry(POLE.radius, POLE.radius, top - street, 14), toon(BRASS), POLE.x, (top + street) / 2, POLE.z, false);
    shaft.userData.interact = interactable;
    group.add(shaft);
    built.push(shaft);

    const parts = new THREE.Group();
    const steel = toon('#5c6370');
    parts.add(mesh(new THREE.SphereGeometry(POLE.radius * 1.8, 12, 8), toon(BRASS), POLE.x, top, POLE.z, false));
    // A bracket out from the edge of each balcony's deck, round the pole.
    const reach = BALCONY.minX - POLE.x;
    for (let k = 0; k < count; k++) {
      const y = (k - index) * STOREY - SLAB / 2;
      parts.add(mesh(new THREE.BoxGeometry(reach, 0.06, 0.08), steel, POLE.x + reach / 2, y, POLE.z, false));
      const ring = mesh(new THREE.TorusGeometry(POLE.radius + 0.03, 0.025, 6, 16), steel, POLE.x, y, POLE.z, false);
      ring.rotation.x = Math.PI / 2;
      parts.add(ring);
    }
    // The crash mat at the bottom, red with a yellow rim.
    parts.add(mesh(new THREE.CylinderGeometry(0.8, 0.84, 0.06, 28), toon('#d62828'), POLE.x, street + 0.03, POLE.z, false));
    const rim = mesh(new THREE.TorusGeometry(0.8, 0.035, 6, 32), toon('#ffd166'), POLE.x, street + 0.06, POLE.z, false);
    rim.rotation.x = Math.PI / 2;
    parts.add(rim);
    const merged = mergeByMaterial(parts);
    group.add(merged);
    built.push(merged);

    // At the bottom, a plate on the pole facing the street: you can't go up this way.
    const plate = textPlane('🚒 Exit only · no climbing', { bg: '#2b2d42', color: '#fffaf3', size: 40, border: '#ffd166' });
    plate.scale.multiplyScalar(0.5);
    plate.position.set(POLE.x, street + 1.9, POLE.z + POLE.radius + 0.02);
    group.add(plate);
    built.push(plate);
  };

  const pole: FirePole = {
    group,
    interactable,
    get bottom() {
      return bottom;
    },
  };
  return { pole, collider, setLevel };
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The fire pole off the west end of the balcony, down to the street. */
    pole: FirePole;
  }
}

/** The fire pole, just past the balcony's west railing. */
export const pole: Fixture<'pole'> = () => {
  const built = buildPole();
  return {
    group: built.pole.group,
    colliders: [built.collider],
    interactables: [built.pole.interactable],
    setLevel: (index, count) => built.setLevel(index, count),
    handle: { pole: built.pole },
  };
};
