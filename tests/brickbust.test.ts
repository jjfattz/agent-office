import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Arcade, HighScores, RECORD_EVERY, type Player } from '../src/server/cabinet.js';
import { BRICK_BURST, BRICKS_PER_SECOND } from '../src/server/games/brickbust.js';
import { checkFrame } from '../src/shared/cabinet.js';
import {
  BRICK_POINTS,
  EXTRA_BALL,
  MAX_BALLS,
  MAX_IN_PLAY,
  MOST_POINTS,
  START_BALLS,
  WALLS,
  WALL_COLS,
  WALL_ROWS,
  bonusBefore,
  bricksBefore,
  bricksIn,
  standing,
  wallBonus,
  wallFor,
  type BrickFrame,
} from '../src/shared/games/brickbust.js';
import { BALL_R, BRICK_H, BRICK_W, Brickbust, LEVEL_PAUSE, PADDLE_H, PADDLE_W, PADDLE_Y, WALL_X, WALL_Y, WIDE_W, speedFor } from '../src/client/features/cabinet/brickbust.js';
import { CARTS } from '../src/client/features/cabinet/games.js';

const ada: Player = { owner: 'name:Ada', name: 'Ada', color: '#ef476f' };
const grace: Player = { owner: 'account:grace', name: 'Grace', color: '#06d6a0' };

/** Game internals, for a test to reach in. */
type Ball = { x: number; y: number; vx: number; vy: number; speed: number; dull: number };
type Inside = {
  wall: string[];
  balls: Ball[];
  drops: { kind: number; x: number; y: number }[];
  paddleX: number;
  serving: boolean;
  wide: boolean;
  break(i: number): void;
  power(kind: number): void;
};
const inside = (g: Brickbust) => g as unknown as Inside;
/** Plays `g` on for `seconds`, a frame at a time. */
const run = (g: Brickbust, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) g.update(1 / 60);
};
/** The middle of brick `i` in the wall. */
const at = (i: number) => ({ x: WALL_X + ((i % WALL_COLS) + 0.5) * BRICK_W, y: WALL_Y + (Math.floor(i / WALL_COLS) + 0.5) * BRICK_H });
/** A ball at (x, y), flying at (vx, vy). */
const ballAt = (x: number, y: number, vx: number, vy: number): Ball => ({ x, y, vx, vy, speed: Math.hypot(vx, vy), dull: 0 });

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

/** A frame of `level` with `gone` of its bricks knocked down (the first ones), scoring `score`. */
function bricks(level: number, gone: number, score: number, f: Partial<BrickFrame> = {}): BrickFrame {
  const wall = [...wallFor(level)];
  let left = gone;
  for (let i = 0; i < wall.length && left > 0; i++) {
    if (wall[i] >= '1' && wall[i] <= '7') {
      wall[i] = '0';
      left--;
    }
  }
  return { title: 'brickbust', wall: wall.join(''), paddle: 220, width: PADDLE_W, balls: [220, 300], drops: [], pops: [], score, kills: bricksBefore(level) + gone, level, lives: START_BALLS, cue: 0, state: 'play', ...f };
}

/**
 * A player that keeps its paddle under the lowest ball coming down (a little off its middle, more or
 * less, so the ball goes up at an angle), launches as soon as it can, and goes after pills when
 * nothing's coming.
 */
function bot(g: Brickbust, aim: { off: number }) {
  const s = inside(g);
  const coming = s.balls.filter((b) => b.vy > 0).sort((a, b) => b.y - a.y)[0];
  const drop = s.drops.sort((a, b) => b.y - a.y)[0];
  if (!coming) aim.off = 4 + Math.random() * 26;
  const aimAt = coming ? coming.x + (coming.x < 220 ? aim.off : -aim.off) : drop ? drop.x : 220;
  const d = aimAt - s.paddleX;
  g.input('left', d < -4);
  g.input('right', d > 4);
  if (s.serving) g.input('launch', true);
}

test('every game on the cabinet has its cartridge, BRICKBUST too', () => {
  assert.equal(CARTS.brickbust.title, 'brickbust');
});

