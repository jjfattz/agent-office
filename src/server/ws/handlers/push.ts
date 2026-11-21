// 🔔 Notify this phone (see push/): the office's key and your devices, adding and removing one, a
// test push, which browsers have the 2D view on screen, and answering a worker from its card.
import type { PushClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { throttle, type Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import { answerWorker } from '../../push/answer.js';
import type { FeatureHooks, HandlerMap } from './types.js';

const who = (c: Client) => ({ owner: c.accountId, device: c.device });
const send = (ctx: Ctx, c: Client) => ctx.sendTo(c, { t: 'push', state: ctx.push.view(who(c)) });

export const pushHandlers = {
  'push.get'(ctx, c) {
    send(ctx, c);
  },
  'push.subscribe'(ctx, c, msg) {
    if (!throttle(c, 'push.subscribe', 1000)) return;
    const keys = msg.keys && typeof msg.keys === 'object' ? { p256dh: str(msg.keys.p256dh, 200), auth: str(msg.keys.auth, 100) } : { p256dh: '', auth: '' };
    const err = ctx.push.subscribe(who(c), { endpoint: str(msg.endpoint, 1000), keys }, str(msg.name, 60));
    if (err) return ctx.warn(c, err);
    console.log(`  ${c.peer.name} turned on notifications for "${str(msg.name, 60) || 'a device'}"`);
  },
  'push.unsubscribe'(ctx, c, msg) {
    if (!ctx.push.unsubscribe(who(c), str(msg.id, 32), c.admin)) ctx.warn(c, 'That device already gets no notifications');
  },
  'push.test'(ctx, c) {
    if (!throttle(c, 'push.test', 2000)) return;
    void ctx.push.test(who(c)).then(({ sent, error }) =>
      ctx.sendTo(c, { t: 'toast', text: error ?? `🔔 Sent a test to ${sent === 1 ? 'your device' : `${sent} of your devices`}`, level: error ? 'warn' : 'info' }),
    );
  },
  'push.here'(ctx, c, msg) {
    ctx.push.here(c.id, msg.endpoint ? str(msg.endpoint, 1000) : undefined, msg.visible === true);
  },
  'worker.answer'(ctx, c, msg) {
    if (!throttle(c, `answer:${str(msg.workerId, 32)}`, 500)) return;
    ctx.warn(c, answerWorker(ctx, msg.workerId, str(msg.key, 4), c.peer.name));
  },
} satisfies HandlerMap<PushClientMsg>;

/** A browser that left isn't looking any more. */
export const pushHooks: FeatureHooks = {
  closed(ctx, c) {
    ctx.push.forget(c.id);
  },
};
