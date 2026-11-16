import type { PlayState } from '../../../shared/cabinet';
import {
  BATTERY,
  BED,
  CAT_POINTS,
  CRUMB,
  DONUT,
  EXIT,
  EXTRA_LIFE,
  FIELD_H,
  FIELD_W,
  FLOOR,
  ITEMS,
  MAX_LIVES,
  MAZE,
  MAZE_COLS,
  MAZE_ROWS,
  MAZE_X,
  MAZE_Y,
  MOOD,
  START,
  START_LIVES,
  TILE,
  donutPoints,
  type MazeFrame,
} from '../../../shared/games/dustbot';
import type { ArcadeSound, CabinetGame } from './cart';

/**
 * DUSTBOT, a game on the arcade cabinet (ui.ts). You're the office's robot vacuum, steering round a
 * floor of desks to hoover up every crumb, while the office cats hunt you: Ginger walks the shortest
 * way to you, Smoke heads you off, Patch keeps to its corner until you come near, and Snowball naps
 * between dashes. Every so often they all get distracted and wander for a moment. A battery in each
 * corner makes the vacuum roar: the cats scatter, slow and scared, and any you catch runs back to its
 * bed for points, more for each in a row. Clean the floor and the next one's quicker. The maze is in
 * shared/games/dustbot.ts; the rules are here; dustbot-paint.ts draws a MazeFrame of it.
 */

/** The game runs in steps this long, whatever the frame rate, so nobody slips past anybody. */
const STEP = 1 / 120;
/** Right, down, left, up. */
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const back = (d: number) => (d + 2) % 4;
/** Tiles a second on the first level: the vacuum, and the cats hunting; scared cats go this much of that, and caught ones run home at HOME_SPEED. */
const BOT_SPEED = 7.5;
const CAT_SPEED = 6.5;
const SCARED = 0.55;
const HOME_SPEED = 15;
/** How long READY is up, how long a clean floor flashes, and how long a pounce takes. */
export const READY_TIME = 2;
const CLEAR_TIME = 1.6;
const POUNCE_TIME = 1.6;
/** After READY, when each cat comes out of its room. */
const RELEASE = [0, 2.5, 5, 7.5];
/** The cats hunt this long, then are distracted for LULL (shorter each level). */
const HUNT_TIME = 15;
const LULL = 5;
/** Snowball hunts this long, then naps this long. */
const HUNT_SPELL = 5;
const NAP_SPELL = 2.5;
/** Patch comes after you within this many tiles' walk, and otherwise keeps to its corner. */
const GUARD_RANGE = 8;
const GUARD_CORNER: readonly [number, number] = [1, 25];
/** Smoke heads for this many tiles ahead of you. */
const CUT_AHEAD = 4;
/** A cat and the vacuum this near, in tiles, meet. */
const MEET = 0.6;
/** A scared cat is calming down for this long at the end of it (and flashes). */
export const CALMING = 2;
/** How long a donut stays out, and how much of a floor has to be gone for each to turn up. */
const DONUT_TIME = 9;
const DONUT_AFTER = [70, 170];
const POP_TIME = 1;
/** Where each cat starts a life: Ginger at the cat flap, the others in their room. */
const CAT_START: readonly (readonly [number, number])[] = [EXIT, [9, 2], BED, [11, 2]];

