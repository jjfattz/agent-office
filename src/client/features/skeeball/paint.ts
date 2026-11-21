import * as THREE from 'three';
import { BALLS, CORNERS, RINGS } from '../../../shared/skeeball';

// What's painted on the skeeball machine: the target's rings, the marquee, and the score display.

const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';
const INK = '#2b2d42';
/** Each ring's color, out from the 50, and the 10 round them all. */
const RING_COLORS: Record<number, string> = { 50: '#ef476f', 40: '#ffd166', 30: '#06d6a0', 20: '#118ab2', 10: '#073b4c' };

/** What the score display shows: nobody playing (your best), a game under way, or one just over. */
export type DisplayState =
  | { kind: 'idle'; best: number | null }
  | { kind: 'game'; name: string; color: string; score: number; ball: number }
  | { kind: 'over'; name: string; color: string; score: number; best: boolean };

/** The target, `w` across and `long` up its slope: the rings round the 50, the 100 pockets and the 10 below. */
export function paintFace(w: number, long: number): THREE.CanvasTexture {
  const px = 640;
  const c = document.createElement('canvas');
  c.width = Math.round(px * w);
  c.height = Math.round(px * long);
  const g = c.getContext('2d')!;
  // d up the face is up the canvas, u across is across it.
  const X = (u: number) => (u + w / 2) * px;
  const Y = (d: number) => (long - d) * px;
  g.fillStyle = RING_COLORS[10];
  g.fillRect(0, 0, c.width, c.height);
  // The gutter along the bottom, where a short or a wide ball ends up.
  g.fillStyle = '#05202b';
  g.fillRect(0, Y(0.06), c.width, 0.06 * px);
  g.font = `900 ${0.05 * px}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffffcc';
  g.fillText('10', X(-w / 3), Y(0.14));
  g.fillText('10', X(w / 3), Y(0.14));
  // The rings, outside in: each one a band, its hole a dark gap round its inside edge.
  const bands = [...RINGS.bands].reverse();
  bands.forEach(([r, points], i) => {
    const inner = i + 1 < bands.length ? bands[i + 1][0] : 0;
    g.beginPath();
    g.arc(X(0), Y(RINGS.d), r * px, 0, Math.PI * 2);
    g.fillStyle = RING_COLORS[points];
    g.fill();
    g.lineWidth = 0.012 * px;
    g.strokeStyle = INK;
    g.stroke();
    if (inner) {
      // The gap a ball drops through, round the bottom of the band.
      g.beginPath();
      g.arc(X(0), Y(RINGS.d), inner * px + 0.012 * px, Math.PI * 0.15, Math.PI * 0.85);
      g.lineWidth = 0.02 * px;
      g.strokeStyle = '#111';
      g.stroke();
    }
    g.fillStyle = points === 40 ? INK : '#fff';
    g.font = `900 ${(points === 50 ? 0.06 : 0.042) * px}px ${FONT}`;
    g.fillText(String(points), X(0), points === 50 ? Y(RINGS.d) : Y(RINGS.d + (r + inner) / 2));
  });
  // The 50's cup in the middle.
  g.beginPath();
  g.arc(X(0), Y(RINGS.d), 0.035 * px, 0, Math.PI * 2);
  g.fillStyle = '#00000055';
  g.fill();
  g.fillStyle = '#fff';
  g.font = `900 ${0.05 * px}px ${FONT}`;
  g.fillText('50', X(0), Y(RINGS.d));
  // The 100 pockets up in the corners.
  for (const side of [-1, 1]) {
    g.beginPath();
    g.arc(X(side * CORNERS.u), Y(CORNERS.d), CORNERS.r * px, 0, Math.PI * 2);
    g.fillStyle = '#111';
    g.fill();
    g.fillStyle = '#ffd166';
    g.font = `900 ${0.034 * px}px ${FONT}`;
    g.fillText('100', X(side * CORNERS.u), Y(CORNERS.d - CORNERS.r - 0.03));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** The marquee, in lights. */
export function paintMarquee(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 236;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, '#3a0ca3');
  grad.addColorStop(1, '#7209b7');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  g.lineWidth = 10;
  g.strokeStyle = '#ffd166';
  g.strokeRect(5, 5, c.width - 10, c.height - 10);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 92px ${FONT}`;
  g.lineWidth = 12;
  g.strokeStyle = INK;
  g.strokeText('ROLL & SCORE', c.width / 2, c.height / 2 - 12, c.width - 50);
  g.fillStyle = '#ffd166';
  g.fillText('ROLL & SCORE', c.width / 2, c.height / 2 - 12, c.width - 50);
  g.font = `800 34px ${FONT}`;
  g.fillStyle = '#fff';
  g.fillText(`roll ${BALLS} · score big`, c.width / 2, c.height - 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The score display: an LED board, amber on black. */
export function paintDisplay(c: HTMLCanvasElement, s: DisplayState) {
  const g = c.getContext('2d')!;
  const { width: w, height: h } = c;
  g.fillStyle = '#0b0b12';
  g.fillRect(0, 0, w, h);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const led = '#ffb703';
  g.shadowColor = led;
  g.shadowBlur = 14;
  const name = (n: string) => (n.length > 16 ? `${n.slice(0, 15)}…` : n);
  if (s.kind === 'idle') {
    g.fillStyle = led;
    g.font = `900 64px ${FONT}`;
    g.fillText('PRESS E', w / 2, h / 2 - 34);
    g.font = `800 40px ${FONT}`;
    g.fillStyle = '#fff3b0';
    g.fillText(s.best === null ? 'TO PLAY' : `YOUR BEST ${s.best}`, w / 2, h / 2 + 44);
  } else {
    g.fillStyle = s.color;
    g.font = `800 36px ${FONT}`;
    g.fillText(name(s.name), w / 2, 36);
    g.fillStyle = led;
    g.font = `900 104px ${FONT}`;
    g.fillText(String(s.score).padStart(3, '0'), w / 2, h / 2 + 8);
    g.font = `800 34px ${FONT}`;
    g.fillStyle = '#fff3b0';
    g.fillText(s.kind === 'game' ? `BALL ${Math.min(s.ball, BALLS)} OF ${BALLS}` : s.best ? 'NEW BEST!' : 'GAME OVER', w / 2, h - 34);
  }
  g.shadowBlur = 0;
}
