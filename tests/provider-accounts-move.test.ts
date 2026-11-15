// Moving a worker already at its desk to another provider account: its conversation is copied into
// the new account's folder, and one that's running starts over there once its run has ended.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProviderAccounts } from '../src/server/provider-accounts/index.js';
import { carryConversation, moveWorker } from '../src/server/provider-accounts/move.js';
import type { SignIns } from '../src/server/signins.js';
import { newTracker } from '../src/server/usage.js';
import { MOVE_EXIT_WAIT_MS, moveAccount, type Carry } from '../src/server/workers/account.js';
import type { Pty, PtyExit } from '../src/server/ptys.js';
import type { Worker, WorkerContext } from '../src/server/workers/types.js';
import type { WorkerManager } from '../src/server/workers/manager.js';
import { newWorker } from '../src/server/workers/worker.js';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';

/** A folder of its own, and HOME pointed into it, so ~/.claude and ~/.codex are never the real ones. */
function sandbox(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-move-'));
  const home = path.join(root, 'home');
  mkdirSync(home);
  const was = process.env.HOME;
  process.env.HOME = home;
  t.after(() => {
    if (was === undefined) delete process.env.HOME;
    else process.env.HOME = was;
    rmSync(root, { recursive: true, force: true });
  });
  return { root, home };
}

