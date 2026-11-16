import type { PlayState } from '../../../shared/cabinet';
import {
  BRICK_POINTS,
  EXTRA_BALL,
  FIELD_H,
  FIELD_W,
  MAX_BALLS,
  MAX_IN_PLAY,
  START_BALLS,
  WALL_COLS,
  WALL_ROWS,
  wallBonus,
  wallFor,
  type BrickFrame,
  type DropKind,
} from '../../../shared/games/brickbust';
import type { ArcadeSound, CabinetGame } from './cart';

/**
 * BRICKBUST, a game on the arcade cabinet (ui.ts). Launch the ball off your paddle and keep it up:
 * every brick it hits breaks (hard ones take two, steel ones never), and where it lands on the paddle
 * says which way it goes back up. Now and then a brick drops a pill to catch: a wider paddle, a
 * multi-ball, a slower ball or a ball to spare. Knock the whole wall down for a bonus and the next
 * wall goes up, the ball a little quicker. The walls are in shared/games/brickbust.ts; the rules are
 * here; brickbust-paint.ts draws a BrickFrame of it.
 */

/** The game runs in steps this long, whatever the frame rate, so the ball never skips past a brick. */
const STEP = 1 / 240;
/** Where the wall's top-left corner is in the field, and the size of a brick's place in it. */
export const WALL_X = (FIELD_W - WALL_COLS * 40) / 2;
export const WALL_Y = 64;
export const BRICK_W = 40;
export const BRICK_H = 20;
/** Where the paddle's middle is up the field, how thick it is, how wide (and wide once it's caught a WIDE), and how fast it goes. */
export const PADDLE_Y = 556;
export const PADDLE_H = 12;
export const PADDLE_W = 72;
export const WIDE_W = 112;
const PADDLE_SPEED = 500;
export const BALL_R = 6;
/** The most the paddle sends the ball off to either side of straight up (radians), from hitting it at its very end. */
const MAX_ANGLE = (62 * Math.PI) / 180;
/** The flattest the ball ever flies, from straight up or down, so it never runs along the wall for ever. */
const FLATTEST = (70 * Math.PI) / 180;
/** Each paddle hit speeds the ball up this much, to at most CAP times the level's speed. */
const SPEED_UP = 1.02;
const CAP = 1.3;
/** A SLOW pill drops every ball to this much of the level's speed. */
const SLOW = 0.7;
/** How often a brick drops a pill, how fast pills fall, and how many can fall at once. */
const DROP_CHANCE = 0.12;
const DROP_SPEED = 150;
const DROPS_AT_ONCE = 3;
/** How likely each kind of pill is: WIDE, MULTI, SLOW, +BALL. */
const DROP_ODDS: readonly [DropKind, number][] = [
  [1, 3],
  [2, 3],
  [3, 2],
  [4, 1],
];
/** How long "LEVEL n" is up before you can launch the ball. */
export const LEVEL_PAUSE = 1.5;
/** How long the last ball's burst plays before the game's over. */
const LAST_BURST = 1.2;
const POP_LIFE = 0.5;
/**
 * Bounces in a row without breaking a brick (off the paddle too) before the ball's nudged off its
 * line, at its next bounce off steel, a side or the top: so it can't go round the same loop for ever.
 */
const DULL_BOUNCES = 20;

/** The ball's speed (field units a second) on `level`: a little quicker each wall. */
export function speedFor(level: number): number {
  return 320 * Math.min(1.55, 1 + 0.05 * (level - 1));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  /** Bounces since it last broke a brick (see DULL_BOUNCES). */
  dull: number;
}
interface Drop {
  kind: DropKind;
  x: number;
  y: number;
}
interface Pop {
  x: number;
  y: number;
  age: number;
  brick: number;
}

/** Sends `b` off at `angle` from straight up (negative to the left), at its speed: up, or down if `down`. */
function aim(b: Ball, angle: number, down = false) {
  const a = clamp(angle, -FLATTEST, FLATTEST);
  b.vx = b.speed * Math.sin(a);
  b.vy = b.speed * Math.cos(a) * (down ? 1 : -1);
}

