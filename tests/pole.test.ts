import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BALCONY, streetBelow } from '../src/shared/layout.js';
import { POLE, SLIDE, slideSpeed } from '../src/shared/pole.js';
import { Slide } from '../src/client/features/pole/slide.js';
import { slideSeconds } from '../src/client/features/pole/sound.js';

/** Slides from the grab spot on floor `index`'s balcony to its street: every point, and the phases it went through. */
function ride(index: number) {
  const land = streetBelow(index);
  const s = new Slide(new THREE.Vector3(POLE.grab.x, 0, POLE.grab.z), land, Math.PI);
  const pos = new THREE.Vector3(POLE.grab.x, 0, POLE.grab.z);
  const points: { x: number; y: number; z: number; phase: string; speed: number }[] = [];
  for (let i = 0; i < 60 * 120; i++) {
    const going = s.step(pos, 1 / 60);
    points.push({ x: pos.x, y: pos.y, z: pos.z, phase: s.phase, speed: s.speed });
    if (!going) break;
  }
  return { land, points, s };
}

test('the fire pole stands clear of the balconies it goes down past', () => {
  // Someone on it, at its far side from the pole, never reaches into a balcony on the way down.
  assert.ok(POLE.x + POLE.hold + 0.3 < BALCONY.minX, 'whoever is on the pole passes the balconies below');
  assert.ok(POLE.grab.x > BALCONY.minX && POLE.grab.z > BALCONY.minZ && POLE.grab.z < BALCONY.maxZ, 'you climb over to it from the balcony');
});

test('down the fire pole from any floor, all the way to the street without stopping', () => {
  for (const index of [0, 1, 4, 12]) {
    const { land, points, s } = ride(index);
    assert.equal(s.phase, 'done', `floor ${index}: it gets to the bottom`);
    // Up over the railing on the way out.
    const over = points.filter((p) => p.phase === 'over');
    assert.ok(Math.max(...over.map((p) => p.y)) > POLE.railTop, `floor ${index}: over the top of the railing`);
    // Down the pole without ever stopping or going back up, and never faster than it can go.
    const down = points.filter((p) => p.phase === 'down');
    for (let i = 1; i < down.length; i++) assert.ok(down[i].y < down[i - 1].y, `floor ${index}: keeps going down`);
    for (const p of down) {
      assert.ok(p.speed <= SLIDE.max + 1e-9, `floor ${index}: no faster than ${SLIDE.max} m/s`);
      assert.ok(Math.abs(Math.hypot(p.x - POLE.x, p.z - POLE.z) - POLE.hold) < 1e-6, `floor ${index}: on the pole`);
    }
    // Braking at the bottom, and on its feet on the street, clear of the pole.
    assert.ok(down[down.length - 1].speed <= SLIDE.land + 0.5, `floor ${index}: lands gently (${down[down.length - 1].speed.toFixed(2)} m/s)`);
    const end = points[points.length - 1];
    assert.equal(end.y, land, `floor ${index}: down on the street`);
    assert.ok(Math.hypot(end.x - POLE.x, end.z - POLE.z) > 0.08 + 0.32, `floor ${index}: steps off clear of the pole`);
  }
});

test('the slide picks up speed, and its sound lasts as long as it does', () => {
  assert.ok(slideSpeed(0, 50, 0.1) > 0);
  assert.equal(slideSpeed(SLIDE.max, 50, 0.1), SLIDE.max);
  assert.ok(slideSpeed(SLIDE.max, 0.01, 0.01) < SLIDE.land + 0.2, 'braked right down at the bottom');
  const { points } = ride(3);
  const seconds = points.filter((p) => p.phase === 'down').length / 60;
  assert.ok(Math.abs(slideSeconds(-streetBelow(3) + 0.25) - seconds) < 0.1, `the hiss lasts the slide (${seconds.toFixed(2)} s)`);
});
