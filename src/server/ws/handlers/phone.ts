// 📱 Use on your phone (see phone/): what the window shows, turning access on and off (admins),
// pairing a phone, a test notification, and signing a paired device out.
import type { PhoneClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { throttle, type Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import type { FeatureHooks, HandlerMap } from './types.js';

const send = (ctx: Ctx, c: Client) => ctx.sendTo(c, { t: 'phone', state: ctx.phone.view(c) });

/** Only admins change whether the office is on the tailnet, or keep the computer awake. */
function admin(ctx: Ctx, c: Client): boolean {
  if (!c.admin) ctx.warn(c, 'Only an admin can change phone access');
  return c.admin;
}

export const phoneHandlers = {
  'phone.get'(ctx, c, msg) {
    ctx.phone.subscribe(c.id);
    if (msg.watch) ctx.phone.watch(c.id, true);
    send(ctx, c);
  },
  'phone.unwatch'(ctx, c) {
    ctx.phone.watch(c.id, false);
  },
  'phone.login'(ctx, c) {
    if (admin(ctx, c)) ctx.phone.login();
  },
  'phone.access'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    const on = msg.on === true;
    console.log(`  ${c.peer.name} turned phone access ${on ? 'on' : 'off'}`);
    void ctx.phone.setAccess(on);
  },
  'phone.awake'(ctx, c, msg) {
    if (admin(ctx, c)) ctx.phone.setAwake(msg.on === true);
  },
  'phone.pair'(ctx, c) {
    if (!throttle(c, 'phone.pair', 1000)) return;
    const link = ctx.phone.pairLink(c);
    if (!link) return ctx.warn(c, c.admin ? 'Turn on phone access first (step 4)' : 'Ask an admin to turn on phone access');
    ctx.sendTo(c, { t: 'phone.pairing', ...link });
  },
  'phone.test'(ctx, c) {
    if (!throttle(c, 'phone.test', 2000)) return;
    // Your own paired devices with the office open (web push to a closed one is still to come).
    const mine = [...ctx.clients.values()].filter((o) => o.device && !o.out && o.accountId === c.accountId);
    if (!mine.length) return ctx.warn(c, 'Open the office on your phone first: it buzzes while the office is open there');
    for (const o of mine) ctx.sendTo(o, { t: 'phone.buzz', title: '🔔 It works!', body: 'Your phone will hear from the office here.' });
    ctx.sendTo(c, { t: 'toast', text: `🔔 Sent to ${mine.length === 1 ? 'your phone' : `${mine.length} of your devices`}`, level: 'info' });
  },
  'phone.revoke'(ctx, c, msg) {
    const d = ctx.phone.devices.get(str(msg.id, 64));
    if (!d || (!c.admin && (d.owner ?? undefined) !== c.accountId)) return ctx.warn(c, 'That device is already signed out');
    ctx.phone.devices.revoke(d.id);
    console.log(`  ${c.peer.name} signed out the device "${d.name}"`);
    // Its open sockets go too (see People.stillIn).
    ctx.accountsChanged();
  },
} satisfies HandlerMap<PhoneClientMsg>;

/** Someone who left stops hearing about it. */
export const phoneHooks: FeatureHooks = {
  closed(ctx, c) {
    ctx.phone.forget(c.id);
  },
};
