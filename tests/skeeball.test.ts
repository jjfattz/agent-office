import test from 'node:test';
import assert from 'node:assert/strict';
import { AIM_MAX, BALLS, CORNERS, LANE, RINGS, SKEEBALL, SWEEP, aimSweep, laneY, onFace, pathAt, roll, rollOk, scoreAt } from '../src/shared/skeeball.js';
import { MEETING_ROOM, SPAWN, STAIRS } from '../src/shared/layout.js';
import { route, walkable } from '../src/shared/nav.js';

test('skeeball: the machine stands with its back to the meeting room glass, just north of the stairs', () => {
  const back = SKEEBALL.x + SKEEBALL.length;
  assert.ok(back < MEETING_ROOM.minX && MEETING_ROOM.minX - back < 0.2, `its back is ${back}, the glass at ${MEETING_ROOM.minX}`);
  const south = SKEEBALL.z + SKEEBALL.width / 2;
  assert.ok(south < STAIRS.minZ && STAIRS.minZ - south < 0.3, `its south side is ${south}, the stairs start at ${STAIRS.minZ}`);
  assert.ok(SKEEBALL.z - SKEEBALL.width / 2 > MEETING_ROOM.minZ, 'it is alongside the meeting room, not past its corner');
});

test('skeeball: you can walk up to its front, and nobody walks through it', () => {
  const front: [number, number] = [SKEEBALL.x - 0.6, SKEEBALL.z];
  assert.ok(walkable(...front), 'where you stand to roll is open floor');
  assert.ok(!walkable(SKEEBALL.x + SKEEBALL.length / 2, SKEEBALL.z), 'the middle of the lane is in the way');
  assert.ok(route([SPAWN.x, SPAWN.z], front).length > 0, 'there is a way there from where people arrive');
});

test('skeeball: the target scores each ring, the corner pockets, and the 10 round them', () => {
  assert.equal(scoreAt(RINGS.d, 0), 50);
  const [[r50], [r40], [r30], [r20]] = RINGS.bands;
  assert.equal(scoreAt(RINGS.d + (r50 + r40) / 2, 0), 40);
  assert.equal(scoreAt(RINGS.d - (r40 + r30) / 2, 0), 30);
  assert.equal(scoreAt(RINGS.d, (r30 + r20) / 2), 20);
  assert.equal(scoreAt(CORNERS.d, -CORNERS.u), 100);
  assert.equal(scoreAt(CORNERS.d, CORNERS.u), 100);
  assert.equal(scoreAt(0.05, 0.3), 10);
});

test('skeeball: the lane climbs smoothly into the hump', () => {
  let last = -Infinity;
  for (let s = LANE.start.s; s <= LANE.hump.s; s += 0.01) {
    const y = laneY(s);
    assert.ok(y >= last, `it never dips (at ${s.toFixed(2)})`);
    last = y;
  }
  assert.ok(Math.abs(laneY(LANE.foot.s) - LANE.foot.y) < 1e-9 && Math.abs(laneY(LANE.hump.s) - LANE.hump.y) < 1e-9);
});

test('skeeball: too soft rolls back for nothing; straight up the middle, harder climbs the rings in turn', () => {
  assert.deepEqual([roll(0, 0).outcome.points, roll(0, 0).outcome.label], [0, 'Too soft']);
  // Up the middle: 10s short, then each ring further up, to the 50.
  const seen: number[] = [];
  for (let p = 0.12; p <= 0.48; p += 0.02) {
    const pts = roll(0, p).outcome.points;
    if (seen[seen.length - 1] !== pts) seen.push(pts);
  }
  assert.deepEqual(seen, [10, 20, 30, 40, 50]);
});

test('skeeball: every score can be had, the 100s only near the edges', () => {
  const seen = new Set<number>();
  const hundreds: number[] = [];
  for (let a = -AIM_MAX; a <= AIM_MAX + 1e-9; a += AIM_MAX / 15)
    for (let p = 0; p <= 1; p += 0.02) {
      const pts = roll(a, p).outcome.points;
      seen.add(pts);
      if (pts === 100) hundreds.push(a);
    }
  assert.deepEqual([...seen].sort((x, y) => x - y), [0, 10, 20, 30, 40, 50, 100]);
  assert.ok(hundreds.every((a) => Math.abs(a) > 0.15), 'no 100 from aiming at the middle');
  assert.ok(hundreds.some((a) => a < 0) && hundreds.some((a) => a > 0), 'both corners');
});