test("every wall fits, has bricks to knock down, and the ball can get to every one of them", () => {
  for (const [n, rows] of WALLS.entries()) {
    assert.ok(rows.length <= WALL_ROWS, `wall ${n + 1} has ${rows.length} rows`);
    for (const row of rows) assert.match(row, new RegExp(`^[0-79]{${WALL_COLS}}$`), `wall ${n + 1}: ${row}`);
    const wall = wallFor(n + 1);
    assert.equal(wall.length, WALL_COLS * WALL_ROWS);
    assert.ok(bricksIn(n + 1) > 20);
    // Out from every open edge (the top, the sides and below the wall) through everything but steel.
    const reach = new Set<number>();
    const go = (r: number, c: number) => {
      if (r < 0 || c < 0 || c >= WALL_COLS || r >= WALL_ROWS) return;
      const i = r * WALL_COLS + c;
      if (reach.has(i) || wall[i] === '9') return;
      reach.add(i);
      go(r - 1, c);
      go(r + 1, c);
      go(r, c - 1);
      go(r, c + 1);
    };
    for (let c = 0; c < WALL_COLS; c++) {
      go(0, c);
      go(WALL_ROWS - 1, c);
    }
    for (let r = 0; r < WALL_ROWS; r++) {
      go(r, 0);
      go(r, WALL_COLS - 1);
    }
    for (let i = 0; i < wall.length; i++) if (wall[i] !== '0' && wall[i] !== '9') assert.ok(reach.has(i), `wall ${n + 1}: brick ${i} is shut in`);
  }
});

test('the walls come round again harder, with the same bricks to knock down, and the office counts them all', () => {
  const n = WALLS.length;
  for (let level = 1; level <= n; level++) {
    const again = wallFor(level + n);
    const hard = (w: string) => [...w].filter((ch) => ch === '7').length;
    assert.ok(hard(again) > hard(wallFor(level)), `level ${level + n} has more hard bricks`);
    assert.equal(bricksIn(level + n), bricksIn(level));
    assert.equal(standing(again, level + n), bricksIn(level));
  }
  let bricksSoFar = 0;
  let bonusSoFar = 0;
  for (let level = 1; level <= 40; level++) {
    assert.equal(bricksBefore(level), bricksSoFar, `bricks before level ${level}`);
    assert.equal(bonusBefore(level), bonusSoFar, `bonus before level ${level}`);
    bricksSoFar += bricksIn(level);
    bonusSoFar += wallBonus(level);
  }
  // A frame's wall: only bricks its level has, none back once they're gone.
  const wall = wallFor(4);
  const steel = wall.indexOf('9');
  const hard = wall.indexOf('7');
  assert.equal(standing(wall, 4), bricksIn(4));
  assert.equal(standing(wall.slice(0, hard) + '8' + wall.slice(hard + 1), 4), bricksIn(4), 'a hard brick hit once is still up');
  assert.equal(standing(wall.slice(0, hard) + '0' + wall.slice(hard + 1), 4), bricksIn(4) - 1);
  assert.equal(standing(wall.slice(0, steel) + '0' + wall.slice(steel + 1), 4), -1, 'steel never goes');
  assert.equal(standing(wallFor(1), 4), -1, "another level's wall");
});

test('a BRICKBUST frame from a browser is checked before anyone else sees it', (t) => {
  t.mock.method(Math, 'random', seeded(3));
  const g = new Brickbust();
  g.input('launch', true);
  run(g, 1);
  const f = g.frame();
  assert.equal(f.balls.length, 2, 'the ball is up');
  assert.deepEqual(checkFrame(JSON.parse(JSON.stringify(f))), f);
  assert.equal(checkFrame({ ...f, wall: f.wall.slice(1) }), null, 'a brick short');
  assert.equal(checkFrame({ ...f, wall: 'x' + f.wall.slice(1) }), null, 'no such brick');
  assert.equal(checkFrame({ ...f, balls: [...f.balls, 3] }), null, 'a ball short of a number');
  assert.equal(checkFrame({ ...f, balls: new Array(MAX_IN_PLAY + 1).fill([10, 10]).flat() }), null, 'more balls than can be in play');
  assert.equal(checkFrame({ ...f, drops: [9, 10, 10] }), null, 'no such pill');
  assert.equal(checkFrame({ ...f, lives: MAX_BALLS + 1 }), null);
  assert.equal(checkFrame({ ...f, paddle: 0.5 }), null);
  assert.equal(checkFrame({ ...f, cue: 3 }), null);
});

