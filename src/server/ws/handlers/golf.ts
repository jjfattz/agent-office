// The golf course across the street: a shot goes to everyone else on the floor, who work out where it goes.
import type { GolfClientMsg } from '../../../shared/protocol.js';
import { shotOk } from '../../../shared/golf.js';
import { throttle } from '../../office/client.js';
import type { HandlerMap } from './types.js';

/** The quickest anyone hits one shot after another (ms): a page's own wait is longer. */
const SHOT_EVERY = 800;

export const golfHandlers = {
  golf(ctx, c, msg) {
    // Only with a club out, over the ball.
    const shot = { hole: msg.hole, x: msg.x, z: msg.z, club: msg.club, yaw: msg.yaw, loft: msg.loft, power: msg.power };
    if (!c.peer.golfing || !shotOk(shot) || !throttle(c, 'golf', SHOT_EVERY)) return;
    ctx.toNeighbors(c, { t: 'golf', id: c.id, ...shot });
  },
} satisfies HandlerMap<GolfClientMsg>;
