// The boss's computer's games that the office keeps itself (see src/server/retro.ts): the list for the
// library, each game's file, for the page to hand the emulator, and recognizing the games people add
// in their own browsers (see src/server/retro-db.ts).
import { isSystem, romFileOk, type RetroMeta, type RetroSystem } from '../../../shared/retro.js';
import type { Ctx } from '../../office/context.js';
import { RetroShelf } from '../../retro.js';
import type { Route } from '../router.js';
import { readBody, sameOrigin, send } from '../util.js';

/** The most games the page asks about at once. */
const MAX_IDENTIFY = 2000;
/** How long recognizing waits on libretro's lists before answering with what it has, in ms. */
const IDENTIFY_WAIT = 4000;

/** What the page asks to recognize: each game's console, file name and CRCs. Null when it isn't that. */
export function parseIdentify(body: unknown): { system: RetroSystem; file: string; crcs: string[] }[] | null {
  const games = (body as { games?: unknown } | null)?.games;
  if (!Array.isArray(games) || games.length > MAX_IDENTIFY) return null;
  const out: { system: RetroSystem; file: string; crcs: string[] }[] = [];
  for (const g of games as { system?: unknown; file?: unknown; crcs?: unknown }[]) {
    if (!g || !isSystem(g.system) || typeof g.file !== 'string' || !romFileOk(g.system, g.file)) return null;
    const crcs = Array.isArray(g.crcs) ? g.crcs.filter((c): c is string => typeof c === 'string' && /^[0-9A-F]{8}$/.test(c)).slice(0, 8) : [];
    out.push({ system: g.system, file: g.file, crcs });
  }
  return out;
}

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
    async handle(ctx, { res }) {
      const shelf = shelfOf(ctx);
      const { games, pending } = await shelf.list();
      return send(res, 200, { dir: shelf.dir, games, pending });
    },
  },
  identify: {
    method: 'POST',
    path: '/api/retro/identify',
    auth: 'session',
    async handle(ctx, { req, res }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      let games: ReturnType<typeof parseIdentify>;
      try {
        games = parseIdentify(JSON.parse(await readBody(req, 512 * 1024)));
      } catch {
        games = null;
      }
      if (!games) return send(res, 400, { error: 'Bad request' });
      const db = shelfOf(ctx).db;
      // What's recognized in time is sent; the rest (null) is asked about again while `pending` says so.
      const metas: (RetroMeta | null)[] = games.map(() => null);
      const all = Promise.all(
        games.map(async (g, i) => {
          metas[i] = (await db.identify(g.system, g.file, g.crcs)) ?? null;
        }),
      );
      const done = await Promise.race([all.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), IDENTIFY_WAIT).unref?.())]);
      return send(res, 200, { metas, pending: !done });
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
