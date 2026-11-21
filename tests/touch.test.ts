// The 3D office's touch controls (features/touch): the stick a thumb makes, which finger is doing what,
// the keys the buttons take from the hint bar, and what the stick holds down for what reads keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DEAD_ZONE, RUN_AT, STICK_ZONE, Touches, codeOf, hintKeys, stickFrom } from '../src/client/features/touch/touches.js';
import { STICK_KEY_AT, stickHolds, stickPushed, type Stick } from '../src/client/player/stick.js';

const R = 100;
const stick = (): Stick => ({ x: 0, z: 0, run: false });
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('a thumb resting in the dead zone does not move you', () => {
  for (const [dx, dy] of [[0, 0], [3, -4], [R * DEAD_ZONE * 0.99, 0], [0, -R * DEAD_ZONE * 0.5]]) {
    const s = stickFrom(dx, dy, R, { x: 0.5, z: 0.5, run: true });
    assert.deepEqual(s, { x: 0, z: 0, run: false }, `${dx},${dy}`);
    assert.equal(stickPushed(s), false);
  }
});

test('the stick points where the thumb went: up the screen is forward (z −), as W is', () => {
  const up = stickFrom(0, -60, R, stick());
  close(up.x, 0);
  assert.ok(up.z < 0);
  const right = stickFrom(60, 0, R, stick());
  assert.ok(right.x > 0);
  close(right.z, 0);
  // A diagonal is as fast as straight ahead: the stick's length, not each axis, is how far you pushed.
  const diag = stickFrom(60 / Math.SQRT2, 60 / Math.SQRT2, R, stick());
  close(Math.hypot(diag.x, diag.z), Math.hypot(up.x, up.z));
  close(diag.x, diag.z);
});

test('how far you push is how fast you walk, up to the run threshold, and never past full length', () => {
  const at = (d: number) => {
    const s = stickFrom(d, 0, R, stick());
    return { len: Math.hypot(s.x, s.z), run: s.run };
  };
  const half = at(R * ((DEAD_ZONE + RUN_AT) / 2));
  close(half.len, 0.5);
  assert.equal(half.run, false);
  assert.ok(at(R * 0.3).len < at(R * 0.6).len, 'further is faster');
  const justUnder = at(R * RUN_AT - 0.01);
  assert.equal(justUnder.run, false);
  assert.ok(justUnder.len > 0.99);
  const run = at(R * RUN_AT);
  assert.equal(run.run, true, 'pushed to the run threshold runs');
  close(run.len, 1);
  // Way past the rim: clamped.
  const far = at(R * 5);
  close(far.len, 1);
  assert.equal(far.run, true);
});

test('the stick writes into the object it is given (no garbage while the thumb moves)', () => {
  const out = stick();
  assert.equal(stickFrom(50, 0, R, out), out);
});

test('two thumbs: the first touch on the left walks, everything else looks', () => {
  const t = new Touches();
  const W = 1000;
  assert.equal(t.start(1, W * STICK_ZONE - 1, W), 'stick');
  assert.equal(t.start(2, 800, W), 'look');
  // A second finger on the left while the first walks looks around instead of fighting over the stick.
  assert.equal(t.start(3, 50, W), 'look');
  assert.equal(t.count('look'), 2);
  assert.equal(t.role(1), 'stick');
  assert.equal(t.role(99), undefined, 'a pointer that is not ours');
  // The walking thumb lifts: the looking ones carry on.
  assert.equal(t.end(1), 'stick');
  assert.equal(t.has('stick'), false);
  assert.equal(t.role(2), 'look');
  // Lifted twice (pointerup, then pointercancel): nothing the second time.
  assert.equal(t.end(1), undefined);
  // The stick is free again for the next thumb on the left.
  assert.equal(t.start(4, 10, W), 'stick');
  assert.equal(t.start(5, W * STICK_ZONE, W), 'look', 'the zone ends at STICK_ZONE');
});

test('a cancelled touch, or every touch at once (blur, the tab hidden), lets go', () => {
  const t = new Touches();
  t.start(1, 10, 1000);
  t.start(2, 900, 1000);
  assert.equal(t.end(2), 'look', 'pointercancel ends it like pointerup');
  t.clear();
  assert.equal(t.size, 0);
  assert.equal(t.role(1), undefined);
  assert.equal(t.start(3, 10, 1000), 'stick');
});

test('the buttons take their keys from the hint bar: E, Space and the rest; the stick and a drag stand for the others', () => {
  assert.equal(codeOf('E'), 'KeyE');
  assert.equal(codeOf('E / Click'), 'KeyE');
  assert.equal(codeOf('Q'), 'KeyQ');
  assert.equal(codeOf('Space'), 'Space');
  assert.equal(codeOf('Esc'), 'Escape');
  for (const cap of ['W A S D', 'A D', 'W S', 'Mouse', 'Click', 'Scroll', 'W', 'A']) assert.equal(codeOf(cap), null, cap);
  const desk = hintKeys([
    { cap: 'E', label: 'Open terminal' },
    { cap: 'C', label: 'Changes' },
    { cap: 'P', label: 'Prompt' },
    { cap: 'O', label: ' PR #12' },
    { cap: 'X', label: 'Send home' },
    { cap: 'W A S D', label: 'Get up' },
    { cap: 'E', label: 'again' },
  ]);
  assert.deepEqual(
    desk.map((k) => [k.code, k.label]),
    [
      ['KeyE', 'Open terminal'],
      ['KeyC', 'Changes'],
      ['KeyP', 'Prompt'],
      ['KeyO', 'PR #12'],
      ['KeyX', 'Send home'],
    ],
  );
  assert.deepEqual(hintKeys([{ cap: 'E / Click', label: 'Hold to shoot' }]), [{ code: 'KeyE', cap: 'E', label: 'Hold to shoot' }]);
});

test('the stick holds down W A S D and Shift for what reads keys (a car, aiming at the tee or the oche)', () => {
  const s: Stick = { x: 0, z: -0.9, run: true };
  assert.ok(stickHolds(s, 'KeyW') && stickHolds(s, 'ArrowUp') && stickHolds(s, 'ShiftLeft'));
  assert.ok(!stickHolds(s, 'KeyS') && !stickHolds(s, 'KeyA') && !stickHolds(s, 'KeyD') && !stickHolds(s, 'Space'));
  // A gentle push one way doesn't steer.
  const gentle: Stick = { x: STICK_KEY_AT - 0.01, z: STICK_KEY_AT, run: false };
  assert.ok(!stickHolds(gentle, 'KeyD'));
  assert.ok(stickHolds(gentle, 'KeyS'));
  assert.ok(!stickHolds(gentle, 'ShiftRight'));
});

test('no key handler in the office asks whether a key was really typed, so the touch buttons press them all', () => {
  const client = path.join(import.meta.dirname, '../src/client');
  const files = (readdirSync(client, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length > 100);
  for (const f of files) assert.doesNotMatch(readFileSync(path.join(client, f), 'utf8'), /\.isTrusted\b/, `src/client/${f} checks isTrusted: the touch buttons' key presses (features/touch/keys.ts) would stop working there`);
});
