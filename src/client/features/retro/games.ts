// The boss's computer's library: the ones on the office's own shelf (src/server/retro.ts), the ones you
// added in this browser (store.ts), each with what libretro's database says it is (its proper name, its
// year, who made it, its box), and the homebrew games it comes with (catalog.ts), as one list; and
// fetching a game to play.
import { MAX_ROM_BYTES, RETRO_SYSTEMS, isSystem, romFileOk, type RetroMeta, type RetroSystem } from '../../../shared/retro';
import { byTitle, prettyTitle, regionOf, thumbUrls } from '../../../shared/retro-names';
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
  /** Who made it (its developer). */
  by?: string;
  publisher?: string;
  year?: number;
  genre?: string;
  players?: number;
  /** Where it was sold: "USA", "Japan", "Europe". */
  region?: string;
  blurb?: string;
  /** Its pictures, to try in turn until one's there. */
  art?: readonly string[];
  /** Its pictures are of its box (shown whole), not of the game. */
  boxart?: boolean;
  /** How the office knows what game it is (see RetroMeta.match); missing when it doesn't. */
  known?: RetroMeta['match'];
  size?: number;
  /** For one you added: its id in this browser, and its CRCs, to recognize it by. */
  id?: string;
  crcs?: string[];
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
  art: [artUrl(c)],
}));

/** What the office says about a game, checked: null when it isn't something it could say. */
export function parseMeta(m: unknown, system: RetroSystem): RetroMeta | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  if (typeof o.name !== 'string' || !o.name.trim() || o.name.length > 300) return null;
  if (typeof o.db !== 'string' || !(RETRO_SYSTEMS[system].db as readonly string[]).includes(o.db)) return null;
  if (o.match !== 'crc' && o.match !== 'name') return null;
  const out: RetroMeta = { name: o.name, db: o.db, match: o.match };
  if (typeof o.year === 'number' && o.year >= 1970 && o.year <= 2100) out.year = Math.round(o.year);
  for (const k of ['developer', 'publisher', 'genre'] as const) {
    const v = o[k];
    if (typeof v === 'string' && v.trim() && v.length <= 120) out[k] = v;
  }
  if (typeof o.players === 'number' && o.players >= 1 && o.players <= 16) out.players = Math.round(o.players);
  return out;
}

/** A game of yours with what the database says it is, or else what its file's name says. */
export function described(game: Game, meta: RetroMeta | null | undefined): Game {
  const base = game.file.replace(/\.[^.]+$/, '');
  if (!meta) return { ...game, title: prettyTitle(base), region: regionOf(base) };
  return {
    ...game,
    title: prettyTitle(meta.name),
    region: regionOf(meta.name) ?? regionOf(base),
    year: meta.year,
    by: meta.developer ?? meta.publisher,
    publisher: meta.publisher,
    genre: meta.genre,
    players: meta.players,
    art: thumbUrls(meta.db, meta.name),
    boxart: true,
    known: meta.match,
  };
}

let dir: string | null = null;
/** Where the office keeps its shelf, to say so (null until the office has said). */
export const shelfDir = () => dir;

/** The office's shelf, or nothing when it can't be reached. `pending`: the office is still recognizing some of it. */
async function shelfGames(): Promise<{ games: Game[]; pending: boolean }> {
  try {
    const res = await fetch('/api/retro/shelf', { credentials: 'same-origin' });
    if (!res.ok) return { games: [], pending: false };
    const body = (await res.json()) as { dir?: unknown; games?: unknown; pending?: unknown };
    if (typeof body.dir === 'string') dir = body.dir;
    if (!Array.isArray(body.games)) return { games: [], pending: false };
    const games = body.games.flatMap((g: { system?: unknown; file?: unknown; size?: unknown; meta?: unknown }) => {
      if (!isSystem(g.system) || typeof g.file !== 'string' || !romFileOk(g.system, g.file)) return [];
      const game: Game = { key: `s:${g.system}:${g.file}`, source: 'shelf', system: g.system, title: g.file, file: g.file };
      if (typeof g.size === 'number') game.size = g.size;
      return [described(game, parseMeta(g.meta, g.system))];
    });
    return { games, pending: body.pending === true };
  } catch {
    return { games: [], pending: false };
  }
}

/** What the office said each of your own games is, by key (null: not a game it knows), so it's asked once a visit. */
const recognized = new Map<string, RetroMeta | null>();
/** The most games asked about at once. */
const ASK_AT_ONCE = 2000;

/** Asks the office what your games are, the ones not asked about yet. Says whether some are still being worked out. */
async function recognize(games: Game[]): Promise<boolean> {
  const ask = games.filter((g) => !recognized.has(g.key)).slice(0, ASK_AT_ONCE);
  if (!ask.length) return false;
  try {
    const res = await fetch('/api/retro/identify', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ games: ask.map((g) => ({ system: g.system, file: g.file, crcs: g.crcs ?? [] })) }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { metas?: unknown; pending?: unknown };
    if (!Array.isArray(body.metas)) return false;
    const pending = body.pending === true;
    ask.forEach((g, i) => {
      const meta = parseMeta((body.metas as unknown[])[i], g.system);
      // One the office hasn't got to yet is asked about again.
      if (meta || !pending) recognized.set(g.key, meta);
    });
    return pending || games.some((g) => !recognized.has(g.key));
  } catch {
    return false;
  }
}

/** The games you added in this browser, or nothing when it keeps nothing. */
async function myGames(): Promise<Game[]> {
  try {
    const roms = await myRoms.list();
    return roms
      .filter((r) => isSystem(r.system))
      .map((r) => ({ key: `m:${r.id}`, source: 'mine', system: r.system, title: r.title, file: r.file, size: r.size, id: r.id, crcs: r.crcs }));
  } catch {
    return [];
  }
}

/**
 * Every game there is to play: yours (the office's and this browser's) by name, then the homebrew it
 * comes with. `pending`: the office is still recognizing some, so asking again in a moment says more.
 */
export async function loadLibrary(): Promise<{ games: Game[]; pending: boolean }> {
  const [shelf, mine] = await Promise.all([shelfGames(), myGames()]);
  const minePending = await recognize(mine);
  const yours = [...shelf.games, ...mine.map((g) => described(g, recognized.get(g.key)))].sort(byTitle);
  return { games: [...yours, ...CATALOG_GAMES], pending: shelf.pending || minePending };
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
