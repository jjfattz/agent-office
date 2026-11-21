// The office's service worker, for the 2D view as an app on a phone's home screen (see src/client/pwa/
// and src/client/push/). It does three things:
//
// - Opening /lite while the office can't be reached shows offline.html ("Reconnecting…", which keeps
//   trying) instead of the browser's error page. Only that page and its pictures are cached: nothing
//   behind sign-in, and no API answer, ever. Everything else goes straight to the network.
// - A push from the office (server/push/) shows as a notification, even with the office closed.
// - Tapping one opens the 2D view on that worker; its buttons (Android) answer the worker there and then.
const CACHE = 'office-shell-v1';
const SHELL = ['/offline.html', '/favicon.svg', '/icons/icon-192.png', '/icons/badge-96.png'];
const APP_PAGES = new Set(['/lite', '/lite.html']);
/** A page that hasn't answered by then is taken for an office that can't be reached. */
const NAV_TIMEOUT_MS = 10000;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !APP_PAGES.has(url.pathname)) return;
  e.respondWith(navigate(req));
});

async function navigate(req) {
  try {
    return await Promise.race([fetch(req), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS))]);
  } catch {
    return (await caches.match('/offline.html')) || Response.error();
  }
}

// ---- Push ---------------------------------------------------------------------------------------
const canAct = typeof Notification !== 'undefined' && 'maxActions' in Notification;

self.addEventListener('push', (e) => {
  let p = {};
  try {
    p = e.data ? e.data.json() : {};
  } catch {
    p = { title: 'Agent Office', body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(show(p));
});

function show(p) {
  const actions = canAct ? (p.actions || []).map((a) => ({ action: `answer:${a.key}`, title: a.label })) : [];
  return self.registration.showNotification(p.title || 'Agent Office', {
    body: p.body || '',
    tag: p.tag || 'office',
    renotify: true,
    requireInteraction: !!p.sticky,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url: p.url || '/lite', worker: p.worker, floor: p.floor },
    ...(actions.length ? { actions } : {}),
  });
}

self.addEventListener('notificationclick', (e) => {
  const n = e.notification;
  const d = n.data || {};
  n.close();
  if (e.action && e.action.startsWith('answer:') && d.worker) e.waitUntil(answer(d, e.action.slice('answer:'.length), n));
  else e.waitUntil(openApp(d));
});

/** A notification's button: picks that choice for the worker, as whoever this phone is signed in as. */
async function answer(d, key, n) {
  try {
    const res = await fetch('/api/push/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ worker: d.worker, key }), credentials: 'same-origin' });
    if (res.ok) return;
    const why = res.status === 401 ? 'Open the office to sign in again.' : ((await res.json().catch(() => ({}))).error || 'Open the office to answer it.');
    await self.registration.showNotification('Couldn’t answer', { body: why, tag: n.tag, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', data: d });
  } catch {
    await openApp(d);
  }
}

/** The 2D view on that worker: the one already open if there is one, else a new one. */
async function openApp(d) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const lite = wins.find((c) => APP_PAGES.has(new URL(c.url).pathname));
  if (lite) {
    await lite.focus().catch(() => {});
    if (d.worker) lite.postMessage({ t: 'open-worker', worker: d.worker, floor: d.floor });
    return;
  }
  await self.clients.openWindow(new URL(d.url || '/lite', self.location.origin).href);
}
