// The boss's computer's library, on its screen: the consoles down the side, the games as cards with
// their pictures, a search, and what you've picked out (its story, its saved games, Play) on the right.
import { RETRO_SYSTEMS, SYSTEM_IDS, type RetroSystem } from '../../../shared/retro';
import { h, timeAgo } from '../../ui/dom';
import type { Game } from './games';
import { saves, type SaveRecord } from './store';

/** Where to start a game from: where you left it, the start, or one of your saves. */
export type From = 'resume' | 'new' | SaveRecord;

export interface LibraryEvents {
  play(game: Game, from: From): void;
  /** Back to the game that's going, which you'd stepped away from to look at the library. */
  back(): void;
  remove(game: Game): void;
  add(): void;
}

/** What the side lists: every game, the ones you played last, a console's, or the ones from one place. */
type Shelf = 'all' | 'recent' | Game['source'] | RetroSystem;

/** Where a game is from, on its card. */
const SOURCE_TAG = { catalog: '🎁', shelf: '📁', mine: '💾' } as const;

export class Library {
  readonly el: HTMLElement;
  private readonly side = h('nav.retro-side', { 'aria-label': 'Consoles' });
  private readonly search = h('input', { type: 'search', placeholder: 'Search games…', 'aria-label': 'Search games', spellcheck: 'false' });
  private readonly grid = h('div.retro-grid', { role: 'listbox', 'aria-label': 'Games' });
  private readonly info = h('aside.retro-info');
  private games: Game[] = [];
  private resumes = new Map<string, SaveRecord>();
  private recent: string[] = [];
  private playing: Game | null = null;
  private shelf: Shelf = 'all';
  private shown: Game[] = [];
  private selected: Game | null = null;
  private infoFor = '';

