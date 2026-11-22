import * as THREE from 'three';
import { BRIDGE, CART_PARK, CART_PATH, COURSE_TREES, FRINGE, HOLES, TEE_BOX, holeLength, yawTo } from '../../../shared/course';
import { STREET_Y } from '../../../shared/layout';
import type { Collider, Interactable } from '../../world/types';
import { canvasTexture } from '../../world/texture';
import { mergeByMaterial, mesh, textPlane, toon } from '../../world/toon';

// The way onto the course and round it: an arch over the cart path in off the street, the cart park
// and a map of the course beside it, and each hole's tee: a mown box with its markers, a sign saying
// which hole it is, and what you press E at to tee off.

const G = STREET_Y;

/** The tee box's turf, mown both ways with a white line round it. */
function teeTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (g) => {
    for (let i = 0; i < 6; i++) {
      g.fillStyle = i % 2 ? '#6cc24a' : '#7ed957';
      g.fillRect(0, (i * 128) / 6, 128, 128 / 6 + 1);
    }
    g.strokeStyle = '#fffaf3';
    g.lineWidth = 5;
    g.strokeRect(4, 4, 120, 120);
  });
}

/** Where the map stands, by the cart path, facing the street. */
const MAP = { x: CART_PATH.minX - 2.2, z: 40 } as const;

