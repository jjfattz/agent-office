import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskQueue, type QueueWorkers } from '../src/server/queue.js';
import { imagesNote, QueueImages } from '../src/server/queue-images.js';
import { isQueueImageId } from '../src/shared/queue-images.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b00000000049454e44ae426082', 'hex');

/** A floor's checkout with its .agent-office folder, and a queue on it whose workers are fakes. */
function fixture() {
  const project = mkdtempSync(path.join(tmpdir(), 'office-queue-images-'));
  const dataDir = path.join(project, '.agent-office');
  mkdirSync(dataDir);
  const workers: WorkerInfo[] = [];
  const manager: QueueWorkers = {
    defaultProvider: 'claude',
    list: () => workers,
    deskOccupied: (desk) => workers.some((w) => w.deskId === desk),
    spawn(deskId, by, prompt, worktree, kind, provider) {
      const id = `worker-${workers.length}`;
      const w: WorkerInfo = {
        id, deskId, kind, provider, prompt, name: 'Test', color: '#ffffff', status: 'working', acked: false, createdBy: by,
        createdAt: Date.now(), cols: 80, rows: 24, viewers: [], viewerIds: [],
        worktree: worktree ? { path: `.agent-office/worktrees/${id}`, branch: `office/${id}`, base: 'abc' } : undefined,
      };
      workers.push(w);
      return w;
    },
    kill: () => Promise.resolve({}),
  };
  const queues: TaskQueue[] = [];
  const open = (worktrees = false) => {
    const q = new TaskQueue(dataDir, manager, worktrees, { update() {}, toast() {}, claimIssue: async () => undefined, refreshGitHub() {}, hiringPaused: () => undefined, emptied() {} });
    queues.push(q);
    return q;
  };
  return { project, dataDir, workers, open, close() { queues.forEach((q) => q.shutdown()); rmSync(project, { recursive: true, force: true }); } };
}

test('only real pictures are kept, under a safe id', (t) => {
  const f = fixture(); t.after(() => f.close());
  const images = new QueueImages(f.dataDir, f.project);
  const r = images.save('../../My Screen shot!.png', PNG);
  assert.ok('id' in r);
  assert.ok(isQueueImageId(r.id), r.id);
  assert.match(r.id, /-My-Screen-shot\.png$/);
  assert.deepEqual(images.file(r.id), { type: 'image/png', body: PNG });
  // Named like a picture, but it isn't one.
  assert.ok('error' in images.save('evil.png', Buffer.from('<svg onload="alert(1)"/>')));
  // Ids the office never made don't reach the disk.
  assert.equal(images.has('../queue.json'), false);
  assert.equal(images.file('../queue.json'), undefined);
});

test("a task's pictures go to its worker: named in its prompt, and copied into its worktree", (t) => {
  const f = fixture(); t.after(() => f.close());
  const q = f.open(true);
  q.setLimit(0);
  const saved = q.images.save('shot.png', PNG);
  assert.ok('id' in saved);
  assert.equal(q.add('Fix the layout', 'Tester', undefined, undefined, undefined, undefined, undefined, undefined, [saved.id]), undefined);
  assert.deepEqual(q.state().tasks[0].images, [saved.id]);
  q.setLimit(1);
  const w = f.workers[0];
  const rel = `.agent-office/queue-images/${saved.id}`;
  assert.ok(w.prompt?.startsWith(`Fix the layout\n\n${imagesNote([rel])}`), w.prompt);
  assert.deepEqual(readFileSync(path.join(f.project, w.worktree!.path, rel)), PNG);
  // Retried, it still has them.
  w.status = 'done';
  q.onWorker(w);
  assert.equal(q.retry(q.state().tasks[0].id), undefined);
  assert.deepEqual(q.state().tasks.at(-1)?.images, [saved.id]);
});

test("a worker in the checkout itself finds the pictures where they're kept", (t) => {
  const f = fixture(); t.after(() => f.close());
  const q = f.open(false);
  const saved = q.images.save('shot.png', PNG);
  assert.ok('id' in saved);
  assert.equal(q.add('Fix the layout', 'Tester', undefined, undefined, undefined, undefined, undefined, undefined, [saved.id]), undefined);
  const rel = `.agent-office/queue-images/${saved.id}`;
  assert.ok(f.workers[0].prompt?.includes(rel));
  assert.ok(existsSync(path.join(f.project, rel)));
});

test('a task naming a picture that was never sent up, or that another task has, is refused', (t) => {
  const f = fixture(); t.after(() => f.close());
  const q = f.open();
  q.setLimit(0);
  assert.match(q.add('Fix it', 'Tester', undefined, undefined, undefined, undefined, undefined, undefined, ['0123456789ab-nope.png']) ?? '', /gone/);
  const saved = q.images.save('shot.png', PNG);
  assert.ok('id' in saved);
  assert.equal(q.add('Fix it', 'Tester', undefined, undefined, undefined, undefined, undefined, undefined, [saved.id]), undefined);
  assert.match(q.add('Fix it again', 'Tester', undefined, undefined, undefined, undefined, undefined, undefined, [saved.id]) ?? '', /gone/);
});

test("a task's pictures go when it does, survive a restart while it's queued, and pictures never queued go after a day", (t) => {
  const f = fixture(); t.after(() => f.close());
  const q = f.open();
  q.setLimit(0);
  const kept = q.images.save('kept.png', PNG);
  const dropped = q.images.save('dropped.png', PNG);
  const stray = q.images.save('stray.png', PNG);
  assert.ok('id' in kept && 'id' in dropped && 'id' in stray);
  q.add('Keep me', 'Tester', undefined, undefined, undefined, undefined, undefined, undefined, [kept.id]);
  q.add('Drop me', 'Tester', undefined, undefined, undefined, undefined, undefined, undefined, [dropped.id]);
  const gone = q.state().tasks.find((x) => x.title === 'Drop me')!;
  assert.equal(q.remove(gone.id), undefined);
  assert.equal(q.images.has(dropped.id), false);
  // The window closed before the stray was queued: it waits a day for its task, then goes.
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
  utimesSync(path.join(q.images.dir, stray.id), old, old);
  utimesSync(path.join(q.images.dir, kept.id), old, old);
  q.shutdown();
  const restored = f.open();
  assert.deepEqual(restored.state().tasks[0].images, [kept.id]);
  assert.equal(restored.images.has(kept.id), true);
  assert.equal(restored.images.has(stray.id), false);
});
