// The emulator's frame on the office's page (see frame.ts for its side). It lives outside the window
// you play in, laid over the screen while you're at it, so stepping away (✕, Esc, or anything else
// closing the window) leaves the game paused in it instead of gone, and there's time to save it.
import { h } from '../../ui/dom';
import { bootOptions, frameHtml } from './frame';

/** What the frame can send back (frame.ts), checked before anything here believes it. */
type FromFrame =
  | { t: 'ready' | 'started' | 'esc' }
  | { t: 'failed'; message: string }
  | { t: 'saved'; id: number; state?: ArrayBuffer; shot?: ArrayBuffer | null; error?: string }
  | { t: 'setting'; key: string; value: string | null };

export interface PlayerEvents {
  started(): void;
  failed(message: string): void;
  esc(): void;
  setting(key: string, value: string | null): void;
}

export interface Boot {
  /** The console, as EmulatorJS calls it. */
  ejs: string;
  rom: ArrayBuffer;
  /** The game's file name, whose extension tells the emulator what it is. */
  name: string;
  /** Where to start from: a saved game. */
  state?: ArrayBuffer;
  settings: Record<string, string>;
}

/** The biggest saved game or screenshot the frame may hand back, in bytes. */
const MAX_STATE = 256 * 1024 * 1024;
const MAX_SHOT = 16 * 1024 * 1024;
/** How long saving waits for the frame, in ms. */
const SAVE_WAIT = 5000;

export function parseFromFrame(m: unknown): FromFrame | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'ready':
    case 'started':
    case 'esc':
      return { t: o.t };
    case 'failed':
      return { t: 'failed', message: typeof o.message === 'string' ? o.message.slice(0, 200) : 'The game could not start' };
    case 'saved': {
      if (typeof o.id !== 'number') return null;
      if (typeof o.error === 'string') return { t: 'saved', id: o.id, error: o.error.slice(0, 200) };
      if (!(o.state instanceof ArrayBuffer) || o.state.byteLength === 0 || o.state.byteLength > MAX_STATE) return null;
      const shot = o.shot instanceof ArrayBuffer && o.shot.byteLength <= MAX_SHOT ? o.shot : null;
      return { t: 'saved', id: o.id, state: o.state, shot };
    }
    case 'setting':
      if (typeof o.key !== 'string' || o.key.length > 200) return null;
      if (o.value !== null && (typeof o.value !== 'string' || o.value.length > 64 * 1024)) return null;
      return { t: 'setting', key: o.key, value: o.value };
    default:
      return null;
  }
}

export class RetroPlayer {
  /** Over the screen while you play, and hidden otherwise. */
  private readonly host = h('div.retro-host', { 'aria-hidden': 'true' });
  private frame: HTMLIFrameElement | null = null;
  private boot: Boot | null = null;
  private saving = new Map<number, (r: { state: Blob; shot: Blob | null } | null) => void>();
  private nextSave = 1;
  /** The game in the frame has started. */
  started = false;
  /** The game's to have the keyboard once its frame is up (a hidden frame can't take it). */
  private wantsFocus = false;

  constructor(private readonly events: PlayerEvents) {
    document.body.append(this.host);
    window.addEventListener('message', (e) => this.onMessage(e));
  }

  /** A game is in the frame (starting, playing, or paused). */
  get loaded(): boolean {
    return !!this.frame;
  }

  /** Starts a game in a new frame, in place of whatever was in the old one. */
  start(boot: Boot, title: string) {
    this.unload();
    this.boot = boot;
    this.started = false;
    const frame = h('iframe', {
      // Scripts, and nothing else: no origin of its own (so none of the office's), no popups, no navigating the office.
      sandbox: 'allow-scripts',
      allow: 'autoplay; gamepad; fullscreen',
      title,
      referrerpolicy: 'no-referrer',
    });
    frame.srcdoc = frameHtml();
    this.frame = frame;
    this.host.append(frame);
  }

  /** Takes the game out of the frame, and the frame away. */
  unload() {
    this.blur();
    this.frame?.remove();
    this.frame = null;
    this.boot = null;
    this.started = false;
    for (const done of this.saving.values()) done(null);
    this.saving.clear();
  }

  pause() {
    this.send({ t: 'pause' });
  }
  resume() {
    this.send({ t: 'resume' });
  }
  restart() {
    this.send({ t: 'restart' });
  }
  /** Picks up from a saved game. */
  load(state: ArrayBuffer) {
    this.send({ t: 'load', state }, [state]);
  }

  /** The game as it is now, and a picture of it, or null when it can't be saved (it hasn't started, or the frame's gone). */
  save(): Promise<{ state: Blob; shot: Blob | null } | null> {
    if (!this.frame || !this.started) return Promise.resolve(null);
    const id = this.nextSave++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.saving.delete(id);
        resolve(null);
      }, SAVE_WAIT);
      this.saving.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.send({ t: 'save', id });
    });
  }

  /**
   * Lays the frame over `rect` (the screen, on the page), or hides it. A frame being saved stays where
   * it was, see-through, until it's done: the browser stops drawing a hidden frame from somewhere else,
   * and the game only takes its picture as it draws.
   */
  place(rect: DOMRect | null, opacity = 1) {
    const s = this.host.style;
    if (!rect || !this.frame) {
      if (this.frame && this.saving.size) {
        s.opacity = '0';
        s.pointerEvents = 'none';
      } else if (s.visibility !== 'hidden') s.visibility = 'hidden';
      return;
    }
    s.visibility = 'visible';
    s.pointerEvents = '';
    if (this.wantsFocus) {
      this.wantsFocus = false;
      this.frame.focus();
    }
    s.left = `${rect.left}px`;
    s.top = `${rect.top}px`;
    s.width = `${rect.width}px`;
    s.height = `${rect.height}px`;
    s.opacity = String(opacity);
  }

  /** Gives the game the keyboard, now or as soon as its frame is up over the screen. */
  focus() {
    if (!this.frame) return;
    if (this.host.style.visibility === 'visible') this.frame.focus();
    else this.wantsFocus = true;
  }

  /** Takes the keyboard back from the game, for the library or the office. */
  blur() {
    this.wantsFocus = false;
    if (this.frame && document.activeElement === this.frame) this.frame.blur();
  }

  private send(m: Record<string, unknown>, transfer: Transferable[] = []) {
    // The frame's origin is opaque ("null"), so a message can't be addressed to it by origin: it goes to that window, which only it can read.
    this.frame?.contentWindow?.postMessage(m, '*', transfer);
  }

  private onMessage(e: MessageEvent) {
    if (!this.frame || e.source !== this.frame.contentWindow) return;
    const m = parseFromFrame(e.data);
    if (!m) return;
    switch (m.t) {
      case 'ready': {
        const b = this.boot;
        if (!b) return;
        this.boot = null;
        const transfer: Transferable[] = [b.rom];
        if (b.state) transfer.push(b.state);
        this.send({ t: 'boot', ...bootOptions(), ejs: b.ejs, rom: b.rom, name: b.name, state: b.state, settings: b.settings }, transfer);
        return;
      }
      case 'started':
        this.started = true;
        return this.events.started();
      case 'failed':
        return this.events.failed(m.message);
      case 'esc':
        return this.events.esc();
      case 'setting':
        return this.events.setting(m.key, m.value);
      case 'saved': {
        const done = this.saving.get(m.id);
        if (!done) return;
        this.saving.delete(m.id);
        done(m.state ? { state: new Blob([m.state]), shot: m.shot ? new Blob([m.shot], { type: 'image/png' }) : null } : null);
      }
    }
  }
}
