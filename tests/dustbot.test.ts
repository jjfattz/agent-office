import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Arcade, HighScores, RECORD_EVERY, type Player } from '../src/server/cabinet.js';
import { ITEM_BURST, ITEMS_PER_SECOND } from '../src/server/games/dustbot.js';
import { checkFrame } from '../src/shared/cabinet.js';
import {
  BATTERIES,
  BATTERY,
  BED,
  CAT_POINTS,
  CHAIN_MOST,
  CRUMB,
  DONUT,
  DONUTS,
  DONUT_MOST,
  EXIT,
  FLOOR,
  ITEMS,
  MAZE,
  MAZE_COLS,
  MAZE_ROWS,
  MOOD,
  START,
  START_LIVES,
  donutPoints,
  leftOn,
  type MazeFrame,
} from '../src/shared/games/dustbot.js';
import { Dustbot, READY_TIME, open, where } from '../src/client/features/cabinet/dustbot.js';
import { CARTS } from '../src/client/features/cabinet/games.js';

const ada: Player = { owner: 'name:Ada', name: 'Ada', color: '#ef476f' };
const grace: Player = { owner: 'account:grace', name: 'Grace', color: '#06d6a0' };
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const wrap = (x: number) => (x + MAZE_COLS) % MAZE_COLS;

/** Game internals, for a test to reach in. */
type Mover = { x: number; y: number; dir: number; p: number; moving: boolean };
type Cat = Mover & { kind: number; mood: string; scared: boolean; t: number };
type Inside = {
  floor: string[];
  bot: Mover;
  want: number;
  cats: Cat[];
  readyT: number;
  hoover(x: number, y: number): void;
  meet(): void;
  pounced(): void;
};
const inside = (g: Dustbot) => g as unknown as Inside;
/** Plays `g` on for `seconds`, a frame at a time. */
const run = (g: Dustbot, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) g.update(1 / 60);
};
/** Keeps every cat where it starts, for as long as it's left there. */
const park = (g: Dustbot) => inside(g).cats.forEach((c) => (c.t = 1e9));
/** Every crumb and battery on a fresh floor, by tile, in order. */
const ITEM_AT = [...FLOOR].flatMap((ch, i) => (ch === '0' ? [] : [i]));
const hooverNext = (g: Dustbot) => {
  const s = inside(g);
  const i = s.floor.findIndex((ch) => ch !== '0');
  s.hoover(i % MAZE_COLS, Math.floor(i / MAZE_COLS));
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
  const arcade = new Arcade(table, () => {});
  return { table, arcade, tick: (ms: number) => t.mock.timers.tick(ms) };
}

/** A frame of `level` with the first `gone` of its floor's crumbs and batteries hoovered up, scoring `score`. */
function maze(level: number, gone: number, score: number, f: Partial<MazeFrame> = {}): MazeFrame {
  const floor = [...FLOOR];
  for (const i of ITEM_AT.slice(0, gone)) floor[i] = '0';
  return { title: 'dustbot', floor: floor.join(''), bot: [220, 400, 2, 0], cats: [], donut: 0, pops: [], score, eaten: (level - 1) * ITEMS + gone, level, lives: START_LIVES, cue: 0, state: 'play', ...f };
}
/** The most a frame of `level` with `gone` hoovered up can score. */
function most(level: number, gone: number): number {
  const batteries = (level - 1) * BATTERIES + ITEM_AT.slice(0, gone).filter((i) => FLOOR[i] === '2').length;
  return ((level - 1) * ITEMS + gone) * CRUMB + batteries * (BATTERY - CRUMB + CHAIN_MOST) + level * DONUTS * DONUT_MOST;
}

/**
 * A player that heads for the nearest crumb by the shortest way that keeps two tiles clear of any cat
 * that isn't scared, and runs from the nearest cat when there isn't one.
 */
