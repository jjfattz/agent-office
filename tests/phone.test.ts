// 📱 Use on your phone (src/server/phone/): reading Tailscale, never touching what isn't the office's,
// pairing a phone, believing Serve's headers only from this computer, and the whole flow against a
// fake `tailscale` (tests/support/fake-tailscale.mjs) that writes down what it's asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { Accounts } from '../src/server/accounts.js';
import { Auth, parseCookies } from '../src/server/auth.js';
import type { Config } from '../src/server/config.js';
import type { Ctx } from '../src/server/office/context.js';
import { requestHandler } from '../src/server/http/router.js';
import { phoneRoutes } from '../src/server/http/routes/phone.js';
import { clientIp, isSecure, sameOrigin, trustsProxy } from '../src/server/http/util.js';
import { Phone } from '../src/server/phone/index.js';
import { awakeCommand, type KeepAwake } from '../src/server/phone/awake.js';
import { phoneCommand } from '../src/server/phone/cli.js';
import { Devices, guessDevice, PAIR_TTL_MS } from '../src/server/phone/pairing.js';
import { readPhone, writePhone } from '../src/server/phone/saved.js';
import { allowed, cliRunner, enableLink, findTailscale, needsOperator, parseStatus, pickPort, pointsAt, portUse, serveOff, serveOn, type ServeConfig } from '../src/server/phone/tailscale.js';
import { Tailnet } from '../src/server/tailnet.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'ao-phone-'));
const HOST = 'my-mac.tail1234.ts.net';

/** What `tailscale status --json` says in each state the window knows. */
const STATUS = {
  needsLogin: { BackendState: 'NeedsLogin', AuthURL: 'https://login.tailscale.com/a/abc', Self: { DNSName: '', UserID: 0 }, User: null, CertDomains: null },
  noHttps: { BackendState: 'Running', Self: { DNSName: `${HOST}.`, UserID: 7 }, User: { '7': { LoginName: 'jo@example.com' } }, CurrentTailnet: { Name: 'jo@example.com', MagicDNSSuffix: 'tail1234.ts.net', MagicDNSEnabled: true }, CertDomains: null, Peer: {} },
  running: {
    BackendState: 'Running',
    Self: { DNSName: `${HOST}.`, UserID: 7 },
    User: { '7': { LoginName: 'jo@example.com' } },
    CurrentTailnet: { MagicDNSEnabled: true },
    CertDomains: [HOST],
    Peer: {
      a: { HostName: 'Jo’s iPhone', DNSName: 'jos-iphone.tail1234.ts.net.', OS: 'iOS', Online: true, UserID: 7 },
      b: { HostName: 'nas', DNSName: 'nas.tail1234.ts.net.', OS: 'linux', Online: true, LastSeen: '0001-01-01T00:00:00Z' },
    },
  },
};

test('reads Tailscale’s status in each state', () => {
  assert.equal(parseStatus('').state, 'down');
  assert.equal(parseStatus('not json').state, 'down');
  const login = parseStatus(JSON.stringify(STATUS.needsLogin));
  assert.equal(login.state, 'login');
  assert.equal(login.authUrl, 'https://login.tailscale.com/a/abc');
  assert.equal(parseStatus(JSON.stringify({ BackendState: 'Stopped' })).state, 'off');
  assert.equal(parseStatus(JSON.stringify({ BackendState: 'NeedsMachineAuth' })).state, 'approve');
  const noHttps = parseStatus(JSON.stringify(STATUS.noHttps));
  assert.deepEqual([noHttps.state, noHttps.host, noHttps.user, noHttps.magicDns, noHttps.https], ['running', HOST, 'jo@example.com', true, false]);
  const running = parseStatus(JSON.stringify(STATUS.running));
  assert.equal(running.https, true);
  assert.deepEqual(running.peers, [
    { name: 'Jo’s iPhone', os: 'iOS', online: true, user: 'jo@example.com' },
    { name: 'nas', os: 'linux', online: true },
  ]);
});

