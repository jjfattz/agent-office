// Adding games of your own to the boss's computer: game files from your computer, or whole folders of
// them, kept in this browser (store.ts), each for the console you say. A file's extension usually says
// (and else the folders it's in, "SNES/…"), but a .bin or a .zip could be for any of several. Each
// game's CRCs are worked out as it's added, for the office to recognize it by (games.ts).
import { ARCHIVE_EXTS, MAX_ROM_BYTES, RETRO_SYSTEMS, SYSTEM_IDS, extOf, romFileOk, systemsFor, titleFromFile, type RetroSystem } from '../../../shared/retro';
import { crcsOf } from '../../../shared/retro-crc';
import { systemFromPath } from '../../../shared/retro-names';
import { h, openModal, toast } from '../../ui/dom';
import { shelfDir } from './games';
import { myRoms } from './store';

/** A file to add, and the path of folders it was in, which can say its console. */
export interface Picked {
  file: File;
  path: string;
}

/** Every extension a game file can have. */
const EXTS = new Set([...SYSTEM_IDS.flatMap((id) => RETRO_SYSTEMS[id].exts as readonly string[]), ...ARCHIVE_EXTS]);
const ACCEPT = [...EXTS].map((e) => `.${e}`).join(',');
/** The most files one go takes, and the most the window lists one by one (the rest go by their extension or folder). */
const MAX_FILES = 5000;
const MAX_ROWS = 300;

/** A file's name as the emulator will see it: no folders or odd characters, and short enough to keep. */
export function cleanFileName(name: string): string {
  const ext = extOf(name);
  let base = name.replace(/[/\\\0-\x1f]/g, '_').replace(/^\.+/, '');
  if (base.length > 200) base = `${base.slice(0, 190 - ext.length)}.${ext}`;
  return base || `game.${ext}`;
}

/** The console a file is most likely for: its extension's, or the one its folders name. Empty when it can't tell. */
export function guessSystem(name: string, path: string): RetroSystem | '' {
  const by = systemsFor(name);
  if (by.length === 1) return by[0];
  const folder = systemFromPath(path);
  return folder && (by.length === 0 || by.includes(folder)) ? folder : '';
}

/** The files dropped on something, each folder's all the way down. Call it in the drop itself (the drop's list goes after). */
export function droppedFiles(dt: DataTransfer): Promise<Picked[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return Promise.resolve([...dt.files].map((file) => ({ file, path: file.name })));
  return walk(entries);
}

