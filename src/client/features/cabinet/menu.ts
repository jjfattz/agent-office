import { GAME_NAMES, TITLES, scoreText, type Scores, type Title } from '../../../shared/cabinet';
import { CARTS } from './games';
import { DIM, FONT, GOLD, TEXT, W, backdrop, fit, label, lights, table } from './paint';

// The cabinet's own screens, with no game on: the menu you choose a game from up close (ui.ts), and
// what it shows the room while nobody's at it, every game's high scores in turn.

/** What the cabinet's own screens show. */
export interface MenuView {
  scores: Scores;
  /** Your games, to pick out on the tables. */
  mine: Partial<Record<Title, string>>;
  /** Said at the bottom, blinking. */
  prompt?: string;
  /** Seconds, for the blinking. */
  t: number;
}

/** The menu, besides: the game picked out, and your games waiting for you to come back to them (their scores). */
export interface ChoiceView extends MenuView {
  at: Title;
  paused: Partial<Record<Title, number>>;
}

const TOP = 116;
const GAP = 16;
const CARD_X = 30;
const CARD_W = 420;
/** The cards share the room between the title and the line blinking along the bottom. */
const CARD_H = Math.min(170, (410 - (TITLES.length - 1) * GAP) / TITLES.length);
const ICON = Math.min(112, CARD_H - 30);
/** Down a card: its name, the first line of its blurb, and how you or the building are doing at it. */
const NAME_Y = Math.round(CARD_H * 0.25);
const BLURB_Y = Math.round(CARD_H * 0.47);
const BEST_Y = CARD_H - 22;
/** Where the picked game's table goes. */
const TABLE_X = 625;
/** Each game's high scores are up this long, in turn, while nobody's at the cabinet. */
export const ATTRACT_EACH = 6;

const cardY = (i: number) => TOP + i * (CARD_H + GAP);

/** The game whose card is at (x, y) on the menu, if one is. */
export function cardAt(x: number, y: number): Title | null {
  const i = TITLES.findIndex((_, i) => x >= CARD_X && x <= CARD_X + CARD_W && y >= cardY(i) && y <= cardY(i) + CARD_H);
  return i < 0 ? null : TITLES[i];
}

/** The menu: a card for each game, and the high scores of the one picked out. */
export function paintMenu(g: CanvasRenderingContext2D, v: ChoiceView) {
  backdrop(g);
  g.textBaseline = 'middle';
  lights(g, 'ARCADE', W / 2, 62, 64);
  TITLES.forEach((title, i) => card(g, title, cardY(i), v));
  label(g, '🏆 HIGH SCORES', TABLE_X, TOP + 8);
  lights(g, GAME_NAMES[v.at], TABLE_X, TOP + 42, 26, CARTS[v.at].colors);
  const scores = v.scores[v.at];
  if (scores.length) table(g, scores, TABLE_X - 145, 290, TOP + 84, 32, 18, v.mine[v.at]);
  else none(g, TABLE_X, TOP + 150);
  blink(g, v.prompt ?? '↑ ↓ CHOOSE · ENTER TO PLAY', v.t, 26);
}

/** Nobody at the cabinet: its name, its games, and each one's high scores in turn, with a blinking "press E". */
export function paintAttract(g: CanvasRenderingContext2D, v: MenuView) {
  backdrop(g);
  g.textBaseline = 'middle';
  lights(g, 'ARCADE', W / 2, 70, 76);
  const shown = TITLES[Math.floor(v.t / ATTRACT_EACH) % TITLES.length];
  // The games in a row, the one whose scores are up in lights.
  g.font = `900 24px ${FONT}`;
  const widths = TITLES.map((t) => g.measureText(GAME_NAMES[t]).width);
  let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + 48 * (TITLES.length - 1)) / 2;
  TITLES.forEach((t, i) => {
    if (t === shown) lights(g, GAME_NAMES[t], x, 136, 24, CARTS[t].colors, true);
    else {
      g.textAlign = 'left';
      g.fillStyle = DIM;
      g.fillText(GAME_NAMES[t], x, 136);
    }
    x += widths[i] + 48;
  });
  label(g, '🏆 HIGH SCORES', W / 2, 180);
  const scores = v.scores[shown];
  if (scores.length) table(g, scores, W / 2 - 250, 500, 216, 31, 22, v.mine[shown]);
  else none(g, W / 2, 320);
  blink(g, v.prompt ?? 'PRESS E TO PLAY', v.t, 30);
}

