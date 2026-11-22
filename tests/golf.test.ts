import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_TREES, CROWN, HOLES, holeLength, lieAt, scoreName, toPar, yawTo } from '../src/shared/course.js';
import { CLUBS, clubFor, fly, fullReach, shotOk, type Club, type Shot } from '../src/shared/golf.js';
import { GolfRound, MAX_STROKES } from '../src/client/features/golf/round.js';

/** A shot on hole `hole` from (x, z) at its pin, with `club` at its usual loft. */
const at = (hole: number, from: { x: number; z: number }, club: Club, power: number, aim = 0): Shot => ({
  hole,
  x: from.x,
  z: from.z,
  club,
  yaw: yawTo(from, HOLES[hole].pin) + aim,
  loft: CLUBS[club].start,
  power,
});

/** The powers (in steps of a hundredth) that put a shot at the pin on the green. */
function greenPowers(hole: number, from: { x: number; z: number }, club: Club): number[] {
  const out: number[] = [];
  for (let p = 0.2; p <= 1.0001; p += 0.01) if (fly(at(hole, from, club, p)).lie === 'green') out.push(p);
  return out;
}

test('three par 3s round a loop: each green is a short walk from the next tee', () => {
  assert.equal(HOLES.length, 3);
  HOLES.forEach((h, i) => {
    assert.equal(h.par, 3);
    assert.equal(h.n, i + 1);
    const len = holeLength(h);
    assert.ok(len > 55 && len < 90, `hole ${h.n} is ${len.toFixed(0)} m`);
    const next = HOLES[(i + 1) % HOLES.length];
    const walk = Math.hypot(next.tee.x - h.pin.x, next.tee.z - h.pin.z);
    assert.ok(walk < 26, `from the ${h.n} green to the next tee is ${walk.toFixed(0)} m`);
    assert.equal(lieAt(h.tee.x, h.tee.z), 'tee');
    assert.equal(lieAt(h.pin.x, h.pin.z), 'green');
    assert.equal(lieAt(h.drop.x, h.drop.z) === 'water', false, `hole ${h.n}'s drop zone is dry`);
  });
  // A triangle: each hole heads off a good way round from the last.
  for (let i = 0; i < 3; i++) {
    const a = yawTo(HOLES[i].tee, HOLES[i].pin);
    const b = yawTo(HOLES[(i + 1) % 3].tee, HOLES[(i + 1) % 3].pin);
    const turn = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
    assert.ok(turn > Math.PI / 3, `hole ${i + 2 > 3 ? 1 : i + 2} turns ${((turn * 180) / Math.PI).toFixed(0)}° from hole ${i + 1}`);
  }
  // No tree in the way of the line from a tee to its pin.
  for (const h of HOLES) {
    for (const [x, z, s] of COURSE_TREES) {
      const len = holeLength(h);
      const u = ((x - h.tee.x) * (h.pin.x - h.tee.x) + (z - h.tee.z) * (h.pin.z - h.tee.z)) / len;
      const off = Math.abs((x - h.tee.x) * (h.pin.z - h.tee.z) - (z - h.tee.z) * (h.pin.x - h.tee.x)) / len;
      assert.ok(u < 0 || u > len || off > CROWN.r * s + 4, `the tree at (${x}, ${z}) stands in hole ${h.n}'s way`);
    }
  }
});

test('every green can be hit from its tee with the iron, and the island and the pond punish a short one', () => {
  for (const [i, h] of HOLES.entries()) {
    const on = greenPowers(i, h.tee, 'iron');
    assert.ok(on.length >= 3, `hole ${h.n}: the green from the tee at ${on.map((p) => p.toFixed(2)).join(', ')}`);
    assert.ok(on.every((p) => p < 0.97), `hole ${h.n} is in reach without a perfect swing`);
  }
  // Short on the first and the second, it's wet.
  for (const i of [0, 1]) {
    const on = greenPowers(i, HOLES[i].tee, 'iron');
    const short = fly(at(i, HOLES[i].tee, 'iron', on[0] - 0.08));
    assert.equal(short.lie, 'water', `hole ${i + 1} short`);
    assert.ok(Number.isNaN(short.fromPin));
  }
  // Long on the last, it's over the green toward the street.
  assert.ok(fly(at(2, HOLES[2].tee, 'iron', 1)).lie !== 'green');
});

