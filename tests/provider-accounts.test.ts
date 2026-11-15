import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProviderAccounts, type ProviderAccountsHooks } from '../src/server/provider-accounts/index.js';
import { floorRunAs } from '../src/server/provider-accounts/run-as.js';
import type { SignIns } from '../src/server/signins.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

/** A folder of its own, and HOME pointed into it, so ~/.claude is never the real one. */
function sandbox(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-accounts-'));
  const home = path.join(root, 'home');
  mkdirSync(home);
  const was = process.env.HOME;
  process.env.HOME = home;
  t.after(() => {
    if (was === undefined) delete process.env.HOME;
    else process.env.HOME = was;
    rmSync(root, { recursive: true, force: true });
  });
  return { root, home, data: path.join(root, 'data') };
}

/** The office's own environment: its own Claude config, and credentials no account should see. */
const officeEnv = (home: string) => () => ({ PATH: '/usr/bin', HOME: home, CLAUDE_CONFIG_DIR: path.join(home, 'office-claude'), ANTHROPIC_API_KEY: 'sk-ant-api03-office', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-office', OPENAI_API_KEY: 'sk-office' });

function accounts(data: string, home: string, workers: Record<string, string[]> = {}) {
  mkdirSync(data, { recursive: true });
  let changes = 0;
  const hooks: ProviderAccountsHooks = { floorName: (id) => (id === 'f1' ? 'Payments' : undefined), workersOn: (id) => workers[id] ?? [], changed: () => changes++ };
  // No commands: nothing is ever really signed in or out here.
  const pa = new ProviderAccounts(data, { claude: null, codex: null }, officeEnv(home), hooks);
  return { pa, changes: () => changes };
}

const TOKEN = 'sk-ant-oat01-' + 'a'.repeat(40);

test('provider accounts are added as a folder of their own, a folder you use, or a token, and say what is wrong', (t) => {
  const { data, home } = sandbox(t);
  const { pa, changes } = accounts(data, home);
  const work = pa.add('claude', '  Work  ', 'new');
  assert.equal(typeof work, 'object');
  if (typeof work === 'string') return;
  assert.equal(work.name, 'Work');
  assert.equal(work.dir, path.join(data, 'provider-accounts', work.id));
  assert.equal(statSync(work.dir!).mode & 0o777, 0o700);
  assert.ok(changes() > 0);

  assert.equal(pa.add('claude', 'work', 'new'), "There's already a Claude account called work");
  assert.equal(pa.add('gemini', 'X', 'new'), 'The office can only keep Claude and Codex accounts apart');
  assert.equal(pa.add('claude', '   ', 'new'), 'Give the account a name');
  assert.equal(pa.add('claude', 'Mine', 'folder', 'relative/dir'), 'Give the whole path of the folder, like ~/.claude-work');
  assert.equal(pa.add('claude', 'Mine', 'folder', '~/.claude-nope'), "There's no folder at ~/.claude-nope");
  mkdirSync(path.join(home, '.claude-personal'));
  const mine = pa.add('claude', 'Personal', 'folder', '~/.claude-personal');
  assert.equal(typeof mine, 'object');
  assert.equal(pa.add('claude', 'Again', 'folder', path.join(home, '.claude-personal/')), 'Personal already runs on ~/.claude-personal');
  assert.match(String(pa.add('claude', 'Bad', 'token', undefined, 'nope')), /isn't a token from `claude setup-token`/);
  assert.equal(pa.add('codex', 'Key', 'token', undefined, TOKEN), 'Codex accounts sign in with a folder of their own, not a token');
  assert.equal(typeof pa.add('claude', 'CI', 'token', undefined, TOKEN), 'object');

  // Everyone on a floor gets their names; only admins get the rest, and never a token.
  const view = pa.view('f1');
  assert.deepEqual(view.accounts.map((a) => a.name), ['Work', 'Personal', 'CI']);
  const state = pa.state();
  assert.deepEqual(state.accounts.map((a) => [a.name, a.how, a.dir, !!a.made]), [
    ['Work', 'folder', work.dir, true],
    ['Personal', 'folder', '~/.claude-personal', false],
    ['CI', 'token', undefined, false],
  ]);
  assert.equal(JSON.stringify(state).includes(TOKEN), false);
  assert.equal(state.own.claude, '~/office-claude');
  // Kept where only the office's user can read it: it holds the token.
  assert.equal(statSync(path.join(data, 'provider-accounts.json')).mode & 0o777, 0o600);
});

test('each floor picks its account per provider, kept across a restart', (t) => {
  const { data, home } = sandbox(t);
  const { pa } = accounts(data, home);
  const work = pa.add('claude', 'Work', 'new');
  const codex = pa.add('codex', 'Work', 'new');
  if (typeof work === 'string' || typeof codex === 'string') return assert.fail('added');
  assert.equal(pa.use('f1', 'claude', codex.id), 'No such account');
  assert.equal(pa.use('f1', 'claude', work.id), undefined);
  assert.equal(pa.use('f1', 'codex', codex.id), undefined);
  assert.deepEqual(pa.view('f1').floor, { claude: work.id, codex: codex.id });
  assert.deepEqual(pa.view('f2').floor, {});
  assert.deepEqual(pa.state().accounts.map((a) => a.floors), [['Payments'], ['Payments']]);

  const again = accounts(data, home).pa;
  assert.equal(again.pick('f1', 'claude'), work.id);
  assert.equal(again.use('f1', 'codex', null), undefined);
  assert.deepEqual(again.view('f1').floor, { claude: work.id });
});

test("an account stands in for the machine's own login, and nothing of the office's leaks through", (t) => {
  const { data, home } = sandbox(t);
  const { pa } = accounts(data, home);
  const work = pa.add('claude', 'Work', 'new');
  const ci = pa.add('claude', 'CI', 'token', undefined, TOKEN);
  const key = pa.add('claude', 'Key', 'token', undefined, 'sk-ant-api03-' + 'b'.repeat(40));
  const codex = pa.add('codex', 'Work', 'new');
  mkdirSync(path.join(home, '.claude'));
  const usual = pa.add('claude', 'Usual', 'folder', '~/.claude');
  if ([work, ci, key, codex, usual].some((a) => typeof a === 'string')) return assert.fail('added');
  const [w, c, k, x, u] = [work, ci, key, codex, usual] as Exclude<typeof work, string>[];

  const env = officeEnv(home)();
  assert.equal(pa.apply(w.id, env, []), undefined);
  assert.equal(env.CLAUDE_CONFIG_DIR, w.dir);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  // Claude's first-run questions are already answered in a folder the office made.
  assert.equal(JSON.parse(readFileSync(path.join(w.dir!, '.claude.json'), 'utf8')).hasCompletedOnboarding, true);

  // A token keeps the machine's own settings, on the token.
  const tok = officeEnv(home)();
  pa.apply(c.id, tok, []);
  assert.deepEqual([tok.CLAUDE_CONFIG_DIR, tok.CLAUDE_CODE_OAUTH_TOKEN, tok.ANTHROPIC_API_KEY], [path.join(home, 'office-claude'), TOKEN, undefined]);
  const api = officeEnv(home)();
  pa.apply(k.id, api, []);
  assert.deepEqual([api.CLAUDE_CODE_OAUTH_TOKEN, api.ANTHROPIC_API_KEY?.slice(0, 13)], [undefined, 'sk-ant-api03-']);

  // ~/.claude is Claude's usual login: it's found by leaving CLAUDE_CONFIG_DIR unset, not by naming it.
  const own = officeEnv(home)();
  pa.apply(u.id, own, []);
  assert.equal('CLAUDE_CONFIG_DIR' in own, false);
  assert.equal(own.ANTHROPIC_API_KEY, undefined);

  const cx = officeEnv(home)();
  pa.apply(x.id, cx, []);
  assert.deepEqual([cx.CODEX_HOME, cx.OPENAI_API_KEY, cx.CLAUDE_CONFIG_DIR], [x.dir, undefined, path.join(home, 'office-claude')]);

  assert.match(String(pa.apply('000000000000', officeEnv(home)(), [])), /account it was hired on is gone/);
});

test("an account can't be removed while a worker is on it; once it can, its floors go back to the machine's own and only a folder the office made is deleted", async (t) => {
  const { data, home } = sandbox(t);
  const workers: Record<string, string[]> = {};
  const { pa } = accounts(data, home, workers);
  mkdirSync(path.join(home, '.claude-mine'));
  const work = pa.add('claude', 'Work', 'new');
  const mine = pa.add('claude', 'Mine', 'folder', '~/.claude-mine');
  if (typeof work === 'string' || typeof mine === 'string') return assert.fail('added');
  pa.use('f1', 'claude', work.id);
  workers[work.id] = ['Ada', 'Bo'];
  assert.equal(pa.remove(work.id), 'Ada, Bo are still on Work: send them all home first');
  assert.equal(pa.state().accounts[0].workers.length, 2);
  workers[work.id] = [];
  assert.equal(pa.remove(work.id), undefined);
  assert.deepEqual(pa.view('f1').floor, {});
  // Deleted once Claude has been asked to sign out (no Claude here, so straight after).
  for (let i = 0; i < 100 && existsSync(work.dir!); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(existsSync(work.dir!), false);
  assert.equal(pa.remove(mine.id), undefined);
  assert.equal(existsSync(path.join(home, '.claude-mine')), true);
  assert.equal(pa.remove(mine.id), 'No such account');
});

test("a floor's workers run on its accounts: an agent keeps the one it was hired on, a shell follows the floor, and someone's own Claude comes first", (t) => {
  const { data, home } = sandbox(t);
  const { pa } = accounts(data, home);
  const work = pa.add('claude', 'Work', 'new');
  const codex = pa.add('codex', 'Work', 'new');
  if (typeof work === 'string' || typeof codex === 'string') return assert.fail('added');
  pa.use('f1', 'claude', work.id);
  pa.use('f1', 'codex', codex.id);
  // Ada signed in to her own Claude; Bo, an admin, uses the office's.
  const signins = {
    claudeKey: (id: string) => (id === 'ada' ? 'login::ada@example.com' : undefined),
    claudeReady: (id: string) => id !== 'cy',
    why: () => 'Sign in to Claude first',
    apply: (id: string, env: Record<string, string>) => {
      if (id === 'ada') env.CLAUDE_CONFIG_DIR = '/homes/ada/claude';
      return env;
    },
  } as unknown as SignIns;
  const runAs = floorRunAs('f1', signins, pa);
  assert.equal(runAs.account('claude', undefined), work.id);
  assert.equal(runAs.account('claude', 'bo'), work.id);
  assert.equal(runAs.account('claude', 'ada'), undefined);
  assert.equal(runAs.account('codex', 'ada'), codex.id);
  assert.equal(runAs.account('opencode', undefined), undefined);
  assert.equal(floorRunAs('f2', signins, pa).account('claude', undefined), undefined);

  const info = (over: Partial<WorkerInfo>) => ({ id: 'w', kind: 'agent', provider: 'claude', name: 'Eve', createdBy: 'Bo', ...over }) as WorkerInfo;
  const env = officeEnv(home)();
  assert.equal(runAs.apply({ info: info({ account: work.id }) }, env, []), undefined);
  assert.equal(env.CLAUDE_CONFIG_DIR, work.dir);
  // Hired on the office's own login, it stays there whatever the floor picks now.
  const plain = officeEnv(home)();
  runAs.apply({ info: info({}) }, plain, []);
  assert.equal(plain.CLAUDE_CONFIG_DIR, path.join(home, 'office-claude'));

  const shell = officeEnv(home)();
  runAs.apply({ info: info({ kind: 'shell', provider: undefined }) }, shell, []);
  assert.deepEqual([shell.CLAUDE_CONFIG_DIR, shell.CODEX_HOME], [work.dir, codex.dir]);
  const adas = officeEnv(home)();
  runAs.apply({ owner: 'ada', info: info({ kind: 'shell', provider: undefined }) }, adas, []);
  assert.deepEqual([adas.CLAUDE_CONFIG_DIR, adas.CODEX_HOME], ['/homes/ada/claude', codex.dir]);

  assert.match(String(runAs.apply({ owner: 'cy', info: info({}) }, officeEnv(home)(), [])), /^whoever hired Eve \(Bo\) isn't signed in to Claude/);
});
