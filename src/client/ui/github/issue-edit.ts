import { GH_COMMENT_MAX, GH_TITLE_MAX } from '../../../shared/protocol';
import type { Net } from '../../net';
import { h } from '../dom';
import { markdown } from '../markdown';
import { editWaiters } from './api';

// ---- Issue editor -------------------------------------------------------------------------------

export interface IssueText {
  title: string;
  body: string;
}

export interface IssueEditor {
  el: HTMLElement;
  /** Stops waiting for an answer; the window closed. */
  dispose(): void;
}

/**
 * Edits an issue's title and description in place of its first card. It saves through the server's
 * gh, so as your own GitHub sign-in, or else the office's (`viewer` names it when known). `done`
 * gets what GitHub saved, or nothing when you cancel.
 */
export function issueEditor(n: number, start: IssueText, itemUrl: string, viewer: string, net: Net, done: (saved?: IssueText) => void): IssueEditor {
  let busy = false;
  let timer = 0;
  const title = h('input', { type: 'text', value: start.title, maxlength: GH_TITLE_MAX, placeholder: 'Title', 'aria-label': 'Title' }) as HTMLInputElement;
  const ta = h('textarea', { rows: 10, maxlength: GH_COMMENT_MAX, placeholder: 'Describe the issue. Markdown works; ⌘/Ctrl+Enter saves it.', 'aria-label': 'Description' }) as HTMLTextAreaElement;
  ta.value = start.body;
  const shown = h('div.gh-compose-preview.hidden');
  const write = h('button.btn.on', { type: 'button' }, 'Write');
  const preview = h('button.btn', { type: 'button' }, 'Preview');
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  const save = h('button.btn.primary', { type: 'button' }, '💾 Save');
  const result = h('div.gh-merge-result.error.hidden');
  const el = h(
    'article.gh-card.gh-compose.gh-edit',
    {},
    h('header', {}, h('b', {}, `✏️ Edit issue #${n}`), h('span.grow'), h('div.seg', {}, write, preview)),
    h('div.gh-compose-body', {}, title, ta, shown),
    result,
    h('div.gh-compose-foot', {}, h('span.grow', {}, viewer ? `Saves to GitHub as @${viewer}` : "Saves to GitHub as the office's gh account"), cancel, save),
  );

  const changed = () => title.value.trim() !== start.title || ta.value !== start.body;
  const sync = () => {
    save.disabled = busy || !title.value.trim() || !changed();
    title.readOnly = ta.readOnly = busy;
    cancel.disabled = busy;
    save.textContent = busy ? 'Saving…' : '💾 Save';
  };
  const setPreview = (on: boolean) => {
    write.classList.toggle('on', !on);
    preview.classList.toggle('on', on);
    ta.classList.toggle('hidden', on);
    shown.classList.toggle('hidden', !on);
    if (on) shown.replaceChildren(ta.value.trim() ? markdown(ta.value, itemUrl) : h('p.gh-quiet', {}, 'No description.'));
    else ta.focus();
  };
  const fail = (text: string) => {
    result.textContent = text;
    result.classList.remove('hidden');
  };
  const settle = () => {
    editWaiters.delete(n);
    clearTimeout(timer);
    busy = false;
  };
  const submit = () => {
    if (save.disabled) return;
    busy = true;
    result.classList.add('hidden');
    sync();
    editWaiters.set(n, (msg) => {
      settle();
      if (msg.error) {
        fail(msg.error);
        sync();
      } else done({ title: msg.title ?? title.value.trim(), body: msg.body ?? ta.value });
    });
    // The office drops messages while it's disconnected, and then no answer comes.
    timer = window.setTimeout(() => {
      settle();
      fail('No answer from the office. Reload the issue to see whether the edit went through before saving it again.');
      sync();
    }, 45_000);
    net.send({ t: 'gh.edit', number: n, title: title.value.trim(), body: ta.value });
  };

  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || e.target === title)) {
      e.preventDefault();
      submit();
    }
  };
  title.addEventListener('keydown', keys);
  ta.addEventListener('keydown', keys);
  title.addEventListener('input', sync);
  ta.addEventListener('input', sync);
  write.addEventListener('click', () => setPreview(false));
  preview.addEventListener('click', () => setPreview(true));
  cancel.addEventListener('click', () => done());
  save.addEventListener('click', submit);
  sync();
  setTimeout(() => title.focus(), 30);
  return { el, dispose: settle };
}
