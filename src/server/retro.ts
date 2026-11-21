// The office's own shelf of games for the boss's computer (features/retro on the page): a folder for
// each console under the data folder, .agent-office/roms/<console>/, that whoever runs the office puts
// game files in. Everyone signed in sees them in the library and can play them. The office only ever
// lists and reads plain files in those folders, by a name the page can't use to step outside them, and
// recognizes each game in libretro's database (retro-db.ts) to give it its proper name and pictures.
import { createReadStream, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, type ReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { crcsOf } from '../shared/retro-crc.js';
import { MAX_ROM_BYTES, SYSTEM_IDS, isSystem, romFileOk, type RetroMeta, type RetroSystem } from '../shared/retro.js';
import { RetroDb } from './retro-db.js';

/** A game on the shelf. */
export interface ShelfGame {
  system: RetroSystem;
  file: string;
  size: number;
  /** When it was put there, in ms. */
  added: number;
  /** What libretro's database says it is, once the office has recognized it. */
  meta?: RetroMeta;
}

/** The most games the shelf lists for a console. */
const MAX_PER_SYSTEM = 2000;
/** How long listing the shelf waits on recognizing new games before answering with what it knows, in ms. */
const LIST_WAIT = 4000;

/** What the office worked out about a file, and the size and time it had then (a new copy is looked at afresh). */
interface Known {
  size: number;
  mtime: number;
  crcs?: string[];
  /** Null: not in the database. */
  meta?: RetroMeta | null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.());

export class RetroShelf {
  /** .agent-office/roms, with a folder for each console in it. */
  readonly dir: string;
  readonly db: RetroDb;
  private made = false;
  /** What's known of each file, by console/file, and where the CRCs are kept between runs. */
  private known = new Map<string, Known>();
  private readonly sums: string;
  private sumsRead = false;
  private job: Promise<void> | null = null;

  constructor(dataDir: string, db = new RetroDb(dataDir)) {
    this.dir = path.join(dataDir, 'roms');
    this.db = db;
    this.sums = path.join(dataDir, 'retro-db', 'shelf-crcs.json');
  }

  /** Makes the folders the first time anyone looks, so whoever runs the office can see where games go. */
  private make() {
    if (this.made) return;
    this.made = true;
    try {
      for (const id of SYSTEM_IDS) mkdirSync(path.join(this.dir, id), { recursive: true });
    } catch (err) {
      console.warn(`The office couldn't make its games folder ${this.dir}: ${(err as Error).message}`);
    }
  }

  /** Every game on the shelf, console by console, in name order, without what they are. */
  files(): ShelfGame[] {
    this.make();
    const out: ShelfGame[] = [];
    for (const system of SYSTEM_IDS) {
      let names: string[];
      try {
        names = readdirSync(path.join(this.dir, system));
      } catch {
        continue;
      }
      let n = 0;
      for (const file of names.sort((a, b) => a.localeCompare(b))) {
        if (n >= MAX_PER_SYSTEM) break;
        const st = this.stat(system, file);
        if (!st) continue;
        out.push({ system, file, size: st.size, added: Math.round(st.mtimeMs) });
        n++;
      }
    }
    return out;
  }

  /**
   * Every game on the shelf, with what each is as far as the office knows. New games are recognized
   * meanwhile, for up to `wait` ms; `pending` says some still are, for asking again in a moment.
   */
  async list(wait = LIST_WAIT): Promise<{ games: ShelfGame[]; pending: boolean }> {
    const games = this.files();
    const job = this.recognize(games);
    const done = await Promise.race([job.then(() => true), sleep(wait).then(() => false)]);
    for (const g of games) {
      const meta = this.fresh(g)?.meta;
      if (meta) g.meta = meta;
    }
    return { games, pending: !done };
  }

  /** A game's file to send, or null when there's no such game on the shelf. */
  open(system: unknown, file: unknown): { size: number; stream: () => ReadStream } | null {
    if (!isSystem(system) || typeof file !== 'string') return null;
    const st = this.stat(system, file);
    if (!st) return null;
    const full = path.join(this.dir, system, file);
    return { size: st.size, stream: () => createReadStream(full) };
  }

  /** What's known of a game file, if it's still the same file. */
  private fresh(g: ShelfGame): Known | undefined {
    const k = this.known.get(`${g.system}/${g.file}`);
    return k && k.size === g.size && k.mtime === g.added ? k : undefined;
  }

  /** Recognizes the games not recognized yet, one after another (one run at a time; a later one picks up what this one missed). */
  private recognize(games: ShelfGame[]): Promise<void> {
    if (this.job) return this.job;
    const todo = games.filter((g) => this.fresh(g)?.meta === undefined);
    if (!todo.length) return Promise.resolve();
    this.job = this.run(todo).finally(() => (this.job = null));
    return this.job;
  }

  private async run(games: ShelfGame[]) {
    this.readSums();
    let summed = false;
    for (const g of games) {
      const key = `${g.system}/${g.file}`;
      let k = this.fresh(g);
      if (!k) this.known.set(key, (k = { size: g.size, mtime: g.added }));
      if (!k.crcs) {
        k.crcs = await this.crcs(g).catch(() => []);
        summed = true;
      }
      const meta = await this.db.identify(g.system, g.file, k.crcs);
      // Undefined: the database couldn't be had. It's asked again next time.
      if (meta !== undefined) k.meta = meta;
    }
    if (summed) this.writeSums();
  }

  private async crcs(g: ShelfGame): Promise<string[]> {
    const fh = await open(path.join(this.dir, g.system, g.file), 'r');
    try {
      return await crcsOf(g.file, g.size, async (start, end) => {
        const buf = Buffer.alloc(end - start);
        const { bytesRead } = await fh.read(buf, 0, buf.length, start);
        return buf.subarray(0, bytesRead);
      });
    } finally {
      await fh.close();
    }
  }

  /** The CRCs worked out before the office last stopped, so a big shelf isn't read through again. */
  private readSums() {
    if (this.sumsRead) return;
    this.sumsRead = true;
    try {
      const kept = JSON.parse(readFileSync(this.sums, 'utf8')) as Record<string, { size: number; mtime: number; crcs: string[] }>;
      for (const [key, v] of Object.entries(kept)) {
        if (typeof v?.size === 'number' && typeof v.mtime === 'number' && Array.isArray(v.crcs) && !this.known.has(key)) this.known.set(key, { size: v.size, mtime: v.mtime, crcs: v.crcs.filter((c) => /^[0-9A-F]{8}$/.test(c)) });
      }
    } catch {
      // None kept yet.
    }
  }

  private writeSums() {
    const out: Record<string, { size: number; mtime: number; crcs: string[] }> = {};
    for (const [key, k] of this.known) if (k.crcs) out[key] = { size: k.size, mtime: k.mtime, crcs: k.crcs };
    try {
      mkdirSync(path.dirname(this.sums), { recursive: true });
      writeFileSync(`${this.sums}.tmp`, JSON.stringify(out));
      renameSync(`${this.sums}.tmp`, this.sums);
    } catch (err) {
      console.warn(`The office couldn't keep its shelf's game CRCs: ${(err as Error).message}`);
    }
  }

  /** A file in a console's folder that can be one of its games: a plain name, a regular file (a link to one is fine), not empty and not too big. */
  private stat(system: RetroSystem, file: string) {
    if (!romFileOk(system, file)) return null;
    const folder = path.join(this.dir, system);
    const full = path.join(folder, file);
    // romFileOk already turns away anything with a slash in it, so this is belt and braces.
    if (path.dirname(full) !== folder) return null;
    try {
      const st = statSync(full);
      return st.isFile() && st.size > 0 && st.size <= MAX_ROM_BYTES ? st : null;
    } catch {
      return null;
    }
  }
}
