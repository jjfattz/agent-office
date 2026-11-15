// Provider accounts (see provider-accounts/): admins keep the office's logins, and pick which one the
// floor they're on runs each provider on. Everyone on a floor is told its picks (providerAccountsView).
import { isAccountProvider, type ProviderAccountsClientMsg } from '../../../shared/protocol.js';
import type { Floor } from '../../floor.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { str } from '../../office/input.js';
import { KINDS } from '../../provider-accounts/kinds.js';
import type { HandlerMap } from './types.js';

/** The office's logins are kept by admins (on the shared password, that's everyone). */
const admin = (ctx: Ctx, c: Client) => {
  if (ctx.meOf(c.accountId).admin) return true;
  ctx.warn(c, 'Only admins can change the provider accounts');
  return false;
};
const idOf = (v: unknown) => str(v, 64);

/** The accounts' names, and which of them this floor runs on. */
export const providerAccountsView = (ctx: Ctx, floor: Floor | undefined) => ctx.providerAccounts.view(floor?.id);

export const providerAccountsHandlers = {
  'providerAccounts.get'(ctx, c) {
    if (!admin(ctx, c)) return;
    ctx.sendTo(c, { t: 'providerAccounts.state', state: ctx.providerAccounts.state() });
    void ctx.providerAccounts.look();
  },
  'providerAccounts.add'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    const a = ctx.providerAccounts.add(msg.provider, str(msg.name, 200), msg.how, msg.dir, msg.token);
    if (typeof a === 'string') ctx.warn(c, a);
  },
  'providerAccounts.rename'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    ctx.warn(c, ctx.providerAccounts.rename(idOf(msg.id), str(msg.name, 200)));
  },
  'providerAccounts.remove'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    ctx.warn(c, ctx.providerAccounts.remove(idOf(msg.id)));
  },
  'providerAccounts.use'(ctx, c, msg) {
    if (!admin(ctx, c) || !isAccountProvider(msg.provider)) return;
    const floor = ctx.floorOf(c);
    if (!floor) return ctx.warn(c, 'Go to a floor first: each floor picks its own accounts');
    const id = msg.id === null ? null : idOf(msg.id);
    const was = ctx.providerAccounts.pick(floor.id, msg.provider);
    const err = ctx.providerAccounts.use(floor.id, msg.provider, id);
    if (err) return ctx.warn(c, err);
    if ((was ?? null) === id) return;
    const { label } = KINDS[msg.provider];
    const on = id ? ctx.providerAccounts.get(id)?.name : 'the machine’s own login';
    const here = floor.workers.list().filter((w) => w.kind === 'agent' && w.provider === msg.provider).length;
    const keep = here ? ` (the ${here === 1 ? 'one' : here} already here keep${here === 1 ? 's' : ''} ${here === 1 ? 'its' : 'theirs'})` : '';
    ctx.toastFloor(floor, `🪪 ${c.peer.name} put ${floor.def.name}’s ${label} workers on ${on}${keep}`);
  },
  'providerAccounts.signin'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    ctx.warn(c, ctx.providerAccounts.signIn(idOf(msg.id)));
  },
  'providerAccounts.code'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    ctx.warn(c, ctx.providerAccounts.code(idOf(msg.id), str(msg.code, 4096)));
  },
  'providerAccounts.cancel'(ctx, c, msg) {
    if (!admin(ctx, c)) return;
    ctx.providerAccounts.cancel(idOf(msg.id));
  },
} satisfies HandlerMap<ProviderAccountsClientMsg>;
