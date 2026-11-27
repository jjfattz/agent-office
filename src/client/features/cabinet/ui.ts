import * as THREE from 'three';
import { GAME_NAMES, TITLES, type CabinetFrame, type Title } from '../../../shared/cabinet';
import type { WorkerInfo } from '../../../shared/protocol';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, toast, type Modal } from '../../ui/dom';
import { ScreenZoom } from '../../core/screen-zoom';
import type { ArcadeSound, CabinetGame, ScreenView } from './cart';
import { CARTS, cartOf } from './games';
import { cardAt, paintAttract, paintMenu, type ChoiceView, type MenuView } from './menu';
import { H, W, scanlines } from './paint';

/** Keys every game takes, by `code`, besides its own. */
const COMMON_KEYS: Readonly<Record<string, string>> = { KeyP: 'pause', Enter: 'go', KeyM: 'menu' };
/** Keys for the menu, by `code`. */
const MENU_KEYS: Readonly<Record<string, 'up' | 'down' | 'pick'>> = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', Enter: 'pick', Space: 'pick' };

type Mode = 'menu' | 'play' | 'watch';

/**
 * The arcade cabinet in the lounge. Press E there and the camera glides up to its screen, where you
 * pick a game (games.ts) and play it on the keyboard. Everyone else on the floor sees your game on the
 * cabinet as you play, and can walk up and press E to watch it up close. One of your workers needing
 * input pauses it and says who; walking away, or going back to the games, leaves it paused for when
 * you come back to it. Its score goes on that game's high-score table when you step away from it and
 * when it ends.
 */
export class Cabinet {
  private mode: Mode | null = null;
  private modal: Modal | null = null;
  private readonly view: ScreenZoom;
  /** Your games, a game each: the one you're playing, and any you left paused. */
  private readonly games = new Map<Title, CabinetGame>();
  /** The game picked out on the menu, or being played. */
  private title: Title = TITLES[0];
  /** The game you last asked the office to carry on with, until it says which one you're on ('' for a new one). */
  private asked = '';
  /** Its game-over sound has played. */
  private ended = false;
  private sent = { version: -1, at: 0 };
  /** The worker whose question paused your game. */
  private waiting: WorkerInfo | null = null;
  /** Who you're watching. */
  private watching = '';
  /** What the cabinet in the office shows. */
  private readonly picture = document.createElement('canvas');
  private readonly texture = new THREE.CanvasTexture(this.picture);
  /** The screen up close, drawn at the size it shows on the page so it stays crisp, and what's under it. */
  private board: HTMLCanvasElement | null = null;
  private bar: { name: HTMLElement; tip: HTMLElement; games: HTMLButtonElement; stop: HTMLButtonElement } | null = null;
  /** Over the screen while a worker waits on you: who, and a way to its terminal. */
  private call: HTMLElement | null = null;
  private dirty = true;
  private painted = -1;
  private blink = -1;
  /** The last frame from whoever's playing, to hear what changed. */
  private heard: CabinetFrame | null = null;

  constructor(
    screen: THREE.Mesh,
    private readonly net: Net,
    private readonly opts: { openTerminal(workerId: string): void; sound(kind: ArcadeSound, n?: number): void },
  ) {
    this.view = new ScreenZoom(screen);
    this.picture.width = 512;
    this.picture.height = 384;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = screen.material as THREE.MeshBasicMaterial;
    mat.map = this.texture;
    mat.color.set('#ffffff');
    // Canvas text only picks up the office's font once it has loaded.
    void document.fonts.ready.then(() => (this.dirty = true));
    store.on('cabinet', () => this.onState());
    store.on('cabinetFrame', () => this.onFrame());
    store.on('workers', () => this.onWorkers());
    // Clicked off into another window: the game waits for you.
    window.addEventListener('blur', () => {
      if (this.mode === 'play') this.game?.pause(true);
    });
    // Closing the tab mid-game: the office sees the game as it stands, so what you scored still counts.
    window.addEventListener('pagehide', () => {
      if (this.mode === 'play') this.sendFrame();
    });
  }

  /** Anywhere between your view and the screen: your first-person hands would cover it. */
  get zoomed(): boolean {
    return this.view.zoomed;
  }

  /** Puts it down, if you're at it (the building changed maps under you). */
  stop() {
    this.modal?.close();
  }

  /** Your game that's waiting for you, if you've stepped away from one: the last you played. */
  paused(): { title: Title; score: number } | null {
    const g = this.game;
    return g && !g.over && this.mode !== 'play' ? { title: this.title, score: g.score } : null;
  }