/** The map by the cart park: the three holes from above, as you see them reading it on your way in (facing south, east on your left). */
function mapTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 400;
  // The far end of the course at the top.
  const box = { minX: -72, maxX: 58, minZ: 40, maxZ: 160 };
  const k = Math.min((W - 40) / (box.maxX - box.minX), (H - 70) / (box.maxZ - box.minZ));
  const X = (x: number) => W - 20 - (x - box.minX) * k;
  const Y = (z: number) => H - 20 - (z - box.minZ) * k;
  return canvasTexture(W, H, (g) => {
    g.fillStyle = '#fffaf3';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#b7e4a0';
    g.fillRect(10, 44, W - 20, H - 54);
    const dot = (x: number, z: number, r: number, color: string, rz = r) => {
      g.fillStyle = color;
      g.beginPath();
      g.ellipse(X(x), Y(z), r * k, rz * k, 0, 0, Math.PI * 2);
      g.fill();
    };
    for (const [x, z, s] of COURSE_TREES) dot(x, z, 1.4 * s, '#5fb760');
    for (const h of HOLES) for (const f of h.fairway) dot(f.x, f.z, f.r, '#8fd16f');
    for (const h of HOLES) for (const w of h.water) dot(w.x, w.z, w.rx, '#3fa7d6', w.rz);
    g.strokeStyle = '#a47148';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(X(BRIDGE.x0), Y(BRIDGE.z));
    g.lineTo(X(BRIDGE.x1), Y(BRIDGE.z));
    g.stroke();
    for (const h of HOLES) {
      dot(h.pin.x, h.pin.z, h.green + FRINGE, '#6cc24a');
      dot(h.pin.x, h.pin.z, h.green, '#9be07a');
      for (const b of h.bunkers) dot(b.x, b.z, b.r, '#f3e3b3');
      // The line from the tee, dashed, and the numbers at each end.
      g.strokeStyle = 'rgba(43,45,66,0.55)';
      g.setLineDash([6, 6]);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(X(h.tee.x), Y(h.tee.z));
      g.lineTo(X(h.pin.x), Y(h.pin.z));
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = h.flag;
      g.fillRect(X(h.pin.x), Y(h.pin.z) - 22, 14, 10);
      g.fillStyle = '#2b2d42';
      g.fillRect(X(h.pin.x) - 1, Y(h.pin.z) - 22, 2, 22);
      g.beginPath();
      g.arc(X(h.tee.x), Y(h.tee.z), 11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fffaf3';
      g.font = '900 15px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(h.n), X(h.tee.x), Y(h.tee.z) + 1);
    }
    // You are here.
    g.fillStyle = '#ef476f';
    g.beginPath();
    g.arc(X(MAP.x), Y(MAP.z), 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2b2d42';
    g.font = '900 13px system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillText('You are here', X(MAP.x) - 10, Y(MAP.z) + 4);
    g.font = '900 26px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('⛳ Agent Office Links · 3 holes · Par 9', W / 2, 26);
    g.strokeStyle = '#2b2d42';
    g.lineWidth = 6;
    g.strokeRect(3, 3, W - 6, H - 6);
  });
}

/** A board on two legs: `face` (a textured plane) at (x, z), `up` its bottom edge, facing `rotY`. */
function board(parts: THREE.Group, colliders: Collider[], face: THREE.Mesh, x: number, z: number, rotY: number, up: number, width: number) {
  face.position.set(x, G + up + (face.geometry as THREE.PlaneGeometry).parameters.height / 2, z);
  face.rotation.y = rotY;
  for (const s of [-1, 1]) {
    const px = x + Math.cos(rotY) * s * (width / 2 - 0.1);
    const pz = z - Math.sin(rotY) * s * (width / 2 - 0.1);
    parts.add(mesh(new THREE.BoxGeometry(0.1, up + 0.3, 0.1), toon('#8a5a3b'), px - Math.sin(rotY) * 0.06, G + (up + 0.3) / 2, pz - Math.cos(rotY) * 0.06));
    colliders.push({ minX: px - 0.08, maxX: px + 0.08, minZ: pz - 0.08, maxZ: pz + 0.08, bottom: G, top: G + up });
  }
}

/** The tees, the signs and the way in, built into the street's `ground`. Hands back each tee's interactable, by hole. */
export function buildTees(ground: THREE.Group, colliders: Collider[]): Interactable[] {
  const parts = new THREE.Group();
  const turf = new THREE.MeshToonMaterial({ map: teeTexture(), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  const tees = HOLES.map((h) => {
    const yaw = yawTo(h.tee, h.pin);
    const it: Interactable = { kind: 'golf', x: h.tee.x, z: h.tee.z, y: G, radius: 2.6 };
    const box = mesh(new THREE.PlaneGeometry(TEE_BOX, TEE_BOX).rotateX(-Math.PI / 2), turf, h.tee.x, G + 0.02, h.tee.z, false);
    box.rotation.y = yaw;
    box.userData.interact = it;
    ground.add(box);
    // A marker either side across the front, in the hole's colour.
    const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const side = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    for (const s of [-1, 1]) {
      parts.add(mesh(new THREE.SphereGeometry(0.1, 12, 8), toon(h.flag), h.tee.x + side.x * s * 1.1 + fwd.x * 0.9, G + 0.1, h.tee.z + side.z * s * 1.1 + fwd.z * 0.9));
    }
    // The sign off the back corner on the golfer's side, facing whoever's walking up behind the tee.
    const sign = textPlane(`⛳ ${h.n} · ${h.name} · Par ${h.par} · ${Math.round(holeLength(h))} m`, { bg: '#2b2d42', color: '#fffaf3', size: 48, border: h.flag });
    sign.userData.interact = it;
    const blurb = textPlane(h.blurb, { bg: '#fffaf3', color: '#2b2d42', size: 34, border: '#2b2d42' });
    const sx = h.tee.x + side.x * 3 - fwd.x * 1.6;
    const sz = h.tee.z + side.z * 3 - fwd.z * 1.6;
    const width = (sign.geometry as THREE.PlaneGeometry).parameters.width;
    board(parts, colliders, sign, sx, sz, yaw + Math.PI, 1.05, width);
    blurb.position.set(sx - fwd.x * 0.01, G + 0.75, sz - fwd.z * 0.01);
    blurb.rotation.y = yaw + Math.PI;
    ground.add(sign, blurb);
    // A ball washer on a post, across the back of the tee from the sign.
    const wx = h.tee.x - side.x * 2.4 - fwd.x * 0.6;
    const wz = h.tee.z - side.z * 2.4 - fwd.z * 0.6;
    parts.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6), toon('#2b2d42'), wx, G + 0.45, wz));
    parts.add(mesh(new THREE.BoxGeometry(0.2, 0.26, 0.16), toon(h.flag), wx, G + 0.98, wz));
    colliders.push({ minX: wx - 0.1, maxX: wx + 0.1, minZ: wz - 0.1, maxZ: wz + 0.1, bottom: G, top: G + 1.1 });
    return it;
  });

  // The cart path in off the street, over the far sidewalk to the cart park.
  const path = toon('#d6ccb4');
  const { minX, maxX, minZ, maxZ } = CART_PATH;
  parts.add(new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX, maxZ - minZ).rotateX(-Math.PI / 2).translate((minX + maxX) / 2, G + 0.05, (minZ + maxZ) / 2), path));
  const pad = { minX: minX, maxX: CART_PARK[1].x + 1.6, minZ: maxZ - 0.5, maxZ: CART_PARK[0].z + 2 };
  parts.add(new THREE.Mesh(new THREE.PlaneGeometry(pad.maxX - pad.minX, pad.maxZ - pad.minZ).rotateX(-Math.PI / 2).translate((pad.minX + pad.maxX) / 2, G + 0.051, (pad.minZ + pad.maxZ) / 2), path));
  for (const x of [CART_PARK[0].x - 1.5, (CART_PARK[0].x + CART_PARK[1].x) / 2, CART_PARK[1].x + 1.5]) {
    parts.add(new THREE.Mesh(new THREE.PlaneGeometry(0.08, 3).rotateX(-Math.PI / 2).translate(x, G + 0.053, CART_PARK[0].z), toon('#fffaf3')));
  }

  // The arch over the cart path: two posts and the course's name across the top.
  const archZ = minZ + 3.2;
  for (const x of [minX - 0.4, maxX + 0.4]) {
    parts.add(mesh(new THREE.BoxGeometry(0.3, 3.4, 0.3), toon('#fffaf3'), x, G + 1.7, archZ));
    parts.add(mesh(new THREE.ConeGeometry(0.28, 0.5, 4).rotateY(Math.PI / 4), toon('#3f8f45'), x, G + 3.65, archZ));
    colliders.push({ minX: x - 0.15, maxX: x + 0.15, minZ: archZ - 0.15, maxZ: archZ + 0.15, bottom: G, top: G + 3.4 });
  }
  parts.add(mesh(new THREE.BoxGeometry(maxX - minX + 1.1, 0.2, 0.2), toon('#3f8f45'), (minX + maxX) / 2, G + 3.25, archZ));
  const name = textPlane('⛳ Agent Office Links', { bg: '#3f8f45', color: '#fffaf3', size: 64, border: '#fffaf3' });
  name.position.set((minX + maxX) / 2, G + 2.8, archZ - 0.12);
  name.rotation.y = Math.PI;
  const back = name.clone();
  back.position.z = archZ + 0.12;
  back.rotation.y = 0;
  ground.add(name, back);

  // The map, beside the cart park, facing the path.
  const map = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.03), new THREE.MeshBasicMaterial({ map: mapTexture() }));
  board(parts, colliders, map, MAP.x, MAP.z, Math.PI, 0.75, 2.6);
  ground.add(map);
  ground.add(mergeByMaterial(parts));
  return tees;
}