export function botSpeed(level: number): number {
  return BOT_SPEED * Math.min(1.25, 1 + 0.03 * (level - 1));
}
export function catSpeed(level: number): number {
  return CAT_SPEED * Math.min(1.4, 1 + 0.05 * (level - 1));
}
/** How long the cats are distracted, on `level`. */
export function lullFor(level: number): number {
  return Math.max(2, LULL - 0.3 * (level - 1));
}
/** How long a battery scares the cats, on `level`. */
export function scaredFor(level: number): number {
  return Math.max(CALMING, 7 - 0.5 * (level - 1));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wrap = (x: number) => (x + MAZE_COLS) % MAZE_COLS;
const tileAt = (x: number, y: number) => (y >= 0 && y < MAZE_ROWS ? MAZE[y][wrap(x)] : '#');
/** Whether tile (x, y) is floor: for the vacuum, or a cat; one going in or out of its room (`room`) can use that too. */
export function open(x: number, y: number, room = false): boolean {
  const ch = tileAt(x, y);
  return ch !== '#' && (room || (ch !== 'P' && ch !== '-'));
}

/** Something going round the maze: on tile (x, y), `p` of the way to the next tile its way (`dir`). */
interface Mover {
  x: number;
  y: number;
  dir: number;
  p: number;
  moving: boolean;
}
type Mood = 'room' | 'out' | 'hunt' | 'nap' | 'home';
interface Cat extends Mover {
  kind: 1 | 2 | 3 | 4;
  mood: Mood;
  scared: boolean;
  /** Seconds until it comes out of its room, naps, or wakes. */
  t: number;
}
interface Pop {
  x: number;
  y: number;
  points: number;
  age: number;
}

/** Where `m` is, in tiles: the middle of tile (0, 0) is (0, 0). */
export function where(m: Mover): [number, number] {
  return [m.x + DX[m.dir] * m.p, m.y + DY[m.dir] * m.p];
}

/** `m` goes `dist` tiles on, `arrive` choosing its way each time it gets to the middle of a tile. */
function travel(m: Mover, dist: number, arrive: (m: Mover) => void) {
  while (dist > 1e-9) {
    if (m.p === 0) {
      arrive(m);
      if (!m.moving) return;
    }
    const go = Math.min(dist, 1 - m.p);
    m.p += go;
    dist -= go;
    if (m.p >= 1 - 1e-9) {
      m.x = wrap(m.x + DX[m.dir]);
      m.y += DY[m.dir];
      m.p = 0;
    }
  }
}

/** `m` turns round where it is. */
function turnBack(m: Mover) {
  if (m.p > 0) {
    m.x = wrap(m.x + DX[m.dir]);
    m.y += DY[m.dir];
    m.p = 1 - m.p;
  }
  m.dir = back(m.dir);
}

export class Dustbot implements CabinetGame {
  id = '';
  state: PlayState = 'play';
  score = 0;
  eaten = 0;
  level = 1;
  lives = START_LIVES;
  version = 0;
  /** What it makes a noise about. */
  onSound?: (kind: ArcadeSound, n?: number) => void;
  private floor = [...FLOOR];
  /** Crumbs and batteries hoovered up off this floor. */
  private ate = 0;
  private bot: Mover = { x: START[0], y: START[1], dir: 2, p: 0, moving: false };
  /** The way you last steered: it turns that way as soon as it can. */
  private want = -1;
  private cats: Cat[] = [];
  private pops: Pop[] = [];
  private readyT = READY_TIME;
  private clearT = 0;
  private pounceT = 0;
  private scaredT = 0;
  /** Cats caught on this battery so far. */
  private chain = 0;
  private donutT = 0;
  /** Seconds until the cats are distracted, and (while they are) until they're over it. */
  private huntT = HUNT_TIME;
  private lullT = 0;
  private acc = 0;
  /** Shortest walks to a tile, by the tile (and whether through the cats' room). */
  private walks = new Map<number, Int16Array>();

  constructor() {
    this.newLife();
  }

  get over(): boolean {
    return this.state === 'over';
  }

  get started(): boolean {
    return this.eaten > 0 || this.lives < START_LIVES;
  }

  input(action: string, down: boolean) {
    const d = ['right', 'down', 'left', 'up'].indexOf(action);
    if (!down || d < 0 || this.state !== 'play') return;
    this.want = d;
    // Straight back the way it came, there and then.
    const b = this.bot;
    if (b.moving && d === back(b.dir) && !this.frozen) turnBack(b);
  }

  pause(on: boolean) {
    if (this.over || on === (this.state === 'paused')) return;
    this.state = on ? 'paused' : 'play';
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

  frame(): MazeFrame {
    const px = (x: number) => clamp(Math.round(MAZE_X + (x + 0.5) * TILE), -40, FIELD_W + 40);
    const py = (y: number) => clamp(Math.round(MAZE_Y + (y + 0.5) * TILE), -40, FIELD_H + 40);
    const [bx, by] = where(this.bot);
    const pounce = this.over ? 9 : this.pounceT > 0 ? clamp(1 + Math.floor((1 - this.pounceT / POUNCE_TIME) * 9), 1, 9) : 0;
    const cats: number[] = [];
    for (const c of this.cats) {
      const [cx, cy] = where(c);
      cats.push(c.kind, px(cx), py(cy), this.mood(c));
    }
    return {
      title: 'dustbot',
      floor: this.floor.join(''),
      bot: [px(bx), py(by), this.bot.dir, pounce],
      cats,
      donut: this.donutT > 0 ? 1 : 0,
      pops: this.pops.slice(-8).flatMap((p) => [px(p.x), py(p.y), p.points]),
      score: this.score,
      eaten: this.eaten,
      level: this.level,
      lives: this.lives,
      cue: this.readyT > 0 ? 1 : this.clearT > 0 ? 2 : 0,
      state: this.state,
    };
  }

  /** Waiting on READY, a clean floor or a pounce: nothing moves. */
  private get frozen(): boolean {
    return this.readyT > 0 || this.clearT > 0 || this.pounceT > 0;
  }

  private mood(c: Cat): number {
    if (c.mood === 'room') return MOOD.room;
    if (c.mood === 'home') return MOOD.home;
    if (c.scared) return this.scaredT < CALMING ? MOOD.calming : MOOD.scared;
    if (c.mood === 'nap') return MOOD.nap;
    return c.mood === 'hunt' && this.lullT > 0 ? MOOD.lull : MOOD.hunt;
  }

  /** Everyone back where they start, and READY. */
  private newLife() {
    this.bot = { x: START[0], y: START[1], dir: 2, p: 0, moving: false };
    this.want = -1;
    this.cats = CAT_START.map(([x, y], i) => ({ kind: (i + 1) as Cat['kind'], x, y, dir: 3, p: 0, moving: false, mood: 'room' as Mood, scared: false, t: RELEASE[i] }));
    this.scaredT = 0;
    this.donutT = 0;
    this.huntT = HUNT_TIME;
    this.lullT = 0;
    this.readyT = READY_TIME;
  }

  private step(dt: number) {
    for (const p of this.pops) p.age += dt;
    this.pops = this.pops.filter((p) => p.age < POP_TIME);
    if (this.pounceT > 0) {
      if ((this.pounceT -= dt) <= 0) {
        this.pounceT = 0;
        if (this.lives > 0) this.newLife();
        else this.state = 'over';
      }
      return;
    }
    if (this.clearT > 0) {
      if ((this.clearT -= dt) <= 0) this.nextFloor();
      return;
    }
    if (this.readyT > 0) {
      this.readyT -= dt;
      return;
    }
    if (this.scaredT > 0 && (this.scaredT -= dt) <= 0) for (const c of this.cats) c.scared = false;
    if (this.donutT > 0) this.donutT -= dt;
    if (this.lullT > 0) this.lullT = Math.max(0, this.lullT - dt);
    else if ((this.huntT -= dt) <= 0) {
      this.lullT = lullFor(this.level);
      this.huntT = HUNT_TIME;
    }
    travel(this.bot, botSpeed(this.level) * dt, this.steer);
    if (this.clearT > 0) return;
    const [bx, by] = where(this.bot);
    if (this.donutT > 0 && Math.hypot(bx - DONUT[0], by - DONUT[1]) < 0.5) {
      this.donutT = 0;
      this.add(donutPoints(this.level));
      this.pops.push({ x: DONUT[0], y: DONUT[1], points: donutPoints(this.level), age: 0 });
      this.onSound?.('pop');
    }
    for (const c of this.cats) this.prowl(c, dt);
    this.meet();
  }

  /** The vacuum's at the middle of a tile: it hoovers it, and turns the way you steered if it can. */
  private steer = (b: Mover) => {
    this.hoover(b.x, b.y);
    if (this.clearT > 0) b.moving = false;
    else if (this.want >= 0 && open(b.x + DX[this.want], b.y + DY[this.want])) {
      b.dir = this.want;
      b.moving = true;
    } else b.moving = open(b.x + DX[b.dir], b.y + DY[b.dir]);
  };

  /** Whatever's on tile (x, y) goes in the vacuum. */
  private hoover(x: number, y: number) {
    const i = y * MAZE_COLS + x;
    const ch = this.floor[i];
    if (ch === '0' || ch === undefined) return;
    this.floor[i] = '0';
    this.eaten++;
    this.ate++;
    if (ch === '2') {
      this.add(BATTERY);
      this.scare();
      this.onSound?.('power');
    } else {
      this.add(CRUMB);
      this.onSound?.('crumb');
    }
    if (DONUT_AFTER.includes(this.ate)) this.donutT = DONUT_TIME;
    if (this.ate === ITEMS) {
      this.clearT = CLEAR_TIME;
      this.onSound?.('clear', 4);
    }
  }

  /** A battery: every cat not on its way home is scared, and turns tail. */
  private scare() {
    this.scaredT = scaredFor(this.level);
    this.chain = 0;
    for (const c of this.cats) {
      if (c.mood === 'home') continue;
      c.scared = true;
      if (c.mood === 'nap') {
        c.mood = 'hunt';
        c.moving = true;
      } else if (c.mood === 'hunt' && c.moving) turnBack(c);
    }
  }

  private nextFloor() {
    this.clearT = 0;
    this.level++;
    this.floor = [...FLOOR];
    this.ate = 0;
    this.newLife();
    this.onSound?.('wave');
  }

  /** `n` more points, and a vacuum to spare at every EXTRA_LIFE of them. */
  private add(n: number) {
    const before = this.score;
    this.score += n;
    if (Math.floor(this.score / EXTRA_LIFE) > Math.floor(before / EXTRA_LIFE) && this.lives < MAX_LIVES) {
      this.lives++;
      this.onSound?.('wave');
    }
  }

  /** Cat `c` gets on with whatever it's up to. */
  private prowl(c: Cat, dt: number) {
    // Up and off (out of its room, or from a nap) any way at all, back the way it faced too.
    if (c.mood === 'room') {
      if ((c.t -= dt) > 0) return;
      c.mood = 'out';
      c.moving = false;
    } else if (c.mood === 'nap') {
      if ((c.t -= dt) > 0) return;
      c.mood = 'hunt';
      c.t = HUNT_SPELL;
      c.moving = false;
    } else if (c.mood === 'hunt' && c.kind === 4 && !c.scared && (c.t -= dt) <= 0) {
      c.mood = 'nap';
      c.t = NAP_SPELL;
    }
    const speed = c.mood === 'home' ? HOME_SPEED : catSpeed(this.level) * (c.scared ? SCARED : c.mood === 'out' ? 0.6 : 1);
    travel(c, speed * dt, this.choose);
  }

  /** A cat's at the middle of a tile: which way now. Never straight back, unless it's that or nothing. */
  private choose = (m: Mover) => {
    const c = m as Cat;
    if (c.mood === 'out' && c.x === EXIT[0] && c.y === EXIT[1]) {
      c.mood = 'hunt';
      c.t = HUNT_SPELL;
    } else if (c.mood === 'home' && c.x === BED[0] && c.y === BED[1]) {
      // Home: a moment on its bed, and back out.
      c.mood = 'room';
      c.t = 1;
    }
    if (c.mood === 'room' || c.mood === 'nap') {
      c.moving = false;
      return;
    }
    const room = c.mood === 'out' || c.mood === 'home';
    const ways = [3, 2, 1, 0].filter((d) => open(c.x + DX[d], c.y + DY[d], room));
    const ahead = ways.filter((d) => d !== back(c.dir) || !c.moving);
    const options = ahead.length ? ahead : ways;
    if (!options.length) return void (c.moving = false);
    c.moving = true;
    if (c.mood === 'hunt' && (c.scared || this.lullT > 0)) {
      c.dir = options[Math.floor(Math.random() * options.length)];
      return;
    }
    const [gx, gy, by] = this.goal(c);
    const walk = by === 'walk' ? this.walk(gx, gy, room) : null;
    let best = Infinity;
    for (const d of options) {
      const [nx, ny] = [wrap(c.x + DX[d]), c.y + DY[d]];
      const far = walk ? (walk[ny * MAZE_COLS + nx] < 0 ? 9999 : walk[ny * MAZE_COLS + nx]) : Math.hypot(nx - gx, ny - gy);
      if (far < best) {
        best = far;
        c.dir = d;
      }
    }
  };

  /** Where cat `c` is making for, and whether it walks the maze there or heads straight for it as the crow flies. */
  private goal(c: Cat): [number, number, 'walk' | 'line'] {
    if (c.mood === 'out') return [EXIT[0], EXIT[1], 'walk'];
    if (c.mood === 'home') return [BED[0], BED[1], 'walk'];
    const b = this.bot;
    const [bx, by] = b.p < 0.5 ? [b.x, b.y] : [wrap(b.x + DX[b.dir]), b.y + DY[b.dir]];
    if (c.kind === 2) return [bx + DX[b.dir] * CUT_AHEAD, by + DY[b.dir] * CUT_AHEAD, 'line'];
    if (c.kind === 3 && this.walk(bx, by, false)[c.y * MAZE_COLS + c.x] > GUARD_RANGE) return [GUARD_CORNER[0], GUARD_CORNER[1], 'line'];
    return [bx, by, c.kind === 1 || c.kind === 3 ? 'walk' : 'line'];
  }

  /** How many tiles' walk every tile is from (x, y), through the cats' room or not (-1 for no way). */
  private walk(x: number, y: number, room: boolean): Int16Array {
    const key = (y * MAZE_COLS + x) * 2 + (room ? 1 : 0);
    const known = this.walks.get(key);
    if (known) return known;
    const far = new Int16Array(MAZE_COLS * MAZE_ROWS).fill(-1);
    far[y * MAZE_COLS + x] = 0;
    const queue = [y * MAZE_COLS + x];
    for (let q = 0; q < queue.length; q++) {
      const [tx, ty] = [queue[q] % MAZE_COLS, Math.floor(queue[q] / MAZE_COLS)];
      for (let d = 0; d < 4; d++) {
        const [nx, ny] = [wrap(tx + DX[d]), ty + DY[d]];
        const i = ny * MAZE_COLS + nx;
        if (!open(nx, ny, room) || far[i] >= 0) continue;
        far[i] = far[queue[q]] + 1;
        queue.push(i);
      }
    }
    if (this.walks.size > 64) this.walks.clear();
    this.walks.set(key, far);
    return far;
  }

  /** The vacuum and any cat it's run into: a scared one's caught, any other pounces. */
  private meet() {
    const [bx, by] = where(this.bot);
    for (const c of this.cats) {
      if (c.mood === 'room' || c.mood === 'home') continue;
      const [cx, cy] = where(c);
      const dx = Math.abs(bx - cx);
      if (Math.hypot(Math.min(dx, MAZE_COLS - dx), by - cy) >= MEET) continue;
      if (c.scared) this.caught(c, cx, cy);
      else return this.pounced();
    }
  }

  private caught(c: Cat, x: number, y: number) {
    const points = CAT_POINTS[Math.min(this.chain++, CAT_POINTS.length - 1)];
    this.add(points);
    this.pops.push({ x, y, points, age: 0 });
    c.mood = 'home';
    c.scared = false;
    this.onSound?.('meow');
  }

  private pounced() {
    this.lives--;
    this.pounceT = POUNCE_TIME;
    this.bot.moving = false;
    this.onSound?.('boom');
  }
}
