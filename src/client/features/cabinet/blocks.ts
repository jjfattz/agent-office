import { scoreText, type PlayState } from '../../../shared/cabinet';
import { CLEAR_POINTS, WELL_COLS, WELL_ROWS, levelFor, type BlocksFrame } from '../../../shared/games/blockfall';
import type { CabinetGame, Cartridge, ScreenView } from './cart';
import { LIGHTS, NEON, W, backdrop, banner, label, line, playerAndBest, table, value } from './paint';

/**
 * BLOCKFALL, a game on the arcade cabinet (ui.ts): falling blocks with the usual rotation and wall
 * kicks, a bag of all seven pieces at a time, hold, a ghost where the piece will land, and a painter
 * that draws the whole screen (see paint.ts) from a BlocksFrame.
 */

const COLS = WELL_COLS;
/** Two rows above the top of the well, where the pieces come in. */
const HIDDEN = 2;
const ROWS = WELL_ROWS + HIDDEN;
const GHOST = 8;

/** I, O, T, S, Z, J, L: where each piece's blocks are in its box, turned the way it comes in. */
const SHAPES: readonly (readonly [number, number][])[] = [
  [],
  [[0, 1], [1, 1], [2, 1], [3, 1]],
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[1, 0], [0, 1], [1, 1], [2, 1]],
  [[1, 0], [2, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [1, 1], [2, 1]],
  [[0, 0], [0, 1], [1, 1], [2, 1]],
  [[2, 0], [0, 1], [1, 1], [2, 1]],
];
const BOX = [0, 4, 2, 3, 3, 3, 3, 3];
/** Each piece's color, and a ghost's. */
export const COLORS = ['', '#4cc9f0', '#ffd166', '#b388eb', '#06d6a0', '#ef476f', '#4f86f7', '#ff8a5b'];

/**
 * Where to try a piece that won't turn where it is, turning clockwise from each of its four ways
 * (x right, y up, as they're usually written). Turning back the other way tries them reversed.
 */
