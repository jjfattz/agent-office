import { scoreText } from '../../../shared/cabinet';
import { FIELD_H, FIELD_W, WALL_COLS, type BrickFrame } from '../../../shared/games/brickbust';
import { BALL_R, BRICK_H, BRICK_W, Brickbust, PADDLE_H, PADDLE_W, PADDLE_Y, WALL_X, WALL_Y } from './brickbust';
import type { Cartridge, ScreenView } from './cart';
import { DIM, FONT, GOLD, TEXT, W, backdrop, banner, label, lights, playerAndBest, table, value, type Rect } from './paint';

// BRICKBUST's screen (see brickbust.ts): the field down the middle with the wall, your paddle, the
// ball and the pills falling; the score, the level and your balls on the left, and the high scores
// and what each pill does on the right.

/** Where the field is on the screen. */
const FX = (W - FIELD_W) / 2;
const FIELD: Rect = { x: FX, y: 0, w: FIELD_W, h: FIELD_H };
const EDGE = '#ff8a5b';
const INK = '#2b2d42';
/** Each brick's color, by its character in the wall (1–6 bright, 7 and 8 hard, 9 steel). */
const BRICKS = ['', '#06d6a0', '#4cc9f0', '#4f86f7', '#b388eb', '#ffd166', '#ef476f', '#d7dde8', '#d7dde8', '#5c6b86'];
const COLORS = ['#ef476f', '#ffd166', '#06d6a0', '#4cc9f0', '#b388eb'];
/** Each pill's color, by its kind (see DROPS in shared/games/brickbust.ts). */
const PILLS = ['', '#4cc9f0', '#ff5ecb', '#ffd166', '#06d6a0'];
/** What each pill does, said by the legend on the right. */
const PILL_SAYS = ['', 'wider paddle', 'three balls', 'slower ball', 'a ball spare'];

function paint(g: CanvasRenderingContext2D, f: BrickFrame, v: ScreenView) {
  backdrop(g);
  g.textBaseline = 'middle';
  g.fillStyle = '#070912';
  g.fillRect(FX, 0, FIELD_W, FIELD_H);

  // The field, clipped so nothing near its sides goes over the numbers.
  g.save();
  g.beginPath();
  g.rect(FX, 0, FIELD_W, FIELD_H);
  g.clip();
  g.translate(FX, 0);
  grid(g, v.t);
  for (let i = 0; i < f.wall.length; i++) {
    const ch = Number(f.wall[i]);
    if (ch) brick(g, WALL_X + (i % WALL_COLS) * BRICK_W, WALL_Y + Math.floor(i / WALL_COLS) * BRICK_H, ch);
  }
  for (let i = 0; i < f.drops.length; i += 3) pill(g, f.drops[i], f.drops[i + 1], f.drops[i + 2], v.t);
  paddle(g, f.paddle, PADDLE_Y, f.width, v.t);
  for (let i = 0; i < f.balls.length; i += 2) ball(g, f.balls[i], f.balls[i + 1]);
  for (let i = 0; i < f.pops.length; i += 4) pop(g, f.pops[i], f.pops[i + 1], f.pops[i + 2] / 9, f.pops[i + 3]);
  if (f.state === 'play' && f.cue) {
    g.textAlign = 'center';
    if (f.cue === 1) {
      lights(g, `LEVEL ${f.level}`, FIELD_W / 2, 370, 48, COLORS);
      g.fillStyle = DIM;
      g.font = `800 18px ${FONT}`;
      g.fillText(f.level === 1 ? '← → move · Space launch' : 'Here comes the next wall', FIELD_W / 2, 420);
    } else if (Math.floor(v.t * 1.6) % 2 === 0) {
      g.fillStyle = GOLD;
      g.font = `900 26px ${FONT}`;
      g.fillText('SPACE TO LAUNCH', FIELD_W / 2, 400);
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

  // Left: how it's going. Right: the table, and what the pills do.
  const lx = FX / 2;
  const rx = W - FX / 2;
  label(g, 'SCORE', lx, 62);
  value(g, scoreText(f.score), lx, 94, 30, 160);
  label(g, 'LEVEL', lx, 150);
  value(g, String(f.level), lx, 180, 28, 160);
  label(g, 'BALLS', lx, 236);
  const spare = Math.max(0, f.lives - (f.balls.length ? 1 : 0));
  for (let i = 0; i < spare; i++) ball(g, lx + (i - (spare - 1) / 2) * 26, 270);
  playerAndBest(g, lx, v.player, v.scores[0] && Math.max(v.scores[0].score, f.score), 150);
  label(g, 'HIGH SCORES', rx, 62);
  if (v.scores.length) table(g, v.scores, rx - 76, 152, 96, 30, 14, v.mine);
  else value(g, 'Be the first!', rx, 96, 16, 160);
  label(g, 'CATCH THESE', rx, 410);
  for (const kind of [1, 2, 3, 4]) {
    const y = 410 + kind * 32;
    pill(g, kind, rx - 54, y, v.t, 0.85);
    g.textAlign = 'left';
    g.fillStyle = TEXT;
    g.font = `900 14px ${FONT}`;
    g.fillText(PILL_SAYS[kind], rx - 34, y);
  }

  if (f.state === 'paused') banner(g, FIELD, 'PAUSED', v.note ?? 'P to carry on', '#4f86f7');
  else if (f.state === 'over') banner(g, FIELD, 'GAME OVER', v.prompt ?? scoreText(f.score), '#e63946');
}

/** A faint grid on the field's floor, its lines glinting by now and then. */
function grid(g: CanvasRenderingContext2D, t: number) {
  g.lineWidth = 1;
  for (let x = 20; x < FIELD_W; x += 40) {
    g.strokeStyle = `rgba(76, 201, 240, ${0.05 + 0.04 * Math.max(0, Math.sin(t * 0.8 + x * 0.05))})`;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, FIELD_H);
    g.stroke();
  }
  g.strokeStyle = 'rgba(76, 201, 240, 0.05)';
  for (let y = 24; y < FIELD_H; y += 40) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(FIELD_W, y);
    g.stroke();
  }
}

