// The 2D view on a phone, in headless Chrome: /lite, signing in, ✨ New task, a worker's terminal and
// its answer buttons, 📌 Issues, 🔀 PRs, 📋 Queue and a PR window, on an iPhone (390×844), an
// Android phone (360×800) and an iPad (820×1180). Each has no sideways scroll, and every button you
// can see is a thumb's size (44×44) or more. Then the 3D office on a phone (/?3d=1), upright and on its
// side, played with the touch controls (features/touch), and with a mouse, which shows none. It runs
// against the built bundle (npm run build) with Chrome or Chromium, and is skipped without them; the 3D
// part draws with swiftshader, and is skipped if it can't draw there. MOBILE_SHOTS=<folder> keeps a
// screenshot of each.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { loadConfig } from '../src/server/config.js';
import { startServer } from '../src/server/server.js';
import type { GhIssue, GhPull, WorkerInfo } from '../src/shared/protocol.js';

const publicDir = path.resolve(import.meta.dirname, '../dist/public');
const CHROMES = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
const chrome = CHROMES.find((c): c is string => !!c && existsSync(c));
const skip = !chrome ? 'no Chrome or Chromium (set CHROME_PATH)' : !existsSync(path.join(publicDir, 'sw.js')) ? 'no built bundle (npm run build)' : false;
const SHOTS = process.env.MOBILE_SHOTS;
const PASSWORD = 'mobile-test';

