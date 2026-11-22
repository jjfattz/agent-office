import { HOLES, toPar } from '../../../shared/course';
import { $, h } from '../../ui/dom';
import type { GolfRound } from './round';
import './ui.css';

// The scorecard at the top of the screen while you're out on the course between shots: the three
// holes with their pars and your scores, the one you're on lit up, and a line saying what's next.

export class Scorecard {
  private readonly panel: HTMLElement;
  private readonly table: HTMLElement;
  private readonly note: HTMLElement;
  private shown = '';

  constructor() {
    this.table = h('div.golf-card-grid');
    this.note = h('div.golf-card-note');
    this.panel = h('div.golf-card.panel.hidden', { 'aria-label': 'Scorecard' }, this.table, this.note);
    $('hud').append(this.panel);
  }

  /** Shows the card for `round`, with `note` under it; null hides it. */
  show(round: GolfRound | null, note = ''): void {
    if (!round) {
      if (this.shown) this.panel.classList.add('hidden');
      this.shown = '';
      return;
    }
    // The holes in the order you play them, from the tee you started at.
    const order = HOLES.map((_, i) => (round.start + i) % HOLES.length);
    const key = `${order.join()}|${round.card.join()}|${round.hole}|${round.strokes}|${round.done}|${note}`;
    if (key === this.shown) return;
    if (!this.shown) this.panel.classList.remove('hidden');
    this.shown = key;
    const cell = (text: string | number, cls = '') => h('span', { class: cls.split('.').join(' ').trim() || undefined }, String(text));
    const par = order.reduce((n, i) => n + HOLES[i].par, 0);
    const now = (i: number) => !round.done && i === round.hole;
    this.table.replaceChildren(
      cell('Hole', '.golf-card-head'),
      ...order.map((i) => cell(HOLES[i].n, `.golf-card-head${now(i) ? '.now' : ''}`)),
      cell('Tot', '.golf-card-head'),
      cell('Par'),
      ...order.map((i) => cell(HOLES[i].par)),
      cell(par),
      cell('You'),
      ...order.map((i) => {
        const s = round.card[i];
        const cls = s === null ? (now(i) ? '.now' : '') : s < HOLES[i].par ? '.under' : s > HOLES[i].par ? '.over' : '';
        return cell(s ?? (now(i) && round.strokes ? `${round.strokes}…` : '–'), cls);
      }),
      cell(round.played ? `${round.total} (${toPar(round.toPar)})` : '–', '.golf-card-total'),
    );
    this.note.textContent = note;
  }
}
