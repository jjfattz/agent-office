import type { PlayState } from '../../../shared/cabinet';
import { BUG_POINTS, EXTRA_SHIP, FIELD_H, FIELD_W, MAX_SHIPS, START_SHIPS, type BugKind, type SwarmFrame } from '../../../shared/games/bugswarm';
import type { ArcadeSound, CabinetGame } from './cart';

/**
 * BUGSWARM, a game on the arcade cabinet (ui.ts). A wave of bugs flies in a few at a time along
 * looping paths, settles into rows swaying over the field, and dives at your ship in ones and twos,
 * stinging as it comes. Shoot every one down and the next wave comes in, a little quicker. The rules
 * are here; bugswarm-paint.ts draws a SwarmFrame of it.
 */

/** The game runs in steps this long, whatever the frame rate, so a shot never skips past a bug. */
const STEP = 1 / 120;
/** Where the ship flies, how fast (field units a second), and how near the edges it gets. */
export const SHIP_Y = 548;
const SHIP_SPEED = 300;
const SHIP_EDGE = 22;
/** Your shots: how fast they go, how many can be up at once, and how often holding fire shoots. */
const SHOT_SPEED = 720;
const SHOTS = 2;
const FIRE_EVERY = 0.18;
/** The bugs' stings: how fast, and how many can be in the air at once. */
const STING_SPEED = 230;
const STINGS = 24;
/** How long "WAVE n" is up before each wave flies in (the first one too), in seconds. */
export const WAVE_PAUSE = 2.5;
/**
 * A wave flies in a group at a time, GROUP_GAP apart, each bug of a group FOLLOW_GAP behind the one
 * before. With WAVE_PAUSE, that's the shortest a wave can last, which the office counts on (see
 * WAVE_SECONDS in server/games/bugswarm.ts).
 */
export const GROUP_GAP = 0.9;
export const FOLLOW_GAP = 0.14;
/** How fast bugs fly in and dive (field units a second) on the first wave; later waves are quicker. */
const ENTRY_SPEED = 270;
const DIVE_SPEED = 220;
/** A ship that's blown up comes back after this long, once nothing's diving. */
const RESPAWN = 2;
const POP_LIFE = 0.6;
/** How long the last ship's burst plays before the game's over. */
const LAST_BURST = 1.4;
/** How near a shot (or your ship) has to come to a bug to hit it, by kind. */
const REACH: Record<BugKind, number> = { 1: 12, 2: 13, 3: 16 };

/** The swarm, row by row from the top: which bug, and how many across. */
export const ROWS: readonly { kind: BugKind; n: number }[] = [
  { kind: 3, n: 4 },
  { kind: 2, n: 8 },
  { kind: 1, n: 12 },
  { kind: 1, n: 12 },
];
const GAP_X = 30;
const GAP_Y = 34;
const TOP = 86;
/** How far the swarm sways either side, and how long one sway takes, in seconds. */
const SWAY = 22;
const SWAY_TIME = 6;

/** Who flies in together, in the order they come: runs of the swarm, [row, first column, last column]. */
export const GROUPS: readonly (readonly (readonly [number, number, number])[])[] = [
  [[2, 3, 8]],
  [[3, 3, 8]],
  [
    [0, 0, 3],
    [1, 3, 4],
  ],
  [
    [1, 0, 2],
    [1, 5, 7],
  ],
  [
    [2, 0, 2],
    [2, 9, 11],
  ],
  [
    [3, 0, 2],
    [3, 9, 11],
  ],
];

type Point = readonly [number, number];

/** The ways a group flies in from the left, through these points and then up to its places. A group from the right flies the mirror of one. */
const ENTRIES: readonly Point[][] = [
  // Down from the top, round a loop low over the field, and up.
  [
    [160, -30],
    [160, 110],
    [80, 250],
    [150, 380],
    [280, 340],
    [260, 220],
  ],
  // In low from the side, across, and up round a curl.
  [
    [-30, 460],
    [110, 430],
    [240, 340],
    [220, 230],
    [120, 220],
    [110, 300],
    [190, 330],
  ],
];

