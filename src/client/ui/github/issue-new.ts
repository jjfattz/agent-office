import './windows.css';
import { GH_COMMENT_MAX, GH_TITLE_MAX, type GhIssue, type GhLabel } from '../../../shared/protocol';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal } from '../dom';
import { markdown } from '../markdown';
import { createWaiters, getJson } from './api';
import { labelChip } from './labels';
import { errorBox } from './pieces';

// ---- New issue ----------------------------------------------------------------------------------

/** What was typed into a new issue that wasn't opened yet, by floor, so closing the window by mistake loses nothing. */
const drafts = new Map<string, { title: string; body: string; labels: string[] }>();

/**
 * Opens a new issue on the floor's repository: a title, a description in Markdown and the repo's
 * labels to pick from. It goes through the server's gh, so as your own GitHub sign-in, or else the
 * office's. `created` gets the issue as GitHub saved it.
 */
export function openNewIssue(net: Net, created: (issue: GhIssue) => void) {
  const floor = store.floor ?? store.project?.dir ?? '';
  const draft = drafts.get(floor) ?? { title: '', body: '', labels: [] };
  const picked = new Set(draft.labels);
  // Any issue's address does for the preview's links (#12, relative paths); before the board has one, they stay as typed.
  const itemUrl = store.issues.items[0]?.url;
  let busy = false;
  let timer = 0;
  let id = '';

  const title = h('input', { type: 'text', value: draft.title, maxlength: GH_TITLE_MAX, placeholder: 'Title', 'aria-label': 'Title' }) as HTMLInputElement;
  const ta = h('textarea', { rows: 10, maxlength: GH_COMMENT_MAX, placeholder: 'Describe the issue. Markdown works; ⌘/Ctrl+Enter opens it.', 'aria-label': 'Description' }) as HTMLTextAreaElement;
  ta.value = draft.body;
  const shown = h('div.gh-compose-preview.hidden');
  const write = h('button.btn.on', { type: 'button' }, 'Write');
  const preview = h('button.btn', { type: 'button' }, 'Preview');
  const labelList = h('div.gh-new-labels', { role: 'group', 'aria-label': 'Labels' });
  const result = h('div.gh-merge-result.hidden');
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  const go = h('button.btn.primary', { type: 'button' }, '📝 Open issue');
  const el = h(
    'div.modal.gh-merge.gh-new-issue',
    { role: 'dialog', 'aria-label': 'New issue' },
    h('header', {}, h('h2', {}, '📝 New issue')),
    h('div.body', {}, title, h('div.gh-new-tabs', {}, h('div.seg', {}, write, preview)), ta, shown, h('label', {}, 'Labels'), labelList, result),
    h('footer', {}, h('span.grow', {}, 'Opens on GitHub as your own sign-in, or else the office’s gh account'), cancel, go),
  );

  const keep = () => drafts.set(floor, { title: title.value, body: ta.value, labels: [...picked] });
  const sync = () => {
    go.disabled = busy || !title.value.trim();
    title.readOnly = ta.readOnly = busy;
    go.textContent = busy ? 'Opening…' : '📝 Open issue';
    for (const b of labelList.querySelectorAll('button')) (b as HTMLButtonElement).disabled = busy;
  };
  const setPreview = (on: boolean) => {
    write.classList.toggle('on', !on);
    preview.classList.toggle('on', on);
    ta.classList.toggle('hidden', on);
    shown.classList.toggle('hidden', !on);
    if (on) shown.replaceChildren(ta.value.trim() ? markdown(ta.value, itemUrl) : h('p.gh-quiet', {}, 'No description.'));
    else ta.focus();
  };

  const renderLabels = (repo: GhLabel[]) => {
    const byName = (a: GhLabel, b: GhLabel) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    // A label picked in a draft that the repo no longer has would only be turned away.
    for (const name of picked) if (!repo.some((l) => l.name === name)) picked.delete(name);
    labelList.replaceChildren(
      ...[...repo].sort(byName).map((l) => {
        const b = h('button.gh-new-label', { type: 'button', 'aria-pressed': String(picked.has(l.name)), title: l.description ?? l.name }, labelChip(l)) as HTMLButtonElement;
        b.addEventListener('click', () => {
          if (picked.has(l.name)) picked.delete(l.name);
          else picked.add(l.name);
          b.setAttribute('aria-pressed', String(picked.has(l.name)));
          keep();
        });
        return b;
      }),
    );
    if (!repo.length) labelList.append(h('small.gh-quiet', {}, 'This repository has no labels yet.'));
    sync();
  };
  const loadLabels = () => {
    labelList.replaceChildren(h('small.gh-quiet', {}, 'Loading the repo’s labels…'));
    getJson<GhLabel[]>('/api/gh/labels')
      .then(renderLabels)
      .catch((err) => labelList.replaceChildren(errorBox((err as Error).message, loadLabels)));
  };

  const fail = (text: string) => {
    result.className = 'gh-merge-result error';
    result.replaceChildren(text);
  };
  const settle = () => {
    createWaiters.delete(id);
    clearTimeout(timer);
    busy = false;
  };
  const submit = () => {
    if (go.disabled) return;
    busy = true;
    id = Math.random().toString(36).slice(2, 12);
    result.className = 'gh-merge-result';
    result.replaceChildren(h('span.spinner'), 'Opening the issue on GitHub…');
    sync();
    createWaiters.set(id, (msg) => {
      settle();
      if (!msg.issue) {
        fail(msg.error ?? 'GitHub did not open the issue');
        return sync();
      }
      drafts.delete(floor);
      modal.close();
      created(msg.issue);
    });
    // The office drops messages while it's disconnected, and then no answer comes.
    timer = window.setTimeout(() => {
      settle();
      fail('No answer from the office. Look at the board to see whether the issue was opened before trying again.');
      sync();
    }, 45_000);
    net.send({ t: 'gh.create', id, title: title.value.trim(), body: ta.value, labels: [...picked] });
  };

  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || e.target === title)) {
      e.preventDefault();
      submit();
    }
  };
  title.addEventListener('keydown', keys);
  ta.addEventListener('keydown', keys);
  for (const box of [title, ta]) box.addEventListener('input', () => (keep(), sync()));
  write.addEventListener('click', () => setPreview(false));
  preview.addEventListener('click', () => setPreview(true));
  const modal = openModal(el, { doing: '📝 writing an issue', onClose: settle });
  cancel.addEventListener('click', () => modal.close());
  go.addEventListener('click', submit);
  loadLabels();
  sync();
  setTimeout(() => title.focus(), 30);
}
