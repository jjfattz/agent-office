// The pictures attached to tasks on a floor's 📋 queue: sent up as they're pasted into its window,
// before the task is queued, and shown on the task after (see queue-images.ts).
import { QUEUE_IMAGE_MAX_BYTES } from '../../../shared/queue-images.js';
import { str } from '../../office/input.js';
import { readBytes, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const queueRoutes = {
  image: {
    path: '/api/queue/image',
    auth: 'session',
    async handle(ctx, { req, res, url }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      if (req.method === 'GET') {
        const f = floor.queue.images.file(url.searchParams.get('id') ?? '');
        if (!f) return send(res, 404, { error: 'No such picture' });
        res.writeHead(200, {
          'content-type': f.type,
          'content-length': String(f.body.length),
          // Its id is new for every picture sent up, so it never changes.
          'cache-control': 'private, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          'cross-origin-resource-policy': 'same-origin',
        });
        res.end(f.body);
        return;
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const tooBig = `That picture is too big to attach (${QUEUE_IMAGE_MAX_BYTES / 1024 / 1024} MB at most)`;
      if (Number(req.headers['content-length']) > QUEUE_IMAGE_MAX_BYTES) return send(res, 413, { error: tooBig });
      let body: Buffer;
      try {
        body = await readBytes(req, QUEUE_IMAGE_MAX_BYTES);
      } catch (err) {
        return (err as Error).message === 'too large' ? send(res, 413, { error: tooBig }) : send(res, 400, { error: 'Bad request' });
      }
      const r = floor.queue.images.save(str(url.searchParams.get('name'), 256), body);
      return 'error' in r ? send(res, 400, r) : send(res, 200, r);
    },
  },
} satisfies Record<string, Route>;