async function walk(entries: FileSystemEntry[]): Promise<Picked[]> {
  const out: Picked[] = [];
  const queue = [...entries];
  while (queue.length && out.length < MAX_FILES) {
    const e = queue.shift()!;
    if (e.isFile) {
      const file = await new Promise<File | null>((resolve) => (e as FileSystemFileEntry).file(resolve, () => resolve(null)));
      if (file) out.push({ file, path: e.fullPath.replace(/^\//, '') });
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      // A folder hands over its entries a batch at a time, until a batch is empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
        if (!batch.length) break;
        queue.push(...batch);
      }
    }
  }
  return out;
}

interface Row extends Picked {
  system: RetroSystem | '';
  pick?: HTMLSelectElement;
}

function systemSelect(label: string, first: string, value: RetroSystem | '', prefer: RetroSystem[] = []): HTMLSelectElement {
  const pick = h('select', { 'aria-label': label });
  pick.append(h('option', { value: '' }, first));
  for (const id of [...prefer, ...SYSTEM_IDS.filter((s) => !prefer.includes(s))]) pick.append(h('option', { value: id }, RETRO_SYSTEMS[id].name));
  pick.value = value;
  return pick;
}

/**
 * The window for adding games: pick files or a folder (or drop them on it, or bring some already
 * dropped on the screen), say which console any is for that it can't tell, and add them. `added`
 * hears how many went in.
 */
export function openAddGames(dropped: Picked[], added: (n: number) => void) {
  const rows: Row[] = [];
  let skipped = 0;
  const list = h('ul.retro-files');
  const more = h('p.setting-note.hidden');
  const rest = h('div.retro-rest.hidden');
  const go = h('button.btn.primary', { type: 'button', disabled: true }, 'Add games');
  const files = h('input', { type: 'file', multiple: true, accept: ACCEPT, hidden: true });
  const folder = h('input', { type: 'file', webkitdirectory: true, hidden: true });
  const pickFiles = h('button.btn', { type: 'button' }, '📄 Choose game files…');
  const pickFolder = h('button.btn', { type: 'button' }, '📁 Choose a folder…');
  pickFiles.addEventListener('click', () => files.click());
  pickFolder.addEventListener('click', () => folder.click());
  const drop = h('div.retro-drop', {}, h('div.retro-buttons', {}, pickFiles, pickFolder), h('span', {}, 'or drop game files or folders here'), files, folder);

  const take = (picked: Picked[]) => {
    for (const p of picked) {
      if (rows.length >= MAX_FILES) break;
      if (!EXTS.has(extOf(p.file.name))) {
        skipped++;
        continue;
      }
      if (p.file.size > MAX_ROM_BYTES) {
        toast(`${p.file.name} is too big to keep here`, 'warn');
        continue;
      }
      if (rows.some((r) => r.file.name === p.file.name && r.file.size === p.file.size)) continue;
      const row: Row = { ...p, system: guessSystem(p.file.name, p.path) };
      rows.push(row);
      if (rows.length > MAX_ROWS) continue;
      const guess = systemsFor(p.file.name);
      row.pick = systemSelect(`Console for ${p.file.name}`, 'Which console?', row.system, guess);
      row.pick.addEventListener('change', () => {
        row.system = row.pick!.value as RetroSystem | '';
        sync();
      });
      list.append(h('li', {}, h('span.name', { title: p.path }, p.file.name), h('span.size', {}, mb(p.file.size)), row.pick));
    }
    sync();
  };
  function sync() {
    const ready = rows.filter((r) => r.system).length;
    const unsure = rows.length - ready;
    go.disabled = ready === 0;
    go.textContent = ready ? `Add ${ready} game${ready === 1 ? '' : 's'}` : 'Add games';
    const unlisted = rows.length - Math.min(rows.length, MAX_ROWS);
    more.classList.toggle('hidden', !unlisted);
    more.textContent = `…and ${unlisted} more, each for the console its name or folder says.`;
    rest.classList.toggle('hidden', unsure < 2);
    if (unsure >= 2 && !rest.firstChild) {
      const all = systemSelect('Console for the rest', 'Which console?', '');
      all.addEventListener('change', () => {
        for (const r of rows) {
          if (r.system) continue;
          r.system = all.value as RetroSystem | '';
          if (r.pick) r.pick.value = r.system;
        }
        all.value = '';
        sync();
      });
      rest.replaceChildren(h('span', {}, 'All the ones that don’t say are for'), all);
    }
  }

  for (const input of [files, folder]) {
    input.addEventListener('change', () => {
      take([...(input.files ?? [])].map((file) => ({ file, path: file.webkitRelativePath || file.name })));
      input.value = '';
    });
  }
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer) void droppedFiles(e.dataTransfer).then(take);
  });

  const dir = shelfDir();
  const box = h(
    'div.modal.retro-addgames',
    { role: 'dialog', 'aria-label': 'Add games' },
    h('header', {}, h('h2', {}, '＋ Add games')),
    h(
      'div.body',
      {},
      h('p.setting-note', {}, 'Game files (ROMs) from your computer stay in this browser, for you to play here. Zipped games work too, and a whole folder of them at once. The office recognizes each game to give it its proper name, year and box.'),
      drop,
      rest,
      list,
      more,
      h('p.setting-note', {}, 'To share games with everyone in the office, put them on the office’s computer instead, in a folder for each console: ', h('code', {}, `${dir ?? '.agent-office/roms'}/<console>/`), ` (${SYSTEM_IDS.join(', ')}). They show up under 📁 Office shelf.`),
    ),
    h('footer', {}, h('span.grow'), go),
  );
  const modal = openModal(box, { doing: '🕹️ adding retro games' });

  go.addEventListener('click', async () => {
    go.disabled = true;
    const todo = rows.filter((r) => r.system);
    const have = new Set((await myRoms.list().catch(() => [])).map((r) => `${r.system}|${r.file}|${r.size}`));
    let n = 0;
    let same = 0;
    for (const [i, { file, system }] of todo.entries()) {
      go.textContent = `Adding ${i + 1} of ${todo.length}…`;
      const sys = system as RetroSystem;
      const name = cleanFileName(file.name);
      if (!romFileOk(sys, name)) {
        toast(`${file.name} isn't a ${RETRO_SYSTEMS[sys].name} game file`, 'warn');
        continue;
      }
      if (have.has(`${sys}|${name}|${file.size}`)) {
        same++;
        continue;
      }
      const crcs = await crcsOf(name, file.size, async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer())).catch(() => []);
      try {
        await myRoms.put({ id: crypto.randomUUID(), system: sys, title: titleFromFile(name), file: name, size: file.size, added: Date.now(), data: file, crcs });
        have.add(`${sys}|${name}|${file.size}`);
        n++;
      } catch {
        toast('This browser won’t keep games (a private window, or it’s out of room)', 'error');
        break;
      }
    }
    modal.close();
    const notes = [same ? `${same} already here` : '', skipped ? `${skipped} file${skipped === 1 ? '' : 's'} that aren't games skipped` : ''].filter(Boolean).join(', ');
    if (n || notes) toast(`Added ${n} game${n === 1 ? '' : 's'}${notes ? ` (${notes})` : ''}`);
    added(n);
  });
  take(dropped);
}

function mb(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
