// The 2D view on a phone, in headless Chrome: /lite, signing in, ✨ New task, a worker's terminal and
// its answer buttons, 📌 Issues, 🔀 PRs, 📋 Queue and a PR window, on an iPhone (390×844), an
// Android phone (360×800) and an iPad (820×1180). Each has no sideways scroll, and every button you
// can see is a thumb's size (44×44) or more. It runs against the built bundle (npm run build) with
// Chrome or Chromium, and is skipped without them. MOBILE_SHOTS=<folder> keeps a screenshot of each.
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
      assert.equal(await page.locator('.lite-actions .btn').count(), 2, 'Pixel has ✍️ Reply and 🔀 PR #7');

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
