import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Arcade, HighScores, RECORD_EVERY, type Player } from '../src/server/cabinet.js';
import { WAVE_BURST, WAVE_SECONDS } from '../src/server/games/bugswarm.js';
import { TITLES, checkFrame } from '../src/shared/cabinet.js';
import { BUG_POINTS, MOST_POINTS, START_SHIPS, SWARM_SIZE, type SwarmFrame } from '../src/shared/games/bugswarm.js';
import { Bugswarm, FOLLOW_GAP, GROUP_GAP, GROUPS, ROWS, SHIP_Y, WAVE_PAUSE } from '../src/client/features/cabinet/bugswarm.js';
import { CARTS } from '../src/client/features/cabinet/games.js';

const ada: Player = { owner: 'name:Ada', name: 'Ada', color: '#ef476f' };
const grace: Player = { owner: 'account:grace', name: 'Grace', color: '#06d6a0' };

/** Game internals, for a test to reach in. */
type Inside = {
  bugs: { kind: number; hp: number; mode: string; x: number; y: number }[];
  stings: { x: number; y: number; vx: number; vy: number }[];
  shots: { x: number; y: number }[];
  shipX: number;
  shipUp: boolean;
  kill(b: Inside['bugs'][number]): void;
};
const inside = (g: Bugswarm) => g as unknown as Inside;
/** Plays `g` on for `seconds`, a frame at a time. */
const run = (g: Bugswarm, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) g.update(1 / 60);
};

/** Math.random, but the same every run. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** An arcade with its tables in a fresh folder, on a clock the test moves. */
function arcadeFor(t: TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-arcade-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
  const table = new HighScores(dir);
  const news: { title: string; game: string }[] = [];
  const arcade = new Arcade(table, (first) => first && news.push({ title: first.title, game: first.score.game }));
  return { dir, table, arcade, news, tick: (ms: number) => t.mock.timers.tick(ms) };
}

const swarm = (f: Partial<SwarmFrame> = {}): SwarmFrame => ({ title: 'bugswarm', ship: 220, bugs: [], shots: [], stings: [], pops: [], score: 0, kills: 0, wave: 1, ships: START_SHIPS, state: 'play', ...f });

test('every game on the cabinet has its cartridge', () => {
  assert.deepEqual(Object.keys(CARTS).sort(), [...TITLES].sort());
  for (const t of TITLES) assert.equal(CARTS[t].title, t);
});

test('the swarm is SWARM_SIZE bugs, and every place in it has one bug flying in to it', () => {
  assert.equal(
    ROWS.reduce((n, r) => n + r.n, 0),
    SWARM_SIZE,
  );
  const places = GROUPS.flat().flatMap(([row, from, to]) => Array.from({ length: to - from + 1 }, (_, i) => `${row}:${from + i}`));
  assert.equal(places.length, SWARM_SIZE);
  assert.equal(new Set(places).size, SWARM_SIZE);
  for (const p of places) {
    const [row, col] = p.split(':').map(Number);
    assert.ok(col < ROWS[row].n, `${p} is in the swarm`);
  }
  // The office counts on a wave lasting at least WAVE_SECONDS: from the last one going to its last bug flying in.
  const last = (GROUPS.length - 1) * GROUP_GAP + (Math.max(...GROUPS.map((g) => g.reduce((n, [, a, b]) => n + b - a + 1, 0))) - 1) * FOLLOW_GAP;
  assert.ok(WAVE_PAUSE + last > WAVE_SECONDS, `${WAVE_PAUSE + last}s`);
});

test('a BUGSWARM frame from a browser is checked before anyone else sees it', (t) => {
  t.mock.method(Math, 'random', seeded(3));
  const g = new Bugswarm();
  run(g, WAVE_PAUSE + 3);
  const f = g.frame();
  assert.ok(f.bugs.length > 0, 'bugs have flown in');
  assert.deepEqual(checkFrame(JSON.parse(JSON.stringify(f))), f);
  assert.equal(checkFrame({ ...f, bugs: [...f.bugs, 1, 2, 3] }), null, 'a bug short of a number');
  assert.equal(checkFrame({ ...f, bugs: [9, 10, 10, 90] }), null, 'no such bug');
  assert.equal(checkFrame({ ...f, bugs: new Array(SWARM_SIZE + 1).fill([1, 10, 10, 90]).flat() }), null, 'more bugs than a swarm');
  assert.equal(checkFrame({ ...f, ship: 0.5 }), null);
  assert.equal(checkFrame({ ...f, stings: ['<b>', 4] }), null);
  assert.equal(checkFrame({ ...f, title: 'pong' }), null);
  assert.equal(checkFrame({ ...f, title: undefined }), null);
});

