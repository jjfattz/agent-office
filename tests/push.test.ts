// 🔔 Web push (src/server/push/): the message encryption, the VAPID keys and their JWT, keeping
// devices, deciding when a worker is worth a push, and what the push says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encryptPush, knownPushService, makeVapidKeys, vapidAuth, vapidPublicKey } from '../src/server/push/webpush.js';
import { PushStore } from '../src/server/push/store.js';
import { PushDecider } from '../src/server/push/decide.js';
import { Push, workerPayload } from '../src/server/push/index.js';
import { pushDeviceName } from '../src/shared/device-name.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

const b64 = (s: string) => Buffer.from(s, 'base64url');

// RFC 8291, Appendix A.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** What the browser does with a push: decrypts it with its own key and secret. */
function decrypt(body: Buffer, uaPrivate: Buffer, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = ecdh.getPublicKey();
  const ikm = Buffer.from(hkdfSync('sha256', ecdh.computeSecret(asPublic), auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const data = body.subarray(21 + idlen);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'the last record ends with its delimiter');
  return plain.subarray(0, -1).toString('utf8');
}

test('encrypts a push exactly as RFC 8291’s example does', () => {
  const body = encryptPush({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: RFC.uaPublic, auth: RFC.auth } }, Buffer.from(RFC.plaintext), b64(RFC.salt), { privateKey: b64(RFC.asPrivate) });
  assert.equal(body.toString('base64url'), RFC.body);
  assert.equal(decrypt(body, b64(RFC.uaPrivate), b64(RFC.auth)), RFC.plaintext);
});

test('a push with fresh keys decrypts on the browser’s side', () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = Buffer.alloc(16, 7);
  const target = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  const msg = JSON.stringify({ title: '🙋 Byte needs you', body: 'Wants permission: Bash: npm test' });
  assert.equal(decrypt(encryptPush(target, Buffer.from(msg)), ua.getPrivateKey(), auth), msg);
});

test('signs a VAPID JWT for the push service that its public key verifies', () => {
  const keys = makeVapidKeys();
  const now = Date.UTC(2026, 10, 21);
  const header = vapidAuth(keys, 'https://fcm.googleapis.com/fcm/send/abc', now);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
  assert.ok(m, header);
  assert.equal(m[4], vapidPublicKey(keys));
  assert.equal(b64(m[4]).length, 65);
  const claims = JSON.parse(b64(m[2]).toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.exp, now / 1000 + 12 * 3600);
  assert.match(claims.sub, /^https:\/\//);
  const pub = createPublicKey({ key: keys.publicJwk, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: pub, dsaEncoding: 'ieee-p1363' }, b64(m[3])));
});

