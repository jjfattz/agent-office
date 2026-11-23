import test from 'node:test';
import assert from 'node:assert/strict';
import { COURSE_TREES, CROWN, HOLES, holeLength, lieAt, scoreName, toPar, yawTo } from '../src/shared/course.js';
import { CLUBS, CUP, carry, clubFor, fly, fullReach, lieText, powerFor, puttRoll, shotOk, type Club, type Shot } from '../src/shared/golf.js';
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

test('the cup: a putt over the middle at a sensible pace drops, one hit hard lips out and says so', () => {
  // Every hole, from 3 m on a few sides: a good stretch of the meter holes it, dead straight at the cup.
  for (const [i, h] of HOLES.entries()) {
    for (const side of [0, 2, 4]) {
      const from = { x: h.pin.x + Math.sin(side) * 3, z: h.pin.z + Math.cos(side) * 3 };
      let holed = 0;
      for (let p = 0.3; p <= 0.8; p += 0.005) {
        for (const aim of [-0.03, -0.015, 0, 0.015, 0.03]) {
          if (fly(at(i, from, 'putter', p, aim)).holed) {
            holed++;
            break;
          }
        }
      }
      assert.ok(holed * 0.005 >= 0.12, `hole ${h.n} from side ${side}: holed over ${(holed * 0.5).toFixed(1)}% of the meter`);
    }
  }
  // Rammed at it from 1.5 m on the flattest line there is: over the cup, off round its edge.
  const h = HOLES[0];
  const from = { x: h.pin.x, z: h.pin.z - 1.5 };
  const hard = fly(at(0, from, 'putter', 0.9));
  assert.ok(!hard.holed && hard.hits.some((x) => x.kind === 'lip'), 'it lips out');
  assert.match(lieText(hard), /^Lipped out/);
  // And the guide's length is how far a putt rolls on the flat.
  assert.ok(Math.abs(puttRoll(1) - fullReach('putter', 0)) < 1e-9 && puttRoll(0.5) < puttRoll(1) / 3);
  assert.ok(CUP >= 0.15);
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

test('the landing circle: the power the meter notch asks for lands the ball about where it is aimed', () => {
  // Off each tee, straight at the pin and a little either side, with both clubs at a few lofts.
  for (const [i, h] of HOLES.entries()) {
    const toPin = Math.hypot(h.pin.x - h.tee.x, h.pin.z - h.tee.z);
    for (const club of ['iron', 'wedge'] as Club[]) {
      const [lo, hi] = CLUBS[club].loft;
      for (const loft of [lo, (lo + hi) / 2, hi]) {
        const full = fullReach(club, loft);
        for (const dist of [full * 0.3, Math.min(full, toPin) * 0.8, full]) {
          const power = powerFor(club, loft, dist);
          assert.ok(power > 0 && power <= 1);
          assert.ok(Math.abs(carry(club, loft, power) - dist) < 0.05, `${club} at ${loft.toFixed(2)} carries ${dist.toFixed(1)} m`);
          const yaw = Math.atan2(h.pin.x - h.tee.x, h.pin.z - h.tee.z);
          const f = fly({ hole: i, x: h.tee.x, z: h.tee.z, club, yaw, loft, power });
          const first = f.hits[0];
          // A tree in the way is a tree in the way; otherwise it comes down inside the circle.
          if (!first || first.kind === 'tree' || first.kind === 'wall') continue;
          const landed = Math.hypot(first.at.x - h.tee.x, first.at.z - h.tee.z);
          assert.ok(Math.abs(landed - dist) < Math.max(1, dist * 0.05), `hole ${h.n}, ${club}: aimed ${dist.toFixed(1)} m, landed ${landed.toFixed(1)} m`);
        }
      }
    }
  }
  // Further than the club goes is a full swing; nothing is nothing; and a putt's power rolls it that far.
  assert.equal(powerFor('iron', CLUBS.iron.start, 1000), 1);
  assert.equal(powerFor('wedge', CLUBS.wedge.start, 0), 0);
  assert.ok(Math.abs(puttRoll(powerFor('putter', 0, 5)) - 5) < 1e-9);
  // The arc's points start at the ball and come back down at the carry.
  const pts: number[] = [];
  const c = carry('iron', CLUBS.iron.start, 0.7, pts);
  assert.deepEqual(pts.slice(0, 2), [0, 0]);
  assert.ok(pts.length > 20 && Math.abs(pts[pts.length - 2] - c) < 1 && Math.max(...pts.filter((_, k) => k % 2)) > 5);
});