test('a shot takes a beetle two hits, worth more on the wing than sitting in the swarm', (t) => {
  t.mock.method(Math, 'random', seeded(5));
  const g = new Bugswarm();
  const s = inside(g);
  run(g, WAVE_PAUSE + 0.05);
  for (const b of s.bugs) Object.assign(b, { mode: 'swarm', x: -200 });
  const beetle = s.bugs.find((b) => b.kind === 3)!;
  Object.assign(beetle, { x: 100, y: 100 });
  // Hit it where it sits, between steps of the swarm.
  const shoot = () => {
    s.shots.push({ x: beetle.x, y: beetle.y + 2 });
    g.update(1 / 120);
  };
  shoot();
  assert.equal(beetle.hp, 1);
  assert.equal(g.frame().bugs.filter((_, i, a) => i % 4 === 0 && a[i] === 4).length, 1, 'it shows hurt');
  assert.equal(g.kills, 0);
  shoot();
  assert.equal(g.kills, 1);
  assert.equal(g.score, BUG_POINTS[3][0]);
  const gnat = s.bugs.find((b) => b.kind === 1)!;
  Object.assign(gnat, { mode: 'dive' });
  s.kill(gnat);
  assert.equal(g.score, BUG_POINTS[3][0] + BUG_POINTS[1][1]);
});

test('a sting costs you a ship, and the last one ends the game', (t) => {
  t.mock.method(Math, 'random', seeded(9));
  const g = new Bugswarm();
  const s = inside(g);
  const sting = () => {
    s.stings.push({ x: s.shipX, y: SHIP_Y, vx: 0, vy: 0 });
    g.update(1 / 120);
  };
  sting();
  assert.equal(g.ships, START_SHIPS - 1);
  assert.equal(g.frame().ship, -1);
  // Back once the burst has gone and nothing's diving.
  for (let i = 0; i < 40 && !s.shipUp; i++) run(g, 0.1);
  assert.ok(s.shipUp);
  while (g.ships > 1) {
    sting();
    for (let i = 0; i < 80 && !s.shipUp; i++) run(g, 0.1);
  }
  sting();
  assert.equal(g.ships, 0);
  assert.equal(g.state, 'play', 'the burst plays out first');
  run(g, 2);
  assert.equal(g.state, 'over');
  // A paused game stands still.
  const h = new Bugswarm();
  run(h, WAVE_PAUSE + 1);
  h.pause(true);
  const before = JSON.stringify(h.frame());
  run(h, 5);
  assert.equal(JSON.stringify(h.frame()), before.replace('"play"', '"paused"'));
});

test('the fastest BUGSWARM there could be, every bug shot as it shows, goes on its own table frame by frame', (t) => {
  const { arcade, table, news, tick } = arcadeFor(t);
  t.mock.method(Math, 'random', seeded(11));
  const g = new Bugswarm();
  const s = inside(g);
  g.id = arcade.start('bugswarm', ada);
  let ms = 0;
  while (g.wave <= 10) {
    for (const b of [...s.bugs]) if (b.mode !== 'wait') s.kill(b);
    g.update(0.05);
    tick(50);
    ms += 50;
    assert.equal(arcade.frame(g.id, g.frame(), 'f1'), 'ok', `wave ${g.wave}, ${g.kills} bugs, ${g.score} points`);
  }
  assert.equal(g.kills, 10 * SWARM_SIZE);
  assert.ok(ms / 10 > WAVE_SECONDS * 1000, `${ms / 10} ms a wave`);
  arcade.leave(g.id, 'f1');
  tick(RECORD_EVERY);
  assert.deepEqual(
    table.top('bugswarm').map((e) => [e.game, e.score, e.level]),
    [[g.id, g.score, 11]],
  );
  assert.deepEqual(table.top('blockfall'), []);
  assert.deepEqual(news, [{ title: 'bugswarm', game: g.id }]);
});

