// The page inside the boss's computer's screen: EmulatorJS (github.com/EmulatorJS/EmulatorJS), loaded
// from its own site at a pinned version, in a sandboxed frame with an origin of its own. It can't see
// the office's page, cookies or storage, and the office only talks to it in messages (player.ts):
//
//   office → frame   boot {ejs, rom, name, state?, settings, controls}, pause, resume, restart,
//                    save {id}, load {state}
//   frame → office   ready, started, failed {message}, esc, saved {id, state, shot} or {id, error},
//                    setting {key, value}
//
// A sandboxed frame has no storage of its own, so the emulator's settings (its controls, its volume)
// live in memory here and are sent out for the office to keep. Keys reach the game wherever the
// frame's focus is in it, and Esc goes out to the office, which steps away from the screen.

/** The EmulatorJS release the frame loads. Its files are on its CDN, one folder a version. */
export const EJS_VERSION = '4.2.3';
export const EJS_DATA = `https://cdn.emulatorjs.org/${EJS_VERSION}/data/`;

/** The keys every game starts with (EmulatorJS's controls menu changes them, and they're kept), by RetroPad button. */
export const DEFAULT_KEYS: Readonly<Record<number, string>> = {
  0: 'z', // B
  1: 'a', // Y
  2: 'shift', // Select
  3: 'enter', // Start
  4: 'up arrow',
  5: 'down arrow',
  6: 'left arrow',
  7: 'right arrow',
  8: 'x', // A
  9: 's', // X
  10: 'q', // L
  11: 'w', // R
  12: 'e', // L2
  13: 'r', // R2
  16: 'h', // left stick →
  17: 'f', // left stick ←
  18: 'g', // left stick ↓
  19: 't', // left stick ↑
  20: 'l', // right stick →
  21: 'j', // right stick ←
  22: 'k', // right stick ↓
  23: 'i', // right stick ↑
};

/** What a gamepad's buttons are, by RetroPad button, as EmulatorJS names them. */
const PAD: Readonly<Record<number, string>> = {
  0: 'BUTTON_2', 1: 'BUTTON_4', 2: 'SELECT', 3: 'START', 4: 'DPAD_UP', 5: 'DPAD_DOWN', 6: 'DPAD_LEFT', 7: 'DPAD_RIGHT', 8: 'BUTTON_1', 9: 'BUTTON_3',
  10: 'LEFT_TOP_SHOULDER', 11: 'RIGHT_TOP_SHOULDER', 12: 'LEFT_BOTTOM_SHOULDER', 13: 'RIGHT_BOTTOM_SHOULDER', 14: 'LEFT_STICK', 15: 'RIGHT_STICK',
  16: 'LEFT_STICK_X:+1', 17: 'LEFT_STICK_X:-1', 18: 'LEFT_STICK_Y:+1', 19: 'LEFT_STICK_Y:-1', 20: 'RIGHT_STICK_X:+1', 21: 'RIGHT_STICK_X:-1', 22: 'RIGHT_STICK_Y:+1', 23: 'RIGHT_STICK_Y:-1',
};

/** EmulatorJS's controls: the keyboard and the first gamepad for player 1; the others set theirs in its menu. */
export function defaultControls(): Record<number, Record<number, { value?: string; value2?: string }>> {
  const one: Record<number, { value?: string; value2?: string }> = {};
  for (let i = 0; i <= 23; i++) one[i] = { value: DEFAULT_KEYS[i] ?? '', value2: PAD[i] };
  return { 0: one, 1: {}, 2: {}, 3: {} };
}

/** EmulatorJS's own buttons under the game: the ones that would save or download where a sandbox can't are hidden (the office has its own). */
const BUTTONS = {
  saveState: false,
  loadState: false,
  quickSave: false,
  quickLoad: false,
  saveSavFiles: false,
  loadSavFiles: false,
  screenshot: false,
  screenRecord: false,
  cacheManager: false,
  exitEmulation: false,
  netplay: false,
  contextMenu: false,
};

