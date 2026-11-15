import { scoreText } from '../../../shared/cabinet';
import { BUG_POINTS, FIELD_H, FIELD_W, type SwarmFrame } from '../../../shared/games/bugswarm';
import { Bugswarm, SHIP_Y } from './bugswarm';
import type { Cartridge, ScreenView } from './cart';
import { DIM, FONT, GOLD, TEXT, W, backdrop, banner, label, lights, playerAndBest, table, value, type Rect } from './paint';

// BUGSWARM's screen (see bugswarm.ts): the field down the middle with the stars going by, the swarm,
// your ship, and the shots and stings between them; the score, the wave and your ships on the left,
// and the high scores and what each bug is worth on the right.

/** Where the field is on the screen. */
const FX = (W - FIELD_W) / 2;
const FIELD: Rect = { x: FX, y: 0, w: FIELD_W, h: FIELD_H };
const EDGE = '#4cc9f0';
const INK = '#2b2d42';
const COLORS = ['#06d6a0', '#ffd166', '#4cc9f0', '#ff5ecb'];

function paint(g: CanvasRenderingContext2D, f: SwarmFrame, v: ScreenView) {
  backdrop(g);
  g.textBaseline = 'middle';
  g.fillStyle = '#05070f';
  g.fillRect(FX, 0, FIELD_W, FIELD_H);

  // The field, clipped so nothing flying off its sides goes over the numbers.
  g.save();
  g.beginPath();
  g.rect(FX, 0, FIELD_W, FIELD_H);
  g.clip();
  g.translate(FX, 0);
  stars(g, v.t);
  g.fillStyle = GOLD;
  for (let i = 0; i < f.shots.length; i += 2) {
    g.beginPath();
    g.roundRect(f.shots[i] - 1.5, f.shots[i + 1] - 7, 3, 13, 1.5);
    g.fill();
  }
  g.fillStyle = '#ff5ecb';
  for (let i = 0; i < f.stings.length; i += 2) {
    const [x, y] = [f.stings[i], f.stings[i + 1]];
    g.beginPath();
    g.moveTo(x, y - 6);
    g.lineTo(x + 3, y);
    g.lineTo(x, y + 6);
    g.lineTo(x - 3, y);
    g.fill();
  }
  for (let i = 0; i < f.bugs.length; i += 4) bug(g, f.bugs[i], f.bugs[i + 1], f.bugs[i + 2], (f.bugs[i + 3] * Math.PI) / 180, v.t, i, f.state === 'play');
  if (f.ship >= 0) ship(g, f.ship, SHIP_Y, v.t, 1);
  for (let i = 0; i < f.pops.length; i += 4) pop(g, f.pops[i], f.pops[i + 1], f.pops[i + 2] / 9, f.pops[i + 3] === 2);
  if (f.state === 'play') {
    g.textAlign = 'center';
    if (!f.bugs.length) {
      lights(g, `WAVE ${f.wave}`, FIELD_W / 2, 250, 48, COLORS);
      g.fillStyle = DIM;
      g.font = `800 18px ${FONT}`;
      g.fillText(f.wave === 1 ? '← → move · Space fire' : 'Here comes the next swarm', FIELD_W / 2, 300);
    } else if (f.ship < 0 && f.ships > 0 && !f.pops.some((_, i) => i % 4 === 3 && f.pops[i] === 2)) {
      g.fillStyle = GOLD;
      g.font = `900 30px ${FONT}`;
      g.fillText('READY', FIELD_W / 2, 400);
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

  // Left: how it's going. Right: the table, and what the bugs are worth.
  const lx = FX / 2;
  const rx = W - FX / 2;
  label(g, 'SCORE', lx, 62);
  value(g, scoreText(f.score), lx, 94, 30, 160);
  label(g, 'WAVE', lx, 150);
  value(g, String(f.wave), lx, 180, 28, 160);
  label(g, 'SHIPS', lx, 236);
  const spare = Math.max(0, f.ships - 1);
  for (let i = 0; i < spare; i++) ship(g, lx + (i - (spare - 1) / 2) * 30, 274, v.t, 0.75, false);
  playerAndBest(g, lx, v.player, v.scores[0] && Math.max(v.scores[0].score, f.score), 150);
  label(g, 'HIGH SCORES', rx, 62);
  if (v.scores.length) table(g, v.scores, rx - 76, 152, 96, 30, 14, v.mine);
  else value(g, 'Be the first!', rx, 96, 16, 160);
  label(g, 'IN ROWS · FLYING', rx, 410);
  for (const kind of [1, 2, 3] as const) {
    const y = 410 + kind * 34;
    bug(g, kind, rx - 52, y, Math.PI / 2, v.t, kind, false, 0.8);
    g.textAlign = 'left';
    g.fillStyle = TEXT;
    g.font = `900 15px ${FONT}`;
    g.fillText(`${BUG_POINTS[kind][0]} · ${BUG_POINTS[kind][1]}`, rx - 30, y);
  }

  if (f.state === 'paused') banner(g, FIELD, 'PAUSED', v.note ?? 'P to carry on', '#4f86f7');
  else if (f.state === 'over') banner(g, FIELD, 'GAME OVER', v.prompt ?? scoreText(f.score), '#e63946');
}

/** The stars going by behind the swarm, nearer ones quicker. */
function stars(g: CanvasRenderingContext2D, t: number) {
  for (let i = 0; i < 70; i++) {
    const r = (n: number) => {
      const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    const near = i % 3;
    const y = (r(1) * FIELD_H + t * (18 + near * 22)) % FIELD_H;
    g.globalAlpha = 0.35 + near * 0.2 + 0.2 * Math.sin(t * 3 + i);
    g.fillStyle = ['#ffffff', '#4cc9f0', '#ff5ecb'][i % 3];
    g.fillRect(r(2) * FIELD_W, y, near === 2 ? 2 : 1.5, near === 2 ? 2 : 1.5);
  }
  g.globalAlpha = 1;
}

function ellipse(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, rot = 0) {
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  g.fill();
}

/**
 * A bug of `kind` (1 gnat, 2 wasp, 3 beetle, 4 a beetle that's been hit) at (x, y), heading
 * `heading` (radians, π/2 is straight down). Its wings beat while `flapping`.
 */
function bug(g: CanvasRenderingContext2D, kind: number, x: number, y: number, heading: number, t: number, seed: number, flapping: boolean, scale = 1) {
  g.save();
  g.translate(x, y);
  // Drawn facing down the screen, its head toward +y.
  g.rotate(heading - Math.PI / 2);
  g.scale(scale, scale);
  const beat = flapping ? Math.abs(Math.sin(t * 18 + seed)) : 0.7;
  const wing = 'rgba(214, 240, 255, 0.6)';
  if (kind === 1) {
    for (const s of [-1, 1]) ellipse(g, s * 7, -3, 3 + 5 * beat, 4, wing, s * 0.5);
    ellipse(g, 0, -1, 5, 8, '#4cc9f0');
    ellipse(g, 0, 7, 4.5, 4, INK);
    for (const s of [-1, 1]) ellipse(g, s * 2, 9, 1.5, 1.5, '#ffffff');
  } else if (kind === 2) {
    for (const s of [-1, 1]) ellipse(g, s * 8, -4, 4 + 6 * beat, 4.5, wing, s * 0.45);
    g.save();
    g.beginPath();
    g.ellipse(0, -5, 6.5, 9, 0, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = GOLD;
    g.fillRect(-7, -14, 14, 18);
    g.fillStyle = INK;
    for (const yy of [-10, -5, 0]) g.fillRect(-7, yy, 14, 2.5);
    g.restore();
    g.fillStyle = INK;
    g.beginPath();
    g.moveTo(-2, -13);
    g.lineTo(0, -18);
    g.lineTo(2, -13);
    g.fill();
    ellipse(g, 0, 6, 5.5, 5, INK);
    for (const s of [-1, 1]) ellipse(g, s * 2.6, 8, 2.1, 2.1, '#ef476f');
    g.strokeStyle = INK;
    g.lineWidth = 1.5;
    g.beginPath();
    for (const s of [-1, 1]) {
      g.moveTo(s * 2, 10);
      g.lineTo(s * 5, 15);
    }
    g.stroke();
  } else {
    // A beetle: legs out from under a round shell, and a head with pincers.
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.beginPath();
    for (const s of [-1, 1]) {
      for (const [ly, dy] of [
        [-6, -4],
        [0, 0],
        [6, 4],
      ]) {
        g.moveTo(s * 9, ly);
        g.lineTo(s * (15 + beat * 2), ly + dy);
      }
    }
    g.stroke();
    ellipse(g, 0, 11, 7, 5.5, INK);
    g.beginPath();
    for (const s of [-1, 1]) {
      g.moveTo(s * 3, 14);
      g.quadraticCurveTo(s * 6, 19, s * 2, 20);
    }
    g.stroke();
    const hurt = kind === 4;
    ellipse(g, 0, -2, 12.5, 13, INK);
    ellipse(g, 0, -2, 11, 11.5, hurt ? '#ff8a5b' : '#06d6a0');
    g.strokeStyle = INK;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -13);
    g.lineTo(0, 9);
    g.stroke();
    for (const s of [-1, 1]) {
      ellipse(g, s * 5, -6, 2.4, 2.4, 'rgba(11, 19, 32, 0.45)');
      ellipse(g, s * 5.5, 2, 2, 2, 'rgba(11, 19, 32, 0.45)');
    }
    if (hurt) {
      // A crack across the shell.
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(-9, -6);
      g.lineTo(-4, -2);
      g.lineTo(-6, 3);
      g.lineTo(-1, 6);
      g.stroke();
    }
    for (const s of [-1, 1]) ellipse(g, s * 3, 12, 1.5, 1.5, '#ffffff');
  }
  g.restore();
}

/** Your ship at (x, y), nose up, its engine burning while `lit`. */
function ship(g: CanvasRenderingContext2D, x: number, y: number, t: number, scale: number, lit = true) {
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  if (lit) {
    const flick = 5 + 4 * Math.abs(Math.sin(t * 40));
    g.fillStyle = '#ff8a5b';
    g.beginPath();
    g.moveTo(-4, 11);
    g.lineTo(0, 13 + flick);
    g.lineTo(4, 11);
    g.fill();
  }
  g.fillStyle = '#ef476f';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(s * 5, -2);
    g.lineTo(s * 16, 11);
    g.lineTo(s * 5, 9);
    g.fill();
  }
  g.fillStyle = '#f1ede4';
  g.strokeStyle = INK;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, -18);
  g.quadraticCurveTo(9, -6, 7, 11);
  g.lineTo(-7, 11);
  g.quadraticCurveTo(-9, -6, 0, -18);
  g.fill();
  g.stroke();
  ellipse(g, 0, -4, 3, 5.5, '#4cc9f0');
  g.fillStyle = '#ef476f';
  g.fillRect(-7, 5, 14, 2.5);
  g.restore();
}

/** A burst `p` of the way through (0–1): a ring and sparks flying out, bigger for your ship. */
function pop(g: CanvasRenderingContext2D, x: number, y: number, p: number, big: boolean) {
  const k = big ? 1.7 : 1;
  g.save();
  g.globalAlpha = 1 - p;
  g.strokeStyle = big ? '#ff8a5b' : GOLD;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(x, y, (4 + p * 16) * k, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = big ? '#ffffff' : '#ff5ecb';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    const r = (6 + p * 22) * k;
    g.fillRect(x + Math.cos(a) * r - 1.5, y + Math.sin(a) * r - 1.5, 3, 3);
  }
  g.restore();
}

/** BUGSWARM as the cabinet plays it (see cart.ts). */
export const bugswarm: Cartridge<SwarmFrame> = {
  title: 'bugswarm',
  blurb: 'Shoot down the swarm before it stings your ship.',
  colors: COLORS,
  keys: {
    ArrowLeft: 'left',
    KeyA: 'left',
    ArrowRight: 'right',
    KeyD: 'right',
    Space: 'fire',
    ArrowUp: 'fire',
    KeyW: 'fire',
    KeyZ: 'fire',
    KeyX: 'fire',
  },
  tip: '← → move · Space fire · P pause',
  frameMs: 50,
  start(sound) {
    const g = new Bugswarm();
    g.onSound = sound;
    return g;
  },
  paint,
  hear(was, f, sound) {
    if (f.ships < was.ships) sound('boom');
    else if (f.kills > was.kills) sound('pop');
    else if (f.shots.length > was.shots.length) sound('shot');
    if (!was.bugs.length && f.bugs.length) sound('wave');
  },
  icon(g, x, y, size) {
    const k = size / 60;
    bug(g, 3, x, y - 12 * k, Math.PI / 2, 0, 0, false, k * 1.2);
    g.fillStyle = GOLD;
    g.fillRect(x - 1.5 * k, y + 6 * k, 3 * k, 9 * k);
    ship(g, x, y + 30 * k, 0, k * 0.85);
  },
};