/** `b`'s heading turned by `by` radians, kept off the flat. */
function turn(b: Ball, by: number) {
  const up = b.vy < 0;
  const a = Math.atan2(b.vx, Math.abs(b.vy)) + (up ? by : -by);
  aim(b, a, !up);
}

export class Brickbust implements CabinetGame {
  id = '';
  state: PlayState = 'play';
  score = 0;
  kills = 0;
  level = 1;
  lives = START_BALLS;
  version = 0;
  /** What it makes a noise about. */
  onSound?: (kind: ArcadeSound, n?: number) => void;
  private wall: string[] = [...wallFor(1)];
  private balls: Ball[] = [];
  private drops: Drop[] = [];
  private pops: Pop[] = [];
  private paddleX = FIELD_W / 2;
  private wide = false;
  /** The ball's sitting on the paddle, waiting to go. */
  private serving = true;
  /** Seconds "LEVEL n" has left up. */
  private levelT = LEVEL_PAUSE;
  /** Seconds of the last ball's burst left before it's over (0 while there are balls left). */
  private overT = 0;
  private left = false;
  private right = false;
  private acc = 0;

  get over(): boolean {
    return this.state === 'over';
  }

  get started(): boolean {
    return this.kills > 0 || this.lives < START_BALLS;
  }

  private get width(): number {
    return this.wide ? WIDE_W : PADDLE_W;
  }

  input(action: string, down: boolean) {
    if (action === 'left') this.left = down;
    else if (action === 'right') this.right = down;
    else if (action === 'launch' && down) this.launch();
  }

  pause(on: boolean) {
    if (this.over || on === (this.state === 'paused')) return;
    this.state = on ? 'paused' : 'play';
    this.left = this.right = false;
    this.version++;
  }

  update(dt: number) {
    if (this.state !== 'play') return;
    this.acc = Math.min(this.acc + dt, 0.25);
    if (this.acc < STEP) return;
    while (this.acc >= STEP && this.state === 'play') {
      this.acc -= STEP;
      this.step(STEP);
    }
    this.version++;
  }

  frame(): BrickFrame {
    const x = (v: number) => clamp(Math.round(v), -40, FIELD_W + 40);
    const y = (v: number) => clamp(Math.round(v), -40, FIELD_H + 40);
    const balls = this.serving ? [{ x: this.paddleX, y: PADDLE_Y - PADDLE_H / 2 - BALL_R }] : this.balls;
    return {
      title: 'brickbust',
      wall: this.wall.join(''),
      paddle: clamp(Math.round(this.paddleX), 0, FIELD_W),
      width: this.width,
      balls: balls.flatMap((b) => [x(b.x), y(b.y)]),
      drops: this.drops.flatMap((d) => [d.kind, x(d.x), y(d.y)]),
      pops: this.pops.slice(-40).flatMap((p) => [x(p.x), y(p.y), Math.min(9, Math.floor((p.age / POP_LIFE) * 10)), p.brick]),
      score: this.score,
      kills: this.kills,
      level: this.level,
      lives: this.lives,
      cue: this.serving ? (this.levelT > 0 ? 1 : 2) : 0,
      state: this.state,
    };
  }

  /** The ball goes up off the paddle: the way you're moving, or off to one side. */
  private launch() {
    if (!this.serving || this.state !== 'play') return;
    const dir = (this.right ? 1 : 0) - (this.left ? 1 : 0);
    const b: Ball = { x: this.paddleX, y: PADDLE_Y - PADDLE_H / 2 - BALL_R, vx: 0, vy: 0, speed: speedFor(this.level), dull: 0 };
    aim(b, dir ? dir * 0.45 : (Math.random() < 0.5 ? -1 : 1) * (0.2 + Math.random() * 0.2));
    this.balls = [b];
    this.serving = false;
    this.levelT = 0;
    this.onSound?.('bounce');
  }