// Runs in the frame, as plain script. It trusts only messages from the office's page (its parent).
const BRIDGE = `
(() => {
  const post = (m, t) => parent.postMessage(m, '*', t || []);
  // No storage in a sandbox: the emulator keeps its settings here, and the office keeps them for next time.
  const mem = new Map();
  const store = {
    getItem: (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
    setItem: (k, v) => { k = String(k); v = String(v); mem.set(k, v); post({ t: 'setting', key: k, value: v }); },
    removeItem: (k) => { k = String(k); mem.delete(k); post({ t: 'setting', key: k, value: null }); },
    clear: () => mem.clear(),
    key: (i) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  };
  Object.defineProperty(window, 'localStorage', { value: store, configurable: true });
  Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
  // The emulator asks to keep the screen on, which a sandbox doesn't allow: it gets a lock that does nothing, rather than an error.
  if (navigator.wakeLock) Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => ({ released: false, type: 'screen', release: async () => {}, addEventListener() {}, removeEventListener() {} }) }, configurable: true });

  let ejs = null;
  const game = document.getElementById('game');
  // Whatever has the focus in here, the game hears the keys (EmulatorJS listens on its own element, which can't take the focus by itself in a sandbox).
  const keys = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'keydown') post({ t: 'esc' });
      return;
    }
    if (ejs && ejs.started && !game.contains(e.target)) ejs.keyChange(e);
  };
  addEventListener('keydown', keys, true);
  addEventListener('keyup', keys, true);

  const failed = (message) => post({ t: 'failed', message: String(message || 'The game could not start') });
  Object.defineProperty(window, 'EJS_emulator', {
    configurable: true,
    get: () => ejs,
    set: (v) => {
      ejs = v;
      const was = v.startGameError.bind(v);
      v.startGameError = (message) => { failed(message); return was(message); };
    },
  });

  // A picture of the game. The emulator only takes one as it runs a frame, so a paused game runs a moment for it.
  const shot = async () => {
    const paused = ejs.paused;
    if (paused) ejs.play();
    try {
      return await Promise.race([ejs.gameManager.screenshot(), new Promise((resolve) => setTimeout(() => resolve(null), 1500))]);
    } finally {
      if (paused) ejs.pause();
    }
  };

  addEventListener('message', async (e) => {
    if (e.source !== parent || !e.data || typeof e.data !== 'object') return;
    const m = e.data;
    if (m.t === 'boot' && !ejs) {
      for (const [k, v] of Object.entries(m.settings || {})) if (typeof v === 'string') mem.set(k, v);
      Object.assign(window, {
        EJS_player: '#game',
        EJS_core: m.ejs,
        EJS_gameUrl: new Uint8Array(m.rom),
        EJS_gameName: m.name,
        EJS_loadStateURL: m.state ? new Uint8Array(m.state) : undefined,
        EJS_pathtodata: m.data,
        EJS_startOnLoaded: true,
        EJS_disableDatabases: true,
        EJS_noAutoFocus: true,
        EJS_language: 'en-US',
        EJS_disableAutoLang: false,
        EJS_color: '#ff8a5b',
        EJS_backgroundColor: '#0b1320',
        EJS_volume: 0.6,
        EJS_defaultControls: m.controls,
        EJS_Buttons: m.buttons,
        EJS_onGameStart: () => post({ t: 'started' }),
      });
      const s = document.createElement('script');
      s.src = m.data + 'loader.js';
      s.onerror = () => failed('The emulator could not be downloaded');
      document.body.append(s);
      return;
    }
    if (!ejs || !ejs.started) {
      if (m.t === 'save') post({ t: 'saved', id: m.id, error: 'The game has not started' });
      return;
    }
    if (m.t === 'pause') ejs.pause();
    else if (m.t === 'resume') ejs.play();
    else if (m.t === 'restart') ejs.gameManager.restart();
    else if (m.t === 'load' && m.state) ejs.gameManager.loadState(new Uint8Array(m.state));
    else if (m.t === 'save') {
      try {
        const state = ejs.gameManager.getState();
        const png = await shot();
        const out = { t: 'saved', id: m.id, state: state.buffer, shot: png ? png.buffer : null };
        post(out, png ? [state.buffer, png.buffer] : [state.buffer]);
      } catch (err) {
        post({ t: 'saved', id: m.id, error: String((err && err.message) || err) });
      }
    }
  });
  post({ t: 'ready' });
})();
`;

/** The frame's page. */
export function frameHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#0b1320;overflow:hidden}#game{width:100%;height:100%}</style></head><body><div id="game"></div><script>${BRIDGE}</script></body></html>`;
}

/** What the frame is booted with, besides the game and its state. */
export function bootOptions() {
  return { data: EJS_DATA, controls: defaultControls(), buttons: BUTTONS };
}
