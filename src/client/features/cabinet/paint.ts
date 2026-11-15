import { scoreText, type HighScore } from '../../../shared/cabinet';

// What the cabinet's screens are painted with: every game's (blocks.ts, bugswarm-paint.ts) and the
// menu's (menu.ts). They all draw in the same fixed 800×600 units, so the player's screen, the cabinet
// in the office and everyone watching show the same picture.

export const W = 800;
export const H = 600;

export const FONT = "Nunito, ui-rounded, 'SF Pro Rounded', system-ui, sans-serif";
export const INK = '#0b1320';
export const TEXT = '#f1ede4';
export const DIM = '#8d99ae';
export const NEON = '#ff5ecb';
export const GOLD = '#ffd166';
/** The office's bright colors, for names in lights. */
export const LIGHTS = ['#4cc9f0', '#ffd166', '#b388eb', '#06d6a0', '#ef476f', '#4f86f7', '#ff8a5b'];

/** A box on the screen. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The screen's dark blue, top to bottom. */
export function backdrop(g: CanvasRenderingContext2D) {
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1b1d3a');
  bg.addColorStop(1, INK);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
}

/** Scan lines, like the tube it would have had. */
export function scanlines(g: CanvasRenderingContext2D) {
  g.fillStyle = 'rgba(0, 0, 0, 0.12)';
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1.5);
}

/** `text` in lights: each letter in the next of `colors`, glowing, centered on (cx, cy) unless `left`. */
export function lights(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, size: number, colors: readonly string[] = LIGHTS, left = false) {
  g.save();
  g.font = `900 ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const letters = [...text];
  const widths = letters.map((ch) => g.measureText(ch).width);
  let x = left ? cx : cx - widths.reduce((a, b) => a + b, 0) / 2;
  letters.forEach((ch, i) => {
    g.fillStyle = colors[i % colors.length];
    g.shadowColor = g.fillStyle;
    g.shadowBlur = size / 4.5;
    g.fillText(ch, x + widths[i] / 2, cy);
    x += widths[i];
  });
  g.restore();
}

/** A high-score table: place, name and score, `width` wide from `x`, a row every `step` from `y`, in `size` px. `mine` is picked out. */
export function table(g: CanvasRenderingContext2D, scores: readonly HighScore[], x: number, width: number, y: number, step: number, size: number, mine?: string) {
  scores.forEach((s, i) => {
    const cy = y + i * step;
    if (s.game === mine) {
      g.fillStyle = 'rgba(255, 209, 102, 0.22)';
      g.beginPath();
      g.roundRect(x - 8, cy - step / 2 + 2, width + 16, step - 4, 8);
      g.fill();
    }
    g.font = `900 ${size}px ${FONT}`;
    const score = scoreText(s.score);
    const place = size * 1.6;
    g.textAlign = 'left';
    g.fillStyle = i === 0 ? GOLD : DIM;
    g.fillText(String(i + 1), x, cy);
    g.fillStyle = s.color;
    g.fillText(fit(g, s.name, width - place - g.measureText(score).width - size), x + place, cy);
    g.textAlign = 'right';
    g.fillStyle = TEXT;
    g.fillText(score, x + width, cy);
  });
}

/** Big words across `r` (a game's well or field), shaded over, and a line under them. */
export function banner(g: CanvasRenderingContext2D, r: Rect, title: string, sub: string, color: string) {
  g.fillStyle = 'rgba(7, 11, 20, 0.72)';
  g.fillRect(r.x, r.y, r.w, r.h);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(r.x - 30, cy - 62, r.w + 60, 112, 16);
  g.fill();
  g.textAlign = 'center';
  g.fillStyle = '#ffffff';
  g.font = `900 44px ${FONT}`;
  g.fillText(title, cx, cy - 22);
  g.font = `800 18px ${FONT}`;
  g.fillText(fit(g, sub, r.w + 40), cx, cy + 22);
}

/** A small heading. */
export function label(g: CanvasRenderingContext2D, text: string, x: number, y: number) {
  g.textAlign = 'center';
  g.fillStyle = DIM;
  g.font = `900 16px ${FONT}`;
  g.fillText(text, x, y);
}

/** A number (or a few words) under a heading, cut to `width`. */
export function value(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, width = 200) {
  g.textAlign = 'center';
  g.fillStyle = TEXT;
  g.font = `900 ${size}px ${FONT}`;
  g.fillText(fit(g, text, width), x, y);
}

/** Who's playing, and the best score there is (or this one, if it's better), under the game's numbers. */
export function playerAndBest(g: CanvasRenderingContext2D, x: number, player: string | undefined, best: number | undefined, width: number) {
  g.textAlign = 'center';
  if (player) {
    g.fillStyle = GOLD;
    g.font = `900 20px ${FONT}`;
    g.fillText(`▶ ${fit(g, player.toUpperCase(), width)}`, x, 470);
  }
  if (best !== undefined) {
    g.fillStyle = DIM;
    g.font = `800 16px ${FONT}`;
    g.fillText(`HI ${scoreText(best)}`, x, 502);
  }
}

export function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

/** `text`, cut short with … to fit in `width` in the current font. */
export function fit(g: CanvasRenderingContext2D, text: string, width: number): string {
  if (g.measureText(text).width <= width) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > width) s = s.slice(0, -1);
  return `${s}…`;
}
