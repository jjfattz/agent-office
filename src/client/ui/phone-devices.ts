import './phone.css';
// The devices signed in with a pairing QR code (see server/phone/pairing.ts), each with a way to sign
// it out: in the 📱 window, in 🔐 Your sign-ins, and (everyone's) in 🔑 Accounts.
import type { PhoneDevice } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, timeAgo } from './dom';
import { confirmDialog } from './prompt';

/** A list of `devices`; `owners` names whose each one is (an admin's list of everyone's). `none` is what an empty one says. */
export function deviceList(net: Net, devices: PhoneDevice[], owners = false, none = 'None yet. Pair one from ☰ → 📱 Use on your phone.'): HTMLElement {
  if (!devices.length) return h('p.empty', {}, none);
  return h(
    'ul.phone-devices',
    {},
    ...devices.map((d) => {
      const out = h('button.btn', { type: 'button', title: 'Sign this device out of the office now' }, 'Sign out');
      out.addEventListener('click', () =>
        confirmDialog(`Sign out ${d.name}?`, 'It can’t open the office any more until it’s paired again. Good for a lost phone.', 'Sign out', () => net.send({ t: 'phone.revoke', id: d.id })),
      );
      const who = owners ? (d.mine ? 'you' : (d.owner ?? 'the shared password')) : '';
      return h(
        'li',
        {},
        h('span.phone-device-icon', { 'aria-hidden': 'true' }, '📱'),
        h('span.phone-device', {}, h('b', {}, d.name), h('small', {}, [who && `${who} · `, d.lastSeenAt ? `seen ${timeAgo(d.lastSeenAt)}` : 'not connected yet', ` · paired ${timeAgo(d.pairedAt)}`].filter(Boolean).join(''))),
        out,
      );
    }),
  );
}

/**
 * A section that keeps itself up to date with the office's list: yours, or with `everyone`, every
 * device (an admin's). Call the `off` it hands back when the window closes.
 */
export function devicesSection(net: Net, title: string, everyone = false): { el: HTMLElement; off: () => void } {
  const body = h('div');
  const el = h('section.phone-devices-section', { hidden: true }, h('h4', {}, title), body);
  const paint = () => {
    const all = store.phone?.devices ?? [];
    const shown = everyone ? all : all.filter((d) => d.mine);
    el.hidden = !shown.length;
    body.replaceChildren(deviceList(net, shown, everyone));
  };
  const off = store.on('phone', paint);
  paint();
  if (!store.phone) net.send({ t: 'phone.get' });
  return { el, off };
}