function bot(g: Dustbot) {
  const s = inside(g);
  const b = s.bot;
  const [bx, by] = b.p < 0.5 ? [b.x, b.y] : [wrap(b.x + DX[b.dir]), b.y + DY[b.dir]];
  const cats = s.cats.filter((c) => c.mood !== 'room' && c.mood !== 'home').map((c) => [...where(c), c.scared ? 1 : 0]);
  const danger = new Set<number>();
  for (const [cx, cy, scared] of cats) {
    if (scared) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 2) danger.add((Math.round(cy) + dy) * MAZE_COLS + wrap(Math.round(cx) + dx));
  }
  const from = new Int32Array(MAZE_COLS * MAZE_ROWS).fill(-1);
  const start = by * MAZE_COLS + bx;
  from[start] = start;
  const queue = [start];
  let found = -1;
  for (let q = 0; q < queue.length && found < 0; q++) {
    for (let d = 0; d < 4; d++) {
      const [nx, ny] = [wrap((queue[q] % MAZE_COLS) + DX[d]), Math.floor(queue[q] / MAZE_COLS) + DY[d]];
      const n = ny * MAZE_COLS + nx;
      if (!open(nx, ny) || from[n] >= 0 || danger.has(n)) continue;
      from[n] = queue[q];
      queue.push(n);
      if (s.floor[n] !== '0') found = n;
    }
  }
  let dir = -1;
  if (found >= 0) {
    let n = found;
    while (from[n] !== start) n = from[n];
    dir = [0, 1, 2, 3].find((d) => wrap(bx + DX[d]) === n % MAZE_COLS && by + DY[d] === Math.floor(n / MAZE_COLS)) ?? -1;
  } else {
    let best = -Infinity;
    for (let d = 0; d < 4; d++) {
      if (!open(bx + DX[d], by + DY[d])) continue;
      const far = Math.min(99, ...cats.filter((c) => !c[2]).map(([cx, cy]) => Math.hypot(bx + DX[d] - cx, by + DY[d] - cy)));
      if (far > best) [best, dir] = [far, d];
    }
  }
  if (dir >= 0) g.input(['right', 'down', 'left', 'up'][dir], true);
}

test('every game on the cabinet has its cartridge, DUSTBOT too', () => {
  assert.equal(CARTS.dustbot.title, 'dustbot');
});

