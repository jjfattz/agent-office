import { scoreText } from '../../../shared/cabinet';
import { BED, DONUT, FIELD_H, FIELD_W, MAZE, MAZE_COLS, MAZE_ROWS, MAZE_X, MAZE_Y, MOOD, TILE, type MazeFrame } from '../../../shared/games/dustbot';
import { Dustbot } from './dustbot';
import type { Cartridge, ScreenView } from './cart';
import { DIM, FONT, GOLD, TEXT, W, backdrop, banner, label, lights, playerAndBest, table, value, type Rect } from './paint';

// DUSTBOT's screen (see dustbot.ts): the office floor down the middle, its desks, crumbs and
// batteries, the cats' room at the top, the vacuum and the cats; the score, the floor you're on and
// your vacuums on the left, and the high scores and the cats on the right.

/** Where the field is on the screen. */
const FX = (W - FIELD_W) / 2;
const FIELD: Rect = { x: FX, y: 0, w: FIELD_W, h: FIELD_H };
const EDGE = '#06d6a0';
const INK = '#2b2d42';
const COLORS = ['#4cc9f0', '#ffd166', '#ff8a5b', '#06d6a0', '#ff8fab', '#b388eb', '#ef476f'];
/** Each cat's coat (and its darker marks), by which it is. */
const COATS = ['', '#ff8a5b', '#8d99ae', '#f1ede4', '#ffffff'];
const MARKS = ['', '#e76f51', '#5c677d', '#ff8a5b', '#ffd6e0'];
/** What each cat does, said by the legend on the right. */
const CAT_SAYS = ['', 'comes for you', 'heads you off', 'guards its corner', 'naps, then dashes'];

const wallAt = (x: number, y: number) => y < 0 || y >= MAZE_ROWS || (x >= 0 && x < MAZE_COLS && MAZE[y][x] === '#');
/** A number from 0 to 1 that's always the same for tile `i`. */
const hash = (i: number) => {
  const v = Math.sin(i * 12.9898) * 43758.5453;
  return v - Math.floor(v);
};