  private step(dt: number) {
    if (this.levelT > 0) this.levelT -= dt;
    const dir = (this.right ? 1 : 0) - (this.left ? 1 : 0);
    const half = this.width / 2;
    this.paddleX = clamp(this.paddleX + dir * PADDLE_SPEED * dt, half, FIELD_W - half);
    // The last brick of a wall puts the next one up and takes every ball off it.
    for (const b of [...this.balls]) if (!this.serving) this.fly(b, dt);
    this.balls = this.balls.filter((b) => b.y - BALL_R <= FIELD_H);
    this.fall(dt);
    for (const p of this.pops) p.age += dt;
    this.pops = this.pops.filter((p) => p.age < POP_LIFE);
    if (this.overT > 0) {
      this.overT = Math.max(0, this.overT - dt);
      if (!this.overT) this.state = 'over';
    } else if (!this.serving && !this.balls.length) this.lose();
  }

  /** Ball `b` flies on: across, bouncing off the sides and bricks, then up or down, off the top, bricks and the paddle. */
  private fly(b: Ball, dt: number) {
    b.x += b.vx * dt;
    if (b.x < BALL_R || b.x > FIELD_W - BALL_R) {
      b.x = clamp(b.x, BALL_R, FIELD_W - BALL_R);
      b.vx = b.x < FIELD_W / 2 ? Math.abs(b.vx) : -Math.abs(b.vx);
      this.dull(b);
    } else if (this.hitBricks(b)) {
      b.x -= b.vx * dt;
      b.vx = -b.vx;
    }
    if (this.serving) return;
    b.y += b.vy * dt;
    if (b.y < BALL_R) {
      b.y = BALL_R;
      b.vy = Math.abs(b.vy);
      this.dull(b);
    } else if (this.hitBricks(b)) {
      b.y -= b.vy * dt;
      b.vy = -b.vy;
    }
    // The paddle: only from above, so a ball that's got past it stays past it.
    const top = PADDLE_Y - PADDLE_H / 2;
    const half = this.width / 2;
    if (b.vy > 0 && b.y + BALL_R >= top && b.y + BALL_R - b.vy * dt <= top + 1 && Math.abs(b.x - this.paddleX) <= half + BALL_R) {
      b.y = top - BALL_R;
      b.speed = Math.min(b.speed * SPEED_UP, speedFor(this.level) * CAP);
      b.dull++;
      aim(b, clamp((b.x - this.paddleX) / half, -1, 1) * MAX_ANGLE);
      this.onSound?.('bounce');
    }
  }

  /** A bounce off steel, a side or the top: after enough without breaking anything, the ball's nudged off its line. */
  private dull(b: Ball) {
    if (++b.dull < DULL_BOUNCES) return;
    b.dull = 0;
    turn(b, (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.12));
  }

