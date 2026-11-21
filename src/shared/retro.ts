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
}

export const RETRO_SYSTEMS = {
  nes: { name: 'NES', maker: 'Nintendo', year: 1985, ejs: 'nes', exts: ['nes', 'unf', 'unif'], color: '#e63946' },
  snes: { name: 'Super Nintendo', maker: 'Nintendo', year: 1991, ejs: 'snes', exts: ['sfc', 'smc', 'fig', 'swc'], color: '#7b61ff' },
  n64: { name: 'Nintendo 64', maker: 'Nintendo', year: 1996, ejs: 'n64', exts: ['n64', 'z64', 'v64'], color: '#2a9d8f' },
  gb: { name: 'Game Boy', maker: 'Nintendo', year: 1989, ejs: 'gb', exts: ['gb', 'gbc', 'dmg'], color: '#8ab17d' },
  gba: { name: 'Game Boy Advance', maker: 'Nintendo', year: 2001, ejs: 'gba', exts: ['gba', 'agb'], color: '#5e60ce' },
  nds: { name: 'Nintendo DS', maker: 'Nintendo', year: 2004, ejs: 'nds', exts: ['nds'], color: '#6c757d' },
  vb: { name: 'Virtual Boy', maker: 'Nintendo', year: 1995, ejs: 'vb', exts: ['vb', 'vboy'], color: '#c1121f' },
  genesis: { name: 'Genesis', maker: 'Sega', year: 1989, ejs: 'segaMD', exts: ['md', 'gen', 'smd', 'bin'], color: '#1d3557' },
  sms: { name: 'Master System', maker: 'Sega', year: 1986, ejs: 'segaMS', exts: ['sms'], color: '#d62828' },
  gg: { name: 'Game Gear', maker: 'Sega', year: 1991, ejs: 'segaGG', exts: ['gg'], color: '#3a86ff' },
  s32x: { name: '32X', maker: 'Sega', year: 1994, ejs: 'sega32x', exts: ['32x'], color: '#9d0208' },
  atari2600: { name: 'Atari 2600', maker: 'Atari', year: 1977, ejs: 'atari2600', exts: ['a26', 'bin'], color: '#bc6c25' },
  atari7800: { name: 'Atari 7800', maker: 'Atari', year: 1986, ejs: 'atari7800', exts: ['a78'], color: '#dda15e' },
  jaguar: { name: 'Atari Jaguar', maker: 'Atari', year: 1993, ejs: 'jaguar', exts: ['j64', 'jag'], color: '#9b2226' },
  pce: { name: 'TurboGrafx-16', maker: 'NEC', year: 1989, ejs: 'pce', exts: ['pce'], color: '#f77f00' },
  ngp: { name: 'Neo Geo Pocket', maker: 'SNK', year: 1998, ejs: 'ngp', exts: ['ngp', 'ngc'], color: '#457b9d' },
  ws: { name: 'WonderSwan', maker: 'Bandai', year: 1999, ejs: 'ws', exts: ['ws', 'wsc'], color: '#4361ee' },
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