  constructor(private readonly events: LibraryEvents) {
    const add = h('button.btn.retro-add', { type: 'button', title: 'Add game files from your computer (or drop them on the screen)' }, '＋ Add games');
    add.addEventListener('click', () => events.add());
    this.search.addEventListener('input', () => this.render());
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        // The library's own keys (see key) are the window's: this one's done here.
        e.preventDefault();
        e.stopPropagation();
        this.search.blur();
        if (e.key === 'Enter' && this.selected) this.playSelected();
      }
    });
    this.el = h(
      'div.retro-lib',
      {},
      this.side,
      h('section.retro-main', {}, h('div.retro-top', {}, this.search, add), this.grid),
      this.info,
    );
  }

  /** What there is to play, where you left each game, what you played last, and the game that's going. */
  set(games: Game[], resumes: Map<string, SaveRecord>, recent: string[], playing: Game | null) {
    this.games = games;
    this.resumes = resumes;
    this.recent = recent;
    this.playing = playing;
    // The same game stays picked out (it's a new copy of it, with more said about it).
    const was = this.selected?.key;
    this.selected = games.find((g) => g.key === was) ?? null;
    if (this.shelf === 'recent' && !this.recentGames().length) this.shelf = 'all';
    if ((this.shelf === 'shelf' || this.shelf === 'mine') && !games.some((g) => g.source === this.shelf)) this.shelf = 'all';
    this.renderSide();
    this.render();
  }

  /** Arrow keys move through the games, Enter plays, and / searches. Says whether it took the key. */
  key(e: KeyboardEvent): boolean {
    if (document.activeElement === this.search) return false;
    if (e.key === '/') {
      this.search.focus();
      return true;
    }
    if (e.key === 'Enter') {
      if (this.selected) this.playSelected();
      return true;
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -this.columns(), ArrowDown: this.columns() }[e.key];
    if (!step || !this.shown.length) return false;
    const at = this.selected ? this.shown.indexOf(this.selected) : -1;
    this.select(this.shown[Math.max(0, Math.min(this.shown.length - 1, at < 0 ? 0 : at + step))], true);
    return true;
  }

  private recentGames(): Game[] {
    const byKey = new Map(this.games.map((g) => [g.key, g]));
    return this.recent.map((k) => byKey.get(k)).filter((g): g is Game => !!g);
  }

  private renderSide() {
    const count = (fn: (g: Game) => boolean) => this.games.filter(fn).length;
    const item = (shelf: Shelf, label: string, n: number) => {
      const b = h('button.retro-nav', { type: 'button', 'aria-pressed': String(this.shelf === shelf) }, h('span', {}, label), h('span.n', {}, String(n)));
      b.classList.toggle('sel', this.shelf === shelf);
      b.addEventListener('click', () => {
        this.shelf = shelf;
        this.search.value = '';
        this.renderSide();
        this.render();
      });
      return b;
    };
    const recent = this.recentGames().length;
    const shelf = count((g) => g.source === 'shelf');
    const mine = count((g) => g.source === 'mine');
    const homebrew = count((g) => g.source === 'catalog');
    const consoles = SYSTEM_IDS.map((id) => [id, count((g) => g.system === id)] as const).filter(([, n]) => n > 0);
    this.side.replaceChildren(
      ...present(
        h('div.retro-brand', {}, 'OVERTIME', h('small', {}, 'retro games')),
        item('all', '★ All games', this.games.length),
        recent ? item('recent', '⏱ Played lately', recent) : null,
        h('h3', {}, 'Consoles'),
        ...consoles.map(([id, n]) => item(id, RETRO_SYSTEMS[id].name, n)),
        h('h3', {}, 'Collections'),
        shelf ? item('shelf', '📁 Office shelf', shelf) : null,
        mine ? item('mine', '💾 This browser', mine) : null,
        homebrew ? item('catalog', '🎁 Homebrew', homebrew) : null,
      ),
    );
  }

  /** The games the side and the search pick out. */
  private pick(): Game[] {
    const q = this.search.value.trim().toLowerCase();
    if (q) return this.games.filter((g) => [g.title, g.file, g.by, g.publisher, g.genre, RETRO_SYSTEMS[g.system].name].some((s) => s?.toLowerCase().includes(q)));
    const s = this.shelf;
    if (s === 'all') return this.games;
    if (s === 'recent') return this.recentGames();
    if (s === 'shelf' || s === 'mine' || s === 'catalog') return this.games.filter((g) => g.source === s);
    return this.games.filter((g) => g.system === s);
  }

  private render() {
    this.shown = this.pick();
    const cards = this.shown.map((g) => this.card(g));
    if (!cards.length) cards.push(h('p.retro-empty', {}, this.search.value ? 'No games match that.' : 'No games here yet.'));
    this.grid.replaceChildren(...cards);
    if (!this.selected || !this.shown.includes(this.selected)) this.selected = this.shown[0] ?? null;
    this.markSelected();
    this.renderInfo();
  }

  private card(g: Game): HTMLElement {
    const resume = this.resumes.get(g.key);
    const tag = this.playing?.key === g.key ? '⏸ Paused' : resume ? '▶ Continue' : '';
    const sub = `${SOURCE_TAG[g.source]} ${[g.source === 'catalog' ? g.by : (g.publisher ?? g.by), g.year].filter(Boolean).join(' · ') || g.file}`;
    const el = h(
      'button.retro-card',
      { type: 'button', role: 'option', title: g.title, 'data-key': g.key },
      h(`div.art${g.boxart ? '.box' : ''}`, {}, ...present(art(g), tag ? h('span.badge', {}, tag) : null, h('span.sys', {}, RETRO_SYSTEMS[g.system].name))),
      h('div.name', {}, g.title),
      h('div.sub', {}, sub),
    );
    el.addEventListener('click', () => this.select(g, false));
    el.addEventListener('dblclick', () => this.playSelected());
    return el;
  }

  private select(g: Game | undefined, scroll: boolean) {
    if (!g) return;
    this.selected = g;
    this.markSelected(scroll);
    this.renderInfo();
  }

  private markSelected(scroll = false) {
    for (const el of this.grid.querySelectorAll<HTMLElement>('.retro-card')) {
      const on = el.dataset.key === this.selected?.key;
      el.classList.toggle('sel', on);
      el.setAttribute('aria-selected', String(on));
      if (on && scroll) el.scrollIntoView({ block: 'nearest' });
    }
  }

  /** How many cards fit across, from where they landed. */
  private columns(): number {
    const cards = [...this.grid.querySelectorAll<HTMLElement>('.retro-card')];
    const top = cards[0]?.offsetTop;
    const n = cards.findIndex((c) => c.offsetTop !== top);
    return n > 0 ? n : Math.max(1, cards.length);
  }

  private playSelected() {
    const g = this.selected;
    if (!g) return;
    if (this.playing?.key === g.key) this.events.back();
    else this.events.play(g, this.resumes.has(g.key) ? 'resume' : 'new');
  }

  private renderInfo() {
    const g = this.selected;
    this.infoFor = g?.key ?? '';
    if (!g) return this.info.replaceChildren(h('p.retro-empty', {}, 'Pick a game.'));
    const sys = RETRO_SYSTEMS[g.system];
    const resume = this.resumes.get(g.key);
    const playing = this.playing?.key === g.key;
    const buttons: HTMLElement[] = [];
    const button = (label: string, cls: string, fn: () => void) => {
      const b = h(`button.btn${cls}`, { type: 'button' }, label);
      b.addEventListener('click', fn);
      buttons.push(b);
    };
    if (playing) button('▶ Back to it', '.primary', () => this.events.back());
    else if (resume) {
      button('▶ Continue', '.primary', () => this.events.play(g, 'resume'));
      button('↺ Start over', '', () => this.events.play(g, 'new'));
    } else button('▶ Play', '.primary', () => this.events.play(g, 'new'));
    const facts = [sys.name, g.region, g.year, g.genre, g.players && g.players > 1 ? `${g.players} players` : g.players ? '1 player' : ''].filter(Boolean).join(' · ');
    const by = g.by && g.publisher && g.publisher !== g.by ? `by ${g.by} · published by ${g.publisher}` : g.by ? `by ${g.by}` : g.publisher ? `by ${g.publisher}` : '';
    const savesEl = h('div.retro-saves');
    this.info.replaceChildren(
      ...present(
        h(`div.art.big${g.boxart ? '.box' : ''}`, {}, art(g)),
        h('h2', {}, g.title),
        h('div.facts', {}, facts),
        by ? h('div.by', {}, by) : null,
        g.blurb ? h('p', {}, g.blurb) : null,
        g.source === 'shelf' ? h('p.note', {}, `On the office's shelf: ${g.file}`) : null,
        g.source === 'mine' ? h('p.note', {}, `Added in this browser: ${g.file}`) : null,
        g.source === 'catalog' ? h('p.note', {}, '🎁 Homebrew: it comes with the computer.') : null,
        g.known === 'name' ? h('p.note', {}, 'Recognized by its file name, so this could be another version of it.') : null,
        g.source !== 'catalog' && !g.known ? h('p.note', {}, 'Not in libretro’s list of games, so it goes by its file name.') : null,
        resume && !playing ? h('p.note', {}, `You left it ${timeAgo(resume.at)}.`) : null,
        h('div.retro-buttons', {}, ...buttons),
        savesEl,
        g.source === 'mine' ? removeButton(() => this.events.remove(g)) : null,
      ),
    );
    void this.renderSaves(g, savesEl);
  }

  /** A game's own saves, to start from one. */
  private async renderSaves(g: Game, el: HTMLElement) {
    let list: SaveRecord[];
    try {
      list = (await saves.of(g.key)).filter((s) => s.kind === 'slot');
    } catch {
      return;
    }
    if (this.infoFor !== g.key || !list.length) return;
    el.replaceChildren(
      h('h3', {}, 'Your saves'),
      ...list.map((s) => {
        const play = h('button.btn', { type: 'button', title: 'Play from here' }, `▶ ${timeAgo(s.at)}`);
        const del = h('button.btn.retro-del', { type: 'button', title: 'Delete this save', 'aria-label': 'Delete this save' }, '🗑');
        const row = h('div.retro-save', {}, thumb(s), play, del);
        play.addEventListener('click', () => this.events.play(g, s));
        del.addEventListener('click', async () => {
          await saves.remove(s.id).catch(() => {});
          row.remove();
        });
        return row;
      }),
    );
  }
}