  /** E at the cabinet: the games to choose from, or whoever's on it already to watch. */
  play() {
    if (this.modal || !store.floor) return;
    const p = store.cabinet.player;
    this.open(p && p.id !== store.you ? 'watch' : 'menu');
  }

  /** One of your workers started waiting on an answer: your game stops for it, and says who. */
  needsYou(w: WorkerInfo) {
    if (this.mode !== 'play' || !this.game) return;
    this.game.pause(true);
    this.waiting = w;
    this.renderCall();
    this.dirty = true;
  }

  /** Runs the game, sends it to everyone watching, keeps the screens drawn and moves the camera. Call it once the player has placed the camera. */
  update(camera: THREE.PerspectiveCamera, dt: number) {
    const g = this.mode === 'play' ? this.game : undefined;
    const now = performance.now();
    if (g) {
      g.update(dt);
      if (g.over && !this.ended) {
        this.ended = true;
        this.opts.sound('over');
      }
      if (g.version !== this.sent.version && now - this.sent.at >= CARTS[this.title].frameMs) this.sendFrame();
      if (g.version !== this.painted) this.dirty = true;
    }
    // The blinking "press E", and the menu's.
    const blink = Math.floor((now / 1000) * 1.6) % 2;
    if (blink !== this.blink) {
      this.blink = blink;
      if (this.idle() || this.mode === 'menu') this.dirty = true;
    }
    if (this.dirty) this.paint(now);
    this.view.update(camera, dt, !!this.modal);
  }

  /** Your game of the one picked out (or being played), if you have one. */
  private get game(): CabinetGame | undefined {
    return this.games.get(this.title);
  }

  private newGame(): CabinetGame {
    const g = CARTS[this.title].start((kind, n) => this.opts.sound(kind, n));
    this.games.set(this.title, g);
    this.ended = false;
    this.sent.version = -1;
    return g;
  }

  /** Asks the office to carry on with game `id` of the one picked out, or to start a new one (''): it says which you're on in `cabinet`. */
  private ask(id: string) {
    this.asked = id;
    this.net.send({ t: 'cabinet.play', title: this.title, game: id || undefined });
  }

  /**
   * Your game as it looks now, to everyone watching, unless they've seen it already. The office goes
   * by these for your score too, so the last one goes out before you step away.
   */
  private sendFrame() {
    const g = this.game;
    if (!g || g.version === this.sent.version) return;
    this.sent = { version: g.version, at: performance.now() };
    this.net.send({ t: 'cabinet.frame', frame: g.frame() });
  }

  private resume() {
    this.waiting = null;
    this.renderCall();
    this.game?.pause(false);
  }

  /** Plays the game picked out on the menu: the one of it you left paused, or a new one. */
  private pick(title: Title) {
    this.title = title;
    const g = !this.game || this.game.over ? this.newGame() : this.game;
    this.ended = false;
    this.sent.version = -1;
    this.ask(g.id);
    this.setMode('play');
  }

  /** Picks out another game on the menu. */
  private choose(by: number) {
    const n = TITLES.length;
    this.title = TITLES[(TITLES.indexOf(this.title) + by + n) % n];
    this.dirty = true;
  }

  private open(mode: Mode) {
    const board = h('canvas', { 'aria-label': 'Arcade' });
    const name = h('span', {});
    const tip = h('span.tip', {});
    const games = h('button.btn', { type: 'button', title: 'Back to the games (M)' }, '☰ Games') as HTMLButtonElement;
    const stop = h('button.btn', { type: 'button' }, '✕ Stop') as HTMLButtonElement;
    const call = h('div.cabinet-call.hidden', { role: 'status' });
    const box = h('div.arcade.cabinet', { role: 'dialog', 'aria-label': 'Arcade' }, h('div.arcade-screen', {}, board), call, h('div.arcade-bar', {}, name, tip, games, stop));

    const fit = () => {
      const { width, height } = this.view.box();
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      board.width = Math.round(width * devicePixelRatio);
      board.height = Math.round(height * devicePixelRatio);
      this.dirty = true;
    };
    const onKey = (e: KeyboardEvent) => this.key(e, true);
    const onKeyUp = (e: KeyboardEvent) => this.key(e, false);
    // The menu takes the mouse too: point at a game to pick it out, click to play it.
    const spot = (e: MouseEvent) => (this.mode === 'menu' ? cardAt((e.offsetX * W) / board.clientWidth, (e.offsetY * H) / board.clientHeight) : null);
    board.addEventListener('pointermove', (e) => {
      const t = spot(e);
      board.style.cursor = t ? 'pointer' : '';
      if (t && t !== this.title) {
        this.title = t;
        this.dirty = true;
      }
    });
    board.addEventListener('click', (e) => {
      const t = spot(e);
      if (t) this.pick(t);
    });
    games.addEventListener('click', () => {
      games.blur();
      this.setMode('menu');
    });
    stop.addEventListener('click', () => this.modal?.close());
    this.board = board;
    this.bar = { name, tip, games, stop };
    this.call = call;
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    this.modal = openModal(box, {
      backdropCloses: false,
      onClose: () => {
        window.removeEventListener('resize', fit);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('keyup', onKeyUp, true);
        this.closed();
      },
    });
    this.modal.backdrop.classList.add('clear');
    this.setMode(mode);
  }