/** Writes `text` at `file`, making its folders. */
function put(file: string, text = 'x') {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

test("a conversation is copied between config folders, Claude's and Codex's, and nothing else of the folder goes with it", (t) => {
  const { root } = sandbox(t);
  const from = path.join(root, 'from');
  const to = path.join(root, 'to');
  put(path.join(from, 'projects', '-work-api', 'S1.jsonl'), 'one');
  put(path.join(from, 'projects', '-work-api', 'S1', 'subagents', 'agent-a.jsonl'), 'sub');
  put(path.join(from, 'file-history', 'S1', 'abc@v1'), 'checkpoint');
  put(path.join(from, 'projects', '-work-api', 'S2.jsonl'), 'another');
  put(path.join(from, '.credentials.json'), 'secret');

  assert.equal(carryConversation('claude', from, to, 'S1'), true);
  assert.equal(readFileSync(path.join(to, 'projects', '-work-api', 'S1.jsonl'), 'utf8'), 'one');
  assert.equal(readFileSync(path.join(to, 'projects', '-work-api', 'S1', 'subagents', 'agent-a.jsonl'), 'utf8'), 'sub');
  assert.equal(readFileSync(path.join(to, 'file-history', 'S1', 'abc@v1'), 'utf8'), 'checkpoint');
  assert.ok(!existsSync(path.join(to, 'projects', '-work-api', 'S2.jsonl')));
  assert.ok(!existsSync(path.join(to, '.credentials.json')));
  // Again, once it's said more: the copy there is the newer one.
  put(path.join(from, 'projects', '-work-api', 'S1.jsonl'), 'one two');
  assert.equal(carryConversation('claude', from, to, 'S1'), true);
  assert.equal(readFileSync(path.join(to, 'projects', '-work-api', 'S1.jsonl'), 'utf8'), 'one two');

  assert.equal(carryConversation('claude', from, to, 'S9'), false);
  assert.equal(carryConversation('claude', from, from, 'S1'), false);
  assert.equal(carryConversation('claude', from, to, '../S1'), false);
  assert.equal(carryConversation('claude', path.join(root, 'nowhere'), to, 'S1'), false);

  const codex = path.join(root, 'codex');
  const codexTo = path.join(root, 'codex-to');
  const rollout = path.join('sessions', '2026', '11', '15', 'rollout-2026-11-15T10-00-00-T1.jsonl');
  put(path.join(codex, rollout), 'codex');
  put(path.join(codex, 'archived_sessions', 'rollout-2026-11-01T09-00-00-T1.jsonl'), 'old');
  put(path.join(codex, 'sessions', '2026', '11', '15', 'rollout-2026-11-15T11-00-00-T2.jsonl'), 'other');
  assert.equal(carryConversation('codex', codex, codexTo, 'T1'), true);
  assert.equal(readFileSync(path.join(codexTo, rollout), 'utf8'), 'codex');
  assert.ok(existsSync(path.join(codexTo, 'archived_sessions', 'rollout-2026-11-01T09-00-00-T1.jsonl')));
  assert.ok(!existsSync(path.join(codexTo, 'sessions', '2026', '11', '15', 'rollout-2026-11-15T11-00-00-T2.jsonl')));
});

/** A worker manager's context, with what it's asked to do written down. */
function fakeCtx(w: Worker) {
  const did = { resumed: [] as string[], persisted: 0, statuses: [] as WorkerStatus[], toasts: [] as string[], closing: false };
  const ctx = {
    workers: new Map([[w.info.id, w]]),
    get closing() {
      return did.closing;
    },
    emit() {},
    persist: () => did.persisted++,
    setStatus: (x: Worker, s: WorkerStatus) => {
      x.info.status = s;
      did.statuses.push(s);
    },
    resume: (id: string) => {
      did.resumed.push(id);
      return undefined;
    },
    events: { toast: (text: string) => did.toasts.push(text) },
  } as unknown as WorkerContext;
  return { ctx, did };
}

/** A running terminal whose ending is up to the test. */
function fakePty() {
  const exits: ((e: PtyExit) => void)[] = [];
  const pty = { pid: 1, killed: 0, write() {}, resize() {}, kill() { pty.killed++; }, onData() {}, onExit: (cb: (e: PtyExit) => void) => exits.push(cb) };
  return { pty: pty as unknown as Pty & { killed: number }, exit: () => exits.forEach((cb) => cb({ exitCode: 0 })) };
}

const worker = (over: Partial<WorkerInfo> = {}) => {
  const w = newWorker({ id: 'w1', kind: 'agent', provider: 'claude', name: 'Ada', status: 'idle', sessionId: 'S1', deskId: 'd1', color: '#fff', createdBy: 'Bo', createdAt: 0, acked: true, cols: 80, rows: 24, viewers: [], viewerIds: [], ...over } as WorkerInfo, newTracker());
  w.tracker.transcript = '/old/projects/p/S1.jsonl';
  w.tracker.files = { '/old/projects/p/S1.jsonl': { offset: 120 }, '/old/projects/p/S1/subagents/a.jsonl': { offset: 40 } };
  return w;
};

test("a worker that isn't running takes its new account at once, its spend read on from where it was", () => {
  const w = worker({ status: 'exited' });
  const { ctx, did } = fakeCtx(w);
  const carried: (string | undefined)[] = [];
  const carry: Carry = (s) => (carried.push(s), ['/old', '/new']);
  assert.equal(moveAccount(ctx, 'w1', 'acc1', carry), undefined);
  assert.equal(w.info.account, 'acc1');
  assert.deepEqual(carried, ['S1']);
  assert.equal(w.tracker.transcript, '/new/projects/p/S1.jsonl');
  assert.deepEqual(w.tracker.files, { '/new/projects/p/S1.jsonl': { offset: 120 }, '/new/projects/p/S1/subagents/a.jsonl': { offset: 40 } });
  assert.deepEqual(did.resumed, []);
  assert.ok(did.persisted > 0);
  // Back to the machine's own login, with nothing to copy: its spend stays where it was read.
  assert.equal(moveAccount(ctx, 'w1', undefined, () => undefined), undefined);
  assert.equal(w.info.account, undefined);
  assert.equal(w.tracker.transcript, '/new/projects/p/S1.jsonl');
  assert.equal(moveAccount(ctx, 'nobody', 'acc1', carry), 'No such worker');
});

test('a running worker ends its run, then is resumed on its new account carrying on, once', () => {
  const w = worker({ status: 'working' });
  const { pty, exit } = fakePty();
  w.pty = pty;
  const { ctx, did } = fakeCtx(w);
  const carried: (string | undefined)[] = [];
  assert.equal(moveAccount(ctx, 'w1', 'acc1', (s) => (carried.push(s), ['/old', '/new'])), undefined);
  assert.equal(w.info.account, 'acc1');
  assert.equal(pty.killed, 1);
  assert.equal(w.pty, undefined);
  assert.deepEqual(did.statuses, ['starting']);
  // Cut off mid-turn, it carries on when it's resumed.
  assert.equal(w.interrupted, true);
  // Copied once already, in case the office stops first; read from the old one until the run ends.
  assert.deepEqual(carried, ['S1']);
  assert.equal(w.tracker.transcript, '/old/projects/p/S1.jsonl');
  assert.deepEqual(did.resumed, []);

  exit();
  assert.deepEqual(carried, ['S1', 'S1']);
  assert.equal(w.tracker.transcript, '/new/projects/p/S1.jsonl');
  assert.deepEqual(did.resumed, ['w1']);
  exit();
  assert.deepEqual(did.resumed, ['w1']);
});

test("a run that doesn't end is left behind after a while; one sent home or closing up meanwhile isn't resumed", (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stuck = worker({ status: 'idle' });
  stuck.pty = fakePty().pty;
  const a = fakeCtx(stuck);
  moveAccount(a.ctx, 'w1', 'acc1', () => undefined);
  t.mock.timers.tick(MOVE_EXIT_WAIT_MS - 1);
  assert.deepEqual(a.did.resumed, []);
  t.mock.timers.tick(1);
  assert.deepEqual(a.did.resumed, ['w1']);
  assert.equal(stuck.interrupted, undefined);

  const gone = worker();
  const g = fakePty();
  gone.pty = g.pty;
  const b = fakeCtx(gone);
  moveAccount(b.ctx, 'w1', 'acc1', () => undefined);
  b.ctx.workers.delete('w1');
  g.exit();
  assert.deepEqual(b.did.resumed, []);

  const closing = worker();
  const c = fakePty();
  closing.pty = c.pty;
  const cc = fakeCtx(closing);
  moveAccount(cc.ctx, 'w1', 'acc1', () => undefined);
  cc.did.closing = true;
  c.exit();
  assert.deepEqual(cc.did.resumed, []);
  // The next office resumes it on the new account.
  assert.equal(closing.info.account, 'acc1');
});

test("moving a worker checks it can go, copies its conversation from the folder it's on, and leaves one on someone's own Claude alone", (t) => {
  const { root, home } = sandbox(t);
  const data = path.join(root, 'data');
  mkdirSync(data);
  const own = path.join(home, 'office-claude');
  const pa = new ProviderAccounts(data, { claude: null, codex: null }, () => ({ HOME: home, CLAUDE_CONFIG_DIR: own }), { floorName: () => undefined, workersOn: () => [], changed() {} });
  const work = pa.add('claude', 'Work', 'new');
  const token = pa.add('claude', 'Team', 'token', undefined, 'sk-ant-oat01-' + 'a'.repeat(40));
  const codex = pa.add('codex', 'Work', 'new');
  if (typeof work === 'string' || typeof token === 'string' || typeof codex === 'string') return assert.fail('added');

  // Where each keeps its conversations: a token runs on the machine's own folder.
  assert.equal(pa.folder(undefined, 'claude'), own);
  assert.equal(pa.folder(work.id, 'claude'), work.dir);
  assert.equal(pa.folder(token.id, 'claude'), own);
  assert.equal(pa.folder(undefined, 'codex'), path.join(home, '.codex'));
  assert.equal(pa.folder(codex.id, 'codex'), codex.dir);
  assert.equal(pa.folder(work.id, 'codex'), undefined);
  assert.equal(pa.folder('gone', 'claude'), undefined);

  const infos: Record<string, Partial<WorkerInfo>> = {
    ada: { name: 'Ada', kind: 'agent', provider: 'claude', sessionId: 'S1' },
    sh: { name: 'Bo 🐚', kind: 'shell' },
    oc: { name: 'Cy', kind: 'agent', provider: 'opencode' },
    eve: { name: 'Eve', kind: 'agent', provider: 'claude', createdBy: 'Eve' },
    fay: { name: 'Fay', kind: 'agent', provider: 'claude', account: work.id },
  };
  const calls: { wid: string; account: string | undefined; carried?: [string, string] }[] = [];
  const workers = {
    get: (wid: string) => (infos[wid] ? ({ id: wid, createdBy: 'Bo', ...infos[wid] } as WorkerInfo) : undefined),
    ownerOf: (wid: string) => (wid === 'eve' ? 'eve' : undefined),
    moveAccount(wid: string, account: string | undefined, carry: Carry) {
      calls.push({ wid, account, carried: carry(infos[wid].sessionId) });
      return undefined;
    },
  } as unknown as WorkerManager;
  const signins = { claudeKey: (id: string) => (id === 'eve' ? 'login::eve@example.com' : undefined) } as unknown as SignIns;
  const move = (wid: string, id: string | null) => moveWorker(pa, signins, workers, wid, id);

  assert.equal(move('nobody', work.id), 'No such worker');
  assert.equal(move('sh', work.id), "Bo 🐚 doesn't run Claude or Codex, so it has no provider account to change");
  assert.equal(move('oc', null), "Cy doesn't run Claude or Codex, so it has no provider account to change");
  assert.equal(move('ada', codex.id), 'No such account');
  assert.equal(move('ada', 'gone'), 'No such account');
  assert.equal(move('eve', work.id), 'Eve runs on Eve’s own Claude sign-in, which no provider account stands in for');
  // Already there: nothing to do.
  assert.equal(move('fay', work.id), undefined);
  assert.deepEqual(calls, []);

  put(path.join(own, 'projects', '-work-api', 'S1.jsonl'), 'hello');
  assert.equal(move('ada', work.id), undefined);
  assert.deepEqual(calls, [{ wid: 'ada', account: work.id, carried: [own, work.dir] }]);
  assert.equal(readFileSync(path.join(work.dir!, 'projects', '-work-api', 'S1.jsonl'), 'utf8'), 'hello');
  // A token keeps to the machine's own folder: nothing to copy.
  assert.equal(move('ada', token.id), undefined);
  assert.deepEqual(calls[1], { wid: 'ada', account: token.id, carried: undefined });
});