test('a forged BUGSWARM score never makes the table', (t) => {
  const { arcade, table, tick } = arcadeFor(t);
  const tries: [string, SwarmFrame[]][] = [
    ['more points than its bugs are worth', [swarm({ kills: 3, score: 3 * MOST_POINTS + 1 })]],
    ['more bugs than the wave has', [swarm({ kills: SWARM_SIZE + 1, score: 100 })]],
    ['a wave on without shooting the last one down', [swarm({ kills: SWARM_SIZE - 1, wave: 2, score: 100 })]],
    ['waves on faster than they fly in', [swarm({ kills: (WAVE_BURST + 1) * SWARM_SIZE, wave: WAVE_BURST + 2, score: 100 })]],
    ['a score going down', [swarm({ kills: 4, score: 200 }), swarm({ kills: 5, score: 150 })]],
    ['a BLOCKFALL frame', [{ title: 'blockfall', cells: '0'.repeat(200), next: 1, hold: 0, score: 10, lines: 0, level: 1, pieces: 1, state: 'play' } as never]],
  ];
  const ids: string[] = [];
  for (const [why, frames] of tries) {
    tick(60_000);
    const id = arcade.start('bugswarm', grace);
    ids.push(id);
    const verdicts = frames.map((f) => arcade.frame(id, f, 'f1'));
    assert.equal(verdicts.at(-1), 'void', why);
  }
  // Right at the bounds, it all adds up.
  tick(60_000);
  const fair = arcade.start('bugswarm', ada);
  assert.equal(arcade.frame(fair, swarm({ kills: WAVE_BURST * SWARM_SIZE, wave: WAVE_BURST + 1, score: WAVE_BURST * SWARM_SIZE * MOST_POINTS }), 'f1'), 'ok');
  tick(WAVE_SECONDS * 1000);
  assert.equal(arcade.frame(fair, swarm({ kills: (WAVE_BURST + 1) * SWARM_SIZE, wave: WAVE_BURST + 2, score: (WAVE_BURST + 1) * SWARM_SIZE * MOST_POINTS }), 'f1'), 'ok');
  for (const id of [...ids, fair]) arcade.leave(id, 'f1');
  tick(RECORD_EVERY);
  assert.deepEqual(
    table.top('bugswarm').map((e) => e.game),
    [fair],
  );
});

test("a game of one can't be carried on as another", (t) => {
  const { arcade } = arcadeFor(t);
  const blocks = arcade.start('blockfall', ada);
  arcade.leave(blocks, 'f1');
  const bugs = arcade.start('bugswarm', ada, blocks);
  assert.notEqual(bugs, blocks);
  arcade.leave(bugs, 'f1');
  // Each carries on as itself.
  assert.equal(arcade.start('blockfall', ada, blocks), blocks);
  assert.equal(arcade.start('bugswarm', ada, bugs), bugs);
  assert.equal(arcade.frame(bugs, swarm({ kills: 1, score: 40 }), 'f1'), 'ok');
});

test('each game has its own high-score table, saved together, and the old file is BLOCKFALL\'s', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-arcade-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // From before there was a choice: one list, of BLOCKFALL games.
  writeFileSync(path.join(dir, 'arcade.json'), JSON.stringify([{ game: 'game00000001', name: 'Ada', color: '#ef476f', score: 900, lines: 12, level: 2, at: 1 }]));
  const table = new HighScores(dir);
  assert.deepEqual(
    table.top('blockfall').map((e) => [e.name, e.score]),
    [['Ada', 900]],
  );
  assert.deepEqual(table.top('bugswarm'), []);
  const r = table.record({ title: 'bugswarm', game: 'game00000002', name: 'Grace', color: '#06d6a0', score: 300, level: 1 });
  assert.equal(r.first?.title, 'bugswarm');
  // A lower BUGSWARM score than BLOCKFALL's best is still first on its own table.
  assert.equal(r.first?.score.game, 'game00000002');
  const saved = JSON.parse(readFileSync(path.join(dir, 'arcade.json'), 'utf8')) as Record<string, { game: string }[]>;
  assert.deepEqual(Object.keys(saved).sort(), [...TITLES].sort());
  const again = new HighScores(dir);
  assert.deepEqual(again.all(), table.all());
  // A table for a game the cabinet doesn't have is left out.
  writeFileSync(path.join(dir, 'arcade.json'), JSON.stringify({ pong: [{ game: 'game00000003', name: 'Eve', color: '#4f86f7', score: 5, level: 1, at: 1 }] }));
  assert.deepEqual(new HighScores(dir).all(), { blockfall: [], bugswarm: [] });
});