test('skeeball: a 100 takes the gap between the rings and the rail, rolled just so', () => {
  let hundreds = 0;
  let rolls = 0;
  for (let a = -AIM_MAX; a <= AIM_MAX + 1e-9; a += AIM_MAX / 40)
    for (let p = 0; p <= 1; p += 0.01) {
      rolls++;
      if (roll(a, p).outcome.points !== 100) continue;
      hundreds++;
      assert.ok(Math.abs(a) < AIM_MAX - 0.06, `aimed ${a.toFixed(3)}: hugging the rail is no way in`);
      assert.ok(p < 0.6, `rolled ${p.toFixed(2)}: slamming it off the back is no way in`);
    }
  assert.ok(hundreds > 0 && hundreds / rolls < 0.02, `${hundreds} of ${rolls} rolls score 100`);
  // Flat out, wherever it's aimed, it comes back off the back too fast to drop in a pocket.
  for (let a = -AIM_MAX; a <= AIM_MAX + 1e-9; a += AIM_MAX / 40) assert.notEqual(roll(a, 1).outcome.points, 100);
});

test('skeeball: the aim slider sets off from its end, crosses to the other, and comes back', () => {
  for (const from of [-1, 1]) {
    assert.equal(aimSweep(0, from), from * AIM_MAX);
    assert.ok(Math.abs(aimSweep(SWEEP / 2, from)) < 1e-9, 'halfway across, it is over the middle');
    assert.ok(Math.abs(aimSweep(SWEEP, from) + from * AIM_MAX) < 1e-9, 'at the other end');
    assert.ok(Math.abs(aimSweep(SWEEP * 2, from) - from * AIM_MAX) < 1e-9, 'and back');
    for (let t = 0; t < 3; t += 0.01) assert.ok(Math.abs(aimSweep(t, from)) <= AIM_MAX + 1e-9);
  }
});

test('skeeball: a roll works out the same every time, stays inside the machine, and drops in its hole', () => {
  for (const [a, p] of [
    [0, 0.55],
    [0.25, 0.9],
    [-0.31, 0.42],
    [AIM_MAX, 0.55],
    [0.1, 0.3],
    [0, 1],
    [0.03, 0.02],
  ]) {
    const one = roll(a, p);
    assert.deepEqual(roll(a, p), one);
    for (const pt of one.path) {
      assert.ok(pt.s >= 0 && pt.s <= LANE.back, `s ${pt.s} is inside the machine`);
      assert.ok(Math.abs(pt.u) <= LANE.inner / 2, `u ${pt.u} is between the rails`);
      assert.ok(pt.y > 0.4 && pt.y < 2.1, `y ${pt.y} is inside the machine`);
    }
    for (let i = 1; i < one.path.length; i++) assert.ok(one.path[i].t > one.path[i - 1].t);
    const mid = one.path[Math.floor(one.path.length / 2)];
    assert.deepEqual(pathAt(one.path, mid.t), mid);
    assert.ok(one.path[one.path.length - 1].t < 6.5, 'it is all over in a few seconds');
    const { hole, points } = one.outcome;
    if (hole.d >= 0) assert.equal(scoreAt(hole.d, hole.u), points, `${points} drops in its own hole`);
  }
});

test('skeeball: the ball goes over the hump before it lands on the target, and you hear it', () => {
  const { events } = roll(0, 0.55);
  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.indexOf('hop') >= 0 && kinds.indexOf('hop') < kinds.indexOf('land'));
  assert.equal(kinds[kinds.length - 1], 'drop');
  assert.ok(onFace(1, 0).y > onFace(0, 0).y, 'the target leans back');
});

test('skeeball: only a roll anybody could have rolled goes on to the floor', () => {
  assert.ok(rollOk({ aim: 0, power: 0.5, n: 1, points: 50 }));
  assert.ok(rollOk({ aim: -AIM_MAX, power: 1, n: BALLS, points: 0 }));
  for (const bad of [
    { aim: AIM_MAX * 2, power: 0.5, n: 1, points: 10 },
    { aim: 0, power: 1.5, n: 1, points: 10 },
    { aim: 0, power: -0.1, n: 1, points: 10 },
    { aim: 0, power: 0.5, n: 0, points: 10 },
    { aim: 0, power: 0.5, n: BALLS + 1, points: 10 },
    { aim: 0, power: 0.5, n: 1.5, points: 10 },
    { aim: Number.NaN, power: 0.5, n: 1, points: 10 },
    { aim: '0', power: 0.5, n: 1, points: 10 },
    { aim: 0, power: 0.5, n: 1, points: 60 },
    { aim: 0, power: 0.5, n: 1 },
  ])
    assert.ok(!rollOk(bad as never), JSON.stringify(bad));
});
