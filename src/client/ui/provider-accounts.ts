import './provider-accounts.css';
import { ACCOUNT_PROVIDERS, PROVIDER_ACCOUNT_NAME_MAX, type AccountProvider, type ProviderAccountInfo } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, type Modal } from './dom';
import { confirmDialog } from './prompt';
import { PROVIDER_LABEL } from './provider';

/** What each provider's own login is called, and how it's signed in from a shell. */
const LOGIN: Record<AccountProvider, { name: string; shell: string; folder: string }> = {
  claude: { name: 'Claude', shell: 'claude auth login', folder: '~/.claude-work' },
  codex: { name: 'Codex', shell: 'codex login', folder: '~/.codex-work' },
};

let open: Modal | null = null;

/**
 * 🪪 Provider accounts: more than one login per agent on the office's machine (a work Claude and a
 * personal one), and which one the floor you're on runs each provider on (see
 * server/provider-accounts/). Admins only: everyone else sees the floor's picks in its details.
 */
export function openProviderAccounts(net: Net) {
  if (open) return;
  const floorRows = h('div.pa-floor');
  const cards = h('div.signins');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Provider accounts', style: 'width:min(680px,100%)' },
    h('header', {}, h('h2', {}, '🪪 Provider accounts')),
    h(
      'div.body.team',
      {},
      h('p.note.lead', {}, 'Keep more than one login for an agent on this machine — a work Claude and a personal one, say — and pick which one each project runs on. Going to a floor is going to its accounts: there’s nothing to switch.'),
      h('h4', {}, 'This floor'),
      floorRows,
      h('h4', {}, 'Accounts'),
      cards,
      h('h4', {}, 'Add an account'),
      addForm(net),
    ),
  );

  // Kept across renders, so a half-typed code survives the next update.
  const codes = new Map<string, HTMLInputElement>();
  const codeInput = (id: string) => {
    let input = codes.get(id);
    if (!input) codes.set(id, (input = h('input', { type: 'text', placeholder: 'Paste the code here', 'aria-label': 'Code from the sign-in page', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement));
    return input;
  };
  const button = (label: string, onClick: () => void, cls = '') => h('button.btn', { type: 'button', class: cls, onclick: onClick }, label);
  /** The account being renamed, in place of its name. */
  let renaming: string | null = null;
  const renameInput = h('input', { type: 'text', 'aria-label': 'New name', maxlength: PROVIDER_ACCOUNT_NAME_MAX, autocomplete: 'off' }) as HTMLInputElement;

  const renderFloor = () => {
    const s = store.providerAccountsState;
    const p = store.project;
    if (!p || !store.floor) return floorRows.replaceChildren(h('p.empty', {}, 'Go to a floor to pick the accounts its workers run on.'));
    const providers = ACCOUNT_PROVIDERS.filter((pr) => s?.accounts.some((a) => a.provider === pr));
    if (!providers.length) return floorRows.replaceChildren(h('p.empty', {}, `${p.name}’s workers run on this machine’s own logins. Add an account below to run them on another.`));
    floorRows.replaceChildren(
      ...providers.map((pr) => {
        const select = h('select', { 'aria-label': `${PROVIDER_LABEL[pr]} account for ${p.name}` }) as HTMLSelectElement;
        select.append(h('option', { value: '' }, `This machine’s own login (${s?.own[pr] ?? ''})`));
        for (const a of s?.accounts.filter((o) => o.provider === pr) ?? []) select.append(h('option', { value: a.id }, a.name));
        select.value = store.providerAccounts.floor[pr] ?? '';
        select.addEventListener('change', () => net.send({ t: 'providerAccounts.use', provider: pr, id: select.value || null }));
        return h('div.pa-pick', {}, h('span', {}, `${PROVIDER_LABEL[pr]} on ${p.name}`), select);
      }),
      h('p.note', {}, 'Workers hired here from now on run on it, and so does a 🐚 shell here. Workers already at their desks keep the account they were hired on, so their conversations carry on.'),
    );
  };

  const card = (a: ProviderAccountInfo) => {
    const status =
      a.status === 'ok'
        ? h('span.signin-who.ok', {}, '✅ ', a.who ?? 'Signed in')
        : a.status === 'busy'
          ? h('span.signin-who', {}, a.pending ? '⏳ Signing in…' : '⏳ Looking…')
          : h('span.signin-who.none', {}, 'Not signed in');
    const head = h('div.team-head', {}, renaming === a.id ? renameForm(a) : h('h4', {}, `${a.name} `, h('small.pa-kind', {}, PROVIDER_LABEL[a.provider])), status);
    const body = h('div.signin-body');
    const where = a.how === 'token' ? 'A pasted token, on this machine’s own settings' : `${a.made ? 'Its own folder' : 'Your folder'}: ${a.dir ?? ''}`;
    const used = [a.floors.length ? `Floors: ${a.floors.join(', ')}` : 'No floor runs on it yet', a.workers.length ? `${a.workers.length} worker${a.workers.length === 1 ? '' : 's'} on it` : ''].filter(Boolean).join(' · ');
    body.append(h('p.note', {}, where), h('p.note', {}, used));
    if (a.error) body.append(h('p.team-status.error', {}, a.error));

    if (a.pending) {
      const url = a.pending.url && /^https:\/\//.test(a.pending.url) ? a.pending.url : undefined;
      if (!url) body.append(h('p.note', {}, `Starting ${LOGIN[a.provider].name}’s sign-in…`));
      else {
        const input = codeInput(a.id);
        const send = h('button.btn.primary', { type: 'submit', disabled: !!a.pending.sent }, a.pending.sent ? 'Checking…' : 'Send');
        const form = h('form.invite-row', {}, input, send) as HTMLFormElement;
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const code = input.value.trim();
          if (!code) return input.focus();
          net.send({ t: 'providerAccounts.code', id: a.id, code });
          input.value = '';
        });
        body.append(h('ol.signin-steps', {}, h('li', {}, h('a.btn.primary', { href: url, target: '_blank', rel: 'noopener noreferrer' }, `Open ${LOGIN[a.provider].name}’s sign-in page ↗`), ` and sign in as ${a.name}.`), h('li', {}, 'It shows you a code. Paste it here:', form)));
      }
      body.append(h('div.signin-actions', {}, button('Cancel', () => net.send({ t: 'providerAccounts.cancel', id: a.id }))));
      return h('section.signin', { class: a.status }, head, body);
    }

    const actions = h('div.signin-actions');
    if (a.signIn) actions.append(button(a.status === 'ok' ? 'Sign in again' : `Sign in with ${LOGIN[a.provider].name}`, () => net.send({ t: 'providerAccounts.signin', id: a.id }), a.status === 'ok' ? '' : 'primary'));
    actions.append(button('Rename', () => rename(a)));
    const remove = button('Remove', () => {
      const floors = a.floors.length ? ` ${a.floors.join(', ')} go${a.floors.length === 1 ? 'es' : ''} back to this machine’s own login.` : '';
      const what = a.made ? 'Its folder, and the login in it, are deleted.' : a.how === 'token' ? 'The office forgets its token.' : `${a.dir} stays as it is: the office only forgets it.`;
      confirmDialog(`Remove ${a.name}?`, `${what}${floors}`, 'Remove', () => net.send({ t: 'providerAccounts.remove', id: a.id }));
    });
    if (a.workers.length) {
      remove.setAttribute('disabled', '');
      remove.title = `${a.workers.join(', ')} ${a.workers.length === 1 ? 'is' : 'are'} on it: send them home first`;
    }
    actions.append(remove);
    body.append(actions);
    if (a.how === 'folder' && a.status !== 'ok') {
      body.append(
        h(
          'p.note',
          {},
          a.signIn ? 'Or open a worker’s terminal on a floor that runs on it and type ' : 'Sign it in from a 🐚 shell on a floor that runs on it: type ',
          h('code', {}, a.signIn ? '/login' : LOGIN[a.provider].shell),
          ' there.',
        ),
      );
    }
    return h('section.signin', { class: a.status }, head, body);
  };

  const rename = (a: ProviderAccountInfo) => {
    renaming = a.id;
    renameInput.value = a.name;
    render();
    renameInput.focus();
    renameInput.select();
  };
  const renameForm = (a: ProviderAccountInfo) => {
    const form = h('form.invite-row.pa-rename', {}, renameInput, h('button.btn.primary', { type: 'submit' }, 'Save'), button('Cancel', () => ((renaming = null), render()))) as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = renameInput.value.trim();
      if (!name) return renameInput.focus();
      if (name !== a.name) net.send({ t: 'providerAccounts.rename', id: a.id, name });
      renaming = null;
      render();
    });
    return form;
  };

  const render = () => {
    const s = store.providerAccountsState;
    const typing = document.activeElement;
    renderFloor();
    if (!s) cards.replaceChildren(h('p.empty', {}, 'Loading…'));
    else if (!s.accounts.length) cards.replaceChildren(h('p.empty', {}, 'None yet: workers run on this machine’s own logins.'));
    else cards.replaceChildren(...s.accounts.map(card));
    if (typing instanceof HTMLInputElement && (typing === renameInput || [...codes.values()].includes(typing)) && typing.isConnected) typing.focus();
  };

  const offs = [store.on('providerAccountsState', render), store.on('providerAccounts', render), store.on('project', render)];
  open = openModal(el, {
    onClose: () => {
      for (const off of offs) off();
      open = null;
    },
  });
  render();
  net.send({ t: 'providerAccounts.get' });
}

