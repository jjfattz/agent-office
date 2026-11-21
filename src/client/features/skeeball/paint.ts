import * as THREE from 'three';
import { BALLS, CORNERS, HOLE_SPREAD, RINGS } from '../../../shared/skeeball';

// What's painted on the skeeball machine: the target's rings, the maple lane, the side art, the
// marquee, the front's coin door, the net and the score display.

const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';
const INK = '#14112b';
/** Each ring's color, out from the 50, and the 10 round them all. */
export const RING_COLORS: Record<number, string> = { 50: '#ff3d7f', 40: '#ffbe0b', 30: '#3ddc97', 20: '#3a86ff', 10: '#2b1d6b' };

/** What the score display shows: nobody playing (your best), a game under way, or one just over. */
export type DisplayState =
  | { kind: 'idle'; best: number | null }
  | { kind: 'game'; name: string; color: string; score: number; ball: number }
  | { kind: 'over'; name: string; color: string; score: number; best: boolean };

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** The target, `w` across and `long` up its slope: the rings round the 50, the 100 pockets and the 10 below, with each ring's hole round its bottom. */
export function paintFace(w: number, long: number): THREE.CanvasTexture {
  const px = 700;
  const [c, g] = canvas(Math.round(px * w), Math.round(px * long));
  // d up the face is up the canvas, u across is across it.
  const X = (u: number) => (u + w / 2) * px;
  const Y = (d: number) => (long - d) * px;
  const bg = g.createLinearGradient(0, 0, 0, c.height);
  bg.addColorStop(0, '#3b1f8f');
  bg.addColorStop(1, RING_COLORS[10]);
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  // Rays out from the middle, faintly.
  g.save();
  g.translate(X(0), Y(RINGS.d));
  g.fillStyle = 'rgba(255,255,255,.05)';
  for (let i = 0; i < 16; i++) {
    g.rotate(Math.PI / 8);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(-0.05 * px, -1.2 * px);
    g.lineTo(0.05 * px, -1.2 * px);
    g.fill();
  }
  g.restore();
  // The gutter along the bottom, where a short or a wide ball ends up, and its 10s.
  g.fillStyle = '#0b0820';
  g.fillRect(0, Y(0.05), c.width, 0.05 * px);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 ${0.055 * px}px ${FONT}`;
  g.fillStyle = '#ffffffb0';
  for (const side of [-1, 1]) g.fillText('10', X((side * w) / 3), Y(0.16));
  // The rings, outside in, each a step up from the one round it.
  const bands = [...RINGS.bands].reverse();
  bands.forEach(([r, points], i) => {
    const inner = i + 1 < bands.length ? bands[i + 1][0] : 0;
    const grad = g.createRadialGradient(X(0), Y(RINGS.d) - 0.02 * px, inner * px, X(0), Y(RINGS.d), r * px);
    grad.addColorStop(0, shade(RING_COLORS[points], 0.25));
    grad.addColorStop(1, RING_COLORS[points]);
    g.beginPath();
    g.arc(X(0), Y(RINGS.d), r * px, 0, Math.PI * 2);
    g.fillStyle = grad;
    g.fill();
    if (points !== 50) {
      // The hole: a dark slot round the bottom of the band, just inside its lip.
      g.beginPath();
      g.arc(X(0), Y(RINGS.d), (r - 0.022) * px, Math.PI / 2 - HOLE_SPREAD, Math.PI / 2 + HOLE_SPREAD);
      g.lineWidth = 0.03 * px;
      g.lineCap = 'round';
      g.strokeStyle = '#07051a';
      g.stroke();
    }
    g.fillStyle = points === 40 ? INK : '#fff';
    g.font = `900 ${0.045 * px}px ${FONT}`;
    if (points !== 50) g.fillText(String(points), X(0), Y(RINGS.d + (r + inner) / 2));
  });
  // The 50's cup in the middle.
  g.beginPath();
  g.arc(X(0), Y(RINGS.d), 0.05 * px, 0, Math.PI * 2);
  g.fillStyle = '#07051a';
  g.fill();
  g.fillStyle = '#fff';
  g.font = `900 ${0.04 * px}px ${FONT}`;
  g.fillText('50', X(0), Y(RINGS.d + 0.062));
  // The 100 pockets up in the corners.
  for (const side of [-1, 1]) {
    g.beginPath();
    g.arc(X(side * CORNERS.u), Y(CORNERS.d), CORNERS.r * px, 0, Math.PI * 2);
    g.fillStyle = '#07051a';
    g.fill();
    g.fillStyle = '#ffd166';
    g.font = `900 ${0.04 * px}px ${FONT}`;
    g.fillText('100', X(side * CORNERS.u), Y(CORNERS.d - CORNERS.r - 0.035));
  }
  return texture(c);
}

/** A color `k` of the way to white. */
function shade(color: string, k: number): string {
  return `#${new THREE.Color(color).lerp(new THREE.Color('#ffffff'), k).getHexString()}`;
}

