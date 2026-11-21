// The boss's computer's library: the games it comes with (catalog.ts), the ones on the office's own
// shelf (src/server/retro.ts), and the ones you added in this browser (store.ts), as one list, and
// fetching a game to play.
import { MAX_ROM_BYTES, isSystem, romFileOk, titleFromFile, type RetroSystem } from '../../../shared/retro';
import { CATALOG, artUrl, collectionUrl } from './catalog';
import { myRoms } from './store';

/** Where a game comes from: it came with the computer, it's on the office's shelf, or you added it here. */
export type Source = 'catalog' | 'shelf' | 'mine';

export interface Game {
  /** What it's known by in your saves and recents: its source, then its console and file, or its id. */
  key: string;
  source: Source;
  system: RetroSystem;
  title: string;
  /** Its file name, which the emulator goes by (its extension says what's in it). */
  file: string;
  by?: string;
  year?: number;
  genre?: string;
  players?: number;
  blurb?: string;
  /** Its picture. */
  art?: string;
  size?: number;
  /** For one you added: its id in this browser. */
  id?: string;
}

/** The games the computer comes with. */
export const CATALOG_GAMES: readonly Game[] = CATALOG.map((c) => ({
  key: `c:${c.system}:${c.file}`,
  source: 'catalog',
  system: c.system,
  title: c.title,
  file: c.file,
  by: c.by,
  year: c.year,
  genre: c.genre,
  players: c.players,
  blurb: c.blurb,
  art: artUrl(c),
}));

let dir: string | null = null;
/** Where the office keeps its shelf, to say so (null until the office has said). */
export const shelfDir = () => dir;

/** The office's shelf, or nothing when it can't be reached. */
async function shelfGames(): Promise<Game[]> {
  try {
    const res = await fetch('/api/retro/shelf', { credentials: 'same-origin' });
    if (!res.ok) return [];
    const body = (await res.json()) as { dir?: unknown; games?: unknown };
    if (typeof body.dir === 'string') dir = body.dir;
    if (!Array.isArray(body.games)) return [];
    return body.games.flatMap((g: { system?: unknown; file?: unknown; size?: unknown }) => {
      if (!isSystem(g.system) || typeof g.file !== 'string' || !romFileOk(g.system, g.file)) return [];
      const game: Game = { key: `s:${g.system}:${g.file}`, source: 'shelf', system: g.system, title: titleFromFile(g.file), file: g.file };
      if (typeof g.size === 'number') game.size = g.size;
      return [game];
    });
  } catch {
    return [];
  }
}

/** The games you added in this browser, or nothing when it keeps nothing. */
async function myGames(): Promise<Game[]> {
  try {
    const roms = await myRoms.list();
    return roms
      .filter((r) => isSystem(r.system))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((r) => ({ key: `m:${r.id}`, source: 'mine', system: r.system, title: r.title, file: r.file, size: r.size, id: r.id }));
  } catch {
    return [];
  }
}

/** Every game there is to play, the computer's own first. */
export async function loadLibrary(): Promise<Game[]> {
  const [shelf, mine] = await Promise.all([shelfGames(), myGames()]);
  return [...CATALOG_GAMES, ...shelf, ...mine];
}

/** Games fetched this visit, so playing one again starts straight away. Kept to CACHE_BYTES. */
const cache = new Map<string, ArrayBuffer>();
const CACHE_BYTES = 96 * 1024 * 1024;

function remember(key: string, buf: ArrayBuffer) {
  cache.delete(key);
  if (buf.byteLength > CACHE_BYTES / 2) return;
  cache.set(key, buf);
  let total = 0;
  for (const b of cache.values()) total += b.byteLength;
  for (const [k, b] of cache) {
    if (total <= CACHE_BYTES) break;
    cache.delete(k);
    total -= b.byteLength;
  }
}

/** A game's file, a copy of its own (the emulator's frame takes it). */
export async function romOf(game: Game, signal?: AbortSignal): Promise<ArrayBuffer> {
  const kept = cache.get(game.key);
  if (kept) return kept.slice(0);
  let buf: ArrayBuffer;
  if (game.source === 'mine') {
    const rom = game.id ? await myRoms.get(game.id) : undefined;
    if (!rom) throw new Error('That game is no longer in this browser');
    buf = await rom.data.arrayBuffer();
  } else {
    const url = game.source === 'catalog' ? collectionUrl(game.system, game.file) : `/api/retro/rom?system=${encodeURIComponent(game.system)}&file=${encodeURIComponent(game.file)}`;
    const res = await fetch(url, { signal, credentials: game.source === 'shelf' ? 'same-origin' : 'omit' });
    if (!res.ok) throw new Error(res.status === 404 ? 'That game is gone' : `The game didn't download (${res.status})`);
    if (Number(res.headers.get('content-length')) > MAX_ROM_BYTES) throw new Error('That game is too big to play here');
    buf = await res.arrayBuffer();
  }
  if (buf.byteLength > MAX_ROM_BYTES) throw new Error('That game is too big to play here');
  remember(game.key, buf);
  return buf.slice(0);
}
