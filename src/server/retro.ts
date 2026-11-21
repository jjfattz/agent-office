// The office's own shelf of games for the boss's computer (features/retro on the page): a folder for
// each console under the data folder, .agent-office/roms/<console>/, that whoever runs the office puts
// game files in. Everyone signed in sees them in the library and can play them. The office only ever
// lists and reads plain files in those folders, by a name the page can't use to step outside them.
import { createReadStream, mkdirSync, readdirSync, statSync, type ReadStream } from 'node:fs';
import path from 'node:path';
import { MAX_ROM_BYTES, SYSTEM_IDS, isSystem, romFileOk, type RetroSystem } from '../shared/retro.js';

/** A game on the shelf. */
export interface ShelfGame {
  system: RetroSystem;
  file: string;
  size: number;
  /** When it was put there, in ms. */
  added: number;
}

/** The most games the shelf lists for a console. */
const MAX_PER_SYSTEM = 2000;

export class RetroShelf {
  /** .agent-office/roms, with a folder for each console in it. */
  readonly dir: string;
  private made = false;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'roms');
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

  /** Every game on the shelf, console by console, in name order. */
  list(): ShelfGame[] {
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

  /** A game's file to send, or null when there's no such game on the shelf. */
  open(system: unknown, file: unknown): { size: number; stream: () => ReadStream } | null {
    if (!isSystem(system) || typeof file !== 'string') return null;
    const st = this.stat(system, file);
    if (!st) return null;
    const full = path.join(this.dir, system, file);
    return { size: st.size, stream: () => createReadStream(full) };
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