const DEVICES = [
  { name: 'iphone', width: 390, height: 844, mobile: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
  { name: 'android', width: 360, height: 800, mobile: true, ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' },
  { name: 'ipad', width: 820, height: 1180, mobile: true, ua: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
] as const;

let tmp = '';
let office: Awaited<ReturnType<typeof startServer>> | undefined;
let base = '';
let cookie = '';
let browser: Browser | undefined;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

before(async () => {
  if (skip) return;
  tmp = mkdtempSync(path.join(tmpdir(), 'agent-office-mobile-'));
  const project = path.join(tmp, 'project');
  const bin = path.join(tmp, 'bin');
  for (const d of [project, bin, path.join(tmp, 'projects')]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(project, 'README.md'), '# mobile\n');
  for (const args of [['init', '-q', '-b', 'main'], ['add', '.'], ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init']]) execFileSync('git', args, { cwd: project });
  const claude = path.join(bin, 'claude');
  writeFileSync(claude, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  for (const k of Object.keys(process.env)) if (k.startsWith('AGENT_OFFICE_')) delete process.env[k];
  const port = await freePort();
  const cfg = loadConfig([project, '--home', path.join(tmp, 'home'), '--projects', path.join(tmp, 'projects'), '--port', String(port), '--password', PASSWORD, '--no-open', '--weather', 'clear', '--agent', claude]);
  office = await startServer(cfg, { publicDir });
  base = `http://127.0.0.1:${port}`;
  const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  const { chromium } = await import('playwright-core');
  browser = await chromium.launch({ executablePath: chrome });
});

after(async () => {
  await browser?.close();
  office?.shutdown();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function phone(d: (typeof DEVICES)[number], signedIn = true): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser!.newContext({ viewport: { width: d.width, height: d.height }, isMobile: d.mobile, hasTouch: true, userAgent: d.ua, deviceScaleFactor: 2 });
  if (signedIn) {
    const [name, value] = cookie.split('=');
    await ctx.addCookies([{ name, value, url: base }]);
  }
  // tsx names the functions handed to page.evaluate with a helper the page hasn't got.
  await ctx.addInitScript('window.__name = (f) => f');
  // A name already, so the 2D view doesn't ask; and the 📲 hint already seen, so it doesn't cover the bar.
  await ctx.addInitScript(() => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Tess', color: '#ff8a5b' }));
    localStorage.setItem('agent-office.install-hint', '1');
  });
  return { ctx, page: await ctx.newPage() };
}

/** No sideways scroll, and every button on screen at least 44×44; then a screenshot, if they're kept. */
async function check(page: Page, d: (typeof DEVICES)[number], what: string) {
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const vis = (el: Element) => {
      const b = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth;
    };
    // The topmost window's buttons when one is open (what's under it can't be tapped), else the page's.
    const backdrops = document.querySelectorAll('.backdrop');
    const scope = backdrops.length ? backdrops[backdrops.length - 1] : document;
    const small = [...scope.querySelectorAll('button, a.btn, .board-tab')]
      .filter((el) => vis(el) && !el.closest('[data-small-ok]'))
      .map((el) => ({ el, b: el.getBoundingClientRect() }))
      .filter(({ b }) => Math.round(b.width) < 44 || Math.round(b.height) < 44)
      .map(({ el, b }) => `${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30) || el.className} ${Math.round(b.width)}×${Math.round(b.height)}`);
    return { scroll: document.documentElement.scrollWidth, width: innerWidth, small };
  });
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${d.name}-${what}.png`) });
  }
  assert.ok(r.scroll <= r.width, `${d.name} ${what}: the page scrolls sideways (${r.scroll} > ${r.width})`);
  assert.deepEqual(r.small, [], `${d.name} ${what}: buttons under 44×44`);
}

const now = new Date().toISOString();
const ISSUES: GhIssue[] = [1, 2, 3, 4].map((n) => ({ number: n, title: `Issue number ${n} with a title long enough to wrap on a phone`, state: n === 4 ? 'CLOSED' : 'OPEN', url: `https://github.com/o/r/issues/${n}`, author: 'tess', labels: [{ name: 'bug', color: 'ef476f' }], assignees: n === 2 ? ['tess'] : [], createdAt: now, updatedAt: now, body: 'Steps to reproduce…', comments: 1 }));
const PULLS: GhPull[] = [7, 8].map((n) => ({ number: n, title: `Fix the redirect after signing in (${n})`, state: 'OPEN', isDraft: false, url: `https://github.com/o/r/pull/${n}`, author: 'byte', labels: [], reviewDecision: n === 8 ? 'APPROVED' : '', headRefName: `fix-${n}`, baseRefName: 'main', createdAt: now, updatedAt: now, additions: 12, deletions: 3, checks: 'pass', body: 'It went to / instead of /lite.', closes: [1] }));

/** Workers the office doesn't have, for the cards: one asking for permission, one done with a PR, one working. */
function workers(): WorkerInfo[] {
  const w = (id: string, name: string, over: Partial<WorkerInfo>): WorkerInfo => ({ id, kind: 'agent', provider: 'claude', deskId: `desk-${id.slice(-1)}`, name, color: '#5bc0eb', status: 'working', acked: true, createdBy: 'Tess', createdAt: Date.now(), cols: 80, rows: 24, viewers: [], viewerIds: [], ...over });
  return [
    w('w1', 'Byte', { status: 'needs_input', acked: false, waitingSince: Date.now(), activity: 'Wants permission: Bash: npm test', task: { name: 'Fix login redirect', summary: '' }, choices: [{ key: '1', label: 'Yes' }, { key: '2', label: "Yes, and don't ask again for npm test commands" }, { key: '3', label: 'No, and tell Claude what to do differently (esc)' }] }),
    w('w2', 'Pixel', { status: 'done', acked: false, waitingSince: Date.now(), task: { name: 'Add a sign-out button', summary: 'Added it to the menu' }, pr: { number: 7, url: 'https://github.com/o/r/pull/7' } }),
    w('w3', 'Nibble', { status: 'working', activity: 'Read src/server/auth.ts', task: { name: 'Tidy the docs', summary: 'Reading the docs' } }),
  ];
}

async function lite(page: Page) {
  await page.goto(`${base}/lite`);
  await page.waitForFunction(() => (window as any).__lite?.net.up && (window as any).__lite.store.project);
  await page.evaluate(
    ({ ws, issues, pulls }) => {
      const { store } = (window as any).__lite;
      for (const worker of ws) store.apply({ t: 'worker.update', worker });
      store.apply({ t: 'gh.issues', state: { items: issues, fetchedAt: Date.now(), loading: false } });
      store.apply({ t: 'gh.pulls', state: { items: pulls, fetchedAt: Date.now(), loading: false } });
    },
    { ws: workers(), issues: ISSUES, pulls: PULLS },
  );
}

/**
 * A finger dragged up a worker's terminal while the program in it takes the whole screen and reads the
 * mouse, as Claude Code does: the terminal has no scrollback there, so the drag turns the wheel and the
 * program is sent wheel reports (SGR, button 65 = down) to scroll its own view.
 */
async function scrollsFullScreen(page: Page) {
  await page.evaluate(() => {
    const { net, store } = (window as any).__lite;
    const sent: unknown[] = ((window as any).__sent = []);
    const send = net.send.bind(net);
    net.send = (m: unknown) => (sent.push(m), send(m));
    const msg = { t: 'term.snapshot', workerId: 'w1', cols: 40, rows: 20, data: `\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[H${'a line of the conversation\r\n'.repeat(19)}` };
    for (const h of net.handlers) h(msg);
    return store.workers.has('w1');
  });
  const box = (await page.locator('.modal.term .xterm-screen').boundingBox())!;
  await touchDrag(page, { x: box.x + box.width / 2, y: box.y + box.height * 0.8 }, { x: box.x + box.width / 2, y: box.y + box.height * 0.2 }, 50);
  const input = await page.evaluate(() => ((window as any).__sent as { t: string; data?: string }[]).filter((m) => m.t === 'term.input').map((m) => m.data).join(''));
  assert.match(input, /\x1b\[<65;\d+;\d+M/, 'dragging up sends the program wheel-down reports');
  assert.doesNotMatch(input, /\x1b\[<64;/, 'and no wheel-up ones');
}

const close = (page: Page) => page.locator('.backdrop').last().locator('.btn.close').first().click();

for (const d of DEVICES) {
  test(`the 2D view fits ${d.name} (${d.width}×${d.height})`, { skip }, async () => {
    const { ctx, page } = await phone(d);
    try {
      // The office's own address goes straight to the 2D view on a phone.
      await page.goto(`${base}/`);
      await page.waitForURL(/\/lite$/);
      await lite(page);
      await check(page, d, 'workers');
      assert.equal(await page.locator('.lite-answers .btn').count(), 3, 'Byte’s choices are buttons');
      assert.equal(await page.locator('.lite-actions .btn').count(), 3, 'Pixel has ✍️ Reply, 🔀 PR #7 and 🏠');

      // 🏠 asks before sending it home.
      await page.locator('.lite-worker.done .lite-home').click();
      await page.waitForSelector('.modal[aria-label="Send Pixel home?"]');
      await check(page, d, 'send-home');
      await close(page);

      await page.click('#btn-new');
      await page.waitForSelector('.modal.ask');
      assert.equal(await page.locator('.modal.ask footer').textContent().then((t) => /Shift\+Enter/.test(t ?? '')), false, 'no keyboard hint on a touch screen');
      await page.locator('.modal.ask textarea').fill('first line');
      await page.locator('.modal.ask textarea').press('Enter');
      assert.ok(await page.locator('.modal.ask').isVisible(), 'Return makes a new line, not a sent prompt');
      await check(page, d, 'new-task');
      await close(page);

      await page.locator('.lite-worker.needs_input .lite-card').click();
      await page.waitForSelector('.modal.term .term-keypad');
      await check(page, d, 'terminal');
      assert.equal(await page.locator('.modal.term header .term-home').count(), 1, 'its terminal has 🏠 too');
      // The 🎤 sits inside the reply box, not hanging out of it.
      const field = await page.locator('.term-say .dictate-field input').boundingBox();
      const mic = await page.locator('.term-say .dictate-mic').boundingBox();
      if (field && mic) assert.ok(mic.y >= field.y && mic.y + mic.height <= field.y + field.height, `the 🎤 (${mic.y}–${mic.y + mic.height}) is inside its box (${field.y}–${field.y + field.height})`);
      await scrollsFullScreen(page);
      await close(page);

      await page.click('#btn-issues');
      await page.waitForSelector('.modal.board');
      await check(page, d, 'issues');
      if (d.width < 700) {
        assert.equal(await page.locator('.modal.board .column:visible').count(), 1, 'one column at a time');
        await page.locator('.board-tab').nth(1).click();
        assert.match((await page.locator('.modal.board .column:visible h4').textContent()) ?? '', /In progress/);
      }
      await close(page);

      await page.click('#btn-pulls');
      await page.waitForSelector('.modal.board');
      await check(page, d, 'pulls');
      await page.locator('.modal.board .card').first().click();
      await page.waitForSelector('.modal.gh-window');
      await check(page, d, 'pull');
      await close(page);
      await close(page);

      await page.click('#btn-queue');
      await page.waitForSelector('.modal[aria-label="Task queue"]');
      await check(page, d, 'queue');
      await close(page);

      await page.locator('.lite-bar button[aria-label="Notifications"]').click();
      await page.waitForSelector('.push-window');
      await check(page, d, 'notify');
      await close(page);
    } finally {
      await ctx.close();
    }
  });

  test(`signing in fits ${d.name}`, { skip }, async () => {
    const { ctx, page } = await phone(d, false);
    try {
      await page.goto(`${base}/lite`);
      await page.waitForURL(/\/login/);
      await check(page, d, 'sign-in');
      assert.equal(await page.locator('link[rel="manifest"]').getAttribute('href'), '/manifest.webmanifest');
    } finally {
      await ctx.close();
    }
  });
}

test('the home-screen app says it’s reconnecting, not a browser error, while the office can’t be reached', { skip }, async () => {
  const { ctx, page } = await phone(DEVICES[1]);
  try {
    await lite(page);
    // The service worker looks after /lite once it's running.
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration('/'))?.active, undefined, { timeout: 10_000 });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await ctx.setOffline(true);
    await page.goto(`${base}/lite`);
    assert.match((await page.locator('h1').textContent()) ?? '', /Reconnecting/);
    // Nothing behind sign-in went into its cache.
    const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname)))).flat());
    assert.deepEqual(cached.sort(), ['/favicon.svg', '/icons/badge-96.png', '/icons/icon-192.png', '/offline.html']);
    await ctx.setOffline(false);
    // Back once the office answers.
    await page.waitForURL(/\/lite$/);
    await page.waitForFunction(() => (window as any).__lite?.net.up, undefined, { timeout: 15_000 });
  } finally {
    await ctx.close();
  }
});