/** Adding one: which provider, its name, and how it signs in. */
function addForm(net: Net): HTMLElement {
  const provider = h('select', { 'aria-label': 'Provider' }, ...ACCOUNT_PROVIDERS.map((p) => h('option', { value: p }, PROVIDER_LABEL[p]))) as HTMLSelectElement;
  const name = h('input', { type: 'text', placeholder: 'Work, Personal…', 'aria-label': 'Account name', maxlength: PROVIDER_ACCOUNT_NAME_MAX, autocomplete: 'off' }) as HTMLInputElement;
  const how = h('select', { 'aria-label': 'How it signs in' }) as HTMLSelectElement;
  const dir = h('input', { type: 'text', 'aria-label': 'Its folder', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const token = h('input', { type: 'password', placeholder: 'sk-ant-oat01-…', 'aria-label': 'Token', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const hint = h('p.note');
  const paint = () => {
    const p = provider.value as AccountProvider;
    const was = how.value;
    how.replaceChildren(h('option', { value: 'new' }, 'A new login, in a folder of its own'), h('option', { value: 'folder' }, 'A folder you already use'));
    if (p === 'claude') how.append(h('option', { value: 'token' }, 'A token from claude setup-token'));
    how.value = [...how.options].some((o) => o.value === was) ? was : 'new';
    dir.placeholder = LOGIN[p].folder;
    dir.hidden = how.value !== 'folder';
    token.hidden = how.value !== 'token';
    hint.textContent =
      how.value === 'new'
        ? `The office makes it a folder of its own; sign it in from here once it’s added. It starts without your ${LOGIN[p].name} settings.`
        : how.value === 'folder'
          ? `A config folder you already sign in with (what you set ${p === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'} to), settings and all.`
          : 'Run claude setup-token on any computer signed in as that account and paste what it prints (or an Anthropic API key). It keeps this machine’s own Claude settings.';
  };
  provider.addEventListener('change', paint);
  how.addEventListener('change', paint);
  paint();
  const form = h('form.pa-add', {}, h('div.invite-row', {}, provider, name), how, dir, token, hint, h('div.signin-actions', {}, h('button.btn.primary', { type: 'submit' }, 'Add'))) as HTMLFormElement;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!name.value.trim()) return name.focus();
    const kind = how.value as 'new' | 'folder' | 'token';
    if (kind === 'folder' && !dir.value.trim()) return dir.focus();
    if (kind === 'token' && !token.value.trim()) return token.focus();
    net.send({ t: 'providerAccounts.add', provider: provider.value as AccountProvider, name: name.value.trim(), how: kind, ...(kind === 'folder' ? { dir: dir.value.trim() } : {}), ...(kind === 'token' ? { token: token.value.trim() } : {}) });
    name.value = '';
    token.value = '';
  });
  return form;
}