/** Brick `ch` (see BRICKS) in its place at (x, y): lit on top, shaded underneath. Hard ones are riveted, steel is striped. */
function brick(g: CanvasRenderingContext2D, x: number, y: number, ch: number, w = BRICK_W, h = BRICK_H) {
  const [bx, by, bw, bh] = [x + 1.5, y + 1.5, w - 3, h - 3];
  g.fillStyle = BRICKS[ch];
  g.beginPath();
  g.roundRect(bx, by, bw, bh, 4);
  g.fill();
  g.save();
  g.clip();
  if (ch === 9) {
    g.fillStyle = 'rgba(255, 209, 102, 0.35)';
    for (let sx = -bh; sx < bw; sx += 10) {
      g.beginPath();
      g.moveTo(bx + sx, by + bh);
      g.lineTo(bx + sx + 5, by + bh);
      g.lineTo(bx + sx + 5 + bh, by);
      g.lineTo(bx + sx + bh, by);
      g.fill();
    }
  }
  g.fillStyle = 'rgba(255, 255, 255, 0.4)';
  g.fillRect(bx, by, bw, 4);
  g.fillStyle = 'rgba(0, 0, 0, 0.28)';
  g.fillRect(bx, by + bh - 4, bw, 4);
  g.restore();
  if (ch === 7 || ch === 8) {
    g.fillStyle = '#8d99ae';
    for (const rx of [bx + 5, bx + bw - 5]) {
      g.beginPath();
      g.arc(rx, by + bh / 2, 2, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (ch === 8) {
    // A crack across it: one more hit.
    g.strokeStyle = INK;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(bx + bw * 0.3, by);
    g.lineTo(bx + bw * 0.45, by + bh * 0.5);
    g.lineTo(bx + bw * 0.38, by + bh * 0.75);
    g.lineTo(bx + bw * 0.55, by + bh);
    g.stroke();
  }
}

/** The paddle, `width` wide with its middle at (x, y): a cream deck with glowing pink ends. */
function paddle(g: CanvasRenderingContext2D, x: number, y: number, width: number, t: number) {
  const h = PADDLE_H;
  const left = x - width / 2;
  g.save();
  g.shadowColor = '#ff5ecb';
  g.shadowBlur = 10 + 4 * Math.sin(t * 4);
  g.fillStyle = '#ef476f';
  g.beginPath();
  g.roundRect(left, y - h / 2, width, h, h / 2);
  g.fill();
  g.restore();
  g.fillStyle = '#f1ede4';
  g.fillRect(left + 12, y - h / 2, width - 24, h);
  g.fillStyle = '#4cc9f0';
  g.fillRect(left + 16, y - 1.5, width - 32, 3);
  g.fillStyle = 'rgba(255, 255, 255, 0.5)';
  g.fillRect(left + 12, y - h / 2, width - 24, 2.5);
}

/** A ball at (x, y), glowing. */
function ball(g: CanvasRenderingContext2D, x: number, y: number) {
  g.save();
  g.shadowColor = '#ffffff';
  g.shadowBlur = 10;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(x, y, BALL_R, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.fillStyle = 'rgba(76, 201, 240, 0.55)';
  g.beginPath();
  g.arc(x + 1.5, y + 1.5, BALL_R * 0.45, 0, Math.PI * 2);
  g.fill();
}

/** A pill of `kind` (see DROPS) falling at (x, y), with what it does drawn on it. */
function pill(g: CanvasRenderingContext2D, kind: number, x: number, y: number, t: number, scale = 1) {
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  g.shadowColor = PILLS[kind];
  g.shadowBlur = 8 + 4 * Math.sin(t * 6 + x);
  g.fillStyle = PILLS[kind];
  g.beginPath();
  g.roundRect(-15, -7, 30, 14, 7);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255, 255, 255, 0.45)';
  g.fillRect(-9, -6, 18, 2.5);
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.lineWidth = 2;
  g.lineCap = 'round';
  g.beginPath();
  if (kind === 1) {
    // ⟷
    g.moveTo(-8, 0);
    g.lineTo(8, 0);
    for (const s of [-1, 1]) {
      g.moveTo(s * 8, 0);
      g.lineTo(s * 4.5, -3);
      g.moveTo(s * 8, 0);
      g.lineTo(s * 4.5, 3);
    }
    g.stroke();
  } else if (kind === 2) {
    for (const dx of [-6, 0, 6]) g.arc(dx, 0, 2.2, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 3) {
    // A clock.
    g.lineWidth = 1.5;
    g.arc(0, 0, 4.5, 0, Math.PI * 2);
    g.moveTo(0, 0);
    g.lineTo(0, -3);
    g.moveTo(0, 0);
    g.lineTo(2.5, 0);
    g.stroke();
  } else {
    g.moveTo(-4, 0);
    g.lineTo(4, 0);
    g.moveTo(0, -4);
    g.lineTo(0, 4);
    g.stroke();
  }
  g.restore();
}

/** A burst `p` of the way through (0–1): bits of brick `ch` flying out, or a flash for a ball lost off the bottom. */
function pop(g: CanvasRenderingContext2D, x: number, y: number, p: number, ch: number) {
  g.save();
  g.globalAlpha = 1 - p;
  if (!ch) {
    g.fillStyle = '#ff8a5b';
    g.beginPath();
    g.ellipse(x, y, 20 + p * 60, 6 + p * 10, 0, Math.PI, Math.PI * 2);
    g.fill();
  } else {
    g.fillStyle = BRICKS[ch];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.4;
      const r = 4 + p * 22;
      g.fillRect(x + Math.cos(a) * r * 1.4 - 2.5, y + Math.sin(a) * r * 0.8 + p * p * 16 - 2, 5, 4);
    }
  }
  g.restore();
}

/** BRICKBUST as the cabinet plays it (see cart.ts). */
export const brickbust: Cartridge<BrickFrame> = {
  title: 'brickbust',
  blurb: 'Bounce the ball off your paddle and knock the wall down.',
  colors: COLORS,
  keys: {
    ArrowLeft: 'left',
    KeyA: 'left',
    ArrowRight: 'right',
    KeyD: 'right',
    Space: 'launch',
    ArrowUp: 'launch',
    KeyW: 'launch',
  },
  tip: '← → move · Space launch · P pause',
  frameMs: 50,
  start(sound) {
    const g = new Brickbust();
    g.onSound = sound;
    return g;
  },
  paint,
  hear(was, f, sound) {
    if (f.level > was.level) sound('clear', 4);
    else if (f.lives < was.lives) sound('boom');
    else if (f.kills > was.kills) sound('brick', 4);
    // The ball launched, or a ball that was down by the paddle on its way back up.
    const back = f.balls.length === was.balls.length && f.balls.some((y, i) => i % 2 === 1 && was.balls[i] >= PADDLE_Y - 40 && y < was.balls[i]);
    if ((was.cue && !f.cue && f.state === 'play') || back) sound('bounce');
  },
  icon(g, x, y, size) {
    const k = size / 60;
    const bw = 18 * k;
    const bh = 9 * k;
    [6, 5, 2].forEach((ch, row) => {
      for (let c = 0; c < 3; c++) if (row < 2 || c !== 1) brick(g, x + (c - 1.5) * bw, y - 26 * k + row * bh, ch, bw, bh);
    });
    ball(g, x + 6 * k, y + 10 * k);
    paddle(g, x, y + 26 * k, (PADDLE_W / 2.2) * k, 0);
  },
};