/** The lane: maple boards along it, a foul line, the aiming arrows and dots. `long` and `w` are its size. */
export function paintLane(long: number, w: number): THREE.CanvasTexture {
  const px = 300;
  const [c, g] = canvas(Math.round(long * px), Math.round(w * px));
  // Along the lane is across the canvas.
  g.fillStyle = '#e9bd84';
  g.fillRect(0, 0, c.width, c.height);
  const boards = 9;
  for (let i = 0; i < boards; i++) {
    const y0 = (i * c.height) / boards;
    g.fillStyle = i % 2 ? 'rgba(160,100,40,.10)' : 'rgba(255,240,210,.12)';
    g.fillRect(0, y0, c.width, c.height / boards);
    g.fillStyle = 'rgba(120,70,30,.35)';
    g.fillRect(0, y0, c.width, 1.5);
    // Grain.
    for (let k = 0; k < 8; k++) {
      g.strokeStyle = 'rgba(140,85,35,.12)';
      g.lineWidth = 1;
      g.beginPath();
      const yy = y0 + ((k + 0.5) * c.height) / boards / 8;
      g.moveTo(0, yy);
      for (let x = 0; x <= c.width; x += 40) g.lineTo(x, yy + Math.sin(x * 0.02 + i * 3 + k) * 1.5);
      g.stroke();
    }
  }
  // The foul line, and dots and arrows to aim by.
  g.fillStyle = '#c1121f';
  g.fillRect(0.06 * px, 0, 0.025 * px, c.height);
  g.fillStyle = '#5b2a86';
  const mid = c.height / 2;
  for (const k of [-3, -2, -1, 0, 1, 2, 3]) {
    const y = mid + (k * c.height) / 9;
    g.beginPath();
    g.arc(0.3 * px, y, 0.012 * px, 0, Math.PI * 2);
    g.fill();
    const x = (0.75 + Math.abs(k) * 0.07) * px;
    g.beginPath();
    g.moveTo(x + 0.06 * px, y);
    g.lineTo(x, y - 0.025 * px);
    g.lineTo(x, y + 0.025 * px);
    g.fill();
  }
  return texture(c);
}