  /** Switches what you're doing at the cabinet, up close; going from a game steps away from it. */
  private setMode(mode: Mode) {
    if (this.mode === 'play' && mode !== 'play') this.stepAway();
    this.mode = mode;
    this.watching = mode === 'watch' ? (store.cabinet.player?.name ?? '') : '';
    this.dirty = true;
    const bar = this.bar;
    if (!bar || !this.board) return;
    const watched = store.cabinet.player?.title ?? this.title;
    const name = mode === 'menu' ? 'Arcade' : GAME_NAMES[mode === 'watch' ? watched : this.title];
    bar.name.textContent = `🕹️ ${name}`;
    bar.tip.textContent = mode === 'menu' ? '↑ ↓ choose · Enter play' : mode === 'watch' ? `👀 Watching ${this.watching}` : CARTS[this.title].tip;
    bar.games.classList.toggle('hidden', mode !== 'play');
    bar.stop.textContent = mode === 'play' ? '✕ Stop playing' : mode === 'watch' ? '✕ Stop watching' : '✕ Walk away';
    this.board.setAttribute('aria-label', mode === 'watch' ? `${this.watching} playing ${name}` : name);
  }

  /** You stepped away from your game (to the games, or from the cabinet): it waits, paused, with its score on the table so far. */
  private stepAway() {
    const g = this.game;
    // A game you never got going isn't worth coming back to.
    if (g && !g.started) this.games.delete(this.title);
    else this.sendFrame();
    this.net.send({ t: 'cabinet.leave' });
    g?.pause(true);
    this.waiting = null;
    this.renderCall();
  }