// ---- The 3D office on a phone, with its touch controls (features/touch) --------------------------------

const LANDSCAPE = { name: 'iphone-landscape', width: 844, height: 390, mobile: true, ua: DEVICES[0].ua } as const;
/** Swiftshader draws WebGL without a GPU, as headless Chrome on a CI box has none. */
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

/** The 3D office at `/?3d=1`, as a phone (or with a mouse, `touch` false), with a character already picked. Null when it can't draw here. */
async function office3d(d: { width: number; height: number; mobile: boolean; ua?: string }, opts: { touch?: boolean; intro?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page } | null> {
  const touch = opts.touch ?? true;
  const ctx = await browser3d!.newContext({ viewport: { width: d.width, height: d.height }, isMobile: d.mobile, hasTouch: touch, ...(d.ua ? { userAgent: d.ua } : {}), deviceScaleFactor: 1 });
  const [name, value] = cookie.split('=');
  await ctx.addCookies([{ name, value, url: base }]);
  await ctx.addInitScript('window.__name = (f) => f');
  await ctx.addInitScript((seen: boolean) => {
    localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Tess', color: '#ff8a5b', look: { skin: 0, hair: 0, style: 0 } }));
    if (seen) localStorage.setItem('agent-office.touch-intro', '1');
    // A software renderer is slow: the 2D view it would offer for that isn't what's under test.
    localStorage.setItem('agent-office.lite-declined-slow', '1');
  }, !opts.intro);
  const page = await ctx.newPage();
  await page.goto(`${base}/?3d=1`);
  // Swiftshader is slow: the first frames take a while.
  await page.waitForFunction(() => location.pathname.startsWith('/lite') || ((window as any).__office?.store.floor && !document.getElementById('loading')), undefined, { timeout: 90_000 });
  if (new URL(page.url()).pathname.startsWith('/lite')) {
    await ctx.close();
    return null;
  }
  return { ctx, page };
}

/** A finger dragged from `from` to `to` and held there for `hold` ms, by CDP touch events (pointerType 'touch'). */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, hold = 800) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8, id: 1 }] });
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** No sideways scroll, and every touch control on screen at least 44×44; then a screenshot, if they're kept. */
async function check3d(page: Page, name: string, what: string) {
  // A window pops open (scale .96 to 1), slowly on a software renderer: measured once it's done.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const small = [...document.querySelectorAll('.touch-pad button, .dock button, .modal button, .modal .btn')]
      .map((el) => ({ el, b: el.getBoundingClientRect() }))
      .filter(({ b }) => b.width > 0 && b.height > 0 && (Math.round(b.width) < 44 || Math.round(b.height) < 44))
      .map(({ el, b }) => `${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)} ${Math.round(b.width)}×${Math.round(b.height)}`);
    return { scroll: document.documentElement.scrollWidth, width: innerWidth, small };
  });
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `3d-${name}-${what}.png`) });
  }
  assert.ok(r.scroll <= r.width, `${name} ${what}: the page scrolls sideways (${r.scroll} > ${r.width})`);
  assert.deepEqual(r.small, [], `${name} ${what}: buttons under 44×44`);
}