test('the office floor is a fair maze: the same both sides, a tile wide, no dead ends, and all one floor', () => {
  for (const row of MAZE) {
    assert.equal(row.length, MAZE_COLS);
    assert.equal(row, [...row].reverse().join(''), `${row} is the same both sides`);
    assert.match(row, /^[#.o P-]+$/);
  }
  const floorAt = (x: number, y: number) => open(x, y);
  assert.ok([...MAZE[0], ...MAZE[MAZE_ROWS - 1]].every((ch) => ch === '#'), 'closed top and bottom');
  const tunnels = MAZE.flatMap((row, y) => (row[0] !== '#' ? [y] : []));
  assert.ok(tunnels.length >= 1);
  for (const y of tunnels) assert.notEqual(MAZE[y][MAZE_COLS - 1], '#', 'a corridor out one side comes back in the other');
  let tiles = 0;
  for (let y = 0; y < MAZE_ROWS; y++) {
    for (let x = 0; x < MAZE_COLS; x++) {
      if (!floorAt(x, y)) continue;
      tiles++;
      const ways = [0, 1, 2, 3].filter((d) => floorAt(x + DX[d], y + DY[d])).length;
      assert.ok(ways >= 2, `a dead end at ${x},${y}`);
      if (x + 1 < MAZE_COLS && y + 1 < MAZE_ROWS) assert.ok(!(floorAt(x + 1, y) && floorAt(x, y + 1) && floorAt(x + 1, y + 1)), `wider than a tile at ${x},${y}`);
    }
  }
  const seen = new Set([START[1] * MAZE_COLS + START[0]]);
  const queue = [...seen];
  for (let q = 0; q < queue.length; q++) {
    for (let d = 0; d < 4; d++) {
      const [nx, ny] = [wrap((queue[q] % MAZE_COLS) + DX[d]), Math.floor(queue[q] / MAZE_COLS) + DY[d]];
      if (floorAt(nx, ny) && !seen.has(ny * MAZE_COLS + nx)) seen.add(ny * MAZE_COLS + nx) && queue.push(ny * MAZE_COLS + nx);
    }
  }
  assert.equal(seen.size, tiles, 'the vacuum can get everywhere');
  // The cats' room: only cats, in and out through the flap, which leads out to where they come out.
  assert.equal(MAZE[BED[1]][BED[0]], 'P');
  assert.equal(MAZE[EXIT[1] - 1][EXIT[0]], '-');
  assert.ok(floorAt(EXIT[0], EXIT[1]) && !floorAt(BED[0], BED[1]) && open(BED[0], BED[1], true));
  // What's on it: a crumb on every bit of floor but where the vacuum starts, and a battery in each corner.
  assert.equal(FLOOR[START[1] * MAZE_COLS + START[0]], '0');
  assert.equal(BATTERIES, 4);
  assert.equal(ITEMS, tiles - 1);
  assert.ok(floorAt(DONUT[0], DONUT[1]));
  assert.deepEqual(leftOn(FLOOR), { items: ITEMS, batteries: BATTERIES });
});

test('a DUSTBOT frame from a browser is checked before anyone else sees it', (t) => {
  t.mock.method(Math, 'random', seeded(3));
  const g = new Dustbot();
  run(g, READY_TIME + 3);
  const f = g.frame();
  assert.ok(f.eaten > 0, 'it has hoovered something up');
  assert.equal(f.cats.length, 16);
  assert.deepEqual(checkFrame(JSON.parse(JSON.stringify(f))), f);
  assert.equal(checkFrame({ ...f, floor: f.floor.slice(1) }), null, 'a tile short');
  assert.equal(checkFrame({ ...f, floor: '3' + f.floor.slice(1) }), null, 'no such thing on the floor');
  assert.equal(checkFrame({ ...f, bot: [1, 2, 3] }), null, 'a vacuum short of a number');
  assert.equal(checkFrame({ ...f, bot: [] }), null, 'no vacuum');
  assert.equal(checkFrame({ ...f, cats: [...f.cats, 1, 10, 10, 0] }), null, 'five cats');
  assert.equal(checkFrame({ ...f, cats: [1, 10, 10, 7] }), null, 'no such mood');
  assert.equal(checkFrame({ ...f, donut: 2 }), null);
  assert.equal(checkFrame({ ...f, cue: 3 }), null);
  assert.deepEqual(leftOn('1' + FLOOR.slice(1)), null, 'a crumb inside a desk');
});

test('the vacuum turns where you steer it as soon as it can, turns straight back, stops at a desk, and goes out one side and in the other', () => {
  const g = new Dustbot();
  const s = inside(g);
  park(g);
  run(g, READY_TIME + 0.05);
  // Along the bottom corridor to the left, steering up: no way up here, but there is one along.
  assert.ok(!open(15, 20) && open(14, 20));
  s.bot = { x: 15, y: 21, dir: 2, p: 0, moving: true };
  g.input('up', true);
  run(g, 0.2);
  assert.equal(s.bot.x, 14);
  assert.equal(s.bot.dir, 3, 'it turned up');
  run(g, 1);
  assert.deepEqual([s.bot.x, s.bot.y, s.bot.moving], [14, 17, false], 'up to the desk, and stopped');
  // Straight back, there and then.
  g.input('left', true);
  run(g, 0.1);
  const [x] = where(s.bot);
  g.input('right', true);
  assert.ok(Math.abs(where(s.bot)[0] - x) < 1e-9, 'it turns where it is');
  assert.equal(s.bot.dir, 0);
  // Out the left side of the floor, in at the right.
  const y = MAZE.findIndex((row) => row[0] !== '#');
  s.bot = { x: 1, y, dir: 2, p: 0, moving: true };
  g.input('left', true);
  run(g, 0.4);
  assert.ok(where(s.bot)[0] > MAZE_COLS - 4, `at ${where(s.bot)[0]}`);
  assert.equal(g.frame().state, 'play');
});

test('crumbs and batteries score, a battery scares the cats, and caught ones run home for more points each in a row', () => {
  const g = new Dustbot();
  const s = inside(g);
  park(g);
  run(g, READY_TIME + 0.05);
  const before = g.score;
  const crumb = ITEM_AT.find((i) => FLOOR[i] === '1')!;
  s.hoover(crumb % MAZE_COLS, Math.floor(crumb / MAZE_COLS));
  assert.equal(g.score - before, CRUMB);
  const battery = ITEM_AT.find((i) => FLOOR[i] === '2')!;
  const score = g.score;
  s.hoover(battery % MAZE_COLS, Math.floor(battery / MAZE_COLS));
  assert.equal(g.score - score, BATTERY);
  const moods = () => g.frame().cats.filter((_, i) => i % 4 === 3);
  assert.ok(s.cats.every((c) => c.scared), 'scared, even the ones in their room');
  // Every cat on the vacuum, one after another.
  const [bx, by] = where(s.bot);
  for (const [n, c] of s.cats.entries()) {
    Object.assign(c, { mood: 'hunt', x: Math.round(bx), y: Math.round(by), p: 0 });
    const was = g.score;
    s.meet();
    assert.equal(g.score - was, CAT_POINTS[n]);
    assert.equal(c.mood, 'home');
  }
  assert.equal(g.lives, START_LIVES);
  assert.ok(moods().every((m) => m === MOOD.home));
  // Home they run, through the flap, and come back out hunting.
  run(g, 4);
  assert.ok(s.cats.every((c) => c.mood === 'room' || c.mood === 'out' || c.mood === 'hunt'));
});

test("a cat that isn't scared pounces: a vacuum gone, everyone back where they started, and the last one ends the game", () => {
  const g = new Dustbot();
  const s = inside(g);
  park(g);
  run(g, READY_TIME + 0.5);
  const pounce = () => {
    const [bx, by] = where(s.bot);
    Object.assign(s.cats[0], { mood: 'hunt', scared: false, x: Math.round(bx), y: Math.round(by), p: 0 });
    s.meet();
  };
  pounce();
  assert.equal(g.lives, START_LIVES - 1);
  assert.ok(g.frame().bot[3] >= 1, 'pounced on');
  run(g, 2);
  assert.deepEqual([s.bot.x, s.bot.y], [...START]);
  assert.equal(g.frame().cue, 1, 'READY');
  park(g);
  while (g.lives > 0) {
    run(g, READY_TIME + 0.1);
    park(g);
    pounce();
  }
  assert.equal(g.state, 'play', 'the pounce plays out first');
  run(g, 2);
  assert.equal(g.state, 'over');
  assert.equal(g.frame().bot[3], 9);
  // A paused game stands still.
  const h = new Dustbot();
  run(h, READY_TIME + 1);
  h.pause(true);
  const before = JSON.stringify(h.frame());
  run(h, 5);
  assert.equal(JSON.stringify(h.frame()), before.replace('"play"', '"paused"'));
});

test('a clean floor flashes, and the next one is put down; a donut turns up now and then', () => {
  const g = new Dustbot();
  const s = inside(g);
  park(g);
  run(g, READY_TIME + 0.05);
  for (let i = 0; i < 70; i++) hooverNext(g);
  assert.equal(g.frame().donut, 1);
  s.bot = { x: DONUT[0], y: DONUT[1], dir: 2, p: 0, moving: false };
  s.want = -1;
  const was = g.score;
  run(g, 0.05);
  assert.equal(g.frame().donut, 0);
  assert.ok(g.score - was >= donutPoints(1));
  while (s.floor.some((ch) => ch !== '0')) hooverNext(g);
  assert.equal(g.eaten, ITEMS);
  assert.equal(g.frame().cue, 2);
  assert.equal(g.level, 1);
  run(g, 2);
  assert.equal(g.level, 2);
  assert.equal(s.floor.join(''), FLOOR);
  assert.equal(g.frame().cue, 1);
  assert.deepEqual([s.bot.x, s.bot.y], [...START]);
});

test('the cats come out through the flap one by one, Snowball naps, and now and then they all get distracted', (t) => {
  t.mock.method(Math, 'random', seeded(7));
  const g = new Dustbot();
  const s = inside(g);
  // Nothing pounces on the vacuum here.
  s.pounced = () => {};
  run(g, READY_TIME + 0.05);
  assert.deepEqual(
    s.cats.map((c) => c.mood),
    ['hunt', 'room', 'room', 'room'],
    'Ginger first',
  );
  run(g, 9);
  assert.ok(s.cats.every((c) => c.mood !== 'room' && c.y >= EXIT[1]), `all out: ${s.cats.map((c) => `${c.mood}@${c.x},${c.y}`).join(' ')}`);
  let napped = false;
  let lull = false;
  for (let i = 0; i < 20 * 20; i++) {
    run(g, 0.05);
    const moods = g.frame().cats.filter((_, k) => k % 4 === 3);
    napped ||= moods[3] === MOOD.nap;
    lull ||= moods.includes(MOOD.lull);
  }
  assert.ok(napped, 'Snowball napped');
  assert.ok(lull, 'they got distracted');
});

test('a bot playing whole games stays on the floor, and the office follows every frame of them', (t) => {
  const { arcade, table, tick } = arcadeFor(t);
  t.mock.method(Math, 'random', seeded(4));
  for (const player of [ada, grace, ada]) {
    const g = new Dustbot();
    g.id = arcade.start('dustbot', player);
    for (let frame = 0; !g.over && frame < 20 * 60 * 10; frame++) {
      for (let i = 0; i < 3; i++) {
        bot(g);
        g.update(1 / 60);
      }
      tick(50);
      const f = g.frame();
      assert.ok(f.bot[1] > 30 && f.bot[1] < 570, `the vacuum at ${f.bot}`);
      assert.deepEqual(checkFrame(JSON.parse(JSON.stringify(f))), f);
      assert.equal(arcade.frame(g.id, f, 'f1'), 'ok', `floor ${g.level}, ${g.eaten} hoovered up, ${g.score} points`);
    }
    assert.ok(g.eaten > 100, `${player.name} hoovered up ${g.eaten}`);
    arcade.leave(g.id, 'f1');
  }
  tick(RECORD_EVERY);
  assert.equal(table.top('dustbot').length, 3);
  // And one cleaned floor after another, at the vacuum's pace, adds up too.
  const g = new Dustbot();
  g.id = arcade.start('dustbot', grace);
  park(g);
  while (g.level < 4) {
    if (inside(g).floor.some((ch) => ch !== '0')) hooverNext(g);
    else run(g, 0.5);
    tick(100);
    assert.equal(arcade.frame(g.id, g.frame(), 'f1'), 'ok', `floor ${g.level}, ${g.eaten} hoovered up`);
  }
  assert.equal(g.eaten, 3 * ITEMS);
});

test('a forged DUSTBOT score never makes the table', (t) => {
  const { arcade, table, tick } = arcadeFor(t);
  /** Game `id` played fairly up to `gone` hoovered up on `level`, at the vacuum's pace: its score then. */
  const play = (id: string, level: number, gone: number) => {
    const total = (level - 1) * ITEMS + gone;
    for (let e = Math.min(50, total); ; e = Math.min(e + 50, total)) {
      tick(5000);
      assert.equal(arcade.frame(id, maze(Math.floor(e / ITEMS) + 1, e % ITEMS, e * CRUMB), 'f1'), 'ok', `${e} hoovered up`);
      if (e === total) return total * CRUMB;
    }
  };
  const tries: [string, (id: string) => MazeFrame][] = [
    ['more points than everything there could have been', () => maze(1, 3, most(1, 3) + 1)],
    ['hoovered up more than is gone from the floor', () => maze(1, 3, 30, { eaten: 4 })],
    ['hoovered up less than is gone from the floor', () => maze(1, 3, 30, { eaten: 2 })],
    ['a crumb inside a desk', () => maze(1, 0, 0, { floor: '1' + FLOOR.slice(1) })],
    ['the next floor without cleaning this one', (id) => maze(2, 0, play(id, 1, ITEMS - 1), { eaten: ITEMS - 1 })],
    ['hoovering faster than the vacuum goes', () => maze(1, ITEM_BURST + 1, 10)],
    ['a score going down', (id) => maze(1, 5, play(id, 1, 4) - 1)],
    ['a floor going back', (id) => maze(1, ITEMS, play(id, 2, 0))],
    ['a BRICKBUST frame', () => ({ title: 'brickbust', wall: '0'.repeat(100), paddle: 220, width: 72, balls: [], drops: [], pops: [], score: 50, kills: 1, level: 1, lives: 3, cue: 0, state: 'play' }) as never],
  ];
  const ids: string[] = [];
  for (const [why, forge] of tries) {
    tick(600_000);
    const id = arcade.start('dustbot', grace);
    ids.push(id);
    assert.equal(arcade.frame(id, forge(id), 'f1'), 'void', why);
  }
  // Right at the bounds, it all adds up.
  tick(600_000);
  const fair = arcade.start('dustbot', ada);
  assert.equal(arcade.frame(fair, maze(1, ITEM_BURST, most(1, ITEM_BURST)), 'f1'), 'ok');
  assert.equal(arcade.frame(fair, maze(1, ITEM_BURST + 1, most(1, ITEM_BURST + 1)), 'f1'), 'void', 'one over the burst');
  const again = arcade.start('dustbot', ada);
  tick((ITEM_BURST / ITEMS_PER_SECOND) * 1000);
  assert.equal(arcade.frame(again, maze(1, ITEM_BURST, 100), 'f1'), 'ok', 'the pace comes back');
  for (const id of [...ids, fair, again]) arcade.leave(id, 'f1');
  tick(RECORD_EVERY);
  assert.deepEqual(
    table.top('dustbot').map((e) => e.game),
    [again],
  );
});
