import '../ui/phone.css';
import './push.css';
// 🔔 Notify this phone: one switch that has the office buzz this phone when a worker needs you or is
// done, even with the office closed and the screen locked; a test; and your devices that get them,
// each with a 🗑. When it can't work here, it says why in plain words, and what to do about it.
import type { Net } from '../net';
import { store } from '../state';
import type { PushDevice } from '../../shared/protocol';
import { h, openModal, timeAgo } from '../ui/dom';
import { confirmDialog } from '../ui/prompt';
import { currentSubscription, preparePush, pushBlocked, pushOn, thisEndpoint, turnOff, turnOn } from './index';

let open = false;

export function openNotify(net: Net) {
  if (open) return;
  open = true;
  const box = h('input', { type: 'checkbox', role: 'switch' }) as HTMLInputElement;
  const say = h('p.note.push-say', { role: 'status' });
  const test = h('button.btn', { type: 'button' }, '🔔 Send a test');
  const list = h('div.push-devices');
  const el = h(
    'div.modal.push-window',
    { role: 'dialog', 'aria-label': 'Notify this phone' },
    h('header', {}, h('h2', {}, '🔔 Notifications')),
    h(
      'div.body',
      {},
      h('label.phone-switch.push-switch', {}, box, h('span.phone-slider', { 'aria-hidden': 'true' }), 'Notify this phone'),
      say,
      h('div.push-btns', {}, test),
      list,
    ),
  );
  /** Turning it on or off: the switch shows where it's going till it gets there. */
  let busy: boolean | undefined;
  /** Why the last try didn't work, until the next one. It stays on screen: a toast is gone before you've read it. */
  let error: string | undefined;
  const paint = () => {
    const blocked = pushBlocked();
    const on = pushOn();
    const why = on ? undefined : (error ?? blocked);
    box.checked = busy ?? on;
    box.disabled = busy !== undefined || (!!blocked && !on);
    test.disabled = busy !== undefined || !store.push?.devices.length;
    say.classList.toggle('bad', busy === undefined && !!why);
    say.textContent =
      busy !== undefined
        ? 'One moment…'
        : on
          ? 'On: this phone buzzes when a worker needs you or is done, even with the office closed. Tap the notification to go straight to that worker.'
          : (why ?? 'Off. Turn it on to hear about workers that need you with the office closed and your phone locked.');
    list.replaceChildren(...deviceRows(net, store.push?.devices ?? []));
  };
  box.addEventListener('change', async () => {
    // Before anything else, while the tap still counts: see turnOn.
    const job = box.checked ? turnOn(net) : turnOff(net).then(() => undefined);
    busy = box.checked;
    error = undefined;
    paint();
    error = await job;
    busy = undefined;
    paint();
  });
  test.addEventListener('click', () => net.send({ t: 'push.test' }));
  const off = store.on('push', paint);
  net.send({ t: 'push.get' });
  void currentSubscription().then(paint);
  // The service worker and the office's key, ready for the tap.
  void preparePush(net).then((err) => {
    if (err && !pushOn() && busy === undefined) error = err;
    paint();
  });
  paint();
  openModal(el, {
    onClose: () => {
      open = false;
      off();
    },
  });
}

function deviceRows(net: Net, devices: PushDevice[]): HTMLElement[] {
  if (!devices.length) return [];
  const here = thisEndpoint();
  return [
    h('h4', {}, 'Your devices that get notifications'),
    h(
      'ul.phone-devices',
      {},
      ...devices.map((d) => {
        const del = h('button.btn', { type: 'button', title: `Stop notifications to ${d.name}`, 'aria-label': `Stop notifications to ${d.name}` }, '🗑');
        del.addEventListener('click', () =>
          confirmDialog(`Stop notifications to ${d.name}?`, 'It won’t buzz when a worker needs you any more. Turn it back on from 🔔 on that device.', 'Stop', () => net.send({ t: 'push.unsubscribe', id: d.id })),
        );
        const when = d.error ? `⚠️ ${d.error}` : d.lastPushAt ? `last buzzed ${timeAgo(d.lastPushAt)}` : `on since ${timeAgo(d.createdAt)}`;
        return h(
          'li',
          {},
          h('span.phone-device-icon', { 'aria-hidden': 'true' }, '🔔'),
          h('span.phone-device', {}, h('b', {}, d.name, d.endpoint === here ? ' (this one)' : ''), h('small', {}, when)),
          del,
        );
      }),
    ),
  ];
}

/** 🔔 Your devices that get notifications, for 🔐 Your sign-ins. Call the `off` it hands back when the window closes. */
export function pushDevicesSection(net: Net): { el: HTMLElement; off: () => void } {
  const body = h('div');
  const el = h('section.phone-devices-section', { hidden: true }, body);
  const paint = () => {
    const rows = deviceRows(net, store.push?.devices ?? []);
    el.hidden = !rows.length;
    body.replaceChildren(...rows);
  };
  const off = store.on('push', paint);
  paint();
  net.send({ t: 'push.get' });
  return { el, off };
}