  /** Every brick ball `b` is touching takes a hit. Says whether there were any, for it to bounce off. */
  private hitBricks(b: Ball): boolean {
    const c0 = Math.max(0, Math.floor((b.x - BALL_R - WALL_X) / BRICK_W));
    const c1 = Math.min(WALL_COLS - 1, Math.floor((b.x + BALL_R - WALL_X) / BRICK_W));
    const r0 = Math.max(0, Math.floor((b.y - BALL_R - WALL_Y) / BRICK_H));
    const r1 = Math.min(WALL_ROWS - 1, Math.floor((b.y + BALL_R - WALL_Y) / BRICK_H));
    let hit = false;
    let broke = false;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * WALL_COLS + c;
        if (this.wall[i] === '0') continue;
        // The nearest point of the brick to the ball, to see if it's touching.
        const nx = clamp(b.x, WALL_X + c * BRICK_W, WALL_X + (c + 1) * BRICK_W);
        const ny = clamp(b.y, WALL_Y + r * BRICK_H, WALL_Y + (r + 1) * BRICK_H);
        if ((b.x - nx) ** 2 + (b.y - ny) ** 2 > BALL_R * BALL_R) continue;
        hit = true;
        broke = this.hit(i) || broke;
        if (this.serving) return true;
      }
    }
    if (hit && !broke) this.dull(b);
    else if (broke) b.dull = 0;
    return hit;
  }

  /** Brick `i` takes a hit. Says whether it broke, or cracked. */
  private hit(i: number): boolean {
    const brick = this.wall[i];
    if (brick === '9') {
      this.onSound?.('hurt');
      return false;
    }
    if (brick === '7') {
      this.wall[i] = '8';
      this.onSound?.('hurt');
      return true;
    }
    this.break(i);
    return true;
  }

  /** Brick `i` is knocked down: its points, maybe a pill, and the next wall if it was the last. */
  private break(i: number) {
    const brick = Number(this.wall[i]);
    const x = WALL_X + ((i % WALL_COLS) + 0.5) * BRICK_W;
    const y = WALL_Y + (Math.floor(i / WALL_COLS) + 0.5) * BRICK_H;
    this.wall[i] = '0';
    this.kills++;
    this.add(BRICK_POINTS[brick]);
    this.pops.push({ x, y, age: 0, brick });
    this.onSound?.('brick', brick);
    if (!this.wall.some((ch) => ch >= '1' && ch <= '8')) return this.nextWall();
    if (Math.random() < DROP_CHANCE && this.drops.length < DROPS_AT_ONCE) this.drops.push({ kind: this.pickDrop(), x, y });
  }

  private pickDrop(): DropKind {
    const odds = DROP_ODDS.filter(([k]) => k !== 4 || this.lives < MAX_BALLS);
    let n = Math.random() * odds.reduce((a, [, w]) => a + w, 0);
    for (const [k, w] of odds) if ((n -= w) < 0) return k;
    return odds[0][0];
  }

  /** The wall's down: its bonus, and the next one goes up, with the ball back on the paddle. */
  private nextWall() {
    this.add(wallBonus(this.level));
    this.level++;
    this.wall = [...wallFor(this.level)];
    this.balls = [];
    this.drops = [];
    this.wide = false;
    this.serving = true;
    this.levelT = LEVEL_PAUSE;
    this.onSound?.('clear', 4);
  }

  /** `n` more points, and a ball to spare at every EXTRA_BALL of them. */
  private add(n: number) {
    const before = this.score;
    this.score += n;
    if (Math.floor(this.score / EXTRA_BALL) > Math.floor(before / EXTRA_BALL) && this.lives < MAX_BALLS && this.lives > 0) {
      this.lives++;
      this.onSound?.('wave');
    }
  }

  /** The pills fall, and the paddle catches the ones it's under. */
  private fall(dt: number) {
    const top = PADDLE_Y - PADDLE_H / 2;
    const half = this.width / 2;
    this.drops = this.drops.filter((d) => {
      d.y += DROP_SPEED * dt;
      if (d.y + 6 >= top && d.y - 6 <= PADDLE_Y + PADDLE_H / 2 && Math.abs(d.x - this.paddleX) <= half + 14) {
        this.power(d.kind);
        return false;
      }
      return d.y < FIELD_H + 20;
    });
  }

  /** A pill caught. */
  private power(kind: DropKind) {
    this.onSound?.('power');
    if (kind === 1) {
      this.wide = true;
      this.paddleX = clamp(this.paddleX, WIDE_W / 2, FIELD_W - WIDE_W / 2);
    } else if (kind === 2) {
      // Every ball in play splits in three, as many as there's room for.
      for (const b of [...this.balls]) {
        for (const by of [-0.4, 0.4]) {
          if (this.balls.length >= MAX_IN_PLAY) break;
          const c = { ...b, dull: 0 };
          turn(c, by);
          this.balls.push(c);
        }
      }
    } else if (kind === 3) {
      const slow = speedFor(this.level) * SLOW;
      for (const b of this.balls) {
        if (b.speed <= slow) continue;
        b.vx *= slow / b.speed;
        b.vy *= slow / b.speed;
        b.speed = slow;
      }
    } else this.lives = Math.min(MAX_BALLS, this.lives + 1);
  }

  /** The last ball in play went off the bottom: one fewer, and the next on the paddle, or the game's over. */
  private lose() {
    this.lives--;
    this.pops.push({ x: this.paddleX, y: FIELD_H - 8, age: 0, brick: 0 });
    this.drops = [];
    this.wide = false;
    this.onSound?.('boom');
    if (this.lives > 0) this.serving = true;
    else this.overT = LAST_BURST;
  }
}
