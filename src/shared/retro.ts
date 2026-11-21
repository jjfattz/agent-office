// The consoles the boss's computer plays (see features/retro and docs/retro.md): what the page shows of
// each, the emulator that plays it, and the files its games come in. The office's own shelf of games
// (src/server/retro.ts) keeps a folder for each, named by its id here.

export interface RetroSystemInfo {
  /** Its name in the library. */
  name: string;
  /** Who made it, and the year it came out. */
  maker: string;
  year: number;
  /** What EmulatorJS calls it (its `EJS_core`), which picks the emulator that plays it. */
  ejs: string;
  /** The extensions its games come in, lowercase and without the dot. Any of them can come zipped too (see ARCHIVE_EXTS). */
  exts: readonly string[];
  /** Its color in the library, for a game with no picture of its own. */
  color: string;
  /** Its lists in libretro's database of games, which recognize its games and file their pictures (see src/server/retro-db.ts). */
  db: readonly string[];
}

/** What the office knows about a game file it recognized, from libretro's database (see src/server/retro-db.ts). */
export interface RetroMeta {
  /** The game's name in the database, No-Intro's: "Legend of Zelda, The (USA)". Its pictures go by it. */
  name: string;
  /** The list it's in (one of its console's `db`), which its pictures are filed under. */
  db: string;
  /** How it was recognized: by what's in its file (it's that game), or by its file's name (a good guess). */
  match: 'crc' | 'name';
  year?: number;
  developer?: string;
  publisher?: string;
  genre?: string;
  /** How many can play at once. */
  players?: number;
}

export const RETRO_SYSTEMS = {
  nes: { name: 'NES', maker: 'Nintendo', year: 1985, ejs: 'nes', exts: ['nes', 'unf', 'unif'], color: '#e63946', db: ['Nintendo - Nintendo Entertainment System'] },
  snes: { name: 'Super Nintendo', maker: 'Nintendo', year: 1991, ejs: 'snes', exts: ['sfc', 'smc', 'fig', 'swc'], color: '#7b61ff', db: ['Nintendo - Super Nintendo Entertainment System'] },
  n64: { name: 'Nintendo 64', maker: 'Nintendo', year: 1996, ejs: 'n64', exts: ['n64', 'z64', 'v64'], color: '#2a9d8f', db: ['Nintendo - Nintendo 64'] },
  gb: { name: 'Game Boy', maker: 'Nintendo', year: 1989, ejs: 'gb', exts: ['gb', 'gbc', 'dmg'], color: '#8ab17d', db: ['Nintendo - Game Boy', 'Nintendo - Game Boy Color'] },
  gba: { name: 'Game Boy Advance', maker: 'Nintendo', year: 2001, ejs: 'gba', exts: ['gba', 'agb'], color: '#5e60ce', db: ['Nintendo - Game Boy Advance'] },
  nds: { name: 'Nintendo DS', maker: 'Nintendo', year: 2004, ejs: 'nds', exts: ['nds'], color: '#6c757d', db: ['Nintendo - Nintendo DS'] },
  vb: { name: 'Virtual Boy', maker: 'Nintendo', year: 1995, ejs: 'vb', exts: ['vb', 'vboy'], color: '#c1121f', db: ['Nintendo - Virtual Boy'] },
  genesis: { name: 'Genesis', maker: 'Sega', year: 1989, ejs: 'segaMD', exts: ['md', 'gen', 'smd', 'bin'], color: '#1d3557', db: ['Sega - Mega Drive - Genesis'] },
  sms: { name: 'Master System', maker: 'Sega', year: 1986, ejs: 'segaMS', exts: ['sms'], color: '#d62828', db: ['Sega - Master System - Mark III'] },
  gg: { name: 'Game Gear', maker: 'Sega', year: 1991, ejs: 'segaGG', exts: ['gg'], color: '#3a86ff', db: ['Sega - Game Gear'] },
  s32x: { name: '32X', maker: 'Sega', year: 1994, ejs: 'sega32x', exts: ['32x'], color: '#9d0208', db: ['Sega - 32X'] },
  atari2600: { name: 'Atari 2600', maker: 'Atari', year: 1977, ejs: 'atari2600', exts: ['a26', 'bin'], color: '#bc6c25', db: ['Atari - 2600'] },
  atari7800: { name: 'Atari 7800', maker: 'Atari', year: 1986, ejs: 'atari7800', exts: ['a78'], color: '#dda15e', db: ['Atari - 7800'] },
  jaguar: { name: 'Atari Jaguar', maker: 'Atari', year: 1993, ejs: 'jaguar', exts: ['j64', 'jag'], color: '#9b2226', db: ['Atari - Jaguar'] },
  pce: { name: 'TurboGrafx-16', maker: 'NEC', year: 1989, ejs: 'pce', exts: ['pce'], color: '#f77f00', db: ['NEC - PC Engine - TurboGrafx 16'] },
  ngp: { name: 'Neo Geo Pocket', maker: 'SNK', year: 1998, ejs: 'ngp', exts: ['ngp', 'ngc'], color: '#457b9d', db: ['SNK - Neo Geo Pocket', 'SNK - Neo Geo Pocket Color'] },
  ws: { name: 'WonderSwan', maker: 'Bandai', year: 1999, ejs: 'ws', exts: ['ws', 'wsc'], color: '#4361ee', db: ['Bandai - WonderSwan', 'Bandai - WonderSwan Color'] },
} as const satisfies Record<string, RetroSystemInfo>;

export type RetroSystem = keyof typeof RETRO_SYSTEMS;

/** Every console, in the library's order: Nintendo's, Sega's, Atari's, then the rest. */
export const SYSTEM_IDS = Object.keys(RETRO_SYSTEMS) as RetroSystem[];

/** What a game can come zipped in: the emulator unpacks it and plays what's inside. */
export const ARCHIVE_EXTS: readonly string[] = ['zip', '7z'];

/** The biggest game file the office hands out or a browser keeps, in bytes. */
export const MAX_ROM_BYTES = 512 * 1024 * 1024;

export function isSystem(id: unknown): id is RetroSystem {
  return typeof id === 'string' && Object.hasOwn(RETRO_SYSTEMS, id);
}

/** A file's extension, lowercase and without the dot ('' when it has none). */
export function extOf(file: string): string {
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(dot + 1).toLowerCase() : '';
}

/**
 * Whether `file` can be one of `system`'s games: a plain file name (no folders, not hidden), in one of
 * its extensions or zipped.
 */
export function romFileOk(system: RetroSystem, file: string): boolean {
  if (!file || file.length > 200 || file.startsWith('.') || /[/\\\0-\x1f]/.test(file)) return false;
  const ext = extOf(file);
  return (RETRO_SYSTEMS[system].exts as readonly string[]).includes(ext) || ARCHIVE_EXTS.includes(ext);
}

/**
 * The consoles a file could be a game for, by its extension: one for most (.nes, .sfc), more for the
 * ones several share (.bin is a Genesis or an Atari 2600 game), and none for a zip, which could be anything.
 */
export function systemsFor(file: string): RetroSystem[] {
  const ext = extOf(file);
  return SYSTEM_IDS.filter((id) => (RETRO_SYSTEMS[id].exts as readonly string[]).includes(ext));
}

/** A game's title from its file name: "Super_Game (USA).sfc" is "Super Game (USA)". */
export function titleFromFile(file: string): string {
  const dot = file.lastIndexOf('.');
  const base = dot > 0 ? file.slice(0, dot) : file;
  return base.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || file;
}
