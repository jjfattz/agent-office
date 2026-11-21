// Pairing a phone (see phone/pairing.ts): the page a QR code opens, trading its one-time link for a
// session of the device's own, and naming the device.
import type http from 'node:http';
import path from 'node:path';
import { str } from '../../office/input.js';
import { serveFile } from '../static.js';
import { clientIp, isSecure, readBody, send } from '../util.js';
import type { Route } from '../router.js';

const TOO_MANY = 'Too many tries. Wait a few minutes, then scan a new QR code.';

async function body(req: http.IncomingMessage): Promise<Record<string, unknown> | undefined> {
  try {
    const v = JSON.parse(await readBody(req, 4096));
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

export const phoneRoutes = {
  page: { path: ['/pair', '/pair.html'], auth: 'public', handle: (ctx, { res }) => serveFile(res, path.join(ctx.publicDir, 'pair.html'), false) },
  /**
   * A pairing link's token, traded once for a session of the new device's own: as the account that
   * made the link, or on the shared password. Counted like a password guess, since the token is one.
   */
  pair: {
    method: 'POST',
    path: '/api/pair',
    auth: 'public',
    async handle(ctx, { req, res }) {
      const { auth, accounts, phone } = ctx;
      const ip = clientIp(req, ctx.cfg);
      if (!auth.allowAttempt(ip)) return send(res, 429, { error: TOO_MANY });
      const b = await body(req);
      if (!b) return send(res, 400, { error: 'Bad request' });
      const device = phone.devices.redeem(str(b.token, 128), String(req.headers['user-agent'] ?? ''), str(b.name, 64));
      if (!device) return send(res, 410, { error: 'This QR code was already used, or it’s more than 10 minutes old. Make a new one in the office’s 📱 window.' });
      // Whoever made the link must still be signed in to the office as they were.
      const account = accounts.get(device.owner);
      if (device.owner ? !account : !accounts.sharedPassword) {
        phone.devices.revoke(device.id);
        return send(res, 410, { error: 'Whoever made this QR code can’t sign in to the office any more.' });
      }
      auth.recordSuccess(ip);
      console.log(`  a device paired${account ? ` as ${account.name}` : ''}: ${device.name}`);
      return send(res, 200, { ok: true, device: device.name, ...(account ? { who: account.name } : {}) }, { 'set-cookie': auth.cookie(req, auth.issue(device.owner, device.id), isSecure(req, ctx.cfg), true) });
    },
  },
  /** Names the device this session is on. */
  name: {
    method: 'POST',
    path: '/api/phone/device',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!session.device) return send(res, 400, { error: 'This browser wasn’t paired with a QR code' });
      const b = await body(req);
      const d = b && ctx.phone.devices.rename(session.device, str(b.name, 64));
      return d ? send(res, 200, { ok: true, name: d.name }) : send(res, 400, { error: 'Give it a name' });
    },
  },
} satisfies Record<string, Route>;
