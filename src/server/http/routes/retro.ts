// The boss's computer's games that the office keeps itself (see src/server/retro.ts): the list for the
// library, and each game's file, for the page to hand the emulator.
import type { Ctx } from '../../office/context.js';
import { RetroShelf } from '../../retro.js';
import type { Route } from '../router.js';
import { send } from '../util.js';

/** Each office's shelf, by its data folder (there's one office to a process, but tests start more). */
const shelves = new Map<string, RetroShelf>();
export function shelfOf(ctx: Pick<Ctx, 'cfg'>): RetroShelf {
  let shelf = shelves.get(ctx.cfg.dataDir);
  if (!shelf) shelves.set(ctx.cfg.dataDir, (shelf = new RetroShelf(ctx.cfg.dataDir)));
  return shelf;
}

export const retroRoutes = {
  shelf: {
    method: 'GET',
    path: '/api/retro/shelf',
    auth: 'session',
    handle(ctx, { res }) {
      const shelf = shelfOf(ctx);
      return send(res, 200, { dir: shelf.dir, games: shelf.list() });
    },
  },
  rom: {
    method: 'GET',
    path: '/api/retro/rom',
    auth: 'session',
    handle(ctx, { res, url }) {
      const game = shelfOf(ctx).open(url.searchParams.get('system'), url.searchParams.get('file'));
      if (!game) return send(res, 404, { error: 'No such game on the shelf' });
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(game.size),
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
        // Opened on its own, it's a download that can't run anything on the office's origin.
        'content-security-policy': "default-src 'none'; sandbox",
        'content-disposition': 'attachment',
        'cross-origin-resource-policy': 'same-origin',
      });
      const stream = game.stream();
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    },
  },
} satisfies Record<string, Route>;
