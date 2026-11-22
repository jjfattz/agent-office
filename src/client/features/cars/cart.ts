import * as THREE from 'three';
import { CART, SEATS } from '../../../shared/garage';
import { mergeByMaterial, mesh, toon } from '../../world/toon';
import type { CarModel } from './world';

// A golf cart, for getting round the course across the street: nose toward +z, wheels on y = 0. A
// painted tub and nose, a bench for two under a canopy on four posts, a windshield, a steering
// wheel, and a bag of clubs strapped on the back.

const WHEEL_R = 0.22;
const AXLE = 0.86;

export function golfCart(color: string): CarModel {
  const g = new THREE.Group();
  const paint = toon(color);
  const trim = toon('#2b2d42');
  const seat = toon('#f1e4d3');
  const steel = toon('#ced4da');
  const glass = toon('#bfe3ff');
  const tire = toon('#1f1f26');
  const hub = toon('#d9dbe3');
  const L = CART.length / 2;
  const W = CART.width;
  // The tub you sit in, and the nose in front of your knees, rounded off at the front.
  g.add(mesh(new THREE.BoxGeometry(W - 0.1, 0.22, CART.length - 0.2), paint, 0, 0.36, -0.05));
  g.add(mesh(new THREE.BoxGeometry(W - 0.14, 0.04, 1.1), trim, 0, 0.48, 0.2, false));
  const nose = mesh(new THREE.CylinderGeometry(0.42, 0.42, W - 0.12, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), paint, 0, 0.47, L - 0.52);
  g.add(nose);
  g.add(mesh(new THREE.BoxGeometry(W - 0.12, 0.42, 0.5), paint, 0, 0.47, L - 0.77));
  // Bumpers, and the headlights in the nose.
  g.add(mesh(new THREE.BoxGeometry(W, 0.1, 0.1), trim, 0, 0.26, L - 0.05));
  g.add(mesh(new THREE.BoxGeometry(W, 0.1, 0.1), trim, 0, 0.26, -L + 0.08));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 12).rotateX(Math.PI / 2), toon('#fff6c9', { emissive: '#b8a960' }), sx * 0.38, 0.62, L - 0.1, false));
  // The bench: a cushion and its back, behind the wheel.
  const s = SEATS.driver;
  g.add(mesh(new THREE.BoxGeometry(W - 0.18, 0.12, 0.52), seat, 0, 0.5, s.z - 0.02));
  const back = mesh(new THREE.BoxGeometry(W - 0.18, 0.5, 0.1), seat, 0, 0.82, s.z - 0.33);
  back.rotation.x = -0.12;
  g.add(back);
  // The canopy on its four posts, and the windshield between the front two.
  const top = 1.92;
  for (const sx of [-1, 1]) {
    for (const z of [0.42, s.z - 0.42]) g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, top - 0.5, 6), steel, sx * (W / 2 - 0.1), 0.5 + (top - 0.5) / 2, z, false));
  }
  g.add(mesh(new THREE.BoxGeometry(W + 0.1, 0.07, 1.75), paint, 0, top, -0.08));
  g.add(mesh(new THREE.BoxGeometry(W + 0.14, 0.04, 1.8), trim, 0, top - 0.05, -0.08, false));
  const screen = mesh(new THREE.BoxGeometry(W - 0.22, 0.95, 0.02), glass, 0, 1.32, 0.44, false);
  screen.rotation.x = -0.06;
  g.add(screen);
  // The wheel in front of the driver.
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), trim, s.x, 0.78, s.z + 0.6, false));
  const hoop = mesh(new THREE.TorusGeometry(0.14, 0.025, 6, 16), trim, s.x, 1.0, s.z + 0.5);
  hoop.rotation.x = -0.9;
  g.add(hoop);
  // A bag of clubs strapped on behind, leaning back.
  const bag = new THREE.Group();
  bag.add(mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.8, 12), toon('#1d3557'), 0, 0.4, 0));
  bag.add(mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.09, 12), toon('#ef476f'), 0, 0.58, 0, false));
  for (const [cx, tilt] of [
    [-0.06, -0.12],
    [0.05, 0.1],
    [0, 0.02],
  ]) {
    const club = new THREE.Group();
    club.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 6), steel, 0, 0.22, 0, false));
    club.add(mesh(new THREE.BoxGeometry(0.1, 0.07, 0.05), toon('#8d99ae'), 0.03, 0.46, 0, false));
    club.position.set(cx, 0.75, 0);
    club.rotation.z = tilt;
    bag.add(club);
  }
  bag.position.set(0, 0.42, -L + 0.18);
  bag.rotation.x = -0.35;
  g.add(bag);

  const wheel = (x: number, z: number) => {
    const w = new THREE.Group();
    w.position.set(x, WHEEL_R, z);
    w.add(mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.18, 14).rotateZ(Math.PI / 2), tire));
    w.add(mesh(new THREE.CylinderGeometry(WHEEL_R * 0.55, WHEEL_R * 0.55, 0.2, 10).rotateZ(Math.PI / 2), hub, 0, 0, 0, false));
    return w;
  };
  const wheels: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.12);
    g.add(wheel(x, -AXLE));
    wheels.push(wheel(x, AXLE));
  }
  const root = new THREE.Group();
  // Nothing comes off a cart when you get in: the canopy's high enough.
  const off = new THREE.Group();
  const on = new THREE.Group();
  root.add(mergeByMaterial(g), off, on, ...wheels);
  return { root, top: off, open: on, wheels };
}