test('the ball waits on the paddle for you to launch it, and comes back off the paddle the way it lands on it', (t) => {
  t.mock.method(Math, 'random', seeded(5));
  const g = new Brickbust();
  const s = inside(g);
  assert.equal(g.frame().cue, 1, 'LEVEL 1 is up');
  run(g, LEVEL_PAUSE + 0.1);
  assert.equal(g.frame().cue, 2, 'waiting for you');
  // It goes along with the paddle.
  g.input('left', true);
  run(g, 0.2);
  g.input('left', false);
  assert.equal(g.frame().balls[0], Math.round(s.paddleX));
  g.input('launch', true);
  assert.equal(s.serving, false);
  assert.equal(g.frame().cue, 0);
  assert.ok(s.balls[0].vy < 0, 'up it goes');
  // Off the paddle's right end it goes up to the right, off its left end up to the left.
  s.wall.fill('0');
  s.wall[0] = '1';
  const top = PADDLE_Y - PADDLE_H / 2;
  for (const side of [-1, 1]) {
    s.balls = [ballAt(s.paddleX + side * (PADDLE_W / 2 - 4), top - BALL_R - 4, 0, 300)];
    run(g, 0.05);
    const b = s.balls[0];
    assert.ok(b.vy < 0, 'back up');
    assert.equal(Math.sign(b.vx), side);
    assert.ok(b.speed > 300, 'a little quicker');
  }
  // A ball past the paddle's end goes on by.
  s.balls = [ballAt(s.paddleX + PADDLE_W, top - BALL_R - 4, 0, 300)];
  run(g, 0.3);
  assert.equal(g.lives, START_BALLS - 1);
});

test('bricks break for their points, hard ones take two hits, and steel never breaks', (t) => {
  t.mock.method(Math, 'random', seeded(7));
  const g = new Brickbust();
  const s = inside(g);
  g.input('launch', true);
  s.wall.fill('0');
  const [color, hard, steel, spare] = [5, 13, 27, 99];
  s.wall[color] = '6';
  s.wall[hard] = '7';
  s.wall[steel] = '9';
  s.wall[spare] = '1';
  /** Sends a ball straight up into brick `i` from under it, and lets it bounce off. */
  const shoot = (i: number) => {
    const { x, y } = at(i);
    s.balls = [ballAt(x, y + BRICK_H / 2 + BALL_R + 3, 0, -300)];
    run(g, 0.05);
    return s.balls[0];
  };
  assert.ok(shoot(color).vy > 0, 'it bounces off');
  assert.equal(s.wall[color], '0');
  assert.equal(g.kills, 1);
  assert.equal(g.score, BRICK_POINTS[6]);
  shoot(hard);
  assert.equal(s.wall[hard], '8', 'cracked');
  assert.equal(g.kills, 1);
  shoot(hard);
  assert.equal(s.wall[hard], '0');
  assert.equal(g.kills, 2);
  assert.equal(g.score, BRICK_POINTS[6] + BRICK_POINTS[7]);
  for (let i = 0; i < 3; i++) assert.ok(shoot(steel).vy > 0);
  assert.equal(s.wall[steel], '9');
  assert.equal(g.kills, 2);
});