let browser3d: Browser | undefined;
before(async () => {
  if (skip) return;
  const { chromium } = await import('playwright-core');
  browser3d = await chromium.launch({ executablePath: chrome, args: GL_ARGS });
});
after(async () => {
  await browser3d?.close();
});

for (const d of [DEVICES[0], LANDSCAPE]) {
  test(`the 3D office plays with thumbs on ${d.name} (${d.width}×${d.height})`, { skip, timeout: 180_000 }, async (t) => {
    const portrait = d.height > d.width;
    const opened = await office3d(d, { intro: portrait });
    if (!opened) return t.skip('headless Chrome could not draw WebGL here, so the office went to the 2D view');
    const { ctx, page } = opened;
    try {
      assert.ok(await page.evaluate(() => document.body.classList.contains('touch-ui')), 'the touch controls are up');
      if (portrait) {
        // The first time: what each thumb does, with its ✕, and only once.
        await page.waitForSelector('.modal.touch-intro');
        await check3d(page, d.name, 'intro');
        await page.locator('.modal.touch-intro .btn.close').click();
        assert.equal(await page.locator('.modal.touch-intro').count(), 0);
        assert.equal(await page.evaluate(() => localStorage.getItem('agent-office.touch-intro')), '1');
      }
      await page.waitForSelector('.touch-pad .touch-use');
      // Nothing waits on a mouse that isn't there.
      assert.equal(await page.locator('.crosshair .look-hint').isVisible(), false, 'no "Click to look around"');
      await check3d(page, d.name, 'office');

      // The left thumb walks: pushed up the screen, you go somewhere.
      const before = await page.evaluate(() => ({ ...(window as any).__office.player.pos }));
      const from = { x: Math.round(d.width * 0.15), y: Math.round(d.height * 0.7) };
      await touchDrag(page, from, { x: from.x, y: from.y - 60 }, 1200);
      const after = await page.evaluate(() => ({ ...(window as any).__office.player.pos }));
      assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 0.5, `the stick moved you (${JSON.stringify(before)} → ${JSON.stringify(after)})`);
      // Let go: you stop.
      const stopped = await page.evaluate(() => (window as any).__office.player.stick);
      assert.deepEqual(stopped, { x: 0, z: 0, run: false });

      // The right side looks around.
      const yaw = await page.evaluate(() => (window as any).__office.player.camYaw);
      await touchDrag(page, { x: Math.round(d.width * 0.7), y: Math.round(d.height * 0.4) }, { x: Math.round(d.width * 0.7) - 80, y: Math.round(d.height * 0.4) }, 100);
      assert.notEqual(await page.evaluate(() => (window as any).__office.player.camYaw), yaw, 'a drag on the right turned you');

      // Next to an empty desk, Use says what it'll do and does it: the hire window.
      await page.evaluate(() => {
        const o = (window as any).__office;
        const desk = o.office.interactables.find((it: any) => it.kind === 'desk' && it.deskId && !it.off && !o.plan().byId.get(it.deskId)?.room);
        o.player.setView('third');
        o.player.pos.set(desk.x, o.player.pos.y, desk.z);
      });
      await page.waitForFunction(() => !document.querySelector('.touch-use')?.classList.contains('off'));
      assert.match((await page.locator('.touch-use').textContent()) ?? '', /Hire a worker/);
      assert.ok(await page.locator('.touch-fan .touch-key').count(), 'the desk keys fan out above Use');
      await check3d(page, d.name, 'desk');
      await page.locator('.touch-use').tap();
      await page.waitForSelector('.backdrop .modal');
      await check3d(page, d.name, 'hire');
      // ✕ hands the thumbs straight back: the next drag walks.
      await page.locator('.backdrop').last().locator('.btn.close').first().click();
      await page.waitForFunction(() => !document.querySelector('.backdrop'));
      const at = await page.evaluate(() => ({ ...(window as any).__office.player.pos }));
      await touchDrag(page, from, { x: from.x + 60, y: from.y }, 800);
      const moved = await page.evaluate(() => ({ ...(window as any).__office.player.pos }));
      assert.ok(Math.hypot(moved.x - at.x, moved.z - at.z) > 0.3, 'walking again straight after the window closed');

      // A worker at that desk: Use opens its terminal, with the phone's keypad, and its keys fan out above Use.
      await page.evaluate(() => {
        const o = (window as any).__office;
        const desk = o.office.interactables.find((it: any) => it.kind === 'desk' && it.deskId && !it.off && !o.plan().byId.get(it.deskId)?.room);
        o.store.apply({ t: 'worker.update', worker: { id: 'w9', kind: 'agent', provider: 'claude', deskId: desk.deskId, name: 'Byte', color: '#5bc0eb', status: 'needs_input', acked: false, createdBy: 'Tess', createdAt: Date.now(), cols: 80, rows: 24, viewers: [], viewerIds: [], task: { name: 'Fix it', summary: '' } } });
        o.player.pos.set(desk.x, o.player.pos.y, desk.z);
      });
      await page.waitForFunction(() => /Open terminal/.test(document.querySelector('.touch-use')?.textContent ?? ''));
      assert.deepEqual(await page.locator('.touch-fan .touch-key .key').allTextContents().then((k) => k.sort()), ['C', 'L', 'P', 'X']);
      // The hint bar clears the buttons, however many rows the fan has.
      const [hint, pad] = await Promise.all([page.locator('#hint').boundingBox(), page.locator('.touch-pad').boundingBox()]);
      if (portrait) assert.ok(hint!.y + hint!.height <= pad!.y + 1, `the hint bar (bottom ${hint!.y + hint!.height}) is above the buttons (top ${pad!.y})`);
      await check3d(page, d.name, 'worker');
      await page.locator('.touch-use').tap();
      await page.waitForSelector('.modal.term .term-keypad');
      await check3d(page, d.name, 'terminal');
      await page.locator('.backdrop').last().locator('.btn.close').first().click();
      await page.waitForFunction(() => !document.querySelector('.backdrop'));
    } finally {
      await ctx.close();
    }
  });
}

test('the 3D office with a mouse shows no touch controls', { skip, timeout: 120_000 }, async (t) => {
  const opened = await office3d({ width: 1280, height: 800, mobile: false }, { touch: false });
  if (!opened) return t.skip('headless Chrome could not draw WebGL here, so the office went to the 2D view');
  const { ctx, page } = opened;
  try {
    assert.equal(await page.evaluate(() => document.body.classList.contains('touch-ui')), false);
    assert.equal(await page.locator('.touch-pad').isVisible(), false);
    assert.equal(await page.evaluate(() => document.querySelector('meta[name=viewport]')?.getAttribute('content')), 'width=device-width, initial-scale=1');
  } finally {
    await ctx.close();
  }
});
