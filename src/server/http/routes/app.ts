// The 2D view as an app on a phone's home screen (see src/client/pwa/): its manifest and icons, the
// service worker, and the page it shows while the office can't be reached. All public: a phone asks
// for them before it's signed in, and none of them say anything about the office. And the answer a
// notification's button sends (see push/answer.ts), from the service worker, as whoever's signed in.
import path from 'node:path';
import { answerWorker } from '../../push/answer.js';
import { guessDevice } from '../../phone/pairing.js';
import { publicFile, serveFile } from '../static.js';
import { isSecure, readBody, sameOrigin, send } from '../util.js';
import type { Route, RouteRequest } from '../router.js';
import type { Ctx } from '../../office/context.js';

const file = (name: string) => (ctx: Ctx, { res }: RouteRequest) => {
  const f = publicFile(ctx.publicDir, name);
  if (f) return serveFile(res, f, false);
  res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
};

export const appRoutes = {
  manifest: { path: '/manifest.webmanifest', auth: 'public', handle: file('manifest.webmanifest') },
  // At the top of the site, so it can look after /lite; it never caches anything behind sign-in.
  worker: { path: '/sw.js', auth: 'public', handle: file('sw.js') },
  offline: { path: '/offline.html', auth: 'public', handle: file('offline.html') },
  icons: {
    prefix: '/icons/',
    auth: 'public',
    handle(ctx, { res, path: p }) {
      const f = publicFile(ctx.publicDir, path.posix.normalize(p));
      if (f && f.startsWith(path.join(ctx.publicDir, 'icons') + path.sep)) return serveFile(res, f, false);
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    },
  },
  answer: {
    method: 'POST',
    path: '/api/push/answer',
    auth: 'session',
    async handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      let b: { worker?: unknown; key?: unknown };
      try {
        b = JSON.parse(await readBody(req, 1024));
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      const by = session.account?.name ?? ctx.phone.devices.get(session.device)?.name ?? 'Someone on a phone';
      const error = answerWorker(ctx, b?.worker, typeof b?.key === 'string' ? b.key.slice(0, 4) : '', by);
      return error ? send(res, 409, { error }) : send(res, 200, { ok: true });
    },
  },
  /**
   * The office opened as an app from a phone's home screen, which shouldn't ask for the password
   * every two weeks. It becomes a device of its own (in 📱 Your devices, where it's signed out),
   * with a device's session, which every visit from it renews once it's past half its life.
   */
  appSession: {
    method: 'POST',
    path: '/api/app/session',
    auth: 'session',
    handle(ctx, { req, res, session }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const { auth, phone } = ctx;
      const cookie = (device: string) => ({ 'set-cookie': auth.cookie(req, auth.issue(session.account?.id, device), isSecure(req, ctx.cfg), true) });
      if (session.device) return auth.refreshDue(req) ? send(res, 200, { ok: true, renewed: true }, cookie(session.device)) : send(res, 200, { ok: true });
      const ua = String(req.headers['user-agent'] ?? '');
      const d = phone.devices.enroll(session.account?.id, ua, `${guessDevice(ua)} (home screen)`);
      console.log(`  ${session.account?.name ?? 'someone'} put the office on the home screen of their ${d.name}`);
      return send(res, 200, { ok: true, device: d.id }, cookie(d.id));
    },
  },
} satisfies Record<string, Route>;