test('the last brick of a wall is worth its bonus, and puts up the next wall with the ball back on the paddle', (t) => {
  t.mock.method(Math, 'random', seeded(9));
  const g = new Brickbust();
  const s = inside(g);
  g.input('launch', true);
  run(g, 0.1);
  const last = s.wall.findIndex((ch) => ch !== '0');
  for (let i = 0; i < s.wall.length; i++) if (i !== last && s.wall[i] !== '0') s.break(i);
  assert.equal(g.level, 1);
  const before = g.score;
  s.break(last);
  assert.equal(g.level, 2);
  assert.equal(g.score, before + BRICK_POINTS[Number(wallFor(1)[last])] + wallBonus(1));
  assert.equal(g.kills, bricksIn(1));
  assert.equal(s.wall.join(''), wallFor(2));
  assert.equal(s.serving, true);
  assert.deepEqual(s.drops, []);
  const f = g.frame();
  assert.equal(f.cue, 1, 'LEVEL 2 is up');
  assert.equal(f.balls.length, 2, 'the ball on the paddle');
  // The next wall's ball is quicker.
  g.input('launch', true);
  assert.ok(Math.abs(s.balls[0].speed - speedFor(2)) < 1e-9);
  assert.ok(speedFor(2) > speedFor(1));
});

test('the pills: a wider paddle, three balls, a slower ball and a ball spare', (t) => {
  t.mock.method(Math, 'random', seeded(11));
  const g = new Brickbust();
  const s = inside(g);
  g.input('launch', true);
  run(g, 0.1);
  s.power(1);
  assert.equal(g.frame().width, WIDE_W);
  s.power(2);
  assert.equal(s.balls.length, 3);
  for (const b of s.balls) assert.ok(Math.abs(Math.hypot(b.vx, b.vy) - b.speed) < 1e-6, 'every ball as quick as it was');
  s.power(2);
  assert.equal(s.balls.length, MAX_IN_PLAY);
  for (const b of s.balls) {
    b.speed *= 1.25;
    b.vx *= 1.25;
    b.vy *= 1.25;
  }
  s.power(3);
  for (const b of s.balls) assert.ok(b.speed < speedFor(1));
  s.power(4);
  assert.equal(g.lives, START_BALLS + 1);
  for (let i = 0; i < 5; i++) s.power(4);
  assert.equal(g.lives, MAX_BALLS);
  // A pill falls onto the paddle and is caught; one beside it falls on by.
  s.drops = [{ kind: 1, x: s.paddleX, y: PADDLE_Y - 60 }];
  s.wide = false;
  run(g, 0.5);
  assert.equal(s.wide, true);
  s.drops = [{ kind: 4, x: s.paddleX > 220 ? 20 : 420, y: PADDLE_Y - 60 }];
  run(g, 1);
  assert.deepEqual(s.drops, []);
  // Losing the ball loses the wide paddle.
  s.balls = [];
  run(g, 0.05);
  assert.equal(g.frame().width, PADDLE_W);
});

test('losing the last ball in play costs one, the last one ends the game, and points bring more', (t) => {
  t.mock.method(Math, 'random', seeded(13));
  const g = new Brickbust();
  const s = inside(g);
  const lose = () => {
    g.input('launch', true);
    s.balls = [ballAt(10, 590, 0, 400)];
    run(g, 0.1);
  };
  lose();
  assert.equal(g.lives, START_BALLS - 1);
  assert.equal(s.serving, true);
  assert.equal(g.frame().cue, 2);
  g.input('launch', true);
  g.score = EXTRA_BALL - 10;
  s.break(s.wall.findIndex((ch) => ch === '1'));
  assert.equal(g.lives, START_BALLS, 'an extra ball');
  while (g.lives > 1) lose();
  lose();
  assert.equal(g.lives, 0);
  assert.equal(g.state, 'play', 'the burst plays out first');
  run(g, 2);
  assert.equal(g.state, 'over');
  assert.equal(g.frame().balls.length, 0);
  // A paused game stands still.
  const h = new Brickbust();
  h.input('launch', true);
  run(h, 0.5);
  h.pause(true);
  const before = JSON.stringify(h.frame());
  run(h, 5);
  assert.equal(JSON.stringify(h.frame()), before.replace('"play"', '"paused"'));
});