test('a chip and a putt: the wedge gets close from off the green, and a putt rolls into the cup', () => {
  const h = HOLES[0];
  const from = { x: h.pin.x - 14, z: h.pin.z - 6 };
  assert.equal(clubFor(0, from.x, from.z), 'wedge');
  assert.ok(greenPowers(0, from, 'wedge').length > 2, 'a chip onto the green');
  // On the green, it's the putter; there's a stroke that drops it from 4 m.
  const putt = { x: h.pin.x, z: h.pin.z - 4 };
  assert.equal(clubFor(0, putt.x, putt.z), 'putter');
  const holed: number[] = [];
  for (let p = 0.05; p <= 1; p += 0.01) {
    for (const aim of [-0.06, -0.03, 0, 0.03, 0.06]) if (fly(at(0, putt, 'putter', p, aim)).holed) holed.push(p);
  }
  assert.ok(holed.length > 0, 'a putt from 4 m that goes in');
  // Too hard and it runs past; the slope pulls one hit dead straight off the line.
  const hard = fly(at(0, putt, 'putter', 1));
  assert.ok(!hard.holed && hard.fromPin > 2);
  const rolled = fly(at(0, { x: h.pin.x - 5, z: h.pin.z - 5 }, 'putter', 0.6));
  assert.ok(rolled.path.length > 10 && fullReach('putter', 0) > 10);
});

test('trees slow a ball and the same shot always goes the same way', () => {
  const [tx, tz] = COURSE_TREES[0];
  const from = { x: tx - 20, z: tz };
  const shot: Shot = { hole: 0, x: from.x, z: from.z, club: 'wedge', yaw: Math.PI / 2, loft: 0.35, power: 0.85 };
  const f = fly(shot);
  assert.ok(f.hits.some((x) => x.kind === 'tree' || x.kind === 'wall'), 'into the tree');
  assert.deepEqual(fly(shot).rest, f.rest);
});

test('only shots anyone could play get passed on', () => {
  const ok: Shot = { hole: 1, x: 29, z: 137, club: 'iron', yaw: -1.5, loft: 0.6, power: 0.8 };
  assert.ok(shotOk(ok));
  assert.ok(!shotOk({ ...ok, club: 'driver' }));
  assert.ok(!shotOk({ ...ok, hole: 3 }));
  assert.ok(!shotOk({ ...ok, x: 500 }), 'from off the course');
  assert.ok(!shotOk({ ...ok, power: 1.5 }));
  assert.ok(!shotOk({ ...ok, loft: 1.5 }), 'more loft than the iron has');
  assert.ok(!shotOk({ ...ok, yaw: Number.NaN }));
  assert.ok(shotOk({ ...ok, club: 'putter', loft: 0 }));
});

test('a round: strokes, penalties, holing out, and on round the loop to the end', () => {
  const r = new GolfRound(1);
  assert.equal(r.hole, 1);
  assert.ok(r.ball.teed);
  // Into the island's lake off the tee: a stroke added, dropped by the water.
  r.struck();
  const wet = fly(at(1, HOLES[1].tee, 'iron', 0.75));
  assert.equal(wet.lie, 'water');
  assert.deepEqual(r.landed(wet), { kind: 'penalty', why: 'water' });
  assert.equal(r.strokes, 2);
  assert.deepEqual(r.ball, { x: HOLES[1].drop.x, z: HOLES[1].drop.z, teed: false });
  // Out of bounds: back where it was hit from.
  r.struck();
  const out = fly({ ...at(1, r.ball, 'iron', 1), yaw: 0 });
  assert.ok(out.lie === 'out' || out.lie === 'roof' || out.lie === 'rough', out.lie);
  r.landed({ ...out, lie: 'out' });
  assert.equal(r.strokes, 4);
  assert.deepEqual(r.ball, { x: HOLES[1].drop.x, z: HOLES[1].drop.z, teed: false });
  // In: a double bogey, and on to the third, teed up.
  r.struck();
  const done = r.landed({ ...wet, holed: true, lie: 'green' });
  assert.deepEqual(done, { kind: 'holed', hole: 1, strokes: 5, name: 'Double bogey', next: 2, picked: false });
  assert.equal(r.hole, 2);
  assert.ok(r.ball.teed);
  // A hole in one on the third, then pick up on the first: the round's over.
  r.struck();
  assert.equal((r.landed({ ...wet, holed: true }) as { name: string }).name, 'Hole in one!');
  const last = r.pickUp();
  assert.deepEqual(last, { kind: 'holed', hole: 0, strokes: MAX_STROKES, name: 'Picked up', next: null, picked: true });
  assert.ok(r.done);
  assert.equal(r.total, 5 + 1 + MAX_STROKES);
  assert.equal(toPar(r.toPar), `+${5 + 1 + MAX_STROKES - 9}`);
  assert.equal(scoreName(2, 3), 'Birdie');
  assert.equal(scoreName(3, 3), 'Par');
});