test('finds Tailscale’s command line on the PATH, inside the Mac app, or nowhere', () => {
  const has = (...files: string[]) => (p: string) => files.includes(p);
  assert.equal(findTailscale({ PATH: '/usr/bin:/opt/bin' }, 'linux', has('/opt/bin/tailscale', '/usr/bin/tailscale')), '/usr/bin/tailscale');
  assert.equal(findTailscale({ PATH: '/usr/bin' }, 'darwin', has('/Applications/Tailscale.app/Contents/MacOS/Tailscale')), '/Applications/Tailscale.app/Contents/MacOS/Tailscale');
  assert.equal(findTailscale({ PATH: 'C:\\Windows' }, 'win32', has('C:\\Program Files\\Tailscale\\tailscale.exe')), 'C:\\Program Files\\Tailscale\\tailscale.exe');
  assert.equal(findTailscale({ PATH: '/usr/bin' }, 'darwin', has()), undefined);
  assert.equal(findTailscale({ PATH: '/usr/bin', AGENT_OFFICE_TAILSCALE_CLI: '/x/ts' }, 'linux', has('/x/ts', '/usr/bin/tailscale')), '/x/ts');
});

test('never clobbers another app’s handler: takes a free port, or keeps the office’s own', () => {
  const office = 'http://127.0.0.1:4600';
  const web = (port: number, proxy: string, extra: Record<string, unknown> = {}) => ({ [`${HOST}:${port}`]: { Handlers: { '/': { Proxy: proxy }, ...extra } } });
  assert.deepEqual(pickPort({}, HOST, 4600), { port: 443, already: false });
  assert.deepEqual(pickPort({ TCP: { '443': { HTTPS: true } }, Web: web(443, office) }, HOST, 4600), { port: 443, already: true });
  // 443 is someone else's: the next one, never theirs.
  const theirs: ServeConfig = { TCP: { '443': { HTTPS: true } }, Web: web(443, 'http://127.0.0.1:3000') };
  assert.deepEqual(pickPort(theirs, HOST, 4600), { port: 8443, already: false });
  // The office's own on 8443, from before: that, rather than a fresh one.
  assert.deepEqual(pickPort({ ...theirs, TCP: { ...theirs.TCP, '8443': { HTTPS: true } }, Web: { ...theirs.Web, ...web(8443, office) } }, HOST, 4600), { port: 8443, already: true });
  // A raw TCP forward counts as taken too.
  const full: ServeConfig = { TCP: { '443': { TCPForward: '127.0.0.1:22' }, '8443': { HTTPS: true }, '10000': { HTTPS: true } }, Web: { ...web(8443, 'http://localhost:9000'), ...web(10000, 'http://127.0.0.1:1') } };
  assert.equal(pickPort(full, HOST, 4600), undefined);
  assert.equal(portUse(full, HOST, 443, 4600), 'other');
  assert.equal(pointsAt('http://localhost:4600', 4600), true);
  assert.equal(pointsAt('127.0.0.1:4600', 4600), true);
  assert.equal(pointsAt('https://127.0.0.1:4600', 4600), false);
  assert.equal(pointsAt('http://10.0.0.2:4600', 4600), false);
});

test('only ever runs status, login and Serve on HTTPS ports: never Funnel, a reset or anything else', () => {
  const built = [serveOn(443, 4600), serveOn(8443, 4601), serveOff(443), serveOff(5173, true), ['status', '--json'], ['serve', 'status', '--json'], ['login']];
  for (const args of built) {
    assert.ok(allowed(args), args.join(' '));
    assert.ok(!args.some((a) => /funnel/i.test(a)), `${args.join(' ')} mentions funnel`);
  }
  for (const bad of [['funnel', '443', 'on'], ['serve', '--bg', '--yes', '--https=443', 'http://127.0.0.1:4600', '--funnel'], ['serve', 'reset'], ['up', '--reset'], ['serve', '--bg', '--yes', '--https=443', 'http://10.0.0.1:22'], ['set', '--operator=me'], ['logout']]) {
    assert.equal(allowed(bad), false, bad.join(' '));
  }
  assert.equal(enableLink('To enable, visit:\n\n   https://login.tailscale.com/f/serve?node=nABC\n'), 'https://login.tailscale.com/f/serve?node=nABC');
  assert.ok(needsOperator("Access denied: serve config denied\nUse 'sudo tailscale serve'"));
});

