import type * as THREE from 'three';
import { RETRO_SYSTEMS, SYSTEM_IDS, type RetroSystem } from '../../../shared/retro';
import type { WorkerInfo } from '../../../shared/protocol';
import { ScreenZoom } from '../../core/screen-zoom';
import { store } from '../../state';
import { clip, h, openModal, setDoing, timeAgo, toast, type Modal } from '../../ui/dom';
import { confirmDialog } from '../../ui/prompt';
import { openAddGames } from './add';
import { CATALOG_GAMES, loadLibrary, romOf, type Game } from './games';
import { Library, thumb, type From } from './library';
import { Monitor } from './monitor';
import { RetroPlayer } from './player';
import { emulatorSettings, markPlayed, myRoms, forgetPlayed, recentGames, saves, setEmulatorSetting, type SaveRecord } from './store';
import './ui.css';

type Mode = 'library' | 'play';

/** Each console's keys, for the tip under the screen (EmulatorJS's controls menu changes them). */
const TIPS: Partial<Record<RetroSystem, string>> = {
  nes: 'Arrows · X A · Z B · Enter Start · Shift Select',
  snes: 'Arrows · X A · Z B · S X · A Y · Q W L R · Enter Start',
  gb: 'Arrows · X A · Z B · Enter Start · Shift Select',
  gba: 'Arrows · X A · Z B · Q W L R · Enter Start',
  genesis: 'Arrows · A Z X are A B C · Enter Start',
  sms: 'Arrows · Z 1 · X 2 · Enter Pause',
  gg: 'Arrows · Z 1 · X 2 · Enter Start',
  atari2600: 'Arrows · Z fire · Enter Reset · Shift Select',
  n64: 'T F G H stick · Z X A S buttons · I J K L C · Enter Start',
};
const tipFor = (s: RetroSystem) => `${TIPS[s] ?? 'Arrows · Z X A S buttons · Enter Start · Shift Select'} · 🎮 gamepads work`;

/** How long a game gets to start once its file is in the frame, in ms. */
const START_WAIT = 90_000;
/** How often a game you're playing is kept, in case the tab goes, in ms. */
const AUTOSAVE = 60_000;

export interface RetroDeps {
  /** A worker's terminal: one of yours needing you pauses the game, with a button to it. */
  openTerminal(id: string): void;
}

const systemsOf = (games: Game[]) => SYSTEM_IDS.filter((id) => games.some((g) => g.system === id));

/** Hired by you (at a desk, or through the queue), or last given something to do by you. */
function yours(w: WorkerInfo): boolean {
  const name = store.peers.get(store.you)?.name ?? store.profile.name;
  return w.createdBy === name || w.createdBy === `${name} (queue)` || w.lastInput?.by === name;
}

/**
 * The boss's computer: a library of retro games for a dozen and more consoles, played in EmulatorJS
 * (frame.ts) right on the monitor. Sit in the boss's chair and press E, and the camera glides up to
 * the screen while the library is laid exactly over it. Stepping away pauses your game where it is (and
 * keeps it, for next time), and the monitor shows it waiting for you.
 */
export class Retro {
  private modal: Modal | null = null;
  private readonly view: ScreenZoom;
  private readonly monitor: Monitor;
  private readonly player: RetroPlayer;
  private readonly library: Library;
  private games: Game[] = [...CATALOG_GAMES];
  private resumes = new Map<string, SaveRecord>();
  /** The game in the emulator's frame: starting, playing, or paused while you're away from it. */
  private current: Game | null = null;
  private mode: Mode = 'library';
  /** Bumped by each start, so a start something else overtook gives up. */
  private starting = 0;
  private abort: AbortController | null = null;
  private startTimer = 0;
  private els: { box: HTMLElement; screen: HTMLElement; area: HTMLElement; panel: HTMLElement; bar: { name: HTMLElement; tip: HTMLElement; play: HTMLElement[] }; call: HTMLElement } | null = null;
  /** The worker whose question paused your game. */
  private waiting: WorkerInfo | null = null;
  private statuses = new Map<string, string>();

  constructor(screen: THREE.Mesh, private readonly deps: RetroDeps) {
    this.view = new ScreenZoom(screen);
    this.monitor = new Monitor(screen);
    this.player = new RetroPlayer({
      started: () => this.onStarted(),
      failed: (message) => this.onFailed(message),
      esc: () => this.modal?.close(),
      setting: (key, value) => setEmulatorSetting(key, value),
    });
    this.library = new Library({
      play: (g, from) => void this.start(g, from),
      back: () => this.setMode('play'),
      remove: (g) => this.remove(g),
      add: () => this.add([]),
    });
    this.monitor.library(this.games.length, systemsOf(this.games));
    void this.refresh(true);
    store.on('workers', () => this.onWorkers());
    setInterval(() => {
      if (this.modal && this.mode === 'play' && this.player.started && !this.waiting && !this.panelOpen()) void this.keep();
    }, AUTOSAVE);
  }

