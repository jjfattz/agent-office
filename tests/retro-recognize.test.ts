import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32, crcHex, crcsOf, zipDirectory, zipEntries } from '../src/shared/retro-crc.js';
import { baseTitle, byTitle, nameRank, prettyTitle, regionOf, systemFromPath, thumbUrls, titleKey } from '../src/shared/retro-names.js';
import { RETRO_SYSTEMS, SYSTEM_IDS } from '../src/shared/retro.js';
import { LIBRETRO_DB_COMMIT, RetroDb, buildIndex, parseDat, type FetchList } from '../src/server/retro-db.js';
import { RetroShelf } from '../src/server/retro.js';
import { parseIdentify } from '../src/server/http/routes/retro.js';
import { guessSystem } from '../src/client/features/retro/add.js';
import { described, parseMeta, type Game } from '../src/client/features/retro/games.js';

function dataDir(t: TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-retro-db-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));
const reader = (data: Uint8Array) => async (start: number, end: number) => data.subarray(start, end);

/** A zip holding `files` stored as they are, the way any zip tool makes one. */
function storedZip(files: Record<string, Uint8Array>): Uint8Array {
  const parts: Buffer[] = [];
  const dir: Buffer[] = [];
  let at = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(at, 42);
    parts.push(local, n, Buffer.from(data));
    dir.push(central, n);
    at += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(dir);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(dir.length / 2, 8);
  end.writeUInt16LE(dir.length / 2, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(at, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}

test('a game file is recognized by its CRC, with or without the header some copies have', async () => {
  assert.equal(crcHex(crc32(bytes('123456789'))), 'CBF43926', 'the standard check value');
  assert.equal(crc32(bytes('6789'), crc32(bytes('12345'))), crc32(bytes('123456789')), 'read in pieces');
  const game = bytes('the game itself');
  const nes = new Uint8Array([...bytes('NES\x1a'), ...new Uint8Array(12), ...game]);
  assert.deepEqual(await crcsOf('x.nes', nes.length, reader(nes)), [crcHex(crc32(nes)), crcHex(crc32(game))]);
  const copier = new Uint8Array(1024 + 512).fill(7);
  assert.deepEqual(await crcsOf('x.smc', copier.length, reader(copier)), [crcHex(crc32(copier)), crcHex(crc32(copier.subarray(512)))]);
  assert.deepEqual(await crcsOf('x.sfc', 1024, reader(new Uint8Array(1024))), [crcHex(crc32(new Uint8Array(1024)))], 'no header to take off');
  assert.deepEqual(await crcsOf('x.7z', 10, reader(new Uint8Array(10))), [], "a 7z isn't looked inside");
});

test("a zipped game is recognized by the CRC the zip keeps for it, without unzipping it", async () => {
  const rom = bytes('Sonic');
  const zip = storedZip({ 'readme.txt': bytes('hello'), 'folder/': new Uint8Array(0), 'Sonic (USA).md': rom });
  const where = zipDirectory(zip.subarray(Math.max(0, zip.length - 65_557)), zip.length);
  assert.ok(where);
  assert.deepEqual(
    zipEntries(zip.subarray(where.start, where.start + where.length)).map((e) => e.name),
    ['readme.txt', 'Sonic (USA).md'],
  );
  assert.deepEqual(await crcsOf('Sonic.zip', zip.length, reader(zip)), [crcHex(crc32(rom))], 'only the game, not the readme');
  assert.deepEqual(await crcsOf('broken.zip', 5, reader(bytes('hello'))), []);
});

test("game names: what people call them, what they have in common, and where they're from", () => {
  assert.equal(prettyTitle('Legend of Zelda, The - A Link to the Past (USA)'), 'The Legend of Zelda: A Link to the Past');
  assert.equal(prettyTitle('Super Mario Bros. 3 (USA) (Rev 1)'), 'Super Mario Bros. 3');
  assert.equal(prettyTitle('Streets_of_Rage_2 [!]'), 'Streets of Rage 2');
  assert.equal(prettyTitle("Pitfall! - Pitfall Harry's Jungle Adventure (USA)"), "Pitfall! Pitfall Harry's Jungle Adventure");
  assert.equal(baseTitle('Tetris (World) (Rev 1)'), 'Tetris');
  assert.deepEqual(
    ['Mega Man 10', 'The Legend of Zelda', 'Mega Man 2', 'Contra', 'A Boy and His Blob'].map((title) => ({ title })).sort(byTitle).map((g) => g.title),
    ['A Boy and His Blob', 'Contra', 'The Legend of Zelda', 'Mega Man 2', 'Mega Man 10'],
  );
  for (const same of ['The Legend of Zelda', 'legend_of_zelda', 'Legend of Zelda, The (USA)', 'LEGEND OF ZELDA (E) [!]']) assert.equal(titleKey(same), 'legendofzelda', same);
  assert.equal(titleKey('Pokémon - Gold Version'), titleKey('Pokemon - Gold Version'));
  assert.equal(titleKey('Ren & Stimpy'), titleKey('Ren and Stimpy'));
  assert.equal(regionOf('Pokemon - Gold Version (USA, Europe) (SGB Enhanced)'), 'USA, Europe');
  assert.equal(regionOf('Tetris (Rev 1)'), undefined);
  assert.ok(nameRank('Contra (USA)') < nameRank('Contra (Japan)'));
  assert.ok(nameRank('Contra (Japan)') < nameRank('Contra (USA) (Beta)'));
  assert.ok(nameRank('Contra (USA)') < nameRank('Contra (USA) (Rev 1)'));
  assert.deepEqual(thumbUrls('Nintendo - Nintendo Entertainment System', 'Mario & Luigi: Yes? (USA)').map((u) => u.split('/').slice(-3).join('/')), [
    'master/Named_Boxarts/Mario%20_%20Luigi_%20Yes_%20(USA).png',
    'master/Named_Titles/Mario%20_%20Luigi_%20Yes_%20(USA).png',
    'master/Named_Snaps/Mario%20_%20Luigi_%20Yes_%20(USA).png',
  ]);
  assert.ok(thumbUrls('Sega - Mega Drive - Genesis', 'x').every((u) => u.startsWith('https://raw.githubusercontent.com/libretro-thumbnails/Sega_-_Mega_Drive_-_Genesis/')));
});

test("a folder's name says a game's console when its file's doesn't", () => {
  assert.equal(systemFromPath('ROMs/SNES/game.zip'), 'snes');
  assert.equal(systemFromPath('Nintendo - Super Nintendo Entertainment System/game.zip'), 'snes');
  assert.equal(systemFromPath('roms/Nintendo - Nintendo Entertainment System/game.zip'), 'nes');
  assert.equal(systemFromPath('Sega - Mega Drive - Genesis/game.bin'), 'genesis');
  assert.equal(systemFromPath('Atari 2600/game.bin'), 'atari2600');
  assert.equal(systemFromPath('Game Boy Advance/x.zip'), 'gba');
  assert.equal(systemFromPath('stuff/gbc/x.zip'), 'gb');
  assert.equal(systemFromPath('downloads/x.zip'), null);
  assert.equal(systemFromPath('nes.zip'), null, 'only folders, not the file');
  assert.equal(guessSystem('Sonic.bin', 'Genesis/Sonic.bin'), 'genesis');
  assert.equal(guessSystem('Combat.bin', 'Atari 2600/Combat.bin'), 'atari2600');
  assert.equal(guessSystem('x.bin', 'SNES/x.bin'), '', "a .bin can't be a Super Nintendo game");
  assert.equal(guessSystem('Zelda.nes', 'SNES/Zelda.nes'), 'nes', 'the extension says first');
  // Every console's lists are named, for recognizing its games and filing their pictures.
  for (const id of SYSTEM_IDS) assert.ok(RETRO_SYSTEMS[id].db.length > 0, id);
});

const NOINTRO = `clrmamepro (
\tname "Nintendo - Nintendo Entertainment System"
)

game (
\tname "Legend of Zelda, The (USA)"
\tregion "USA"
\trom ( name "Legend of Zelda, The (USA).nes" size 131088 crc AAAA0001 md5 00 sha1 00 )
)
game (
\tname "Legend of Zelda, The (USA)"
\trom ( name "Legend of Zelda, The (USA).unh" size 131072 crc aaaa0002 )
)
game (
\tname "Legend of Zelda, The (Europe)"
\trom ( name "Legend of Zelda, The (Europe).nes" size 131088 crc AAAA0003 )
)
game (
\tname "Legend of Zelda, The (USA) (Beta)"
\trom ( name "Legend of Zelda, The (USA) (Beta).nes" size 131088 crc AAAA0004 )
)
game (
\tname "Pitfall! - Pitfall Harry's Jungle Adventure (USA)"
\trom ( name "x.nes" size 1 crc BBBB0001 )
)
`;
const YEARS = `clrmamepro (
\tname "Nintendo - Nintendo Entertainment System"
)

game (
\tcomment "Legend of Zelda, The (USA)"
\treleaseyear "1987"
\trom ( crc AAAA0001 )
)
`;
const DEVS = `game (
\tcomment "Legend of Zelda, The (Europe)"
\tdeveloper "Nintendo ???"
\trom ( crc FFFFFFFF )
)
`;

test('libretro\'s lists are read into an index of games by CRC, with what each list says of them', () => {
  assert.deepEqual(parseDat(NOINTRO)[1], { fields: { name: 'Legend of Zelda, The (USA)' }, crcs: ['AAAA0002'] });
  assert.deepEqual(parseDat('game (\n\tcomment "Say \\"hi\\""\n\tusers 2\n)\n')[0].fields, { comment: 'Say "hi"', users: '2' });
  const index = buildIndex('Nintendo - Nintendo Entertainment System', { 'no-intro': NOINTRO, releaseyear: YEARS, developer: DEVS });
  assert.equal(index.games.length, 4, 'each game once, however many copies');
  const usa = index.games[index.crcs.AAAA0002];
  assert.equal(usa, index.games[index.crcs.AAAA0001], 'both copies are the same game');
  // By CRC (the year), and by name where the CRC is no help (the maker, without its ???), and shared out to its other copies.
  assert.deepEqual(usa, { name: 'Legend of Zelda, The (USA)', year: 1987, developer: 'Nintendo' });
  assert.deepEqual(index.games[index.crcs.AAAA0003], { name: 'Legend of Zelda, The (Europe)', year: 1987, developer: 'Nintendo' });
});

/** A database whose lists are these, counting downloads. */
function fakeLists(lists: Partial<Record<string, string>>) {
  const asked: string[] = [];
  const fetchText: FetchList = async (url) => {
    asked.push(url);
    const list = /\/metadat\/([^/]+)\//.exec(url)?.[1] ?? '';
    return lists[list] ?? null;
  };
  return { asked, fetchText };
}

test("a game is recognized by what's in it, else by its name, from lists downloaded once and kept", async (t) => {
  const dir = dataDir(t);
  const { asked, fetchText } = fakeLists({ 'no-intro': NOINTRO, releaseyear: YEARS });
  const db = new RetroDb(dir, fetchText);
  assert.deepEqual(await db.identify('nes', 'whatever.nes', ['AAAA0003']), { name: 'Legend of Zelda, The (Europe)', db: 'Nintendo - Nintendo Entertainment System', match: 'crc', year: 1987 });
  assert.equal((await db.identify('nes', 'Legend of Zelda, The (Europe).nes', []))?.name, 'Legend of Zelda, The (Europe)', 'its exact name');
  assert.equal((await db.identify('nes', 'zelda_the_legend_of.nes', []))?.name, undefined, 'not a name it has');
  assert.equal((await db.identify('nes', 'The Legend of Zelda.nes', []))?.name, 'Legend of Zelda, The (USA)', "the USA's, not a beta");
  assert.equal((await db.identify('nes', 'Pitfall!.nes', []))?.name, "Pitfall! - Pitfall Harry's Jungle Adventure (USA)", 'its title without the subtitle');
  assert.equal(await db.identify('nes', 'Not a Real Game.nes', ['12345678']), null);
  assert.ok(asked.every((u) => u.includes(LIBRETRO_DB_COMMIT)), 'pinned');
  assert.equal(asked.filter((u) => u.includes('/no-intro/')).length, 1, 'downloaded once');
  assert.ok(existsSync(path.join(dir, 'retro-db', LIBRETRO_DB_COMMIT, 'Nintendo - Nintendo Entertainment System.json')));
  // Another start of the office reads what it kept, without downloading.
  const offline = new RetroDb(dir, async () => {
    throw new Error('offline');
  });
  assert.equal((await offline.identify('nes', 'x.nes', ['AAAA0001']))?.name, 'Legend of Zelda, The (USA)');
});

test("without libretro's lists, nothing is recognized yet, and the office doesn't keep asking", async (t) => {
  const asked: string[] = [];
  const db = new RetroDb(dataDir(t), async (url) => {
    asked.push(url);
    throw new Error('offline');
  });
  const warn = t.mock.method(console, 'warn', () => {});
  assert.equal(await db.identify('nes', 'Zelda.nes', []), undefined, "undefined: it couldn't tell");
  assert.equal(await db.identify('nes', 'Zelda.nes', []), undefined);
  assert.equal(asked.filter((u) => u.includes('/no-intro/')).length, 1, 'it waits before trying again');
  assert.equal(warn.mock.callCount(), 1);
});

test("the office's shelf says what each of its games is, and keeps their CRCs for next time", async (t) => {
  const dir = dataDir(t);
  const rom = bytes('a cartridge');
  const lists = { 'no-intro': NOINTRO.replace('AAAA0003', crcHex(crc32(rom))) };
  const shelf = new RetroShelf(dir, new RetroDb(dir, fakeLists(lists).fetchText));
  shelf.files();
  writeFileSync(path.join(dir, 'roms', 'nes', 'zelda-eu.nes'), rom);
  writeFileSync(path.join(dir, 'roms', 'nes', 'Some Homebrew.nes'), bytes('homebrew'));
  const { games, pending } = await shelf.list();
  assert.equal(pending, false);
  assert.deepEqual(
    games.map((g) => [g.file, g.meta?.name, g.meta?.match]),
    [
      ['Some Homebrew.nes', undefined, undefined],
      ['zelda-eu.nes', 'Legend of Zelda, The (Europe)', 'crc'],
    ],
  );
  assert.ok(existsSync(path.join(dir, 'retro-db', 'shelf-crcs.json')));
  // A restarted office that can't download anything still has the lists it kept, and the CRCs.
  const again = new RetroShelf(dir, new RetroDb(dir, async () => null));
  assert.equal((await again.list()).games.find((g) => g.file === 'zelda-eu.nes')?.meta?.name, 'Legend of Zelda, The (Europe)');
});

test('what the page asks the office to recognize is checked', () => {
  assert.deepEqual(parseIdentify({ games: [{ system: 'nes', file: 'Zelda.nes', crcs: ['AAAA0001', 'nope', 5] }] }), [{ system: 'nes', file: 'Zelda.nes', crcs: ['AAAA0001'] }]);
  assert.deepEqual(parseIdentify({ games: [{ system: 'nes', file: 'Zelda.nes' }] }), [{ system: 'nes', file: 'Zelda.nes', crcs: [] }]);
  for (const bad of [null, {}, { games: 'x' }, { games: [{ system: 'psx', file: 'a.bin' }] }, { games: [{ system: 'nes', file: '../a.nes' }] }, { games: Array(2001).fill({ system: 'nes', file: 'a.nes' }) }]) assert.equal(parseIdentify(bad), null, JSON.stringify(bad)?.slice(0, 60));
});

test("the page shows a recognized game by its proper name, with its box; an unknown one by its file's", () => {
  const game: Game = { key: 's:nes:zelda.nes', source: 'shelf', system: 'nes', title: 'zelda.nes', file: 'zelda.nes' };
  const meta = parseMeta({ name: 'Legend of Zelda, The (USA)', db: 'Nintendo - Nintendo Entertainment System', match: 'crc', year: 1987, developer: 'Nintendo R&D4', publisher: 'Nintendo', players: 1, extra: 'x' }, 'nes');
  assert.ok(meta);
  const shown = described(game, meta);
  assert.equal(shown.title, 'The Legend of Zelda');
  assert.equal(shown.region, 'USA');
  assert.equal(shown.year, 1987);
  assert.equal(shown.by, 'Nintendo R&D4');
  assert.equal(shown.boxart, true);
  assert.match(shown.art?.[0] ?? '', /Named_Boxarts\/Legend%20of%20Zelda%2C%20The%20\(USA\)\.png$/);
  assert.deepEqual(described({ ...game, file: 'Contra (Japan) [!].nes' }, null), { ...game, file: 'Contra (Japan) [!].nes', title: 'Contra', region: 'Japan' });
  // What the office says is checked: another console's list, or a name too long, isn't believed.
  assert.equal(parseMeta({ name: 'x', db: 'Sega - Mega Drive - Genesis', match: 'crc' }, 'nes'), null);
  assert.equal(parseMeta({ name: 'x'.repeat(301), db: 'Nintendo - Nintendo Entertainment System', match: 'crc' }, 'nes'), null);
  assert.equal(parseMeta({ name: 'x', db: 'Nintendo - Nintendo Entertainment System', match: 'maybe' }, 'nes'), null);
  assert.deepEqual(parseMeta({ name: 'x', db: 'Nintendo - Nintendo Entertainment System', match: 'name', year: 'soon', players: 99 }, 'nes'), { name: 'x', db: 'Nintendo - Nintendo Entertainment System', match: 'name' });
});