/** The side panels' art: a sunset sweep with stars and racing stripes. It's mapped over the side by meters (`long` along, `high` up). */
export function paintSide(long: number, high: number): THREE.CanvasTexture {
  const px = 160;
  const [c, g] = canvas(Math.round(long * px), Math.round(high * px));
  const Y = (y: number) => (high - y) * px;
  const grad = g.createLinearGradient(0, Y(0), c.width, Y(high));
  grad.addColorStop(0, '#c9184a');
  grad.addColorStop(0.55, '#7b2cbf');
  grad.addColorStop(1, '#240046');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  // Racing stripes, sweeping up toward the target.
  const stripes: [string, number][] = [
    ['#ffbe0b', 0.42],
    ['#fb5607', 0.34],
    ['#ff006e', 0.26],
  ];
  for (const [color, y] of stripes) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, Y(y));
    g.lineTo(long * 0.55 * px, Y(y));
    g.quadraticCurveTo(long * 0.75 * px, Y(y), long * 0.88 * px, Y(y + 0.7));
    g.lineTo(long * 0.88 * px, Y(y + 0.75));
    g.quadraticCurveTo(long * 0.74 * px, Y(y + 0.06), long * 0.55 * px, Y(y + 0.06));
    g.lineTo(0, Y(y + 0.06));
    g.fill();
  }
  // Stars.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) star(g, rnd() * c.width, Y(0.5 + rnd() * (high - 0.6)), (0.015 + rnd() * 0.03) * px, `rgba(255,255,255,${0.35 + rnd() * 0.5})`);
  // A dark kick strip along the floor.
  g.fillStyle = '#10002b';
  g.fillRect(0, Y(0.08), c.width, 0.08 * px);
  const tex = texture(c);
  tex.repeat.set(1 / long, 1 / high);
  return tex;
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * 0.42 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.fill();
}

/** The front under the trough: a coin door with FREE PLAY lit on it, and the ticket slot. `w` by `h` meters. */
export function paintFront(w: number, h: number): THREE.CanvasTexture {
  const px = 400;
  const [c, g] = canvas(Math.round(w * px), Math.round(h * px));
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, '#5a189a');
  grad.addColorStop(1, '#240046');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  // The coin door.
  const dw = 0.3 * px;
  const dh = 0.3 * px;
  const dx = (c.width - dw) / 2;
  const dy = 0.08 * px;
  g.fillStyle = '#adb5bd';
  g.beginPath();
  g.roundRect(dx, dy, dw, dh, 10);
  g.fill();
  g.fillStyle = '#6c757d';
  for (const k of [0.3, 0.7]) {
    g.fillStyle = '#ff5d8f';
    g.fillRect(dx + dw * k - 6, dy + 18, 12, 40);
    g.fillStyle = '#212529';
    g.fillRect(dx + dw * k - 3, dy + 24, 6, 28);
  }
  g.fillStyle = '#212529';
  g.fillRect(dx + 20, dy + dh - 46, dw - 40, 24);
  g.fillStyle = '#ffbe0b';
  g.font = `900 ${0.045 * px}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('FREE PLAY', dx + dw / 2, dy + dh - 34);
  // The ticket slot, with a ticket hanging out of it.
  const tx = c.width * 0.8;
  g.fillStyle = '#212529';
  g.fillRect(tx - 40, dy + 30, 80, 10);
  g.fillStyle = '#ff4d6d';
  g.fillRect(tx - 22, dy + 38, 44, 0.12 * px);
  g.fillStyle = '#fff';
  g.font = `800 ${0.02 * px}px ${FONT}`;
  g.fillText('TICKET', tx, dy + 38 + 0.06 * px);
  for (const x of [c.width * 0.12, c.width * 0.88]) star(g, x, c.height * 0.35, 0.05 * px, '#ffbe0b');
  return texture(c);
}

/** The marquee: an arch, in lights. Transparent round the arch. */
export function paintMarquee(): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 512);
  const W = c.width;
  const H = c.height;
  const r = W / 2 - 8;
  const arch = new Path2D();
  arch.moveTo(8, H - 8);
  arch.lineTo(8, H - r * 0.62);
  arch.ellipse(W / 2, H - r * 0.62, r, r * 0.62 * 0.95, 0, Math.PI, 0);
  arch.lineTo(W - 8, H - 8);
  arch.closePath();
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#ff006e');
  grad.addColorStop(0.6, '#8338ec');
  grad.addColorStop(1, '#3a0ca3');
  g.fillStyle = grad;
  g.fill(arch);
  g.lineWidth = 16;
  g.strokeStyle = '#ffbe0b';
  g.stroke(arch);
  // Rays from the bottom.
  g.save();
  g.clip(arch);
  g.translate(W / 2, H);
  g.fillStyle = 'rgba(255,255,255,.08)';
  for (let i = 0; i < 9; i++) {
    g.rotate(Math.PI / 10);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(-30, -H);
    g.lineTo(30, -H);
    g.fill();
  }
  g.restore();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 150px ${FONT}`;
  g.lineJoin = 'round';
  g.lineWidth = 26;
  g.strokeStyle = INK;
  g.strokeText('ROLL & SCORE', W / 2, H * 0.6, W - 140);
  g.shadowColor = '#ffbe0b';
  g.shadowBlur = 30;
  g.fillStyle = '#fff3b0';
  g.fillText('ROLL & SCORE', W / 2, H * 0.6, W - 140);
  g.shadowBlur = 0;
  g.font = `800 54px ${FONT}`;
  g.fillStyle = '#fff';
  g.fillText(`★ ${BALLS} BALLS ★`, W / 2, H * 0.84);
  return texture(c);
}