/** A game's picture (the first of its pictures that's there), or its console's colors and its name when it has none. */
export function art(g: Game): HTMLElement {
  const sys = RETRO_SYSTEMS[g.system];
  const blank = () => h('div.blank', { style: `background-color:${sys.color}` }, h('b', {}, sys.name), h('span', {}, g.title));
  const urls = g.art ?? [];
  if (!urls.length) return blank();
  let at = 0;
  const img = h('img', { src: urls[0], alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false' });
  img.addEventListener('error', () => {
    if (++at < urls.length) img.src = urls[at];
    else img.replaceWith(blank());
  });
  return img;
}

/** A saved game's picture. */
export function thumb(s: SaveRecord): HTMLElement {
  if (!s.shot) return h('div.thumb');
  const url = URL.createObjectURL(s.shot);
  const img = h('img.thumb', { src: url, alt: '' });
  img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
  img.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
  return img;
}

/** The elements that are there, of some that may not be. */
function present(...els: (HTMLElement | null)[]): HTMLElement[] {
  return els.filter((el): el is HTMLElement => !!el);
}

function removeButton(fn: () => void): HTMLElement {
  const b = h('button.btn.retro-remove', { type: 'button' }, '🗑 Remove from this browser');
  b.addEventListener('click', fn);
  return b;
}
