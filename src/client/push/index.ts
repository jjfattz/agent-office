// 🔔 Notify this phone, the browser's side (the office's is server/push/): the service worker it goes
// through (sw.js), turning pushes on and off for this browser, telling the office while the 2D view
// is on screen (it isn't pushed then), and taking down notifications nobody needs any more.
import type { Net } from '../net';
import { store } from '../state';
import type { WorkerInfo } from '../../shared/protocol';
import { pushDeviceName } from '../../shared/device-name';
import { isIos, standalone } from '../ui/touch';

/** Why this browser can't get pushes, in plain words; undefined when it can. */
export function pushBlocked(): string | undefined {
  if (!window.isSecureContext) return 'Notifications need the office’s https address: open it from the link ☰ → 📱 Use on your phone gives you.';
  if (isIos() && !standalone()) return 'On iPhone, add the office to your Home Screen first (tap Share, then Add to Home Screen), and open it from there.';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'This browser can’t get notifications with the office closed.';
  if (Notification.permission === 'denied')
    return isIos()
      ? 'Notifications are blocked for the office. Turn them on in Settings → Notifications, under the name its Home Screen icon has. Not listed there? Delete the icon, add the office to your Home Screen again from Safari, open it from there, and allow notifications when asked.'
      : 'Notifications are blocked for this site. Allow them in the browser’s site settings, then try again.';
  return undefined;
}

let registering: Promise<ServiceWorkerRegistration | undefined> | undefined;

/** The office's service worker, registered once a page. */
export function serviceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return Promise.resolve(undefined);
  return (registering ??= navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined));
}

/** This browser's push subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('PushManager' in window)) return null;
  const reg = await serviceWorker();
  return (await reg?.pushManager.getSubscription().catch(() => null)) ?? null;
}

/** The office's key: the state it sent, or asks for it and waits. */
function officeKey(net: Net): Promise<string | undefined> {
  if (store.push) return Promise.resolve(store.push.key);
  net.send({ t: 'push.get' });
  return new Promise((resolve) => {
    const off = store.on('push', () => {
      off();
      resolve(store.push?.key);
    });
    setTimeout(() => {
      off();
      resolve(store.push?.key);
    }, 8000);
  });
}

const keyBytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const b64url = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '');

/** What subscribing needs, got before the tap: Safari only subscribes straight from one (see turnOn). */
let ready: { reg: ServiceWorkerRegistration; key: string } | undefined;

const within = <T>(p: Promise<T>, ms: number): Promise<T | undefined> => Promise.race([p, new Promise<undefined>((r) => setTimeout(r, ms))]);

/**
 * Gets the service worker running and the office's key, so a tap on the switch can subscribe there
 * and then. Call it when 🔔 opens. Says why it can't, if it can't.
 */
export async function preparePush(net: Net): Promise<string | undefined> {
  const blocked = pushBlocked();
  if (blocked) return blocked;
  const reg = (await serviceWorker()) && (await within(navigator.serviceWorker.ready, 10000));
  if (!reg) return 'The office’s service worker didn’t start. Close the office and open it again.';
  const key = await officeKey(net);
  if (!key) return 'The office didn’t answer. Try again in a moment.';
  // Subscribed to another office's key (the office made a new one): that one's no use, and is in the way.
  const sub = await reg.pushManager.getSubscription().catch(() => null);
  if (sub && b64url(sub.options.applicationServerKey) !== key) await sub.unsubscribe().catch(() => {});
  ready = { reg, key };
  return undefined;
}

/**
 * Turns pushes on for this browser: subscribes (which asks to notify, too), tells the office, and
 * waits for it to list this browser. Call it straight from a tap, before anything else: Safari on an
 * iPhone only subscribes, and only asks, while it's still handling the tap. Says why not, if not.
 */
