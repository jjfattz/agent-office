// What this browser keeps for the boss's computer: the games you added yourself and your saved games
// (in IndexedDB, since they're big), and what you played last and the emulator's own settings (small,
// in localStorage). None of it is the office's: it stays in this browser. A browser that won't keep
// anything (a private window) still plays, and just forgets.
import type { RetroSystem } from '../../../shared/retro';

/** A game you added from your computer. */
export interface MyRom {
  id: string;
  system: RetroSystem;
  title: string;
  /** Its file name, which the emulator goes by (its extension says what's in it). */
  file: string;
  size: number;
  added: number;
  data: Blob;
  /** Its CRCs, to recognize it by in libretro's database (see crcsOf in shared/retro-crc.ts). */
  crcs?: string[];
}

/**
 * A saved game: where you were when you last stepped away from it (`resume`, one a game), or one you
 * saved yourself (`slot`, a few a game). `game` is the game's key (see Game in games.ts).
 */
export interface SaveRecord {
  id: string;
  game: string;
  kind: 'resume' | 'slot';
  at: number;
  state: Blob;
  shot: Blob | null;
}

/** The most saves of your own a game keeps: saving another drops the oldest. */
export const MAX_SLOTS = 8;

const DB = 'agent-office-retro';
let opened: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('roms', { keyPath: 'id' });
      d.createObjectStore('saves', { keyPath: 'id' }).createIndex('game', 'game');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB is not available'));
  }).catch((err) => {
    opened = null;
    throw err;
  });
  return opened;
}

/** One request in a transaction of its own, as a promise. */
async function run<T>(store: 'roms' | 'saves', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
}

export const myRoms = {
  /** Every game you added, without loading any of them. */
  list: () => run<MyRom[]>('roms', 'readonly', (s) => s.getAll() as IDBRequest<MyRom[]>),
  get: (id: string) => run<MyRom | undefined>('roms', 'readonly', (s) => s.get(id) as IDBRequest<MyRom | undefined>),
  put: (rom: MyRom) => run('roms', 'readwrite', (s) => s.put(rom)),
  /** Takes it out, and its saves with it. */
  async remove(id: string, gameKey: string) {
    await run('roms', 'readwrite', (s) => s.delete(id));
    for (const save of await saves.of(gameKey)) await saves.remove(save.id);
  },
};

export const saves = {
  /** A game's saves, newest first. */
  async of(game: string): Promise<SaveRecord[]> {
    const all = await run<SaveRecord[]>('saves', 'readonly', (s) => s.index('game').getAll(game) as IDBRequest<SaveRecord[]>);
    return all.sort((a, b) => b.at - a.at);
  },
  /** Where you left every game you've stepped away from, without loading any. */
  async resumes(): Promise<SaveRecord[]> {
    const all = await run<SaveRecord[]>('saves', 'readonly', (s) => s.getAll() as IDBRequest<SaveRecord[]>);
    return all.filter((r) => r.kind === 'resume');
  },
  /** Keeps where you left a game, in place of where you left it before. */
  resume: (game: string, state: Blob, shot: Blob | null) => run('saves', 'readwrite', (s) => s.put({ id: `resume:${game}`, game, kind: 'resume', at: Date.now(), state, shot } satisfies SaveRecord)),
  /** A save of your own, dropping the oldest once a game has MAX_SLOTS. */
  async slot(game: string, state: Blob, shot: Blob | null): Promise<SaveRecord> {
    const at = Date.now();
    const rec: SaveRecord = { id: `slot:${game}:${at}`, game, kind: 'slot', at, state, shot };
    await run('saves', 'readwrite', (s) => s.put(rec));
    const slots = (await saves.of(game)).filter((r) => r.kind === 'slot');
    for (const old of slots.slice(MAX_SLOTS)) await saves.remove(old.id);
    return rec;
  },
  remove: (id: string) => run('saves', 'readwrite', (s) => s.delete(id)),
};

// ---- Small things, in localStorage ------------------------------------------------------------------

const RECENT = 'office.retro.recent';
const SETTINGS = 'office.retro.emulator';
/** The most games "Recently played" lists. */
const MAX_RECENT = 24;
/** The most the emulator's settings may take up, in characters. */
const MAX_SETTINGS = 256 * 1024;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Full, or not allowed: it's only a convenience.
  }
}

/** The games you played, last first, by key, with when. */
export function recentGames(): { key: string; at: number }[] {
  const list = readJson<unknown>(RECENT, []);
  return Array.isArray(list) ? list.filter((r): r is { key: string; at: number } => !!r && typeof r.key === 'string' && typeof r.at === 'number') : [];
}

export function markPlayed(key: string) {
  writeJson(RECENT, [{ key, at: Date.now() }, ...recentGames().filter((r) => r.key !== key)].slice(0, MAX_RECENT));
}

export function forgetPlayed(key: string) {
  writeJson(RECENT, recentGames().filter((r) => r.key !== key));
}

/** The emulator's settings (its controls, its volume), which it keeps in a frame that can't keep anything. */
export function emulatorSettings(): Record<string, string> {
  const s = readJson<unknown>(SETTINGS, {});
  if (!s || typeof s !== 'object' || Array.isArray(s)) return {};
  return Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
}

export function setEmulatorSetting(key: string, value: string | null) {
  const s = emulatorSettings();
  if (value === null) delete s[key];
  else s[key] = value;
  if (JSON.stringify(s).length <= MAX_SETTINGS) writeJson(SETTINGS, s);
}