test('only sends to the push services browsers use', () => {
  assert.ok(knownPushService('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(knownPushService('https://web.push.apple.com/QH4'));
  assert.ok(knownPushService('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(knownPushService('https://wns2-par02p.notify.windows.com/w/?token=x'));
  assert.ok(!knownPushService('http://fcm.googleapis.com/x'), 'not https');
  assert.ok(!knownPushService('https://127.0.0.1/x'));
  assert.ok(!knownPushService('https://fcm.googleapis.com.evil.example/x'));
  assert.ok(!knownPushService('https://fcm.googleapis.com:8443/x'));
  assert.ok(!knownPushService('not a url'));
});

const target = (n: number) => {
  const e = createECDH('prime256v1');
  e.generateKeys();
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: e.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, n).toString('base64url') } };
};

function tmpDir(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-push-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('keeps its VAPID keys and devices across restarts, in a file only the office reads', (t) => {
  const dir = tmpDir(t);
  const a = new PushStore(dir);
  const key = a.publicKey;
  const sub = a.add(target(1), { owner: 'acct1' }, 'iPhone · Safari');
  assert.ok(typeof sub !== 'string');
  const b = new PushStore(dir);
  assert.equal(b.publicKey, key, 'the same key, so subscriptions keep working');
  assert.deepEqual(b.of('acct1').map((s) => s.name), ['iPhone · Safari']);
  assert.deepEqual(b.of(null), []);
  if (process.platform !== 'win32') assert.equal(statSync(path.join(dir, 'push.json')).mode & 0o777, 0o600);
  assert.ok(JSON.parse(readFileSync(path.join(dir, 'push.json'), 'utf8')).vapid.privateJwk.d);
});

test('adds, renames by endpoint, and removes devices; turns away what isn’t a push subscription', (t) => {
  const s = new PushStore(tmpDir(t));
  const one = s.add(target(1), {}, 'Android phone · Chrome');
  assert.ok(typeof one !== 'string');
  // The same browser again, now signed in as an account: the same device, moved over.
  const again = s.add({ ...target(1), keys: one.keys }, { owner: 'acct1', device: 'dev1' }, 'Pixel');
  assert.ok(typeof again !== 'string');
  assert.equal(again.id, one.id);
  assert.equal(s.all().length, 1);
  assert.equal(again.owner, 'acct1');
  assert.equal(again.device, 'dev1');
  assert.equal(typeof s.add({ ...target(2), endpoint: 'https://10.0.0.5/push' }, {}, 'x'), 'string');
  assert.equal(typeof s.add({ ...target(3), keys: { p256dh: 'short', auth: 'x' } }, {}, 'x'), 'string');
  assert.equal(s.remove(one.id)?.id, one.id);
  assert.equal(s.all().length, 0);
  assert.equal(s.remove(one.id), undefined);
});

test('names a device from its browser', () => {
  assert.equal(pushDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'iPhone · Safari');
  assert.equal(pushDeviceName('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'), 'Android phone · Chrome');
});

function worker(over: Partial<WorkerInfo> = {}): WorkerInfo {
  return { id: 'w1', kind: 'agent', deskId: 'd1', name: 'Byte', color: '#f00', status: 'working', acked: true, createdBy: 'x', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [], ...over };
}

/** Timers run by hand. */
function fakeTimers() {
  const due: { fn: () => void; at: number }[] = [];
  return {
    timers: { set: (fn: () => void, ms: number) => (due.push({ fn, at: ms }), due[due.length - 1]), clear: (t: unknown) => void due.splice(due.indexOf(t as never), 1) },
    run() {
      for (const d of due.splice(0)) d.fn();
    },
    get pending() {
      return due.length;
    },
  };
}

test('pushes a worker that stays waiting with nobody at its terminal, once', () => {
  const clock = fakeTimers();
  const pushed: string[] = [];
  const d = new PushDecider((w, s) => pushed.push(`${w.name}:${s}`), clock.timers, 5000);
  d.onWorker(worker());
  d.onWorker(worker({ status: 'needs_input', acked: false, waitingSince: 1 }));
  assert.equal(clock.pending, 1);
  clock.run();
  assert.deepEqual(pushed, ['Byte:needs_input']);
  // The same wait again (an update with nothing new) isn't pushed twice.
  d.onWorker(worker({ status: 'working' }));
  d.onWorker(worker({ status: 'needs_input', acked: false, waitingSince: 1 }));
  clock.run();
  assert.deepEqual(pushed, ['Byte:needs_input']);
  // A new wait is.
  d.onWorker(worker({ status: 'done', acked: false, waitingSince: 2 }));
  clock.run();
  assert.deepEqual(pushed, ['Byte:needs_input', 'Byte:done']);
});

test('doesn’t push a flicker, a worker someone is looking at, or a shell', () => {
  const clock = fakeTimers();
  const pushed: string[] = [];
  const d = new PushDecider((w) => pushed.push(w.name), clock.timers, 5000);
  d.onWorker(worker());
  d.onWorker(worker({ status: 'needs_input', acked: false, waitingSince: 1 }));
  d.onWorker(worker({ status: 'working', waitingSince: 1 }));
  assert.equal(clock.pending, 0, 'moving on takes the push back');
  d.onWorker(worker({ status: 'needs_input', acked: false, waitingSince: 2 }));
  d.onWorker(worker({ status: 'needs_input', acked: false, waitingSince: 2, viewers: ['Ana'], viewerIds: ['c1'] }));
  clock.run();
  d.onWorker(worker({ status: 'done', acked: true, waitingSince: 3 }));
  clock.run();
  d.onWorker(worker({ id: 's1', kind: 'shell' }));
  d.onWorker(worker({ id: 's1', kind: 'shell', status: 'done', acked: false }));
  clock.run();
  assert.deepEqual(pushed, []);
});

test('says who needs you and what for, with its choices as buttons, and links to its terminal', () => {
  const p = workerPayload(
    worker({ status: 'needs_input', activity: 'Wants permission: Bash: npm test', task: { name: 'Fix login', summary: '' }, choices: [{ key: '1', label: 'Yes' }, { key: '2', label: 'Yes, and don’t ask again' }, { key: '3', label: 'No, and tell Claude what to do differently (esc)' }] }),
    'needs_input',
    { id: 'f1', name: 'Webapp' },
  );
  assert.equal(p.title, '🙋 Byte needs you');
  assert.equal(p.body, 'Wants permission: Bash: npm test\nFix login · Webapp');
  assert.equal(p.url, '/lite?worker=w1&floor=f1');
  assert.equal(p.tag, 'worker-w1');
  assert.deepEqual(p.actions?.map((a) => a.key), ['1', '3']);
  assert.ok(p.sticky);
  const done = workerPayload(worker({ status: 'done', task: { name: 'Fix login', summary: 'Fixed the redirect' } }), 'done');
  assert.equal(done.title, '✅ Byte is done');
  assert.equal(done.actions, undefined);
});

test('pushes every allowed device but the ones looking at the 2D view, and drops the ones that are gone', async (t) => {
  const sent: string[] = [];
  const changed: (string | null)[] = [];
  const push = new Push({
    dataDir: tmpDir(t),
    floorOf: () => ({ id: 'f1', name: 'Webapp' }),
    allowed: (s) => s.owner !== 'revoked',
    changed: (o) => changed.push(o),
    settleMs: 0,
    send: async (_k, target) => {
      sent.push(target.endpoint);
      return target.endpoint.endsWith('/3') ? { ok: false, gone: true, error: '410 Gone' } : { ok: true };
    },
  });
  t.after(() => push.stop());
  assert.equal(push.subscribe({ owner: 'a' }, target(1), 'one'), undefined);
  assert.equal(push.subscribe({ owner: 'a' }, target(2), 'two'), undefined);
  assert.equal(push.subscribe({}, target(3), 'three'), undefined);
  assert.equal(push.subscribe({ owner: 'revoked' }, target(4), 'four'), undefined);
  push.here('client1', target(2).endpoint, true);
  push.onWorker(worker());
  push.onWorker(worker({ status: 'needs_input', acked: false, waitingSince: 1 }));
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(sent.sort(), [target(1).endpoint, target(3).endpoint]);
  assert.deepEqual(push.view({}).devices, [], 'the gone one was dropped');
  assert.deepEqual(push.view({ owner: 'a' }).devices.map((d) => d.name), ['one', 'two']);
  // Someone else's device isn't yours to remove, unless you're an admin.
  const two = push.view({ owner: 'a' }).devices[1];
  assert.ok(!push.unsubscribe({ owner: 'b' }, two.id));
  assert.ok(push.unsubscribe({ owner: 'b' }, two.id, true));
  assert.deepEqual(push.view({ owner: 'a' }).devices.map((d) => d.name), ['one']);
  assert.ok(changed.includes('a'));
});

test('looks again when whoever was at its terminal leaves it, or locks their phone with it open', () => {
  const clock = fakeTimers();
  const pushed: string[] = [];
  const away = new Set<string>();
  const d = new PushDecider((w, s) => pushed.push(`${w.name}:${s}`), clock.timers, 5000, (id) => away.has(id));
  const at = { viewers: ['Ana'], viewerIds: ['c1'] };
  d.onWorker(worker(at));
  // Asking while Ana has its terminal open: no push, until she closes it without answering.
  d.onWorker(worker({ ...at, status: 'needs_input', acked: false, waitingSince: 1 }));
  clock.run();
  assert.deepEqual(pushed, []);
  d.onWorker(worker({ status: 'needs_input', acked: false, waitingSince: 1 }));
  clock.run();
  assert.deepEqual(pushed, ['Byte:needs_input']);
  // Done while Ana watched it finish: she saw it, and the office says so (acked), even once she's left.
  d.onWorker(worker({ ...at, status: 'working' }));
  d.onWorker(worker({ ...at, status: 'done', acked: true, waitingSince: 2 }));
  d.onWorker(worker({ status: 'done', acked: true, waitingSince: 2 }));
  clock.run();
  assert.deepEqual(pushed, ['Byte:needs_input']);
  // Her phone is locked with the terminal open: it's as good as nobody there, done or asking.
  away.add('c1');
  d.onWorker(worker({ ...at, status: 'working' }));
  d.onWorker(worker({ ...at, status: 'done', acked: true, waitingSince: 3 }));
  clock.run();
  assert.deepEqual(pushed, ['Byte:needs_input', 'Byte:done']);
  away.delete('c1');
  d.onWorker(worker({ ...at, status: 'needs_input', acked: false, waitingSince: 4 }));
  clock.run();
  assert.deepEqual(pushed, ['Byte:needs_input', 'Byte:done']);
  away.add('c1');
  d.recheck();
  clock.run();
  assert.deepEqual(pushed, ['Byte:needs_input', 'Byte:done', 'Byte:needs_input']);
});

test('sends no Topic, and catches up a phone that dropped off while the office thought it was looking', async (t) => {
  const sent: { endpoint: string; title: string; topic: unknown }[] = [];
  const push = new Push({
    dataDir: tmpDir(t),
    floorOf: () => ({ id: 'f2', name: 'Other project' }),
    allowed: () => true,
    changed: () => {},
    settleMs: 0,
    send: async (_k, target, payload, opts) => {
      sent.push({ endpoint: target.endpoint, title: (payload as { title: string }).title, topic: (opts as { topic?: unknown }).topic });
      return { ok: true };
    },
  });
  t.after(() => push.stop());
  push.subscribe({}, target(1), 'phone');
  push.subscribe({}, target(2), 'tablet');
  const tick = () => new Promise((r) => setTimeout(r, 30));
  // The phone had the 2D view up, then locked before it could say so: it isn't pushed…
  push.here('phone', target(1).endpoint, true);
  push.here('tablet', target(2).endpoint, true);
  push.onWorker(worker());
  push.onWorker(worker({ status: 'done', acked: false, waitingSince: 1 }));
  await tick();
  assert.deepEqual(sent, []);
  // …the tablet said goodbye properly (it saw it), the phone's connection just dropped (it didn't).
  push.here('tablet', target(2).endpoint, false);
  push.forget('tablet');
  // Its terminal there was still open as it went (the floors let go of it after push does).
  push.onWorker(worker({ status: 'done', acked: false, waitingSince: 1, viewers: ['Ana'], viewerIds: ['phone'] }));
  push.forget('phone');
  await tick();
  assert.deepEqual(sent, [{ endpoint: target(1).endpoint, title: '✅ Byte is done', topic: undefined }]);
  // The test goes out exactly as a worker's push does.
  await push.test({});
  assert.ok(sent.every((s) => s.topic === undefined));
});