/** A game's card on the menu: its picture, its name in lights, what it is, and how you or the building are doing at it. */
function card(g: CanvasRenderingContext2D, title: Title, y: number, v: ChoiceView) {
  const on = title === v.at;
  const cart = CARTS[title];
  const x = CARD_X;
  g.save();
  g.fillStyle = on ? 'rgba(255, 255, 255, 0.09)' : 'rgba(255, 255, 255, 0.03)';
  g.strokeStyle = on ? cart.colors[0] : 'rgba(255, 255, 255, 0.14)';
  g.lineWidth = on ? 4 : 2;
  if (on) {
    g.shadowColor = cart.colors[0];
    g.shadowBlur = 16;
  }
  g.beginPath();
  g.roundRect(x, y, CARD_W, CARD_H, 18);
  g.fill();
  g.stroke();
  g.restore();
  const iy = y + (CARD_H - ICON) / 2;
  g.fillStyle = '#070b14';
  g.beginPath();
  g.roundRect(x + 18, iy, ICON, ICON, 14);
  g.fill();
  g.globalAlpha = on ? 1 : 0.55;
  cart.icon(g, x + 18 + ICON / 2, iy + ICON / 2, ICON * 0.7);
  const tx = x + ICON + 36;
  const tw = CARD_W - ICON - 54;
  lights(g, GAME_NAMES[title], tx, y + NAME_Y, CARD_H < 150 ? 28 : 32, cart.colors, true);
  g.globalAlpha = 1;
  g.textAlign = 'left';
  g.fillStyle = on ? TEXT : DIM;
  g.font = `800 15px ${FONT}`;
  wrap(g, cart.blurb, tw).forEach((text, i) => g.fillText(text, tx, y + BLURB_Y + i * 19));
  const paused = v.paused[title];
  const best = v.scores[title][0];
  g.font = `900 15px ${FONT}`;
  if (paused !== undefined) {
    g.fillStyle = GOLD;
    g.fillText(fit(g, `⏸ YOURS, PAUSED AT ${scoreText(paused)}`, tw), tx, y + BEST_Y);
  } else {
    g.fillStyle = best ? TEXT : DIM;
    g.fillText(fit(g, best ? `🏆 ${scoreText(best.score)} · ${best.name}` : 'No scores yet', tw), tx, y + BEST_Y);
  }
}

/** `text` in lines no wider than `width`, at most two. */
function wrap(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(' ')) {
    const last = lines.length - 1;
    if (last >= 0 && g.measureText(`${lines[last]} ${word}`).width <= width) lines[last] += ` ${word}`;
    else lines.push(word);
  }
  return lines.length > 2 ? [lines[0], fit(g, lines.slice(1).join(' '), width)] : lines;
}

function none(g: CanvasRenderingContext2D, x: number, y: number) {
  g.textAlign = 'center';
  g.fillStyle = DIM;
  g.font = `800 22px ${FONT}`;
  g.fillText('No scores yet. Be the first!', x, y);
}

/** What to press, along the bottom, blinking. */
function blink(g: CanvasRenderingContext2D, text: string, t: number, size: number) {
  if (Math.floor(t * 1.6) % 2) return;
  g.textAlign = 'center';
  g.fillStyle = GOLD;
  g.font = `900 ${size}px ${FONT}`;
  g.fillText(text, W / 2, 560);
}