test('a bot playing whole games stays in the field, and the office follows every frame of them', (t) => {
  const { arcade, table, tick } = arcadeFor(t);
  t.mock.method(Math, 'random', seeded(17));
  let best = 0;
  for (const player of [ada, grace]) {
    const g = new Brickbust();
    g.onSound = () => {};
    g.id = arcade.start('brickbust', player);
    const aim = { off: 14 };
    for (let frame = 0; !g.over && frame < 20 * 60 * 6; frame++) {
      for (let i = 0; i < 3; i++) {
        bot(g, aim);
        g.update(1 / 60);
      }
      tick(50);
      const f = g.frame();
      for (let i = 0; i < f.balls.length; i += 2) assert.ok(f.balls[i] >= BALL_R - 1 && f.balls[i] <= 440 - BALL_R + 1, `ball at ${f.balls[i]}`);
      assert.deepEqual(checkFrame(JSON.parse(JSON.stringify(f))), f);
      assert.equal(arcade.frame(g.id, f, 'f1'), 'ok', `level ${g.level}, ${g.kills} bricks, ${g.score} points`);
    }
    best = Math.max(best, g.level);
    arcade.leave(g.id, 'f1');
    assert.ok(g.kills > 20, `${player.name} knocked down ${g.kills}`);
  }
  assert.ok(best >= 2, `got to level ${best}`);
  tick(RECORD_EVERY);
  assert.equal(table.top('brickbust').length, 2);
});

test('a forged BRICKBUST score never makes the table', (t) => {
  const { arcade, table, tick } = arcadeFor(t);
  const tries: [string, BrickFrame[]][] = [
    ['more points than its bricks are worth', [bricks(1, 3, 3 * MOST_POINTS + 1)]],
    ['bricks gone that it never counted', [bricks(1, 3, 100, { kills: 2 })]],
    ['bricks counted that are still up', [bricks(1, 3, 100, { kills: 4 })]],
    ['a brick that was never in the wall', [bricks(1, 0, 0, { wall: '1' + wallFor(1).slice(1) })]],
    ['a level on without knocking the wall down', [bricks(2, 0, 100, { kills: bricksIn(1) - 1 })]],
    ['bricks down faster than a ball knocks them', [bricks(1 + Math.ceil(BRICK_BURST / bricksIn(1)) + 1, 0, 100)]],
    ['a score going down', [bricks(1, 4, 200), bricks(1, 5, 150)]],
    ['a level going back', [bricks(2, 0, wallBonus(1), { kills: bricksIn(1) }), bricks(1, bricksIn(1), wallBonus(1))]],
    ['a BUGSWARM frame', [{ title: 'bugswarm', ship: 220, bugs: [], shots: [], stings: [], pops: [], score: 40, kills: 1, wave: 1, ships: 3, state: 'play' } as never]],
  ];
  const ids: string[] = [];
  for (const [why, frames] of tries) {
    tick(600_000);
    const id = arcade.start('brickbust', grace);
    ids.push(id);
    const verdicts = frames.map((f) => arcade.frame(id, f, 'f1'));
    assert.equal(verdicts.at(-1), 'void', why);
    assert.ok(verdicts.slice(0, -1).every((v) => v === 'ok'), `${why}: the frames before it add up`);
  }
  // Right at the bounds, it all adds up: a burst's worth of bricks, every one at the most a brick's worth.
  tick(600_000);
  const fair = arcade.start('brickbust', ada);
  let level = 1;
  while (bricksBefore(level + 1) <= BRICK_BURST) level++;
  const gone = BRICK_BURST - bricksBefore(level);
  assert.equal(arcade.frame(fair, bricks(level, gone, BRICK_BURST * MOST_POINTS + bonusBefore(level)), 'f1'), 'ok');
  assert.equal(arcade.frame(fair, bricks(level, gone + 1, (BRICK_BURST + 1) * MOST_POINTS + bonusBefore(level)), 'f1'), 'void', 'one brick over the burst');
  const again = arcade.start('brickbust', ada);
  tick((BRICK_BURST / BRICKS_PER_SECOND) * 1000);
  assert.equal(arcade.frame(again, bricks(level, gone, 100), 'f1'), 'ok', 'the pace comes back');
  for (const id of [...ids, fair, again]) arcade.leave(id, 'f1');
  tick(RECORD_EVERY);
  assert.deepEqual(
    table.top('brickbust').map((e) => e.game),
    [again],
  );
});
