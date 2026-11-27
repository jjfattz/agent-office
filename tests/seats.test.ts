import test from 'node:test';
import assert from 'node:assert/strict';
import { DESK_BY_ID, seatHere, vacantSeats } from '../src/shared/layout.js';

// Two floors that each have a worker at desk 1 and desk 3.
const agentOffice = [
  { id: 'w-one-a', deskId: 'desk-1' },
  { id: 'w-desk-a', deskId: 'desk-3' },
  { id: 'w-bag-a', deskId: 'beanbag-1' },
];
const survive = [
  { id: 'w-one-b', deskId: 'desk-1' },
  { id: 'w-desk-b', deskId: 'desk-3' },
];

test('an empty floor shows every seat free', () => {
  assert.deepEqual(vacantSeats([]), new Set(DESK_BY_ID.keys()));
});

test('riding the elevator between floors that share desks leaves neither showing free', () => {
  for (const [from, to] of [
    [agentOffice, survive],
    [survive, agentOffice],
  ]) {
    const before = vacantSeats(from);
    const after = vacantSeats(to);
    // Same desks, different workers: still taken, so no '+'.
    assert.ok(!after.has('desk-1'), "no '+' over the worker at desk 1");
    assert.ok(!after.has('desk-3'), "no '+' over the worker at desk 3");
    for (const w of to) assert.ok(!after.has(w.deskId), `${w.deskId} is taken`);
    // A seat only the old floor used is free again; the rest are free on both.
    for (const id of DESK_BY_ID.keys()) if (!from.some((w) => w.deskId === id) && !to.some((w) => w.deskId === id)) assert.ok(before.has(id) && after.has(id), `${id} is free`);
  }
  assert.ok(vacantSeats(survive).has('beanbag-1'), 'the bean bag only agent-office uses is free on the other floor');
});

test("a seat shows its '+' again only once the worker sent home has got up", () => {
  const packing = new Set(['desk-1']);
  // Sent home: gone from the store, but still packing up at the desk.
  assert.ok(!vacantSeats([], (id) => packing.has(id)).has('desk-1'));
  // Up and walking off: the '+' is back.
  packing.clear();
  assert.ok(vacantSeats([], (id) => packing.has(id)).has('desk-1'));
  // Someone new hired there while the last one was still packing: taken either way.
  packing.add('desk-1');
  assert.ok(!vacantSeats([{ deskId: 'desk-1' }], (id) => packing.has(id)).has('desk-1'));
});

test("you can only sit where you are: the roof's seats up on the roof, the office's on a floor", () => {
  assert.ok(seatHere('couch:1', false));
  assert.ok(seatHere('roof-stool-1:0', true));
  assert.equal(seatHere('couch:1', true), undefined, 'no office couch from the roof');
  assert.equal(seatHere('roof-stool-1:0', false), undefined, 'no bar stool from a project floor');
  assert.equal(seatHere('couch:9', false), undefined, 'no such place on the couch');
});