/** A net: fine dark cord, see-through between. */
export function paintNet(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.strokeStyle = 'rgba(20,17,43,.6)';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 64);
  g.moveTo(64, 0);
  g.lineTo(0, 64);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** A soft dark patch, for the machine's shadow on the floor. */
export function paintShadow(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 64);
  const grad = g.createRadialGradient(64, 32, 4, 64, 32, 64);
  grad.addColorStop(0, 'rgba(0,0,0,.45)');
  grad.addColorStop(0.7, 'rgba(0,0,0,.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 64);
  return new THREE.CanvasTexture(c);
}

/** The score display: amber LEDs on black, with a lamp for each ball of the game. */
export function paintDisplay(c: HTMLCanvasElement, s: DisplayState) {
  const g = c.getContext('2d')!;
  const { width: w, height: h } = c;
  g.fillStyle = '#07050f';
  g.fillRect(0, 0, w, h);
  // The LED grid behind it all.
  g.fillStyle = '#1a1206';
  for (let x = 6; x < w; x += 12) for (let y = 6; y < h; y += 12) g.fillRect(x - 2, y - 2, 4, 4);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const led = '#ffb703';
  g.shadowColor = led;
  g.shadowBlur = 18;
  const name = (n: string) => (n.length > 16 ? `${n.slice(0, 15)}…` : n);
  if (s.kind === 'idle') {
    g.fillStyle = led;
    g.font = `900 70px ${FONT}`;
    g.fillText('PRESS E', w / 2, h / 2 - 34);
    g.font = `800 40px ${FONT}`;
    g.fillStyle = '#fff3b0';
    g.fillText(s.best === null ? 'TO PLAY' : `YOUR BEST ${s.best}`, w / 2, h / 2 + 46);
  } else {
    g.fillStyle = s.color;
    g.shadowColor = s.color;
    g.font = `800 34px ${FONT}`;
    g.fillText(name(s.name), w / 2, 30);
    g.shadowColor = led;
    g.fillStyle = led;
    g.font = `900 112px ${FONT}`;
    g.fillText(String(s.score).padStart(3, '0'), w / 2, h / 2 + 4);
    g.font = `800 28px ${FONT}`;
    g.fillStyle = '#fff3b0';
    if (s.kind === 'over') g.fillText(s.best ? 'NEW BEST!' : 'GAME OVER', w / 2, h - 30);
    else {
      // A lamp a ball: lit for the ones still to roll.
      for (let i = 0; i < BALLS; i++) {
        const x = w / 2 + (i - (BALLS - 1) / 2) * 34;
        g.beginPath();
        g.arc(x, h - 28, 10, 0, Math.PI * 2);
        g.fillStyle = i >= s.ball - 1 ? '#3ddc97' : '#2a2a2a';
        g.shadowColor = g.fillStyle;
        g.fill();
      }
    }
  }
  g.shadowBlur = 0;
}