  private closed() {
    if (this.mode === 'play') this.stepAway();
    this.mode = null;
    this.modal = this.board = this.bar = this.call = null;
    this.waiting = null;
    this.watching = '';
    this.dirty = true;
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.mode === 'menu') return this.menuKey(e, down);
    const g = this.game;
    const k = CARTS[this.title].keys[e.code] ?? COMMON_KEYS[e.code];
    if (this.mode !== 'play' || !k || !g) return;
    e.preventDefault();
    e.stopPropagation();
    if (!down) return g.input(k, false);
    // Held keys slide, drop and fire on their own time, not the keyboard's repeat.
    if (e.repeat) return;
    if (k === 'menu') return this.setMode('menu');
    if (g.over) {
      if (k === 'go' || e.code === 'Space') {
        this.newGame();
        // A new game for the office to follow, and name.
        this.ask('');
        this.dirty = true;
      }
      return;
    }
    if (g.state === 'paused') {
      if (k === 'pause' || k === 'go') this.resume();
      return;
    }
    if (k === 'pause') g.pause(true);
    else g.input(k, true);
  }

  private menuKey(e: KeyboardEvent, down: boolean) {
    const k = MENU_KEYS[e.code];
    if (!k) return;
    e.preventDefault();
    e.stopPropagation();
    if (!down || (e.repeat && k === 'pick')) return;
    if (k === 'pick') this.pick(this.title);
    else this.choose(k === 'up' ? -1 : 1);
  }

  /** Who's at the cabinet changed. */
  private onState() {
    const p = store.cabinet.player;
    this.heard = store.cabinetFrame;
    if (this.mode === 'play') {
      // Someone else got there first: watch them instead.
      if (p && p.id !== store.you) this.setMode('watch');
      else if (!p) {
        // The office forgot (a dropped connection): still here.
        this.ask(this.game?.id ?? '');
      } else if (this.game) {
        // It can't follow the old game on from where it was, so a new one for the new game it started.
        if (lostGame(this.asked, p.game)) {
          this.newGame();
          toast("🕹️ The office lost track of your game, so here's a new one");
        }
        this.asked = '';
        this.game.id = p.game;
      }
    } else if (this.mode === 'menu' && p && p.id !== store.you) {
      // Someone else started a game while you were choosing.
      this.setMode('watch');
    } else if (this.mode === 'watch' && (!p || p.id === store.you || p.name !== this.watching)) {
      if (!p) toast(`${this.watching} stepped away from the arcade`);
      this.modal?.close();
    }
    this.dirty = true;
  }

  /** Someone else's game moved on: hear it. */
  private onFrame() {
    const f = store.cabinetFrame;
    const was = this.heard;
    this.heard = f;
    this.dirty = true;
    if (!f || !was || f.title !== was.title) return;
    cartOf(f).hear(was, f, this.opts.sound);
    if (f.state === 'over' && was.state !== 'over') this.opts.sound('over');
  }

  /** The worker that paused your game got its answer from someone else. */
  private onWorkers() {
    if (!this.waiting || store.workers.get(this.waiting.id)?.status === 'needs_input') return;
    this.waiting = null;
    this.renderCall();
    this.dirty = true;
  }

  private renderCall() {
    const el = this.call;
    if (!el) return;
    const w = this.waiting;
    el.classList.toggle('hidden', !w);
    if (!w) return el.replaceChildren();
    const go = h('button.btn.primary', { type: 'button' }, '💬 Open its terminal');
    const back = h('button.btn', { type: 'button' }, '▶ Carry on');
    go.addEventListener('click', () => {
      this.modal?.close();
      this.opts.openTerminal(w.id);
    });
    back.addEventListener('click', () => this.resume());
    el.replaceChildren(h('span', {}, `🙋 ${w.name} needs input${deskOf(w)}`), go, back);
  }

  /** Nobody's game on the cabinet in the office, just the high scores. */
  private idle(): boolean {
    const p = store.cabinet.player;
    return !(this.mode === 'play' && this.game) && !(p && p.id !== store.you && store.cabinetFrame);
  }

  /** The game the screen shows, if one: yours, or someone else's. */
  private screen(t: number): { frame: CabinetFrame; view: ScreenView } | null {
    const c = store.cabinet;
    const g = this.game;
    if (this.mode === 'play' && g) {
      const scores = c.scores[this.title];
      const rank = scores.findIndex((s) => s.game === g.id) + 1;
      return {
        frame: g.frame(),
        view: {
          player: store.profile.name,
          scores,
          mine: g.id,
          note: this.waiting ? `${this.waiting.name} needs you${deskOf(this.waiting)}` : 'P to carry on',
          prompt: rank ? `🏆 #${rank} on the table! Enter: again` : 'Enter to play again',
          t,
        },
      };
    }
    const f = store.cabinetFrame;
    if (c.player && c.player.id !== store.you && f) return { frame: f, view: { player: c.player.name, scores: c.scores[f.title], mine: c.player.game, note: 'Back in a moment', t } };
    return null;
  }

  /** The cabinet's own screens: the menu up close, or what it shows the room with no game on. */
  private menuView(t: number): MenuView {
    const mine: MenuView['mine'] = {};
    for (const [title, g] of this.games) mine[title] = g.id;
    const p = store.cabinet.player;
    const prompt = p && p.id !== store.you ? `▶ ${p.name.toUpperCase()}` : this.paused() ? 'PRESS E TO CARRY ON' : undefined;
    return { scores: store.cabinet.scores, mine, prompt, t };
  }

  /** Draws the screen up close while you're at it, and on the cabinet otherwise (the close one covers it). */
  private paint(now: number) {
    this.dirty = false;
    if (this.game) this.painted = this.game.version;
    const t = now / 1000;
    const canvas = this.board ?? this.picture;
    const g = canvas.getContext('2d')!;
    g.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    if (this.board && this.mode === 'menu') paintMenu(g, this.choiceView(t));
    else {
      const s = this.screen(t);
      if (s) cartOf(s.frame).paint(g, s.frame, s.view);
      else paintAttract(g, this.menuView(t));
    }
    scanlines(g);
    if (!this.board) this.texture.needsUpdate = true;
  }

  private choiceView(t: number): ChoiceView {
    const paused: ChoiceView['paused'] = {};
    for (const [title, g] of this.games) if (!g.over) paused[title] = g.score;
    return { ...this.menuView(t), at: this.title, paused, prompt: undefined };
  }
}

/**
 * Whether the office let go of the game you asked it to carry on with (`asked`, '' for a new one):
 * it restarted, or gave up waiting for you, and started game `id` for you instead.
 */
export function lostGame(asked: string, id: string): boolean {
  return asked !== '' && id !== asked;
}

/** " at Desk 3", or nothing when it's not at a desk here. */
function deskOf(w: WorkerInfo): string {
  const d = store.plan().byId.get(w.deskId);
  return d ? ` at ${d.label}` : '';
}
