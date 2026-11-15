import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProviderAccounts } from '../src/server/provider-accounts/index.js';
import { WhoseLimits, type WhoseLimitsDeps } from '../src/server/whose-limits.js';
import type { Client } from '../src/server/office/client.js';
import type { PlanLimits } from '../src/shared/protocol.js';

/** A folder of its own, and HOME pointed into it, so ~/.claude is never the real one. */
function sandbox(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-limits-'));
  const home = path.join(root, 'home');
  mkdirSync(home);
  const was = process.env.HOME;
  process.env.HOME = home;
  t.after(() => {
    if (was === undefined) delete process.env.HOME;
    else process.env.HOME = was;
    rmSync(root, { recursive: true, force: true });
  });
  return { home, data: path.join(root, 'data') };
}

/** Stands in for a PlanLimitsReader: says what it was made with, and reads when told to. */
class Reader {
  state: PlanLimits = { windows: [], at: 0 };
  refreshes = 0;
  closed = false;
  constructor(
    readonly env: Record<string, string>,
    readonly wanted: () => boolean,
    private onChange: (state: PlanLimits) => void,
  ) {}
  refresh() {
    this.refreshes++;
  }
  close() {
    this.closed = true;
  }
  /** A read came back with `pct` of the 5-hour session used. */
  read(pct: number) {
    this.state = { plan: 'max', windows: [{ label: '5h session', pct }], at: 1 };
    this.onChange(this.state);
  }
}

function office(t: { after(fn: () => void): void }) {
  const { home, data } = sandbox(t);
  mkdirSync(data, { recursive: true });
  const base = () => ({ PATH: '/usr/bin', HOME: home, CLAUDE_CONFIG_DIR: path.join(home, 'office-claude') });
  const accounts = new ProviderAccounts(data, { claude: null, codex: null }, base, { floorName: () => undefined, workersOn: () => [], changed: () => {} });
  const readers: Reader[] = [];
  const sent: { to: string; state: PlanLimits }[] = [];
  const clients: Client[] = [];
  /** People with an account of their own who signed in to their own Claude, and what with. */
  const own = new Map<string, string>();
  const deps: WhoseLimitsDeps = {
    read: (env, wanted, onChange) => {
      const r = new Reader(env, wanted, onChange);
      readers.push(r);
      return r;
    },
    base,
    signins: { claudeKey: (id) => own.get(id), apply: (id, env) => Object.assign(env, { CLAUDE_CONFIG_DIR: `/homes/${id}` }) },
    accounts,
    floorOf: (c) => c.peer.floor,
    clients: () => clients,
    send: (c, state) => sent.push({ to: c.id, state }),
  };
  const limits = new WhoseLimits(deps);
  const join = (id: string, floor: string | undefined, accountId?: string) => {
    const c = { id, accountId, peer: { floor } } as Client;
    clients.push(c);
    return c;
  };
  /** What went out since last asked, as who got how much of which account's (none for the office's own, or someone's own). */
  const out = () => sent.splice(0).map(({ to, state }) => `${to}: ${state.account ?? 'unnamed'} ${state.windows[0]?.pct ?? '-'}`);
  return { accounts, limits, readers, out, join, own };
}

