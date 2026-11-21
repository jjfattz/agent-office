// Adding games of your own to the boss's computer: game files from your computer, kept in this browser
// (store.ts), each for the console you say (the file's extension usually says, but a .bin or a .zip
// could be for any of several).
import { ARCHIVE_EXTS, MAX_ROM_BYTES, RETRO_SYSTEMS, SYSTEM_IDS, extOf, romFileOk, systemsFor, titleFromFile, type RetroSystem } from '../../../shared/retro';
import { h, openModal, toast } from '../../ui/dom';
import { shelfDir } from './games';
import { myRoms } from './store';

/** Every extension a game file can have, for the file picker. */
const ACCEPT = [...new Set([...SYSTEM_IDS.flatMap((id) => RETRO_SYSTEMS[id].exts), ...ARCHIVE_EXTS])].map((e) => `.${e}`).join(',');

/** A file's name as the emulator will see it: no folders or odd characters, and short enough to keep. */
export function cleanFileName(name: string): string {
  const ext = extOf(name);
  let base = name.replace(/[/\\\0-\x1f]/g, '_').replace(/^\.+/, '');
  if (base.length > 200) base = `${base.slice(0, 190 - ext.length)}.${ext}`;
  return base || `game.${ext}`;
}

/**
 * The window for adding games: pick files (or drop them on it, or bring some already dropped on the
 * screen), say which console each is for, and add them. `added` hears how many went in.
 */
export function openAddGames(dropped: File[], added: (n: number) => void) {
  const rows: { file: File; pick: HTMLSelectElement }[] = [];
  const list = h('ul.retro-files');
  const go = h('button.btn.primary', { type: 'button', disabled: true }, 'Add games');
  const input = h('input', { type: 'file', multiple: true, accept: ACCEPT, hidden: true });
  const drop = h('label.retro-drop', {}, h('b', {}, 'Choose game files…'), h('span', {}, 'or drop them here'), input);

  const take = (files: Iterable<File>) => {
    for (const file of files) {
      if (rows.some((r) => r.file.name === file.name && r.file.size === file.size)) continue;
      if (file.size > MAX_ROM_BYTES) {
        toast(`${file.name} is too big to keep here`, 'warn');
        continue;
      }
      const guess = systemsFor(file.name);
      const pick = h('select', { 'aria-label': `Console for ${file.name}` });
      const all = guess.length ? [...guess, ...SYSTEM_IDS.filter((id) => !guess.includes(id))] : SYSTEM_IDS;
      if (guess.length !== 1) pick.append(h('option', { value: '' }, 'Which console?'));
      for (const id of all) pick.append(h('option', { value: id }, RETRO_SYSTEMS[id].name));
      if (guess.length === 1) pick.value = guess[0];
      pick.addEventListener('change', sync);
      rows.push({ file, pick });
      list.append(h('li', {}, h('span.name', { title: file.name }, file.name), h('span.size', {}, mb(file.size)), pick));
    }
    sync();
  };
  function sync() {
    const ready = rows.filter((r) => r.pick.value).length;
    go.disabled = ready === 0;
    go.textContent = ready ? `Add ${ready} game${ready === 1 ? '' : 's'}` : 'Add games';
  }

  input.addEventListener('change', () => {
    if (input.files) take(input.files);
    input.value = '';
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer?.files) take(e.dataTransfer.files);
  });

  const dir = shelfDir();
  const box = h(
    'div.modal.retro-addgames',
    { role: 'dialog', 'aria-label': 'Add games' },
    h('header', {}, h('h2', {}, '＋ Add games')),
    h(
      'div.body',
      {},
      h('p.setting-note', {}, 'Game files from your computer stay in this browser, for you to play here. Zipped games work too.'),
      drop,
      list,
      h('p.setting-note', {}, 'To share games with everyone in the office, put them on the office’s computer instead, in a folder for each console: ', h('code', {}, `${dir ?? '.agent-office/roms'}/<console>/`), ` (${SYSTEM_IDS.join(', ')}). They show up under 📁 Office shelf.`),
    ),
    h('footer', {}, h('span.grow'), go),
  );
  const modal = openModal(box, { doing: '🕹️ adding retro games' });

  go.addEventListener('click', async () => {
    go.disabled = true;
    let n = 0;
    for (const { file, pick } of rows) {
      const system = pick.value as RetroSystem;
      if (!system) continue;
      const name = cleanFileName(file.name);
      if (!romFileOk(system, name)) {
        toast(`${file.name} isn't a ${RETRO_SYSTEMS[system].name} game file`, 'warn');
        continue;
      }
      try {
        await myRoms.put({ id: crypto.randomUUID(), system, title: titleFromFile(name), file: name, size: file.size, added: Date.now(), data: file });
        n++;
      } catch {
        toast('This browser won’t keep games (a private window, or it’s out of room)', 'error');
        break;
      }
    }
    modal.close();
    if (n) toast(`Added ${n} game${n === 1 ? '' : 's'}`);
    added(n);
  });
  take(dropped);
}

function mb(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