test('a refused command never runs', async () => {
  const r = await cliRunner('/bin/echo')(['funnel', '443', 'on']);
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
});

test('a pairing link works once, for ten minutes, for whoever made it', () => {
  let now = 1_000_000;
  const changes: number[] = [];
  const devices = new Devices(tmp(), () => changes.push(now), () => now);
  const { token, expiresAt } = devices.pair('acct1');
  assert.equal(expiresAt, now + PAIR_TTL_MS);
  assert.equal(devices.redeem('made-up', 'x'), undefined);
  const d = devices.redeem(token, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)');
  assert.equal(d?.owner, 'acct1');
  assert.equal(d?.name, 'iPhone');
  assert.equal(devices.redeem(token, 'x'), undefined, 'single use');
  const late = devices.pair();
  now += PAIR_TTL_MS + 1;
  assert.equal(devices.redeem(late.token, 'x'), undefined, 'expired');
  // Seen: written down, and news the first time only.
  const n = changes.length;
  assert.ok(devices.live(d!.id));
  assert.ok(devices.live(d!.id));
  assert.equal(changes.length, n + 1);
  assert.equal(devices.list('acct1').length, 1);
  assert.equal(devices.list(null).length, 0);
  devices.revoke(d!.id);
  assert.equal(devices.live(d!.id), false);
  assert.equal(guessDevice('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari'), 'Android phone');
});

test('a device’s session ends the moment it’s signed out', () => {
  const dir = tmp();
  const accounts = new Accounts(dir);
  const salt = randomBytes(16);
  const auth = new Auth(scryptSync('pw', salt, 32), salt, 'secret', accounts);
  const devices = new Devices(dir);
  // Before the office says where devices are, no device session counts.
  const early = auth.issue(undefined, 'nope');
  assert.equal(auth.verify(early), undefined);
  auth.useDevices((id) => devices.live(id));
  const d = devices.redeem(devices.pair().token, 'x')!;
  const cookie = auth.issue(undefined, d.id);
  assert.deepEqual(auth.verify(cookie), { device: d.id });
  // A plain session is untouched.
  assert.deepEqual(auth.verify(auth.issue()), {});
  devices.revoke(d.id);
  assert.equal(auth.verify(cookie), undefined);
});

test('X-Forwarded-* is believed from Serve on this computer, never from anywhere else', () => {
  const req = (remoteAddress: string, headers: Record<string, string>) => ({ socket: { remoteAddress }, headers }) as unknown as http.IncomingMessage;
  const fwd = { 'x-forwarded-for': '100.64.0.9', 'x-forwarded-proto': 'https', 'x-forwarded-host': HOST, origin: `https://${HOST}`, host: '127.0.0.1:4600' };
  const off = { trustProxy: false, localProxy: false } as Config;
  const serving = { trustProxy: false, localProxy: true } as Config;
  for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.ok(trustsProxy(req(peer, fwd), serving), peer);
    assert.equal(clientIp(req(peer, fwd), serving), '100.64.0.9');
    assert.ok(isSecure(req(peer, fwd), serving));
    assert.ok(sameOrigin(req(peer, fwd), serving));
  }
  // Not serving: the headers are whatever the visitor typed.
  assert.equal(clientIp(req('127.0.0.1', fwd), off), '127.0.0.1');
  assert.equal(isSecure(req('127.0.0.1', fwd), off), false);
  assert.equal(sameOrigin(req('127.0.0.1', fwd), off), false);
  // Serving, but from another machine (--host 0.0.0.0): spoofed, ignored.
  assert.equal(trustsProxy(req('192.168.1.20', fwd), serving), false);
  assert.equal(clientIp(req('192.168.1.20', fwd), serving), '192.168.1.20');
  assert.equal(isSecure(req('192.168.1.20', fwd), serving), false);
  // --trust-proxy keeps working as it did.
  assert.ok(trustsProxy(req('10.0.0.5', fwd), { trustProxy: true } as Config));
});