function paint(g: CanvasRenderingContext2D, f: MazeFrame, v: ScreenView) {
  backdrop(g);
  g.textBaseline = 'middle';
  g.save();
  g.beginPath();
  g.rect(FX, 0, FIELD_W, FIELD_H);
  g.clip();
  g.translate(FX, 0);
  floor(g, f.cue === 2 && Math.floor(v.t * 6) % 2 === 1);
  for (let i = 0; i < f.floor.length; i++) {
    const [x, y] = [MAZE_X + ((i % MAZE_COLS) + 0.5) * TILE, MAZE_Y + (Math.floor(i / MAZE_COLS) + 0.5) * TILE];
    if (f.floor[i] === '1') crumb(g, x, y, i);
    else if (f.floor[i] === '2') battery(g, x, y, v.t, 1);
  }
  if (f.donut) donut(g, MAZE_X + (DONUT[0] + 0.5) * TILE, MAZE_Y + (DONUT[1] + 0.5) * TILE, 1);
  for (let i = 0; i < f.cats.length; i += 4) cat(g, f.cats[i], f.cats[i + 1], f.cats[i + 2], f.cats[i + 3], v.t, f.bot);
  vacuum(g, f.bot[0], f.bot[1], f.bot[2], f.bot[3], v.t, 1, f.state === 'play' && !f.cue);
  g.textAlign = 'center';
  for (let i = 0; i < f.pops.length; i += 3) {
    g.font = `900 13px ${FONT}`;
    g.fillStyle = '#4cc9f0';
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.strokeText(String(f.pops[i + 2]), f.pops[i], f.pops[i + 1]);
    g.fillText(String(f.pops[i + 2]), f.pops[i], f.pops[i + 1]);
  }
  if (f.state === 'play' && f.cue === 1) {
    const y = MAZE_Y + (DONUT[1] + 0.5) * TILE;
    g.fillStyle = 'rgba(7, 11, 20, 0.85)';
    g.beginPath();
    g.roundRect(FIELD_W / 2 - 110, y - 26, 220, f.level === 1 ? 76 : 52, 14);
    g.fill();
    lights(g, 'READY!', FIELD_W / 2, y, 34, COLORS);
    if (f.level === 1) {
      g.fillStyle = DIM;
      g.font = `800 15px ${FONT}`;
      g.fillText('arrows steer the vacuum', FIELD_W / 2, y + 32);
    }
  }
  g.restore();

  // The field's edges, glowing.
  g.save();
  g.strokeStyle = EDGE;
  g.lineWidth = 3;
  g.shadowColor = EDGE;
  g.shadowBlur = 12;
  g.beginPath();
  g.moveTo(FX - 2, 0);
  g.lineTo(FX - 2, FIELD_H);
  g.moveTo(FX + FIELD_W + 2, 0);
  g.lineTo(FX + FIELD_W + 2, FIELD_H);
  g.stroke();
  g.restore();

  // Left: how it's going. Right: the table, and the cats.
  const lx = FX / 2;
  const rx = W - FX / 2;
  label(g, 'SCORE', lx, 62);
  value(g, scoreText(f.score), lx, 94, 30, 160);
  label(g, 'FLOOR', lx, 150);
  value(g, String(f.level), lx, 180, 28, 160);
  label(g, 'VACUUMS', lx, 236);
  const spare = Math.max(0, f.lives - (f.state === 'over' ? 0 : 1));
  for (let i = 0; i < spare; i++) vacuum(g, lx + (i - (spare - 1) / 2) * 30, 272, 2, 0, 0, 1.2, false);
  playerAndBest(g, lx, v.player, v.scores[0] && Math.max(v.scores[0].score, f.score), 150);
  label(g, 'HIGH SCORES', rx, 62);
  if (v.scores.length) table(g, v.scores, rx - 76, 152, 96, 30, 14, v.mine);
  else value(g, 'Be the first!', rx, 96, 16, 160);
  label(g, 'THE CATS', rx, 404);
  for (const kind of [1, 2, 3, 4]) {
    const y = 404 + kind * 32;
    cat(g, kind, rx - 66, y, MOOD.hunt, v.t, null, 0.9);
    g.textAlign = 'left';
    g.fillStyle = TEXT;
    g.font = `900 13px ${FONT}`;
    g.fillText(CAT_SAYS[kind], rx - 51, y);
  }

  if (f.state === 'paused') banner(g, FIELD, 'PAUSED', v.note ?? 'P to carry on', '#4f86f7');
  else if (f.state === 'over') banner(g, FIELD, 'GAME OVER', v.prompt ?? scoreText(f.score), '#e63946');
}