test("the limits box follows the floor: each floor's Claude account, or the office's own login", (t) => {
  const { accounts, limits, readers, out, join } = office(t);
  const work = accounts.add('claude', 'Work', 'new');
  assert.ok(typeof work === 'object');
  accounts.use('payments', 'claude', work.id);
  const [own] = readers;
  assert.equal(own.env.CLAUDE_CONFIG_DIR?.endsWith('office-claude'), true);

  const ada = join('ada', 'blog');
  assert.deepEqual(limits.shown(ada), { windows: [], at: 0 });
  assert.equal(own.wanted(), true);
  own.read(10);
  assert.deepEqual(out(), ['ada: unnamed 10']);

  // Up to the floor that runs on Work: its own reader, on its own folder, with its name.
  ada.peer.floor = 'payments';
  limits.show(ada);
  assert.equal(readers.length, 2);
  const onWork = readers[1];
  assert.equal(onWork.env.CLAUDE_CONFIG_DIR, work.dir);
  assert.equal(onWork.refreshes, 1);
  assert.deepEqual(out(), ['ada: Work -']);
  assert.equal(own.wanted(), false);
  onWork.read(80);
  own.read(11);
  assert.deepEqual(out(), ['ada: Work 80']);

  // Someone else on the same floor shares its reader; nothing goes out to whoever already has it.
  const bo = join('bo', 'payments');
  limits.show(bo);
  limits.show(ada);
  assert.equal(readers.length, 2);
  assert.deepEqual(out(), ['bo: Work 80']);

  // Back down: the office's numbers again, read afresh, and Work's only reach who's still there.
  ada.peer.floor = 'blog';
  limits.show(ada);
  assert.deepEqual(out(), ['ada: unnamed 11']);
  assert.equal(own.refreshes, 2);
  onWork.read(81);
  assert.deepEqual(out(), ['bo: Work 81']);

  // The roof and the lobby have no floor of their own to go by.
  bo.peer.floor = undefined;
  limits.show(bo);
  assert.deepEqual(out(), ['bo: unnamed 11']);
  assert.equal(onWork.wanted(), false);
});

test('a floor changing its account, renaming it or removing it shows everyone where they stand', (t) => {
  const { accounts, limits, readers, out, join } = office(t);
  const work = accounts.add('claude', 'Work', 'new');
  const home = accounts.add('claude', 'Personal', 'new');
  assert.ok(typeof work === 'object' && typeof home === 'object');
  const ada = join('ada', 'payments');
  const bo = join('bo', 'blog');
  limits.shown(ada);
  limits.shown(bo);

  accounts.use('payments', 'claude', work.id);
  limits.showAll();
  assert.deepEqual(out(), ['ada: Work -']);
  accounts.use('payments', 'claude', home.id);
  limits.showAll();
  assert.deepEqual(out(), ['ada: Personal -']);
  assert.equal(readers.find((r) => r.env.CLAUDE_CONFIG_DIR === home.dir)?.wanted(), true);

  accounts.rename(home.id, 'Home');
  limits.showAll();
  assert.deepEqual(out(), ['ada: Home -']);
  const onHome = readers.find((r) => r.env.CLAUDE_CONFIG_DIR === home.dir)!;
  onHome.read(42);
  assert.deepEqual(out(), ['ada: Home 42']);

  // Removed: back on the office's own, and its reader stops.
  accounts.remove(home.id);
  limits.showAll();
  assert.deepEqual(out(), ['ada: unnamed -']);
  assert.equal(onHome.closed, true);

  // Signing it in again reads it afresh, with a reader of its own.
  accounts.use('payments', 'claude', work.id);
  limits.showAll();
  out();
  const before = readers.filter((r) => r.env.CLAUDE_CONFIG_DIR === work.dir);
  accounts.get(work.id)!.who = 'ada@example.com';
  limits.showAll();
  const after = readers.filter((r) => r.env.CLAUDE_CONFIG_DIR === work.dir);
  assert.equal(after.length, before.length + 1);
  assert.equal(before.at(-1)!.closed, true);
  assert.deepEqual(out(), ['ada: Work -']);
});

test("someone signed in to a Claude of their own sees their own plan on every floor, as their workers run on it", (t) => {
  const { accounts, limits, readers, out, join, own } = office(t);
  const work = accounts.add('claude', 'Work', 'new');
  assert.ok(typeof work === 'object');
  accounts.use('payments', 'claude', work.id);
  const cy = join('cy', 'payments', 'acct-cy');
  assert.equal(limits.shown(cy).account, 'Work');
  own.set('acct-cy', 'login::cy@example.com');
  limits.showAll();
  const mine = readers.at(-1)!;
  assert.equal(mine.env.CLAUDE_CONFIG_DIR, '/homes/acct-cy');
  assert.deepEqual(out(), ['cy: unnamed -']);
  mine.read(5);
  assert.deepEqual(out(), ['cy: unnamed 5']);
  cy.peer.floor = 'blog';
  limits.show(cy);
  assert.deepEqual(out(), []);

  // Their account revoked: their plan's reader goes with it.
  limits.forget('acct-cy');
  assert.equal(mine.closed, true);
  limits.close();
  assert.ok(readers.every((r) => r.closed));
});