const KICKS: readonly (readonly [number, number][])[] = [
  [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
];
const I_KICKS: readonly (readonly [number, number][])[] = [
  [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
];

/** How long a piece sits on something before it sticks, and how many moves can put that off. */
const LOCK_DELAY = 0.5;
const LOCK_RESETS = 15;
/** Holding left or right: how long before it slides, then how often it steps. */
const DAS = 0.16;
const ARR = 0.045;
/** Rows a second while you hold down. */
const SOFT_DROP = 20;

interface Piece {
  kind: number;
  rot: number;
  x: number;
  y: number;
}

/** The blocks of a piece turned `rot` quarter turns clockwise, in its box. */
function blocks(kind: number, rot: number): [number, number][] {
  const n = BOX[kind];
  return SHAPES[kind].map(([x, y]) => {
    for (let r = 0; r < rot; r++) [x, y] = [n - 1 - y, x];
    return [x, y];
  });
}

/** Seconds per row at a level: a second at 1, quicker and quicker after. */
function gravity(level: number): number {
  return Math.pow(0.8 - (level - 1) * 0.007, level - 1);
}

export class Blocks implements CabinetGame {
  /** Row by row from the top, hidden rows first: 0 empty, else the color of the piece that left it. */
  private well = new Uint8Array(COLS * ROWS);
  private piece!: Piece;
  private bag: number[] = [];
  private queue: number[] = [];
  private held = 0;
  /** Hold only works once per piece. */
  private swapped = false;
  state: PlayState = 'play';
  score = 0;
  lines = 0;
  level = 1;
  pieces = 0;
  /** Up by one whenever the picture changes. */
  version = 0;
  /** What just happened, for the sounds: cleared lines, or the piece landing. */
  onLand?: (cleared: number) => void;
  /** Which game this is on the high-score table: the office names it when you start playing. */
  id = '';
  private fall = 0;
  private lockT = 0;
  private resets = 0;
  private soft = false;
  private left = false;
  private right = false;
  /** Which way it's sliding while a key is held, and how long until the next step. */
  private slide = 0;
  private repeat = 0;

  constructor() {
    this.queue.push(this.draw());
    this.spawn();
  }

  get over(): boolean {
    return this.state === 'over';
  }

  get started(): boolean {
    return this.pieces > 0 || this.score > 0;
  }

  /** A key for it (see KEYS) went down or came back up. */
  input(action: string, down: boolean) {
    if (!down) {
      if (action === 'left') this.release(-1);
      else if (action === 'right') this.release(1);
      else if (action === 'down') this.softDrop(false);
      return;
    }
    if (action === 'left') this.press(-1);
    else if (action === 'right') this.press(1);
    else if (action === 'down') this.softDrop(true);
    else if (action === 'turn') this.rotate(1);
    else if (action === 'back') this.rotate(-1);
    else if (action === 'drop') this.hardDrop();
    else if (action === 'hold') this.hold();
  }

  /** Left (-1) or right (1) pressed: a step now, then sliding while it's held. */
  press(dir: -1 | 1) {
    if (dir < 0) this.left = true;
    else this.right = true;
    this.slide = dir;
    this.repeat = DAS;
    if (this.state === 'play') this.shift(dir);
  }

  release(dir: -1 | 1) {
    if (dir < 0) this.left = false;
    else this.right = false;
    // Still holding the other way: slide that way again.
    if (this.slide === dir) {
      this.slide = this.left ? -1 : this.right ? 1 : 0;
      this.repeat = DAS;
    }
  }

  /** Lets go of everything, when the window loses the keyboard. */
  releaseAll() {
    this.left = this.right = this.soft = false;
    this.slide = 0;
  }

  softDrop(on: boolean) {
    this.soft = on;
  }

  /** Straight down, and it sticks. */
  hardDrop() {
    if (this.state !== 'play') return;
    let rows = 0;
    while (this.fits(this.piece, 0, rows + 1)) rows++;
    this.piece.y += rows;
    this.score += rows * 2;
    this.lock();
  }

  /** A quarter turn, clockwise (1) or back (-1), kicked off a wall or the stack if it has to be. */
  rotate(dir: 1 | -1) {
    if (this.state !== 'play') return;
    const p = this.piece;
    const to = (p.rot + dir + 4) % 4;
    const table = p.kind === 1 ? I_KICKS : KICKS;
    const kicks = dir > 0 ? table[p.rot] : table[to].map(([x, y]) => [-x, -y]);
    for (const [kx, ky] of kicks) {
      const turned = { ...p, rot: to };
      if (!this.fits(turned, kx, -ky)) continue;
      this.piece = { ...turned, x: p.x + kx, y: p.y - ky };
      this.moved();
      return;
    }
  }

  /** Puts the piece by for later, and brings back the one put by before (or the next one). */
  hold() {
    if (this.state !== 'play' || this.swapped) return;
    const kind = this.piece.kind;
    if (this.held) this.spawn(this.held);
    else this.spawn();
    this.held = kind;
    this.swapped = true;
  }

  pause(on: boolean) {
    if (this.over || on === (this.state === 'paused')) return;
    this.state = on ? 'paused' : 'play';
    this.releaseAll();
    this.version++;
  }

  /** Moves the game on by `dt` seconds. */
  update(dt: number) {
    if (this.state !== 'play') return;
    if (this.slide) {
      this.repeat -= dt;
      while (this.repeat <= 0 && this.shift(this.slide)) this.repeat += ARR;
      if (this.repeat <= 0) this.repeat = ARR;
    }
    const perRow = this.soft ? Math.min(gravity(this.level), 1 / SOFT_DROP) : gravity(this.level);
    this.fall += dt;
    while (this.fall >= perRow) {
      this.fall -= perRow;
      if (!this.fits(this.piece, 0, 1)) {
        this.fall = 0;
        break;
      }
      this.piece.y++;
      if (this.soft) this.score++;
      this.version++;
    }
    if (this.fits(this.piece, 0, 1)) this.lockT = 0;
    else if ((this.lockT += dt) >= LOCK_DELAY) this.lock();
  }

  /** The screen as it is now: the well with the piece in it and its ghost below. */
  frame(): BlocksFrame {
    const cells = this.well.slice(HIDDEN * COLS);
    if (this.state !== 'over') {
      let drop = 0;
      while (this.fits(this.piece, 0, drop + 1)) drop++;
      for (const [x, y] of this.at(this.piece, 0, drop)) if (y >= HIDDEN && !cells[(y - HIDDEN) * COLS + x]) cells[(y - HIDDEN) * COLS + x] = GHOST;
      for (const [x, y] of this.at(this.piece)) if (y >= HIDDEN) cells[(y - HIDDEN) * COLS + x] = this.piece.kind;
    }
    return { title: 'blockfall', cells: cells.join(''), next: this.queue[0], hold: this.held, score: this.score, lines: this.lines, level: this.level, pieces: this.pieces, state: this.state };
  }

  /** The next piece from the bag, a fresh shuffled bag of all seven when it's empty. */
  private draw(): number {
    if (!this.bag.length) {
      this.bag = [1, 2, 3, 4, 5, 6, 7];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop()!;
  }

  /** A piece comes in at the top; with no room for it, the game's over. */
  private spawn(kind?: number) {
    if (!kind) {
      kind = this.queue.shift()!;
      this.queue.push(this.draw());
    }
    this.piece = { kind, rot: 0, x: kind === 2 ? 4 : 3, y: 1 };
    this.fall = this.lockT = this.resets = 0;
    this.swapped = false;
    if (!this.fits(this.piece)) this.state = 'over';
    this.version++;
  }

  private shift(dx: number): boolean {
    if (!this.fits(this.piece, dx, 0)) return false;
    this.piece.x += dx;
    this.moved();
    return true;
  }

  /** It moved or turned: on the stack, that buys it a little more time before it sticks. */
  private moved() {
    if (!this.fits(this.piece, 0, 1) && this.resets < LOCK_RESETS) {
      this.lockT = 0;
      this.resets++;
    }
    this.version++;
  }

  private at(p: Piece, dx = 0, dy = 0): [number, number][] {
    return blocks(p.kind, p.rot).map(([x, y]) => [p.x + x + dx, p.y + y + dy]);
  }

  private fits(p: Piece, dx = 0, dy = 0): boolean {
    return this.at(p, dx, dy).every(([x, y]) => x >= 0 && x < COLS && y >= 0 && y < ROWS && !this.well[y * COLS + x]);
  }

  /** The piece sticks where it is, full rows go, and the next piece comes in. */
  private lock() {
    const cells = this.at(this.piece);
    for (const [x, y] of cells) this.well[y * COLS + x] = this.piece.kind;
    this.pieces++;
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (!this.well.subarray(y * COLS, (y + 1) * COLS).every(Boolean)) continue;
      this.well.copyWithin(COLS, 0, y * COLS);
      this.well.fill(0, 0, COLS);
      cleared++;
      y++;
    }
    if (cleared) {
      this.score += CLEAR_POINTS[cleared] * this.level;
      this.lines += cleared;
      this.level = levelFor(this.lines);
    }
    this.onLand?.(cleared);
    // Stuck entirely above the top of the well: that's the end too.
    if (cells.every(([, y]) => y < HIDDEN)) {
      this.state = 'over';
      this.version++;
      return;
    }
    this.spawn();
  }
}

const CELL = 27;
const X0 = (W - COLS * CELL) / 2;
const Y0 = 36;
const WELL = { x: X0, y: Y0, w: COLS * CELL, h: WELL_ROWS * CELL };

/** Draws the whole screen. */
function paint(g: CanvasRenderingContext2D, f: BlocksFrame, v: ScreenView) {
  backdrop(g);
  g.textBaseline = 'middle';
  // The well, in a glowing frame.
  g.fillStyle = '#070b14';
  g.fillRect(X0, Y0, COLS * CELL, WELL_ROWS * CELL);
  g.strokeStyle = NEON;
  g.lineWidth = 4;
  g.shadowColor = NEON;
  g.shadowBlur = 14;
  g.strokeRect(X0 - 4, Y0 - 4, COLS * CELL + 8, WELL_ROWS * CELL + 8);
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  g.lineWidth = 1;
  for (let c = 1; c < COLS; c++) line(g, X0 + c * CELL, Y0, X0 + c * CELL, Y0 + WELL_ROWS * CELL);
  for (let r = 1; r < WELL_ROWS; r++) line(g, X0, Y0 + r * CELL, X0 + COLS * CELL, Y0 + r * CELL);
  for (let i = 0; i < f.cells.length; i++) {
    const k = f.cells.charCodeAt(i) - 48;
    if (!k) continue;
    const x = X0 + (i % COLS) * CELL;
    const y = Y0 + Math.floor(i / COLS) * CELL;
    if (k === GHOST) ghost(g, x, y, CELL);
    else block(g, x, y, CELL, COLORS[k], f.state === 'over');
  }

  // Left: what's on hold and how it's going. Right: what's next and the table.
  const lx = X0 / 2;
  const rx = W - X0 / 2;
  label(g, 'HOLD', lx, 62);
  preview(g, f.hold, lx, 112);
  label(g, 'SCORE', lx, 196);
  value(g, scoreText(f.score), lx, 228, 32);
  label(g, 'LINES', lx, 282);
  value(g, String(f.lines), lx, 312, 28);
  label(g, 'LEVEL', lx, 362);
  value(g, String(f.level), lx, 392, 28);
  playerAndBest(g, lx, v.player, v.scores[0] && Math.max(v.scores[0].score, f.score), 190);
  label(g, 'NEXT', rx, 62);
  preview(g, f.next, rx, 112);
  label(g, 'HIGH SCORES', rx, 196);
  if (v.scores.length) table(g, v.scores, rx - 100, 200, 228, 30, 16, v.mine);
  else value(g, 'Be the first!', rx, 228, 18);

  if (f.state === 'paused') {
    banner(g, WELL, 'PAUSED', v.note ?? 'P to carry on', '#4f86f7');
  } else if (f.state === 'over') {
    banner(g, WELL, 'GAME OVER', v.prompt ?? scoreText(f.score), '#e63946');
  }
}

/** A block: its color, lit on the top and left, shaded on the bottom and right. */
function block(g: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, dull = false) {
  g.globalAlpha = dull ? 0.45 : 1;
  g.fillStyle = color;
  g.fillRect(x + 1, y + 1, size - 2, size - 2);
  g.fillStyle = 'rgba(255, 255, 255, 0.35)';
  g.fillRect(x + 1, y + 1, size - 2, 4);
  g.fillRect(x + 1, y + 1, 4, size - 2);
  g.fillStyle = 'rgba(0, 0, 0, 0.25)';
  g.fillRect(x + 1, y + size - 5, size - 2, 4);
  g.fillRect(x + size - 5, y + 1, 4, size - 2);
  g.globalAlpha = 1;
}

/** Where the falling piece will land. */
function ghost(g: CanvasRenderingContext2D, x: number, y: number, size: number) {
  g.strokeStyle = 'rgba(241, 237, 228, 0.35)';
  g.lineWidth = 2;
  g.strokeRect(x + 3, y + 3, size - 6, size - 6);
}

/** A piece in a little box, centered on (cx, cy). */
function preview(g: CanvasRenderingContext2D, kind: number, cx: number, cy: number) {
  g.fillStyle = '#070b14';
  g.beginPath();
  g.roundRect(cx - 62, cy - 36, 124, 72, 12);
  g.fill();
  if (!kind) return;
  const cells = blocks(kind, 0);
  const size = 22;
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  const ox = cx - ((Math.min(...xs) + Math.max(...xs) + 1) * size) / 2;
  const oy = cy - ((Math.min(...ys) + Math.max(...ys) + 1) * size) / 2;
  for (const [x, y] of cells) block(g, ox + x * size, oy + y * size, size, COLORS[kind]);
}

/** BLOCKFALL as the cabinet plays it (see cart.ts). */
export const blockfall: Cartridge<BlocksFrame> = {
  title: 'blockfall',
  blurb: 'Turn and drop the falling blocks to clear lines.',
  colors: COLORS.slice(1),
  keys: {
    ArrowLeft: 'left',
    KeyA: 'left',
    ArrowRight: 'right',
    KeyD: 'right',
    ArrowDown: 'down',
    KeyS: 'down',
    ArrowUp: 'turn',
    KeyW: 'turn',
    KeyX: 'turn',
    KeyZ: 'back',
    Space: 'drop',
    KeyC: 'hold',
    ShiftLeft: 'hold',
    ShiftRight: 'hold',
  },
  tip: '← → move · ↑ turn · ↓ faster · Space drop · C hold · P pause',
  frameMs: 90,
  start(sound) {
    const g = new Blocks();
    g.onLand = (lines) => sound(lines ? 'clear' : 'land', lines);
    return g;
  },
  paint,
  hear(was, f, sound) {
    if (f.lines > was.lines) sound('clear', f.lines - was.lines);
    else if (f.pieces > was.pieces) sound('land');
  },
  icon(g, x, y, size) {
    // A T on its way down into the gap it fits.
    const c = size / 4;
    const at = (cells: [number, number][], color: string) => cells.forEach(([cx, cy]) => block(g, x + (cx - 2) * c, y + (cy - 2) * c, c, color));
    at([[1, 0], [2, 0], [3, 0], [2, 1]], LIGHTS[2]);
    at([[0, 2], [0, 3], [1, 3]], LIGHTS[0]);
    at([[3, 2], [3, 3], [2, 3]], LIGHTS[6]);
  },
};
