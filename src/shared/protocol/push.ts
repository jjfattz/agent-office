// 🔔 Notify this phone: web push to a phone or computer with the office closed (see server/push/),
// and answering a worker's question from its card or a notification without opening its terminal.

/** A device that gets pushes, as its owner sees it. */
export interface PushDevice {
  id: string;
  /** "iPhone · Safari". */
  name: string;
  /** Its push endpoint, so a browser can tell which one is itself. */
  endpoint: string;
  createdAt: number;
  lastPushAt?: number;
  /** Why the last push didn't get through. */
  error?: string;
}

export interface PushState {
  /** The office's VAPID public key, which a browser subscribes with (applicationServerKey). */
  key: string;
  /** Your devices getting pushes. */
  devices: PushDevice[];
}

export type PushClientMsg =
  /** What 🔔 shows: the office's key and your devices. */
  | { t: 'push.get' }
  /** This browser wants pushes: its PushSubscription, and a name for it ("iPhone · Safari"). */
  | { t: 'push.subscribe'; endpoint: string; keys: { p256dh: string; auth: string }; name?: string }
  /** Stops pushes to one of your devices. */
  | { t: 'push.unsubscribe'; id: string }
  /** A test push to every device of yours. */
  | { t: 'push.test' }
  /** This browser (`endpoint`, its subscription) has the 2D view on screen, or stopped having it: it isn't pushed while it's looking. */
  | { t: 'push.here'; endpoint?: string; visible: boolean }
  /** Picks one of the choices a waiting worker offers (WorkerInfo.choices), by its key. */
  | { t: 'worker.answer'; workerId: string; key: string };

export type PushServerMsg = { t: 'push'; state: PushState };

/** What a push carries to the service worker (src/client/public/sw.js), which shows it. */
export interface PushPayload {
  title: string;
  body: string;
  /** One notification per worker: a newer one replaces it. */
  tag: string;
  /** Where tapping it goes. */
  url: string;
  worker?: string;
  floor?: string;
  /** Buttons on the notification, where the phone shows them (Android): each answers the worker. */
  actions?: { key: string; label: string }[];
  /** Stays up until it's dealt with. */
  sticky?: boolean;
}