/** The office floor: the carpet, the cats' room and its bed, and the desks raised off it (flashing once it's clean). */
function floor(g: CanvasRenderingContext2D, flash: boolean) {
  for (let y = 0; y < MAZE_ROWS; y++) {
    for (let x = 0; x < MAZE_COLS; x++) {
      const ch = MAZE[y][x];
      const [px, py] = [MAZE_X + x * TILE, MAZE_Y + y * TILE];
      if (ch === 'P') g.fillStyle = '#3a2440';
      else if (ch !== '#') g.fillStyle = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? '#0d1628' : '#101b31';
      else continue;
      g.fillRect(px, py, TILE, TILE);
    }
  }
  // The cats' bed, a round cushion.
  const [bx, by] = [MAZE_X + (BED[0] + 0.5) * TILE, MAZE_Y + (BED[1] + 0.5) * TILE];
  g.fillStyle = '#ef476f';
  g.beginPath();
  g.ellipse(bx, by + 4, 34, 15, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ff8fab';
  g.beginPath();
  g.ellipse(bx, by + 4, 26, 9, 0, 0, Math.PI * 2);
  g.fill();
  for (let y = 0; y < MAZE_ROWS; y++) {
    for (let x = 0; x < MAZE_COLS; x++) {
      const ch = MAZE[y][x];
      if (ch !== '#' && ch !== '-') continue;
      const [px, py] = [MAZE_X + x * TILE, MAZE_Y + y * TILE];
      g.fillStyle = flash ? '#f1ede4' : '#2a3658';
      g.fillRect(px, py, TILE, TILE);
      if (ch === '-') {
        // The cat flap.
        g.fillStyle = '#ff8fab';
        g.beginPath();
        g.roundRect(px + 2, py + 6, TILE - 4, 8, 4);
        g.fill();
        continue;
      }
      // Edges where it meets the floor: lit along the top, shaded underneath.
      g.fillStyle = flash ? '#ffffff' : '#7088c4';
      if (!wallAt(x, y - 1)) g.fillRect(px, py, TILE, 3);
      g.fillStyle = flash ? '#cfd6e6' : '#46557f';
      if (!wallAt(x - 1, y)) g.fillRect(px, py, 2, TILE);
      if (!wallAt(x + 1, y)) g.fillRect(px + TILE - 2, py, 2, TILE);
      g.fillStyle = flash ? '#a9b4cc' : '#161d33';
      if (!wallAt(x, y + 1)) g.fillRect(px, py + TILE - 4, TILE, 4);
      // Now and then, deep in a desk, a monitor or a plant.
      if (!flash && wallAt(x - 1, y) && wallAt(x + 1, y) && wallAt(x, y - 1) && wallAt(x, y + 1) && y > 0 && y < MAZE_ROWS - 1 && x > 0 && x < MAZE_COLS - 1) {
        const r = hash(y * MAZE_COLS + x);
        if (r < 0.18) {
          g.fillStyle = 'rgba(76, 201, 240, 0.45)';
          g.fillRect(px + 5, py + 6, 10, 7);
        } else if (r < 0.28) {
          g.fillStyle = 'rgba(6, 214, 160, 0.5)';
          g.beginPath();
          g.arc(px + 10, py + 10, 4, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }
}

/** A crumb, a little different on every tile. */
function crumb(g: CanvasRenderingContext2D, x: number, y: number, i: number) {
  const r = hash(i);
  g.fillStyle = r < 0.5 ? '#e9c46a' : '#f4d6a0';
  g.beginPath();
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + r * 6;
    const d = 2.6 + hash(i * 7 + k) * 1.4;
    if (k) g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
    else g.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  g.fill();
}

/** A battery standing up, glowing. */
function battery(g: CanvasRenderingContext2D, x: number, y: number, t: number, scale: number) {
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  g.shadowColor = '#06d6a0';
  g.shadowBlur = 8 + 6 * Math.abs(Math.sin(t * 4));
  g.fillStyle = '#06d6a0';
  g.beginPath();
  g.roundRect(-5, -6, 10, 14, 2.5);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = '#f1ede4';
  g.fillRect(-2.5, -9, 5, 3);
  g.fillStyle = INK;
  g.fillRect(-3, -1, 6, 1.6);
  g.fillRect(-0.8, -3.2, 1.6, 6);
  g.restore();
}

function donut(g: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  g.fillStyle = '#d4a373';
  g.beginPath();
  g.arc(0, 0, 8, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ff8fab';
  g.beginPath();
  g.arc(0, -0.5, 6.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#0d1628';
  g.beginPath();
  g.arc(0, 0, 2.6, 0, Math.PI * 2);
  g.fill();
  for (const [sx, sy, c] of [[-3.5, -3, '#4cc9f0'], [3, -4, '#ffd166'], [4, 2, '#06d6a0'], [-4, 2.5, '#ffffff']] as const) {
    g.fillStyle = c;
    g.fillRect(sx - 1, sy - 0.6, 2, 1.2);
  }
  g.restore();
}

/**
 * The robot vacuum from above at (x, y), facing `dir` (0 right, 1 down, 2 left, 3 up): a round deck,
 * its bumper lit along the front, a light on top, and side brushes spinning while it `runs`. `pounce`
 * (1–9) is how far it's got through being pounced on: spinning, sparking, in a puff of dust.
 */
function vacuum(g: CanvasRenderingContext2D, x: number, y: number, dir: number, pounce: number, t: number, scale: number, runs: boolean) {
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  const p = pounce / 9;
  if (pounce) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + p * 3;
      g.globalAlpha = 0.5 * (1 - p);
      g.fillStyle = '#8d99ae';
      g.beginPath();
      g.arc(Math.cos(a) * (6 + p * 14), Math.sin(a) * (6 + p * 14) - p * 6, 3 + p * 4, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  g.rotate((dir * Math.PI) / 2 + p * Math.PI * 5);
  if (runs || pounce) {
    // The side brushes, out front at either side.
    g.strokeStyle = '#ffd166';
    g.lineWidth = 1.2;
    for (const s of [-1, 1]) {
      const spin = t * 25 * s;
      for (let k = 0; k < 3; k++) {
        const a = spin + (k * Math.PI * 2) / 3;
        g.beginPath();
        g.moveTo(6, s * 6);
        g.lineTo(6 + Math.cos(a) * 4.5, s * 6 + Math.sin(a) * 4.5);
        g.stroke();
      }
    }
  }
  g.fillStyle = pounce === 9 ? '#8d99ae' : '#e9ecef';
  g.strokeStyle = INK;
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(0, 0, 8.5, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.strokeStyle = '#ced4da';
  g.lineWidth = 1;
  g.beginPath();
  g.arc(0, 0, 5.5, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = '#4cc9f0';
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(0, 0, 8.5, -1, 1);
  g.stroke();
  g.fillStyle = Math.floor(t * 3) % 2 && !pounce ? '#06d6a0' : '#0b8f6c';
  g.beginPath();
  g.arc(-1, 0, 2.2, 0, Math.PI * 2);
  g.fill();
  if (pounce && pounce < 9) {
    g.strokeStyle = GOLD;
    g.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + t * 9;
      g.beginPath();
      g.moveTo(Math.cos(a) * 10, Math.sin(a) * 10);
      g.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
      g.stroke();
    }
  }
  g.restore();
}

/**
 * Cat `kind` at (x, y), up to `mood` (see MOOD): hunting, its eyes on the vacuum at `bot` (when
 * there's one to look at); scared, its fur on end; running home, see-through; napping; in its room,
 * bobbing on its bed; or distracted, wondering what that was.
 */
function cat(g: CanvasRenderingContext2D, kind: number, x: number, y: number, mood: number, t: number, bot: number[] | null, scale = 1) {
  g.save();
  g.translate(x, y + (mood === MOOD.room ? Math.sin(t * 3 + kind) * 1.5 : 0));
  g.scale(scale, scale);
  const scared = mood === MOOD.scared || mood === MOOD.calming;
  const coat = scared ? (mood === MOOD.calming && Math.floor(t * 6) % 2 ? '#f1ede4' : '#4f86f7') : COATS[kind];
  if (mood === MOOD.home) g.globalAlpha = 0.45;
  // The tail, swishing.
  g.strokeStyle = coat;
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(5, 6);
  g.quadraticCurveTo(13, 4 + Math.sin(t * 5 + kind) * 4, 11, -4);
  g.stroke();
  // Ears, then the head (spiky when it's scared).
  g.fillStyle = coat;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(s * 8, -2);
    g.lineTo(s * 7, -11);
    g.lineTo(s * 1.5, -6.5);
    g.fill();
  }
  g.beginPath();
  if (scared) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = i % 2 ? 7.5 : 9.5;
      if (i) g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
  } else g.arc(0, 0, 8, 0, Math.PI * 2);
  g.fill();
  if (!scared && mood !== MOOD.home) {
    // Its marks: Ginger's stripes, Smoke's ears, Patch's patches, Snowball's pink ears.
    g.fillStyle = MARKS[kind];
    if (kind === 1) for (const dx of [-2.5, 0, 2.5]) g.fillRect(dx - 0.8, -7.5, 1.6, 3.5);
    else if (kind === 3) {
      g.beginPath();
      g.arc(-4.5, -4, 4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = INK;
      g.beginPath();
      g.arc(4.5, 1.5, 3.2, 0, Math.PI * 2);
      g.fill();
    } else
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(s * 6.8, -3.5);
        g.lineTo(s * 6.5, -8.5);
        g.lineTo(s * 3, -5.8);
        g.fill();
      }
  }
  // The eyes: on the vacuum while it hunts, wide while it's scared, shut while it naps.
  const [lx, ly] = bot && mood !== MOOD.nap ? look(x, y, bot) : [0, 0];
  for (const s of [-1, 1]) {
    if (mood === MOOD.nap) {
      g.strokeStyle = INK;
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(s * 3.2, -1, 1.8, 0.2, Math.PI - 0.2);
      g.stroke();
      continue;
    }
    g.fillStyle = scared ? '#ffffff' : '#ffd166';
    g.beginPath();
    g.ellipse(s * 3.2, -1, scared ? 2.6 : 2.2, scared ? 2.6 : 2.4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = INK;
    g.beginPath();
    g.ellipse(s * 3.2 + lx, -1 + ly, scared ? 1 : 0.7, scared ? 1 : 1.9, 0, 0, Math.PI * 2);
    g.fill();
  }
  if (mood !== MOOD.home) {
    g.fillStyle = '#ff8fab';
    g.beginPath();
    g.moveTo(-1.2, 2.2);
    g.lineTo(1.2, 2.2);
    g.lineTo(0, 3.4);
    g.fill();
    g.strokeStyle = scared ? '#ffffff' : 'rgba(43, 45, 66, 0.6)';
    g.lineWidth = 0.7;
    g.beginPath();
    for (const s of [-1, 1]) {
      for (const dy of [-1, 1]) {
        g.moveTo(s * 3, 3);
        g.lineTo(s * 10, 3 + dy * 1.8);
      }
    }
    g.stroke();
  }
  g.restore();
  if (mood === MOOD.lull) {
    g.fillStyle = GOLD;
    g.font = `900 ${Math.round(10 * scale)}px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('?', x + 7 * scale, y - 12 * scale + Math.sin(t * 6 + kind) * 1.5);
  } else if (mood === MOOD.nap) {
    g.fillStyle = TEXT;
    g.font = `900 ${Math.round(8 * scale)}px ${FONT}`;
    g.textAlign = 'center';
    const k = (t * 0.8) % 1;
    g.globalAlpha = 1 - k;
    g.fillText('z', x + 8 * scale + k * 4, y - 10 * scale - k * 8);
    g.globalAlpha = 1;
  }
}

/** Which way a cat at (x, y) looks to see the vacuum at `bot` (its pupils' nudge). */
function look(x: number, y: number, bot: number[]): [number, number] {
  const d = Math.hypot(bot[0] - x, bot[1] - y) || 1;
  return [((bot[0] - x) / d) * 0.9, ((bot[1] - y) / d) * 0.9];
}

/** DUSTBOT as the cabinet plays it (see cart.ts). */
export const dustbot: Cartridge<MazeFrame> = {
  title: 'dustbot',
  blurb: 'Hoover every crumb before the office cats get you.',
  colors: COLORS,
  keys: {
    ArrowRight: 'right',
    KeyD: 'right',
    ArrowDown: 'down',
    KeyS: 'down',
    ArrowLeft: 'left',
    KeyA: 'left',
    ArrowUp: 'up',
    KeyW: 'up',
  },
  tip: '← ↑ → ↓ steer · P pause',
  frameMs: 60,
  start(sound) {
    const g = new Dustbot();
    g.onSound = sound;
    return g;
  },
  paint,
  hear(was, f, sound) {
    const count = (s: string, ch: string) => s.split(ch).length - 1;
    const home = (fr: MazeFrame) => fr.cats.filter((m, i) => i % 4 === 3 && m === MOOD.home).length;
    if (f.cue === 2 && was.cue !== 2) sound('clear', 4);
    else if (f.lives < was.lives) sound('boom');
    else if (count(f.floor, '2') < count(was.floor, '2')) sound('power');
    else if (f.eaten > was.eaten) sound('crumb');
    if (home(f) > home(was)) sound('meow');
    if (was.donut && !f.donut && f.pops.length > was.pops.length) sound('pop');
  },
  icon(g, x, y, size) {
    const k = size / 60;
    for (let i = 0; i < 3; i++) crumb(g, x - 2 * k + i * 12 * k, y + 14 * k, i + 3);
    battery(g, x + 26 * k, y + 14 * k, 0, k);
    vacuum(g, x - 18 * k, y + 14 * k, 0, 0, 0.3, k * 1.3, true);
    cat(g, 1, x + 6 * k, y - 16 * k, MOOD.hunt, 0, [x - 18 * k, y + 14 * k], k * 1.4);
  },
};
