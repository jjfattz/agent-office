// libretro's database of games (github.com/libretro/libretro-database), which RetroArch recognizes
// games with: No-Intro's list of every known copy of every game for a console, each by its CRC, and
// lists of each game's year, maker, genre and players. The office downloads a console's lists the first
// time one of its games needs recognizing (pinned to a commit, so they don't change under it), keeps
// what it needs of them in its data folder, and recognizes a game file by what's in it or, failing
// that, by its name.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RETRO_SYSTEMS, extOf, type RetroMeta, type RetroSystem } from '../shared/retro.js';
import { nameRank, titleKey } from '../shared/retro-names.js';

/** The database's commit the office reads. */
export const LIBRETRO_DB_COMMIT = '90601bff67dba7057381292f17e08ed2cecbd6dc';
const BASE = `https://raw.githubusercontent.com/libretro/libretro-database/${LIBRETRO_DB_COMMIT}/metadat`;

/** A console's lists: No-Intro's (the games, by CRC), then what's known of each. */
const LISTS = ['no-intro', 'releaseyear', 'developer', 'publisher', 'genre', 'maxusers'] as const;
type List = (typeof LISTS)[number];

/** The biggest list the office downloads, in bytes. */
const MAX_LIST = 32 * 1024 * 1024;
/** How long a console's lists wait before being tried again after they wouldn't download, in ms. */
const RETRY_AFTER = 10 * 60_000;

export interface DbGame {
  name: string;
  year?: number;
  developer?: string;
  publisher?: string;
  genre?: string;
  players?: number;
}

/** What the office keeps of a console's lists: its games, and which game each CRC is. */
export interface DbIndex {
  db: string;
  games: DbGame[];
  crcs: Record<string, number>;
}

/** A list's games: each one's fields ("name", "comment", "releaseyear"…) and the CRCs of its files. */
export function parseDat(text: string): { fields: Record<string, string>; crcs: string[] }[] {
  const out: { fields: Record<string, string>; crcs: string[] }[] = [];
  let cur: { fields: Record<string, string>; crcs: string[] } | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === 'game (') {
      cur = { fields: {}, crcs: [] };
      continue;
    }
    if (!cur) continue;
    if (line === ')') {
      out.push(cur);
      cur = null;
    } else if (line.startsWith('rom (')) {
      for (const m of line.matchAll(/\bcrc ([0-9a-fA-F]{8})\b/g)) cur.crcs.push(m[1].toUpperCase());
    } else {
      const m = /^(\w+)\s+(?:"((?:[^"\\]|\\.)*)"|(\S+))$/.exec(line);
      if (m) cur.fields[m[1]] = (m[2] ?? m[3]).replace(/\\(.)/g, '$1');
    }
  }
  return out;
}

/** A maker's or genre's name, without the ??? the lists put for a studio nobody knows ("Sega ???" is Sega). */
const text = (v: string | undefined) => (v ? v.replace(/\?{2,}/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || undefined : undefined);

/** A console's index, from its lists' text (all but No-Intro's may be missing). */
export function buildIndex(db: string, lists: Partial<Record<List, string>>): DbIndex {
  const games: DbGame[] = [];
  const byName = new Map<string, number>();
  const crcs: Record<string, number> = {};
  for (const g of parseDat(lists['no-intro'] ?? '')) {
    const name = g.fields.name;
    if (!name) continue;
    let i = byName.get(name);
    if (i === undefined) byName.set(name, (i = games.push({ name }) - 1));
    for (const c of g.crcs) crcs[c] ??= i;
  }
  // The other lists name each game in a comment and give its CRC: either finds it.
  const fill = (list: List, apply: (g: DbGame, f: Record<string, string>) => void) => {
    for (const g of parseDat(lists[list] ?? '')) {
      const i = g.crcs.map((c) => crcs[c]).find((n) => n !== undefined) ?? byName.get(g.fields.comment ?? '');
      if (i !== undefined) apply(games[i], g.fields);
    }
  };
  fill('releaseyear', (g, f) => {
    const year = Number(f.releaseyear);
    if (!g.year && year >= 1970 && year <= 2100) g.year = year;
  });
  fill('developer', (g, f) => (g.developer ??= text(f.developer)));
  fill('publisher', (g, f) => (g.publisher ??= text(f.publisher)));
  fill('genre', (g, f) => (g.genre ??= text(f.genre)));
  fill('maxusers', (g, f) => {
    const n = Number(f.users);
    if (!g.players && n >= 1 && n <= 16) g.players = n;
  });
  // A copy the lists say nothing about (a revision, another region) gets what they say about the game.
  const byTitle = new Map<string, DbGame[]>();
  for (const g of games) {
    const key = titleKey(g.name);
    const group = byTitle.get(key);
    if (group) group.push(g);
    else byTitle.set(key, [g]);
  }
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    for (const field of ['year', 'developer', 'publisher', 'genre', 'players'] as const) {
      const known = group.find((g) => g[field] !== undefined)?.[field];
      if (known !== undefined) for (const g of group) (g as unknown as Record<string, unknown>)[field] ??= known;
    }
  }
  return { db, games, crcs };
}

/** An index, and the ways into it by name: the whole name, its title, and its title before any subtitle. */
interface Loaded {
  index: DbIndex;
  byName: Map<string, number>;
  byTitle: Map<string, number[]>;
  byLead: Map<string, number[]>;
}

