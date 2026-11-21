import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RETRO_SYSTEMS, SYSTEM_IDS, extOf, isSystem, romFileOk, systemsFor, titleFromFile } from '../src/shared/retro.js';
import { RetroShelf } from '../src/server/retro.js';
import { CATALOG, COLLECTIONS, artUrl, collectionUrl } from '../src/client/features/retro/catalog.js';
import { EJS_VERSION, defaultControls, frameHtml } from '../src/client/features/retro/frame.js';
import { parseFromFrame } from '../src/client/features/retro/player.js';
import { cleanFileName } from '../src/client/features/retro/add.js';

function dataDir(t: TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-retro-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("a game file is a plain name in one of its console's extensions, or zipped", () => {
  assert.ok(romFileOk('nes', 'Super Game (USA).nes'));
  assert.ok(romFileOk('nes', 'GAME.NES'));
  assert.ok(romFileOk('snes', 'game.sfc'));
  assert.ok(romFileOk('genesis', 'game.zip'));
  assert.ok(romFileOk('atari2600', 'game.bin'));
  assert.ok(!romFileOk('nes', 'game.sfc'), "another console's extension");
  assert.ok(!romFileOk('nes', 'game.exe'));
  assert.ok(!romFileOk('nes', 'nes'), 'no extension');
  for (const bad of ['../game.nes', 'sub/game.nes', 'sub\\game.nes', '.hidden.nes', 'ga\nme.nes', 'g\0.nes', `${'x'.repeat(200)}.nes`, '']) assert.ok(!romFileOk('nes', bad), bad);
});

test('which consoles a file could be for, and what to call it', () => {
  assert.deepEqual(systemsFor('a.nes'), ['nes']);
  assert.deepEqual(systemsFor('a.BIN'), ['genesis', 'atari2600']);
  assert.deepEqual(systemsFor('a.zip'), [], 'a zip could be for anything');
  assert.equal(extOf('a.b.SFC'), 'sfc');
  assert.equal(extOf('.nes'), '');
  assert.equal(titleFromFile('Super_Game  (USA).sfc'), 'Super Game (USA)');
  assert.equal(isSystem('nes'), true);
  assert.equal(isSystem('toString'), false);
  assert.equal(isSystem(undefined), false);
  // Every console has at least one extension of its own, and every extension is lowercase.
  for (const id of SYSTEM_IDS) {
    const exts = RETRO_SYSTEMS[id].exts as readonly string[];
    assert.ok(exts.length > 0 && exts.every((e) => e === e.toLowerCase() && !e.startsWith('.')), id);
  }
});

test('a file added from your computer keeps a name the emulator and the shelf can use', () => {
  assert.equal(cleanFileName('Game (USA).nes'), 'Game (USA).nes');
  assert.equal(cleanFileName('..evil/../x.nes'), 'evil_.._x.nes');
  const long = cleanFileName(`${'x'.repeat(300)}.sfc`);
  assert.ok(long.length <= 200 && long.endsWith('.sfc'));
  assert.ok(romFileOk('snes', long));
});

test('the games the computer comes with are each a file of a pinned collection, for their own console', () => {
  assert.ok(CATALOG.length >= 80, 'plenty of games');
  const seen = new Set<string>();
  for (const g of CATALOG) {
    assert.ok(isSystem(g.system), g.file);
    assert.ok(romFileOk(g.system, g.file), `${g.file} is a ${g.system} game file`);
    assert.ok(!seen.has(`${g.system}/${g.file}`), `${g.file} is listed twice`);
    seen.add(`${g.system}/${g.file}`);
    assert.ok(g.title.trim() && g.by.trim() && g.genre.trim() && g.blurb.trim(), g.file);
    assert.ok(g.year >= 1977 && g.year <= 2030, `${g.title}'s year`);
    assert.ok(g.players >= 1 && g.players <= 8, `${g.title}'s players`);
    const url = new URL(collectionUrl(g.system, g.file));
    assert.equal(url.origin, 'https://raw.githubusercontent.com');
    assert.ok(artUrl(g).endsWith('.png'));
  }
  // A handful at least for each of the consoles people asked for, and every collection pinned to a commit.
  for (const id of ['nes', 'snes', 'genesis', 'atari2600'] as const) assert.ok(CATALOG.filter((g) => g.system === id).length >= 10, id);
  for (const [id, c] of Object.entries(COLLECTIONS)) {
    assert.match(c.commit, /^[0-9a-f]{40}$/, id);
    assert.match(c.repo, /^retrobrews\/[a-z0-9-]+$/, id);
  }
  // Titles are unique within a console, so the library never shows two of the same.
  for (const id of SYSTEM_IDS) {
    const titles = CATALOG.filter((g) => g.system === id).map((g) => g.title.toLowerCase());
    assert.deepEqual(titles.filter((t, i) => titles.indexOf(t) !== i), [], id);
  }
});

test("the office's shelf lists the game files in each console's folder, and nothing else", (t) => {
  const dir = dataDir(t);
  const shelf = new RetroShelf(dir);
  assert.deepEqual(shelf.files(), []);
  // Looking made a folder for every console, so whoever runs the office can see where games go.
  for (const id of SYSTEM_IDS) assert.ok(existsSync(path.join(dir, 'roms', id)), id);
  const put = (rel: string, bytes = 'game') => writeFileSync(path.join(dir, 'roms', rel), bytes);
  put('nes/B Game.nes');
  put('nes/a game.zip');
  put('nes/notes.txt');
  put('nes/.hidden.nes');
  put('nes/empty.nes', '');
  mkdirSync(path.join(dir, 'roms', 'nes', 'folder.nes'));
  put('snes/game.nes', 'wrong console');
  put('atari2600/combat.bin');
  writeFileSync(path.join(dir, 'secret.nes'), 'outside');
  const list = shelf.files();
  assert.deepEqual(
    list.map((g) => `${g.system}/${g.file}`),
    ['nes/a game.zip', 'nes/B Game.nes', 'atari2600/combat.bin'],
  );
  assert.ok(list.every((g) => g.size === 4 && g.added > 0));
});

test('the shelf only hands out its own games, by a name that cannot step outside it', async (t) => {
  const dir = dataDir(t);
  const shelf = new RetroShelf(dir);
  shelf.files();
  writeFileSync(path.join(dir, 'roms', 'nes', 'game.nes'), 'NES\x1a');
  writeFileSync(path.join(dir, 'secret.nes'), 'outside');
  writeFileSync(path.join(dir, 'roms', 'secret.nes'), 'outside');
  const got = shelf.open('nes', 'game.nes');
  assert.ok(got);
  assert.equal(got.size, 4);
  const chunks: Buffer[] = [];
  for await (const c of got.stream()) chunks.push(c as Buffer);
  assert.equal(Buffer.concat(chunks).toString('latin1'), 'NES\x1a');
  for (const [system, file] of [
    ['nes', '../secret.nes'],
    ['nes', '../../secret.nes'],
    ['nes', `${dir}/secret.nes`],
    ['nes', 'nope.nes'],
    ['../roms', 'game.nes'],
    ['constructor', 'game.nes'],
    ['nes', 42],
    [undefined, undefined],
  ] as const) {
    assert.equal(shelf.open(system, file), null, `${String(system)} ${String(file)}`);
  }
  // A link to a game is fine (that's how you'd share a folder of them), and still only by a plain name.
  symlinkSync(path.join(dir, 'roms', 'nes', 'game.nes'), path.join(dir, 'roms', 'nes', 'linked.nes'));
  assert.ok(shelf.open('nes', 'linked.nes'));
});

test('the emulator frame is a page of its own that only messages the office', () => {
  const html = frameHtml();
  assert.match(html, /^<!doctype html>/i);
  assert.ok(html.includes('postMessage'));
  assert.ok(!html.includes('allow-same-origin'));
  assert.ok(!/document\.cookie|parent\.document|top\.document/.test(html), 'it never reaches into the office');
  assert.match(EJS_VERSION, /^\d+\.\d+\.\d+$/, 'a pinned EmulatorJS release');
  const controls = defaultControls();
  assert.deepEqual(Object.keys(controls), ['0', '1', '2', '3'], 'every player, so none falls back to clashing keys');
  assert.equal(controls[0][3].value, 'enter', 'Start');
  assert.equal(controls[0][8].value, 'x', 'A');
});

test('what the frame says is checked before the office believes it', () => {
  assert.deepEqual(parseFromFrame({ t: 'ready' }), { t: 'ready' });
  assert.deepEqual(parseFromFrame({ t: 'esc', extra: 1 }), { t: 'esc' });
  assert.equal(parseFromFrame(null), null);
  assert.equal(parseFromFrame('ready'), null);
  assert.equal(parseFromFrame({ t: 'boot' }), null, 'only what the frame may say');
  assert.equal(parseFromFrame({ t: 'failed', message: 'x'.repeat(5000) })?.t, 'failed');
  assert.equal((parseFromFrame({ t: 'failed', message: 'x'.repeat(5000) }) as { message: string }).message.length, 200);
  const state = new ArrayBuffer(8);
  assert.deepEqual(parseFromFrame({ t: 'saved', id: 3, state, shot: 'nope' }), { t: 'saved', id: 3, state, shot: null });
  assert.equal(parseFromFrame({ t: 'saved', id: 3, state: new ArrayBuffer(0) }), null, 'an empty save');
  assert.equal(parseFromFrame({ t: 'saved', id: '3', state }), null);
  assert.deepEqual(parseFromFrame({ t: 'saved', id: 4, error: 'no' }), { t: 'saved', id: 4, error: 'no' });
  assert.deepEqual(parseFromFrame({ t: 'setting', key: 'volume', value: '0.5' }), { t: 'setting', key: 'volume', value: '0.5' });
  assert.deepEqual(parseFromFrame({ t: 'setting', key: 'volume', value: null }), { t: 'setting', key: 'volume', value: null });
  assert.equal(parseFromFrame({ t: 'setting', key: 'k', value: 'x'.repeat(70 * 1024) }), null, 'too big to keep');
  assert.equal(parseFromFrame({ t: 'setting', key: 5, value: 'v' }), null);
});