export async function turnOn(net: Net): Promise<string | undefined> {
  const blocked = pushBlocked();
  if (blocked) return blocked;
  const r = ready;
  const options = (key: string) => ({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  // No await before this: it's what has to happen while the tap counts.
  const subscribing = r ? r.reg.pushManager.subscribe(options(r.key)) : undefined;
  let sub: PushSubscription;
  try {
    if (subscribing) sub = await subscribing;
    else {
      // Not ready yet (a browser that's slow to start the service worker): the long way round.
      if ((await Notification.requestPermission()) !== 'granted') return pushBlocked() ?? 'Allow notifications when the phone asks, to get them.';
      const err = await preparePush(net);
      if (err || !ready) return err ?? 'The office didn’t answer. Try again in a moment.';
      sub = (await ready.reg.pushManager.getSubscription()) ?? (await ready.reg.pushManager.subscribe(options(ready.key)));
    }
  } catch (err) {
    const blockedNow = pushBlocked();
    if (blockedNow) return blockedNow;
    const e = err as Error;
    if (e.name === 'NotAllowedError') return 'The phone didn’t let the office ask to notify you. Tap the switch again, and allow notifications when it asks.';
    return `The phone wouldn’t sign up for notifications (${e.name}: ${e.message}).`;
  }
  const json = sub.toJSON();
  net.send({ t: 'push.subscribe', endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' }, name: pushDeviceName(navigator.userAgent) });
  endpoint = sub.endpoint;
  reportHere(net);
  if (!(await officeLists(sub.endpoint, 8000))) return 'The office didn’t add this phone. Check it’s connected, and try again.';
  return undefined;
}

/** Whether the office lists `endpoint` among this browser's devices within `ms`. */
function officeLists(ep: string, ms: number): Promise<boolean> {
  const has = () => !!store.push?.devices.some((d) => d.endpoint === ep);
  if (has()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      off();
      clearTimeout(timer);
      resolve(ok);
    };
    const off = store.on('push', () => has() && done(true));
    const timer = setTimeout(() => done(has()), ms);
  });
}

/** Turns pushes off for this browser, here and at the office. */
export async function turnOff(net: Net) {
  const sub = await currentSubscription();
  const mine = sub && store.push?.devices.find((d) => d.endpoint === sub.endpoint);
  if (mine) net.send({ t: 'push.unsubscribe', id: mine.id });
  await sub?.unsubscribe().catch(() => {});
  endpoint = undefined;
}

/** This browser's endpoint, once known: what it tells the office it's looking with. */
let endpoint: string | undefined;

/** Whether this browser gets pushes from the office now. */
export function pushOn(): boolean {
  return !!endpoint && !!store.push?.devices.some((d) => d.endpoint === endpoint);
}

export function thisEndpoint(): string | undefined {
  return endpoint;
}

function reportHere(net: Net) {
  net.send({ t: 'push.here', endpoint, visible: !document.hidden });
}

/**
 * Keeps the office up to date with this browser: its devices (on every connect), and whether the 2D
 * view is on screen. `openWorker` is what tapping a notification does when the 2D view is already open.
 */
export function installPush(net: Net, openWorker: (workerId: string, floor?: string) => void) {
  void serviceWorker();
  void currentSubscription().then((sub) => {
    endpoint = sub?.endpoint;
    if (net.up) reportHere(net);
  });
  net.onStatus((up) => {
    if (!up) return;
    net.send({ t: 'push.get' });
    reportHere(net);
  });
  document.addEventListener('visibilitychange', () => {
    reportHere(net);
    if (!document.hidden) void closeNotifications(() => true);
  });
  navigator.serviceWorker?.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as { t?: string; worker?: string; floor?: string };
    if (m?.t === 'open-worker' && m.worker) openWorker(m.worker, m.floor);
  });
  // Someone else got to a worker: its notification on this phone goes.
  store.on('workers', () => void closeNotifications((id) => !waiting(store.workers.get(id))));
}

const waiting = (w: WorkerInfo | undefined) => !!w && (w.status === 'needs_input' || (w.status === 'done' && !w.acked));

/** Takes down this browser's worker notifications for which `drop(workerId)` says so. */
async function closeNotifications(drop: (workerId: string) => boolean) {
  if (!endpoint) return;
  const reg = await serviceWorker();
  const shown = (await reg?.getNotifications().catch(() => [])) ?? [];
  for (const n of shown) {
    const id = /^worker-(.+)$/.exec(n.tag)?.[1];
    if (id && (store.workers.has(id) || document.visibilityState === 'visible') && drop(id)) n.close();
  }
}