/** A smooth path, as short straight pieces: the points one after another (x, y), and how far along each is. */
interface Path {
  pts: number[];
  at: number[];
  length: number;
}

const cr = (a: number, b: number, c: number, d: number, t: number) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);

/** The smooth path through `ctrl` (a Catmull-Rom spline). */
function spline(ctrl: readonly Point[]): Path {
  const pts: number[] = [];
  const p = (i: number) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const [a, b, c, d] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    for (let k = 0; k < 12; k++) pts.push(cr(a[0], b[0], c[0], d[0], k / 12), cr(a[1], b[1], c[1], d[1], k / 12));
  }
  pts.push(...ctrl[ctrl.length - 1]);
  const at = [0];
  for (let i = 2; i < pts.length; i += 2) at.push(at[at.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
  return { pts, at, length: at[at.length - 1] };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** `from` turned toward `to` (radians) by at most `most`, the short way round. */
function turn(from: number, to: number, most: number): number {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + clamp(d, -most, most);
}
const DOWN = Math.PI / 2;

interface Bug {
  kind: BugKind;
  hp: number;
  /** Its place in the swarm. */
  row: number;
  col: number;
  x: number;
  y: number;
  /** The way it's heading, in radians (DOWN is straight down, at you). */
  heading: number;
  /** Waiting to fly in, flying in, heading for its place, in its place, or diving at you. */
  mode: 'wait' | 'enter' | 'home' | 'swarm' | 'dive';
  /** What it's flying along, flying in or diving, how far along it's got, and which piece of it it's on. */
  path: Path | null;
  along: number;
  piece: number;
  /** Seconds until it flies in. */
  delay: number;
  /** How far along its path it stings, the next first. */
  stings: number[];
  /** Field units a second. */
  speed: number;
}

interface Shot {
  x: number;
  y: number;
}
interface Sting extends Shot {
  vx: number;
  vy: number;
}
interface Pop extends Shot {
  age: number;
  kind: 1 | 2;
}

export class Bugswarm implements CabinetGame {
  id = '';
  state: PlayState = 'play';
  score = 0;
  kills = 0;
  wave = 1;
  ships = START_SHIPS;
  version = 0;
  /** What it makes a noise about. */
  onSound?: (kind: ArcadeSound) => void;
  private bugs: Bug[] = [];
  private shots: Shot[] = [];
  private stings: Sting[] = [];
  private pops: Pop[] = [];
  private shipX = FIELD_W / 2;
  private shipUp = true;
  /** Seconds since the ship blew up. */
  private downT = 0;
  /** Seconds until the wave flies in. */
  private waveT = WAVE_PAUSE;
  /** Seconds until the next bug might dive. */
  private diveT = 0;
  /** Seconds of the last ship's burst left before it's over (0 while there are ships left). */
  private overT = 0;
  private fireT = 0;
  private left = false;
  private right = false;
  private firing = false;
  /** Game time, for the swarm's sway. */
  private time = 0;
  private acc = 0;

  get over(): boolean {
    return this.state === 'over';
  }

  get started(): boolean {
    return this.kills > 0 || this.ships < START_SHIPS;
  }

  input(action: string, down: boolean) {
    if (action === 'left') this.left = down;
    else if (action === 'right') this.right = down;
    else if (action === 'fire') {
      this.firing = down;
      // A tap fires straight away, if there's a shot to fire.
      if (down) this.fireT = 0;
    }
  }

  pause(on: boolean) {
    if (this.over || on === (this.state === 'paused')) return;
    this.state = on ? 'paused' : 'play';
    this.left = this.right = this.firing = false;
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

  frame(): SwarmFrame {
    const x = (v: number) => clamp(Math.round(v), -80, FIELD_W + 80);
    const y = (v: number) => clamp(Math.round(v), -80, FIELD_H + 80);
    const bugs: number[] = [];
    for (const b of this.bugs) if (b.mode !== 'wait') bugs.push(b.kind === 3 && b.hp < 2 ? 4 : b.kind, x(b.x), y(b.y), (((Math.round((b.heading * 180) / Math.PI) % 360) + 360) % 360));
    return {
      title: 'bugswarm',
      ship: this.shipUp ? clamp(Math.round(this.shipX), 0, FIELD_W) : -1,
      bugs,
      shots: this.shots.flatMap((s) => [x(s.x), y(s.y)]),
      stings: this.stings.flatMap((s) => [x(s.x), y(s.y)]),
      pops: this.pops.slice(-40).flatMap((p) => [x(p.x), y(p.y), Math.min(9, Math.floor((p.age / POP_LIFE) * 10)), p.kind]),
      score: this.score,
      kills: this.kills,
      wave: this.wave,
      ships: this.ships,
      state: this.state,
    };
  }

  /** How much quicker everything is on this wave. */
  private get pace(): number {
    return Math.min(1.6, 1 + 0.06 * (this.wave - 1));
  }

  private step(dt: number) {
    this.time += dt;
    if (this.waveT > 0 && (this.waveT -= dt) <= 0) this.flyIn();
    this.moveShip(dt);
    this.moveShots(dt);
    for (const b of this.bugs) this.fly(b, dt);
    this.chooseDivers(dt);
    this.moveStings(dt);
    this.hitShip();
    for (const p of this.pops) p.age += dt;
    this.pops = this.pops.filter((p) => p.age < POP_LIFE);
    if (!this.shipUp) {
      this.downT += dt;
      if (this.overT > 0 && (this.overT -= dt) <= 0) this.state = 'over';
      else if (this.ships > 0 && this.downT >= RESPAWN && !this.bugs.some((b) => b.mode === 'dive')) {
        this.shipUp = true;
        this.shipX = FIELD_W / 2;
      }
    }
  }

  /** The next wave: every bug waiting its turn to fly in, a group at a time. */
  private flyIn() {
    this.bugs = [];
    GROUPS.forEach((runs, gi) => {
      const ctrl = ENTRIES[(Math.floor(gi / 2) + this.wave - 1) % ENTRIES.length].map(([x, y]): Point => [gi % 2 ? FIELD_W - x : x, y]);
      const path = spline(ctrl);
      let n = 0;
      for (const [row, from, to] of runs) {
        for (let col = from; col <= to; col++) {
          // Later waves sting on the way in, now and then.
          const stings = Math.random() < Math.min(0.5, 0.1 * (this.wave - 1)) ? [path.length * 0.55] : [];
          const [x, y] = ctrl[0];
          const kind = ROWS[row].kind;
          this.bugs.push({ kind, hp: kind === 3 ? 2 : 1, row, col, x, y, heading: DOWN, mode: 'wait', path, along: 0, piece: 1, delay: gi * GROUP_GAP + n++ * FOLLOW_GAP, stings, speed: ENTRY_SPEED * this.pace });
        }
      }
    });
    this.diveT = 1.5;
    this.onSound?.('wave');
  }

  /** Where bug `b`'s place in the swarm is now. */
  private place(b: Bug): [number, number] {
    const sway = SWAY * Math.sin((this.time / SWAY_TIME) * 2 * Math.PI);
    return [FIELD_W / 2 + (b.col - (ROWS[b.row].n - 1) / 2) * GAP_X + sway, TOP + b.row * GAP_Y];
  }

  private fly(b: Bug, dt: number) {
    if (b.mode === 'wait') {
      if ((b.delay -= dt) <= 0) b.mode = 'enter';
      else return;
    }
    if (b.mode === 'swarm') {
      [b.x, b.y] = this.place(b);
      b.heading = turn(b.heading, DOWN, 6 * dt);
      return;
    }
    if (b.mode === 'home') {
      const [px, py] = this.place(b);
      const d = Math.hypot(px - b.x, py - b.y);
      const go = b.speed * dt;
      if (d <= go) {
        [b.x, b.y] = [px, py];
        b.mode = 'swarm';
      } else {
        b.x += ((px - b.x) / d) * go;
        b.y += ((py - b.y) / d) * go;
        b.heading = turn(b.heading, Math.atan2(py - b.y, px - b.x), 10 * dt);
      }
      return;
    }
    // Flying in, or diving: along its path.
    const p = b.path!;
    b.along += b.speed * dt;
    while (b.stings.length && b.along >= b.stings[0]) {
      b.stings.shift();
      this.sting(b);
    }
    if (b.along >= p.length) {
      b.path = null;
      // Off the bottom after a dive: back in at the top, over its place.
      if (b.mode === 'dive') [b.x, b.y] = [this.place(b)[0], -30];
      b.mode = 'home';
      return;
    }
    while (b.piece < p.at.length - 1 && p.at[b.piece] < b.along) b.piece++;
    const i = b.piece;
    const k = (b.along - p.at[i - 1]) / (p.at[i] - p.at[i - 1] || 1);
    const [x0, y0, x1, y1] = [p.pts[2 * i - 2], p.pts[2 * i - 1], p.pts[2 * i], p.pts[2 * i + 1]];
    b.x = x0 + (x1 - x0) * k;
    b.y = y0 + (y1 - y0) * k;
    if (Math.hypot(x1 - x0, y1 - y0) > 0.01) b.heading = turn(b.heading, Math.atan2(y1 - y0, x1 - x0), 14 * dt);
  }

  /** Now and then, once the wave's all in, a bug from the swarm dives at you: more at once, and more often, wave by wave. */
  private chooseDivers(dt: number) {
    if (!this.shipUp || this.bugs.some((b) => b.mode === 'wait' || b.mode === 'enter') || (this.diveT -= dt) > 0) return;
    const few = this.bugs.length <= 6;
    this.diveT = Math.max(0.6, 2.4 - 0.2 * (this.wave - 1)) * (few ? 0.5 : 1) * (0.7 + Math.random() * 0.6);
    const most = few ? this.bugs.length : Math.min(2 + Math.floor((this.wave - 1) / 2), 6);
    if (this.bugs.filter((b) => b.mode === 'dive').length >= most) return;
    const ready = this.bugs.filter((b) => b.mode === 'swarm');
    if (ready.length) this.dive(ready[Math.floor(Math.random() * ready.length)]);
  }

  /** Bug `b` peels off the swarm and dives at the ship: gnats weave, wasps loop the loop, beetles come straight at you. */
  private dive(b: Bug) {
    const s = b.x < FIELD_W / 2 ? -1 : 1;
    const tx = clamp(this.shipX + (Math.random() - 0.5) * 120, 50, FIELD_W - 50);
    const ctrl: Point[] = [
      [b.x, b.y],
      [b.x + s * 26, b.y - 30],
      [b.x + s * 52, b.y + 4],
    ];
    if (b.kind === 1) ctrl.push([tx + s * 40, 300], [tx - s * 40, 420], [tx + s * 20, 520], [tx + s * 70, FIELD_H + 40]);
    else if (b.kind === 2) ctrl.push([tx, 290], [tx - s * 60, 380], [tx, 450], [tx + s * 60, 380], [tx, 330], [tx - s * 40, 470], [tx - s * 60, FIELD_H + 40]);
    else ctrl.push([(tx + b.x) / 2, 260], [tx, 420], [tx, FIELD_H + 40]);
    const path = spline(ctrl);
    const stings = (b.kind === 1 ? 1 : 2) + (this.wave >= 4 ? 1 : 0);
    b.mode = 'dive';
    b.path = path;
    b.along = 0;
    b.piece = 1;
    b.speed = DIVE_SPEED * this.pace * (b.kind === 3 ? 0.85 : b.kind === 2 ? 1.05 : 1);
    b.stings = Array.from({ length: stings }, (_, i) => path.length * (0.3 + i * 0.12));
  }

  /** Bug `b` stings at the ship, if it's there and not too near (at most so far across). */
  private sting(b: Bug) {
    if (!this.shipUp || this.stings.length >= STINGS || b.y > SHIP_Y - 80 || b.y < 0) return;
    const speed = STING_SPEED * this.pace;
    const d = Math.hypot(this.shipX - b.x, SHIP_Y - b.y) || 1;
    const vx = clamp(((this.shipX - b.x) / d) * speed, -0.45 * speed, 0.45 * speed);
    this.stings.push({ x: b.x, y: b.y + 8, vx, vy: Math.sqrt(speed * speed - vx * vx) });
  }

  private moveShip(dt: number) {
    if (!this.shipUp) return;
    const dir = (this.right ? 1 : 0) - (this.left ? 1 : 0);
    this.shipX = clamp(this.shipX + dir * SHIP_SPEED * dt, SHIP_EDGE, FIELD_W - SHIP_EDGE);
    this.fireT -= dt;
    if (this.firing && this.fireT <= 0 && this.shots.length < SHOTS) {
      this.shots.push({ x: this.shipX, y: SHIP_Y - 18 });
      this.fireT = FIRE_EVERY;
      this.onSound?.('shot');
    }
  }

  /** Your shots fly up, and the first bug each meets is hit. */
  private moveShots(dt: number) {
    this.shots = this.shots.filter((s) => {
      s.y -= SHOT_SPEED * dt;
      if (s.y < -20) return false;
      const b = this.bugs.find((b) => b.mode !== 'wait' && Math.abs(b.x - s.x) < REACH[b.kind] && Math.abs(b.y - s.y) < REACH[b.kind] + 4);
      if (!b) return true;
      if (b.hp > 1) {
        b.hp--;
        this.onSound?.('hurt');
      } else this.kill(b);
      return false;
    });
  }

  private moveStings(dt: number) {
    this.stings = this.stings.filter((s) => {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      return s.y < FIELD_H + 20;
    });
  }

  /** A sting, or a bug flying into it, blows the ship up (and the bug with it). */
  private hitShip() {
    if (!this.shipUp) return;
    const sting = this.stings.findIndex((s) => Math.abs(s.x - this.shipX) < 12 && Math.abs(s.y - SHIP_Y) < 14);
    const bug = this.bugs.find((b) => b.mode !== 'wait' && b.mode !== 'swarm' && Math.hypot(b.x - this.shipX, b.y - SHIP_Y) < REACH[b.kind] + 8);
    if (sting < 0 && !bug) return;
    if (sting >= 0) this.stings.splice(sting, 1);
    if (bug) this.kill(bug);
    this.shipUp = false;
    this.downT = 0;
    this.ships--;
    this.firing = false;
    this.pops.push({ x: this.shipX, y: SHIP_Y, age: 0, kind: 2 });
    this.onSound?.('boom');
    if (!this.ships) this.overT = LAST_BURST;
  }

  /** Bug `b` is shot down: worth more on the wing than in the swarm. The last of a wave brings on the next. */
  private kill(b: Bug) {
    const before = this.score;
    this.score += BUG_POINTS[b.kind][b.mode === 'swarm' ? 0 : 1];
    this.kills++;
    this.bugs.splice(this.bugs.indexOf(b), 1);
    this.pops.push({ x: b.x, y: b.y, age: 0, kind: 1 });
    this.onSound?.('pop');
    if (Math.floor(this.score / EXTRA_SHIP) > Math.floor(before / EXTRA_SHIP) && this.ships < MAX_SHIPS && this.ships > 0) {
      this.ships++;
      this.onSound?.('wave');
    }
    if (!this.bugs.length) {
      this.wave++;
      this.waveT = WAVE_PAUSE;
    }
  }
}