function loaded(index: DbIndex): Loaded {
  const byName = new Map<string, number>();
  const byTitle = new Map<string, number[]>();
  const byLead = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, key: string, i: number) => {
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(i);
    else map.set(key, [i]);
  };
  index.games.forEach((g, i) => {
    byName.set(g.name.toLowerCase(), i);
    add(byTitle, titleKey(g.name), i);
    // "Pitfall! - Pitfall Harry's Jungle Adventure" is also just "Pitfall!".
    if (g.name.includes(' - ')) add(byLead, titleKey(g.name.split(' - ')[0]), i);
  });
  return { index, byName, byTitle, byLead };
}

/** Of several copies of a game, the one people most likely mean (see nameRank). */
function likeliest(l: Loaded, found: number[]): number {
  return found.reduce((a, b) => {
    const [na, nb] = [l.index.games[a].name, l.index.games[b].name];
    const [ra, rb] = [nameRank(na), nameRank(nb)];
    return rb < ra || (rb === ra && nb.length < na.length) ? b : a;
  });
}

/** Downloads a list's text, or null when the database has no such list. */
export type FetchList = (url: string) => Promise<string | null>;

async function fetchList(url: string): Promise<string | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status}`);
  if (Number(res.headers.get('content-length')) > MAX_LIST) throw new Error('too big');
  const body = await res.text();
  if (body.length > MAX_LIST) throw new Error('too big');
  return body;
}

export class RetroDb {
  /** .agent-office/retro-db/<commit>, where the indexes are kept. */
  readonly dir: string;
  private ready = new Map<string, Loaded>();
  private loading = new Map<string, Promise<Loaded | null>>();
  private failedAt = new Map<string, number>();

  constructor(dataDir: string, private readonly fetchText: FetchList = fetchList) {
    this.dir = path.join(dataDir, 'retro-db', LIBRETRO_DB_COMMIT);
  }

  /**
   * What the database says about a game file of `system`'s: by its CRCs, or else by its name. Null when
   * it isn't in the database, and undefined when the database couldn't be had (try again later).
   */
  async identify(system: RetroSystem, file: string, crcs: readonly string[]): Promise<RetroMeta | null | undefined> {
    // A Game Boy Color game is likelier on the Color's list, and so on.
    const dbs = [...RETRO_SYSTEMS[system].db];
    if (['gbc', 'ngc', 'wsc'].includes(extOf(file))) dbs.reverse();
    const lists = await Promise.all(dbs.map((db) => this.load(db)));
    const have = lists.filter((l): l is Loaded => !!l);
    for (const l of have) for (const c of crcs) if (Object.hasOwn(l.index.crcs, c)) return meta(l, l.index.crcs[c], 'crc');
    const base = file.replace(/\.[^.]+$/, '');
    for (const l of have) {
      const i = l.byName.get(base.toLowerCase());
      if (i !== undefined) return meta(l, i, 'name');
    }
    const key = titleKey(base);
    for (const by of ['byTitle', 'byLead'] as const) {
      for (const l of key ? have : []) {
        const found = l[by].get(key);
        if (found?.length) return meta(l, likeliest(l, found), 'name');
      }
    }
    return have.length === lists.length ? null : undefined;
  }

  /** A console list's index: kept from before, or downloaded and kept now. Null when it can't be had. */
  load(db: string): Promise<Loaded | null> {
    const ready = this.ready.get(db);
    if (ready) return Promise.resolve(ready);
    const failed = this.failedAt.get(db);
    if (failed && Date.now() - failed < RETRY_AFTER) return Promise.resolve(null);
    let p = this.loading.get(db);
    if (!p) {
      p = this.read(db)
        .then((index) => {
          const l = loaded(index);
          this.ready.set(db, l);
          return l;
        })
        .catch((err) => {
          console.warn(`The office couldn't get libretro's list of ${db} games: ${(err as Error).message}`);
          this.failedAt.set(db, Date.now());
          return null;
        })
        .finally(() => this.loading.delete(db));
      this.loading.set(db, p);
    }
    return p;
  }

  private async read(db: string): Promise<DbIndex> {
    const file = path.join(this.dir, `${db.replace(/[^\w .-]/g, '_')}.json`);
    try {
      const kept = JSON.parse(readFileSync(file, 'utf8')) as DbIndex;
      if (kept.db === db && Array.isArray(kept.games) && kept.crcs && typeof kept.crcs === 'object') return kept;
    } catch {
      // Not kept yet (or spoiled): download it.
    }
    const texts = await Promise.all(LISTS.map((list) => this.fetchText(`${BASE}/${list}/${encodeURIComponent(db)}.dat`).catch((err) => (list === 'no-intro' ? Promise.reject(err) : null))));
    if (!texts[0]) throw new Error('its list is missing');
    const index = buildIndex(db, Object.fromEntries(LISTS.map((list, i) => [list, texts[i] ?? undefined])));
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(`${file}.tmp`, JSON.stringify(index));
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      console.warn(`The office couldn't keep libretro's list of ${db} games: ${(err as Error).message}`);
    }
    return index;
  }
}

function meta(l: Loaded, i: number, match: RetroMeta['match']): RetroMeta {
  const g = l.index.games[i];
  const out: RetroMeta = { name: g.name, db: l.index.db, match };
  for (const k of ['year', 'developer', 'publisher', 'genre', 'players'] as const) if (g[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = g[k];
  return out;
}
