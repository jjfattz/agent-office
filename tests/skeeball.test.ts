import test from 'node:test';
import assert from 'node:assert/strict';
import { AIM_MAX, BALLS, CORNERS, LANE, RINGS, SKEEBALL, fold, pathAt, roll, rollOk, scoreAt } from '../src/shared/skeeball.js';
import { MEETING_ROOM, SPAWN, STAIRS } from '../src/shared/layout.js';
import { route, walkable } from '../src/shared/nav.js';

test('skeeball: the machine stands with its back to the meeting room glass, just north of the stairs', () => {
  const back = SKEEBALL.x + LANE.length;
  assert.ok(back < MEETING_ROOM.minX && MEETING_ROOM.minX - back < 0.2, `its back is ${back}, the glass at ${MEETING_ROOM.minX}`);
  const south = SKEEBALL.z + LANE.width / 2;
  assert.ok(south < STAIRS.minZ && STAIRS.minZ - south < 0.3, `its south side is ${south}, the stairs start at ${STAIRS.minZ}`);
  assert.ok(SKEEBALL.z - LANE.width / 2 > MEETING_ROOM.minZ, 'it is alongside the meeting room, not past its corner');
});

test('skeeball: you can walk up to its front, and nobody walks through it', () => {
  const front: [number, number] = [SKEEBALL.x - 0.5, SKEEBALL.z];
  assert.ok(walkable(...front), 'where you stand to roll is open floor');
  assert.ok(!walkable(SKEEBALL.x + LANE.length / 2, SKEEBALL.z), 'the middle of the lane is in the way');
  assert.ok(route([SPAWN.x, SPAWN.z], front).length > 0, 'there is a way there from where people arrive');
});

test('skeeball: the target scores each ring, the corner pockets, and the 10 round them', () => {
  assert.equal(scoreAt(RINGS.d, 0).points, 50);
  const [[r50], [r40], [r30], [r20]] = RINGS.bands;
  assert.equal(scoreAt(RINGS.d + (r50 + r40) / 2, 0).points, 40);
  assert.equal(scoreAt(RINGS.d - (r40 + r30) / 2, 0).points, 30);
  assert.equal(scoreAt(RINGS.d, (r30 + r20) / 2).points, 20);
  assert.equal(scoreAt(CORNERS.d, -CORNERS.u).points, 100);
  assert.equal(scoreAt(CORNERS.d, CORNERS.u).points, 100);
  assert.equal(scoreAt(0.05, 0.2).points, 10);
  assert.equal(scoreAt(-0.1, 0).points, 10, 'short of the face drops into the 10');
  assert.equal(scoreAt(LANE.face.long + 0.1, 0).points, 10, 'over the top comes back down into the 10');
});

test('skeeball: too soft rolls back for nothing; harder rolls land further up the face', () => {
  assert.deepEqual([roll(0, 0).outcome.points, roll(0, 0).outcome.label], [0, 'Too soft']);
  let last = -Infinity;
  for (let p = 0.1; p <= 1; p += 0.1) {
    const { outcome } = roll(0, p);
    assert.ok(outcome.land, `${p.toFixed(1)} gets over the hump`);
    assert.ok(outcome.land.d > last, `${p.toFixed(1)} lands further up than a softer roll`);
    last = outcome.land.d;
  }
});

test('skeeball: every score is reachable, straight up for the 50 and into a corner for the 100', () => {
  const seen = new Set<number>();
  for (let a = -AIM_MAX; a <= AIM_MAX + 1e-9; a += AIM_MAX / 20) for (let p = 0; p <= 1; p += 0.01) seen.add(roll(a, p).outcome.points);
  assert.deepEqual([...seen].sort((x, y) => x - y), [0, 10, 20, 30, 40, 50, 100]);
  assert.ok([0.42, 0.46, 0.5].every((p) => roll(0, p).outcome.points === 50));
  assert.ok(roll(AIM_MAX * 0.85, 0.96).outcome.points === 100 && roll(-AIM_MAX * 0.85, 0.96).outcome.points === 100);
});

test('skeeball: a roll works out the same every time, and its path stays inside the machine', () => {
  for (const [a, p] of [
    [0, 0.5],
    [0.08, 0.9],
    [-0.1, 0.2],
    [0.03, 0.02],
  ]) {
    const one = roll(a, p);
    assert.deepEqual(roll(a, p), one);
    for (const pt of one.path) {
      assert.ok(pt.s >= 0 && pt.s <= LANE.length, `s ${pt.s} is inside the machine`);
      assert.ok(Math.abs(pt.u) <= LANE.inner / 2, `u ${pt.u} is between the rails`);
    }
    for (let i = 1; i < one.path.length; i++) assert.ok(one.path[i].t > one.path[i - 1].t);
    const mid = one.path[Math.floor(one.path.length / 2)];
    assert.deepEqual(pathAt(one.path, mid.t), mid);
  }
});

test('skeeball: a ball bounces off the rails', () => {
  assert.ok(Math.abs(fold(0.1, 0.25) - 0.1) < 1e-9);
  assert.ok(Math.abs(fold(0.3, 0.25) - 0.2) < 1e-9);
  assert.ok(Math.abs(fold(-0.3, 0.25) + 0.2) < 1e-9);
});

test('skeeball: only a roll anybody could have rolled goes on to the floor', () => {
  assert.ok(rollOk({ aim: 0, power: 0.5, n: 1 }));
  assert.ok(rollOk({ aim: -AIM_MAX, power: 1, n: BALLS }));
  for (const bad of [
    { aim: AIM_MAX * 2, power: 0.5, n: 1 },
    { aim: 0, power: 1.5, n: 1 },
    { aim: 0, power: -0.1, n: 1 },
    { aim: 0, power: 0.5, n: 0 },
    { aim: 0, power: 0.5, n: BALLS + 1 },
    { aim: 0, power: 0.5, n: 1.5 },
    { aim: Number.NaN, power: 0.5, n: 1 },
    { aim: '0', power: 0.5, n: 1 },
  ])
    assert.ok(!rollOk(bad), JSON.stringify(bad));
});