  /** Anywhere between your view and the monitor: your first-person hands would cover the screen. */
  get zoomed(): boolean {
    return this.view.zoomed;
  }

  /** Puts it down, if you're at it (the building changed maps under you). */
  stop() {
    this.modal?.close();
  }

  /** Sits down to the computer: back to the game you left going, or the library. */
  play() {
    if (this.modal) return;
    this.open(this.current && this.player.loaded ? 'play' : 'library');
    void this.refresh();
  }

  /** Moves the camera toward the monitor while you're at it, and lays the game over its screen. Call it once the player has placed the camera. */
  update(camera: THREE.PerspectiveCamera, dt: number) {
    this.view.update(camera, dt, !!this.modal);
    const els = this.els;
    const show = !!els && this.mode === 'play' && !this.waiting && !this.panelOpen() && this.onTop();
    this.player.place(show ? els.area.getBoundingClientRect() : null, show ? Number(getComputedStyle(els.box).opacity) : 1);
  }

  // ---- The window ----------------------------------------------------------------------------------

  private open(mode: Mode) {
    const area = h('div.retro-area');
    const panel = h('div.retro-panel.hidden');
    const screen = h('div.arcade-screen.retro-screen', {}, this.library.el, area, panel);
    const name = h('span.retro-name');
    const tip = h('span.tip');
    const button = (label: string, title: string, fn: () => void) => {
      const b = h('button.btn', { type: 'button', title }, label);
      b.addEventListener('click', () => {
        b.blur();
        fn();
      });
      return b;
    };
    const play = [
      button('☰ Games', 'Back to the library (the game waits, paused)', () => this.setMode('library')),
      button('💾 Save', 'Save the game here', () => void this.saveSlot()),
      button('📂 Load', 'Pick up from one of your saves', () => void this.showSaves()),
    ];
    const bar = h('div.arcade-bar', {}, name, tip, ...play);
    const call = h('div.cabinet-call.hidden');
    const box = h('div.arcade.retro', { role: 'dialog', 'aria-label': 'Retro games' }, screen, bar, call);
    this.els = { box, screen, area, panel, bar: { name, tip, play }, call };

    // Game files dropped on the screen: add them.
    box.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      box.classList.add('dropping');
    });
    box.addEventListener('dragleave', (e) => {
      if (!box.contains(e.relatedTarget as Node | null)) box.classList.remove('dropping');
    });
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      box.classList.remove('dropping');
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) this.add(files);
    });
    // Clicking the screen while a game's on gives it the keys back.
    area.addEventListener('pointerdown', () => this.player.focus());

    const onKey = (e: KeyboardEvent) => {
      if (!this.onTop() || e.metaKey || e.ctrlKey || e.altKey) return;
      if (this.mode === 'library' && this.library.key(e)) e.preventDefault();
    };
    const fit = () => {
      const { width, height } = this.view.box();
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('keydown', onKey);
    this.modal = openModal(box, {
      backdropCloses: false,
      doing: '🕹️ browsing retro games',
      onClose: () => {
        window.removeEventListener('resize', fit);
        window.removeEventListener('keydown', onKey);
        this.closed();
      },
    });
    this.modal.backdrop.classList.add('clear');
    this.mode = mode === 'play' ? 'library' : 'play';
    this.setMode(mode);
  }

  /** You stepped away: the game waits, paused, and where you are in it is kept. One still starting is dropped. */
  private closed() {
    this.modal = this.els = null;
    this.waiting = null;
    if (this.current && this.player.started) {
      this.player.pause();
      void this.keep(true);
    } else if (this.current) this.cancel();
    this.player.blur();
    this.player.place(null);
  }

  /** Between the library and the game. Going to the library leaves the game paused, kept where it is. */
  private setMode(mode: Mode) {
    const els = this.els;
    if (!els || !this.modal) return;
    if (mode === 'play' && !this.current) mode = 'library';
    const was = this.mode;
    this.mode = mode;
    if (was === 'play' && mode === 'library' && this.player.started) {
      this.player.pause();
      void this.keep();
    }
    if (mode === 'library') this.player.blur();
    els.screen.classList.toggle('playing', mode === 'play');
    this.hidePanel();
    const g = this.current;
    if (mode === 'play' && g) {
      els.bar.name.textContent = `🎮 ${clip(g.title, 32)}`;
      els.bar.tip.textContent = tipFor(g.system);
      setDoing(this.modal, `🕹️ playing ${clip(g.title, 40)}`);
      if (this.player.started) {
        this.player.resume();
        this.player.focus();
      }
    } else {
      els.bar.name.textContent = '🕹️ Overtime';
      els.bar.tip.textContent = `${this.games.length} games · ← → ↑ ↓ choose · Enter play · / search · drop game files here to add them`;
      setDoing(this.modal, '🕹️ browsing retro games');
      this.renderLibrary();
    }
    for (const b of els.bar.play) b.classList.toggle('hidden', mode !== 'play');
  }

  private onTop(): boolean {
    return !!this.modal && document.getElementById('modal-root')?.lastElementChild === this.modal.backdrop;
  }

  private renderLibrary() {
    this.library.set(this.games, this.resumes, recentGames().map((r) => r.key), this.current && this.player.loaded ? this.current : null);
  }

  /** Fetches the library again (the office's shelf, your own games) and where you left each game. */
  private async refresh(first = false) {
    const [games, resumes] = await Promise.all([loadLibrary(), saves.resumes().catch(() => [] as SaveRecord[])]);
    this.games = games;
    this.resumes = new Map(resumes.map((r) => [r.game, r]));
    this.monitor.library(games.length, systemsOf(games));
    if (this.els && this.mode === 'library') this.setMode('library');
    // Back in the office: the monitor shows the game you left last.
    if (first && !this.current) {
      const last = recentGames().find((r) => this.resumes.has(r.key));
      const game = last && games.find((g) => g.key === last.key);
      if (game) void this.monitor.showPaused(game, this.resumes.get(game.key)?.shot ?? null);
    }
  }

  // ---- Playing ---------------------------------------------------------------------------------------

  private async start(game: Game, from: From) {
    const run = ++this.starting;
    this.abort?.abort();
    const abort = (this.abort = new AbortController());
    clearTimeout(this.startTimer);
    // What was going is kept where you left it, and put away.
    if (this.current && this.player.loaded) {
      if (this.current.key === game.key && from === 'resume' && this.player.started) return this.setMode('play');
      if (this.player.started) await this.keep();
      if (run !== this.starting) return;
      this.quit();
    }
    if (run !== this.starting || !this.modal) return;
    this.current = game;
    this.setMode('play');
    this.showPanel(h('div.retro-loading', {}, h('div.spinner'), h('b', {}, `Loading ${game.title}…`), h('span', {}, RETRO_SYSTEMS[game.system].name)));
    try {
      const rom = await romOf(game, abort.signal);
      const resume = from === 'resume' ? (this.resumes.get(game.key) ?? null) : from === 'new' ? null : from;
      const state = resume ? await resume.state.arrayBuffer() : undefined;
      if (run !== this.starting || !this.modal) return;
      this.hidePanel();
      this.player.start({ ejs: RETRO_SYSTEMS[game.system].ejs, rom, name: game.file, state, settings: emulatorSettings() }, game.title);
      markPlayed(game.key);
      this.startTimer = window.setTimeout(() => {
        if (run === this.starting && !this.player.started) this.onFailed('The emulator took too long to start. Check your connection, and try again.');
      }, START_WAIT);
    } catch (err) {
      if (run !== this.starting || abort.signal.aborted) return;
      this.onFailed((err as Error).message);
    }
  }

  private onStarted() {
    clearTimeout(this.startTimer);
    if (this.modal && this.mode === 'play') this.player.focus();
    else this.player.pause();
  }

  private onFailed(message: string) {
    clearTimeout(this.startTimer);
    const g = this.current;
    this.quit();
    if (!this.modal || !this.els) return;
    const back = h('button.btn', { type: 'button' }, '☰ Back to the games');
    back.addEventListener('click', () => this.setMode('library'));
    const again = h('button.btn.primary', { type: 'button' }, '↻ Try again');
    again.addEventListener('click', () => g && void this.start(g, 'resume'));
    this.showPanel(h('div.retro-loading.failed', {}, h('b', {}, `😵 ${g ? g.title : 'The game'} didn't start`), h('span', {}, message), h('div.retro-buttons', {}, again, back)));
  }

  /** Takes the game out of the emulator. */
  private quit() {
    this.player.unload();
    this.current = null;
  }

  /** Gives up on a game that's starting (or going), and takes it out. */
  private cancel() {
    this.starting++;
    this.abort?.abort();
    clearTimeout(this.startTimer);
    this.quit();
  }

  /** Keeps where you are in the game, for Continue (and, stepping away, puts it up on the monitor). */
  private async keep(toMonitor = false) {
    const g = this.current;
    if (!g) return;
    const r = await this.player.save();
    if (!r) return;
    this.resumes.set(g.key, { id: `resume:${g.key}`, game: g.key, kind: 'resume', at: Date.now(), state: r.state, shot: r.shot });
    if (toMonitor) void this.monitor.showPaused(g, r.shot);
    try {
      await saves.resume(g.key, r.state, r.shot);
    } catch {
      // A browser that keeps nothing: Continue lasts as long as the page does.
    }
  }

  private async saveSlot() {
    const g = this.current;
    const r = g && (await this.player.save());
    if (!g || !r) return toast('The game can’t be saved right now', 'warn');
    try {
      await saves.slot(g.key, r.state, r.shot);
      toast('💾 Saved');
    } catch {
      toast('This browser won’t keep saves (a private window, or it’s out of room)', 'error');
    }
    this.player.focus();
  }

  /** Your saves of the game, over the screen (the game waits under them). */
  private async showSaves() {
    const g = this.current;
    if (!g || !this.player.started) return;
    const list = (await saves.of(g.key).catch(() => [] as SaveRecord[])).filter((s) => s.kind === 'slot');
    if (this.current !== g || !this.els) return;
    this.player.pause();
    const close = h('button.btn', { type: 'button' }, '▶ Back to the game');
    close.addEventListener('click', () => this.hidePanel(true));
    const rows = list.map((s) => {
      const b = h('button.retro-save-pick', { type: 'button' }, thumb(s), h('span', {}, `Saved ${timeAgo(s.at)}`));
      b.addEventListener('click', async () => {
        this.player.load(await s.state.arrayBuffer());
        this.hidePanel(true);
      });
      return b;
    });
    this.showPanel(h('div.retro-saves-panel', {}, h('h2', {}, `📂 ${g.title}`), rows.length ? h('div.retro-save-grid', {}, ...rows) : h('p', {}, 'No saves yet: 💾 Save keeps one, up to eight a game.'), h('div.retro-buttons', {}, close)));
  }

  private panelOpen(): boolean {
    return !!this.els && !this.els.panel.classList.contains('hidden');
  }

  private showPanel(content: HTMLElement) {
    if (!this.els) return;
    this.player.blur();
    this.els.panel.replaceChildren(content);
    this.els.panel.classList.remove('hidden');
  }

  /** Clears what's over the screen, and with `resume`, carries on with the game. */
  private hidePanel(resume = false) {
    if (!this.els) return;
    this.els.panel.classList.add('hidden');
    this.els.panel.replaceChildren();
    if (resume && this.player.started && this.mode === 'play') {
      this.player.resume();
      this.player.focus();
    }
  }

  // ---- Your own games ------------------------------------------------------------------------------

  private add(files: File[]) {
    openAddGames(files, (n) => {
      if (n) void this.refresh();
    });
  }

  private remove(game: Game) {
    if (game.source !== 'mine' || !game.id) return;
    const id = game.id;
    confirmDialog('Remove this game?', `${game.title} and its saves come out of this browser.`, 'Remove', async () => {
      if (this.current?.key === game.key) this.cancel();
      try {
        await myRoms.remove(id, game.key);
      } catch {
        return toast('This browser wouldn’t let go of it', 'error');
      }
      forgetPlayed(game.key);
      this.resumes.delete(game.key);
      await this.refresh();
    });
  }

  // ---- Workers ---------------------------------------------------------------------------------------

  /** One of your workers needing you pauses the game, and says who, with a way to its terminal. */
  private onWorkers() {
    const next = new Map<string, string>();
    for (const w of store.workers.values()) {
      const was = this.statuses.get(w.id);
      next.set(w.id, w.status);
      if (was && was !== w.status && w.status === 'needs_input' && yours(w)) this.needsYou(w);
    }
    this.statuses = next;
    if (this.waiting && store.workers.get(this.waiting.id)?.status !== 'needs_input') this.carryOn();
  }

  private needsYou(w: WorkerInfo) {
    if (!this.modal || this.mode !== 'play' || !this.player.started) return;
    this.player.pause();
    this.player.blur();
    this.waiting = w;
    this.renderCall();
  }

  private carryOn() {
    this.waiting = null;
    this.renderCall();
    if (this.modal && this.mode === 'play' && this.player.started && !this.panelOpen()) {
      this.player.resume();
      this.player.focus();
    }
  }

  private renderCall() {
    const el = this.els?.call;
    if (!el) return;
    const w = this.waiting;
    el.classList.toggle('hidden', !w);
    if (!w) return el.replaceChildren();
    const go = h('button.btn.primary', { type: 'button' }, '💬 Open its terminal');
    const back = h('button.btn', { type: 'button' }, '▶ Carry on');
    go.addEventListener('click', () => {
      this.modal?.close();
      this.deps.openTerminal(w.id);
    });
    back.addEventListener('click', () => this.carryOn());
    el.replaceChildren(h('span', {}, `🙋 ${w.name} needs input`), go, back);
  }
}