test('keeping the computer awake: what each OS runs, tied to the office’s process', () => {
  assert.deepEqual(awakeCommand('darwin', 42), ['caffeinate', ['-i', '-s', '-w', '42']]);
  const linux = awakeCommand('linux', 42, () => true)!;
  assert.equal(linux[0], 'systemd-inhibit');
  assert.ok(linux[1].includes('--what=idle:sleep') && linux[1].at(-1)!.includes('kill -0 42'));
  assert.equal(awakeCommand('linux', 42, () => false), undefined);
  assert.match(awakeCommand('win32', 42)![1].at(-1)!, /SetThreadExecutionState.*Get-Process -Id 42/s);
});

test('its settings live in config.json, next to what the office keeps there', () => {
  const dir = tmp();
  writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ secret: 'keep me' }));
  assert.deepEqual(readPhone(dir), { on: false, workerPorts: [], awake: true });
  writePhone(dir, { on: true, port: 8443, workerPorts: [5173], awake: false });
  assert.deepEqual(readPhone(dir), { on: true, port: 8443, workerPorts: [5173], awake: false });
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf8')).secret, 'keep me');
});

// ---- The whole flow, against a fake `tailscale` ------------------------------------------------------

/** A fake Tailscale in its own folder: `state` sets what it says, `log` is what it was asked. */
function fakeTailscale() {
  const dir = tmp();
  const bin = path.join(import.meta.dirname, 'support', 'fake-tailscale.mjs');
  chmodSync(bin, 0o755);
  process.env.FAKE_TS_DIR = dir;
  return {
    dir,
    run: cliRunner(bin),
    status(s: object | null) {
      if (s) writeFileSync(path.join(dir, 'status.json'), JSON.stringify(s));
      else rmSync(path.join(dir, 'status.json'), { force: true });
    },
    serve: () => (existsSync(path.join(dir, 'serve.json')) ? (JSON.parse(readFileSync(path.join(dir, 'serve.json'), 'utf8')) as ServeConfig) : {}),
    setServe: (cfg: ServeConfig) => writeFileSync(path.join(dir, 'serve.json'), JSON.stringify(cfg)),
    flag: (name: string, on: boolean) => (on ? writeFileSync(path.join(dir, name), '') : rmSync(path.join(dir, name), { force: true })),
    log: () => readFileSync(path.join(dir, 'log.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]),
  };
}

function office(ts: ReturnType<typeof fakeTailscale> | null, workerPorts: number[] = []) {
  const dataDir = tmp();
  const accounts = new Accounts(dataDir);
  const salt = randomBytes(16);
  const auth = new Auth(scryptSync('pw', salt, 32), salt, 'secret', accounts);
  const cfg = { dataDir, port: 4600, trustProxy: false } as Config;
  const tailnet = new Tailnet(undefined);
  const held: boolean[] = [];
  const awake = { supported: true, holding: false, hold: (on: boolean) => held.push((awake.holding = on)) } as unknown as KeepAwake & { holding: boolean };
  let changed = 0;
  const phone = new Phone({ cfg, auth, accounts, tailnet, workerPorts: () => workerPorts, changed: () => changed++, run: ts ? ts.run : null, awake, platform: 'linux' });
  return { phone, cfg, tailnet, auth, accounts, awake, held, changes: () => changed };
}

const admin = { admin: true };

test('without Tailscale, step 1 says to get it', async () => {
  const { phone } = office(null);
  await phone.refresh();
  const s = phone.view(admin);
  assert.equal(s.tailscale?.state, 'missing');
  assert.equal(s.url, undefined);
  phone.stop();
});

test('turning access on serves the office on 443 and believes Serve; off removes exactly that', async () => {
  const ts = fakeTailscale();
  ts.status(STATUS.running);
  // Someone else's handler on another port, which must survive.
  ts.setServe({ TCP: { '9000': { HTTPS: true } }, Web: { [`${HOST}:9000`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } } } });
  const { phone, cfg, tailnet, held } = office(ts, [5173]);
  await phone.refresh();
  assert.equal(phone.view(admin).tailscale?.user, 'jo@example.com');
  assert.deepEqual(phone.view(admin).tailscale?.phones.map((p) => p.name), ['Jo’s iPhone']);

  await phone.setAccess(true);
  const on = phone.view(admin);
  assert.equal(on.url, `https://${HOST}`);
  assert.equal(on.on, true);
  assert.equal(cfg.localProxy, true);
  assert.equal(tailnet.host, HOST);
  assert.equal(held.at(-1), true, 'held awake');
  assert.ok(ts.log().some((a) => a.join(' ') === `serve --bg --yes --https=443 http://127.0.0.1:4600`));
  // The workers' servers go on the tailnet too, relayed by the office.
  for (let i = 0; i < 50 && !readPhone(cfg.dataDir).workerPorts.length; i++) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(readPhone(cfg.dataDir).workerPorts, [5173]);
  assert.equal(portUse(ts.serve(), HOST, 5173, 4600), 'office');
  // A member sees the address, not Tailscale.
  assert.equal(phone.view({ admin: false }).tailscale, undefined);
  assert.equal(phone.view({ admin: false }).url, `https://${HOST}`);

  await phone.setAccess(false);
  const off = phone.view(admin);
  assert.equal(off.url, undefined);
  assert.equal(cfg.localProxy, false);
  assert.equal(tailnet.host, undefined);
  assert.equal(held.at(-1), false);
  assert.deepEqual(Object.keys(ts.serve().Web ?? {}), [`${HOST}:9000`], 'only the other app’s handler is left');
  assert.deepEqual(readPhone(cfg.dataDir), { on: false, workerPorts: [], awake: true });
  assert.ok(!ts.log().flat().some((a) => /funnel|reset/i.test(a)));
  phone.stop();
});

test('with 443 taken by another app, the office goes on 8443 and says so', async () => {
  const ts = fakeTailscale();
  ts.status(STATUS.running);
  ts.setServe({ TCP: { '443': { HTTPS: true } }, Web: { [`${HOST}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } } } });
  const { phone } = office(ts);
  await phone.setAccess(true);
  const s = phone.view(admin);
  assert.equal(s.url, `https://${HOST}:8443`);
  assert.equal(s.movedPort, true);
  assert.equal(ts.serve().Web?.[`${HOST}:443`]?.Handlers?.['/']?.Proxy, 'http://127.0.0.1:3000');
  await phone.setAccess(false);
  assert.equal(ts.serve().Web?.[`${HOST}:443`]?.Handlers?.['/']?.Proxy, 'http://127.0.0.1:3000');
  assert.equal(ts.serve().Web?.[`${HOST}:8443`], undefined);
  phone.stop();
});

test('with HTTPS off, it hands over Tailscale’s link and waits; turning it off stops waiting', async () => {
  const ts = fakeTailscale();
  ts.status(STATUS.noHttps);
  ts.flag('https-off', true);
  const { phone } = office(ts);
  await phone.refresh();
  assert.equal(phone.view(admin).tailscale?.https, false);
  const turning = phone.setAccess(true);
  for (let i = 0; i < 100 && !phone.view(admin).tailscale?.enableUrl; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(phone.view(admin).tailscale?.enableUrl, 'https://login.tailscale.com/f/serve?node=nFAKE');
  assert.equal(phone.view(admin).busy, true);
  await phone.setAccess(false);
  await turning;
  assert.equal(phone.view(admin).busy, false);
  assert.equal(phone.view(admin).problem, undefined);
  phone.stop();
});

test('on Linux without an operator, it says the one command to run', async () => {
  const ts = fakeTailscale();
  ts.status(STATUS.running);
  ts.flag('denied', true);
  const { phone } = office(ts);
  await phone.setAccess(true);
  const s = phone.view(admin);
  assert.match(s.problem ?? '', /Run the command below once/);
  assert.match(s.tailscale?.operator ?? '', /^sudo tailscale set --operator=\S+$/);
  assert.equal(s.url, undefined);
  phone.stop();
});

test('signing in hands over Tailscale’s page', async () => {
  const ts = fakeTailscale();
  ts.status({ BackendState: 'NeedsLogin' });
  const { phone } = office(ts);
  await phone.refresh();
  assert.equal(phone.view(admin).tailscale?.state, 'login');
  phone.login();
  for (let i = 0; i < 100 && !phone.view(admin).tailscale?.loginUrl; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(phone.view(admin).tailscale?.loginUrl, 'https://login.tailscale.com/a/fake123');
  // Signed in elsewhere: the sign-in it started is stopped.
  ts.status(STATUS.running);
  await phone.refresh();
  assert.equal(phone.view(admin).tailscale?.loginUrl, undefined);
  phone.stop();
});

test('/pair signs a phone in once, with a session of its own, and counts guesses', async () => {
  const ts = fakeTailscale();
  ts.status(STATUS.running);
  const { phone, auth, accounts, cfg } = office(ts);
  await phone.setAccess(true);
  const ctx = { cfg, auth, accounts, phone, tailnet: { host: undefined }, services: { lookup: () => undefined }, publicDir: tmp() } as unknown as Ctx;
  const server = http.createServer(requestHandler(ctx, [phoneRoutes.pair, phoneRoutes.page, phoneRoutes.name]));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (p: string, body: object, headers: Record<string, string> = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (iPhone)', ...headers }, body: JSON.stringify(body) });
  try {
    const link = phone.pairLink({ admin: true })!;
    assert.match(link.url, new RegExp(`^https://${HOST}/pair#[\\w-]{32}$`));
    const token = link.url.split('#')[1];
    const r = await post('/api/pair', { token }, { 'x-forwarded-proto': 'https' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, device: 'iPhone' });
    const set = r.headers.get('set-cookie')!;
    assert.match(set, /Max-Age=7776000; Secure$/, 'a long session, Secure since it came over https through Serve');
    const cookie = set.split(';')[0];
    const session = auth.verify(Object.values(parseCookies(cookie))[0]);
    assert.ok(session?.device);
    assert.equal((await post('/api/phone/device', { name: 'Jo’s iPhone' }, { cookie })).status, 200);
    assert.equal(phone.devices.get(session.device)?.name, 'Jo’s iPhone');
    assert.equal((await post('/api/pair', { token })).status, 410, 'used up');
    // Guessing runs out.
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await post('/api/pair', { token: `guess${i}` })).status;
    assert.equal(last, 429);
    // Signed out: the cookie is dead.
    phone.devices.revoke(session.device);
    assert.equal(auth.verify(Object.values(parseCookies(cookie))[0]), undefined);
  } finally {
    server.close();
    phone.stop();
  }
});

test('agent-office phone: status, on, pair with a QR code in the terminal, and off', async () => {
  const ts = fakeTailscale();
  ts.status(STATUS.running);
  const home = tmp();
  const dataDir = path.join(home, '.agent-office');
  (await import('node:fs')).mkdirSync(dataDir);
  writeFileSync(path.join(dataDir, 'config.json'), '{}');
  const out: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void out.push(a.join(' '));
  try {
    assert.equal(await phoneCommand(['status', '--dir', home], ts.run), 0);
    assert.match(out.join('\n'), /Signed in as jo@example\.com/);
    assert.match(out.join('\n'), /Phone access is off/);
    assert.equal(await phoneCommand(['on', '--dir', home], ts.run), 0);
    assert.equal(readPhone(dataDir).port, 443);
    out.length = 0;
    assert.equal(await phoneCommand(['pair', '--dir', home], ts.run), 0);
    const printed = out.join('\n');
    assert.match(printed, /▀|▄|█/);
    const token = new RegExp(`https://${HOST}/pair#([\\w-]+)`).exec(printed)![1];
    assert.ok(new Devices(dataDir).redeem(token, 'x'), 'the office takes the link it printed');
    assert.equal(await phoneCommand(['off', '--dir', home], ts.run), 0);
    assert.deepEqual(ts.serve().Web ?? {}, {});
    assert.equal(readPhone(dataDir).on, false);
  } finally {
    console.log = log;
  }
});
