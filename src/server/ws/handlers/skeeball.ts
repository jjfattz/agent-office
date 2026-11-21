// The skeeball machine on every floor: a roll goes to everyone else on the floor, who work out where it goes.
import type { SkeeballClientMsg } from '../../../shared/protocol.js';
import { ROOF } from '../../../shared/rooftop.js';
import { rollOk } from '../../../shared/skeeball.js';
import { throttle } from '../../office/client.js';
import type { HandlerMap } from './types.js';

/** The quickest anyone rolls one ball after another (ms): a page's own wait is longer. */
const ROLL_EVERY = 400;

export const skeeballHandlers = {
  skeeball(ctx, c, msg) {
    const roll = { aim: msg.aim, power: msg.power, n: msg.n };
    if (!c.peer.floor || c.peer.floor === ROOF || !rollOk(roll) || !throttle(c, 'skeeball', ROLL_EVERY)) return;
    ctx.toNeighbors(c, { t: 'skeeball', id: c.id, aim: roll.aim, power: roll.power, n: roll.n });
  },
} satisfies HandlerMap<SkeeballClientMsg>;
