// The Claude plan limits under the workers.
import type { UsageClientMsg } from '../../../shared/protocol.js';
import type { FeatureHooks, HandlerMap } from './types.js';

export const usageHandlers = {
  'limits.refresh'(ctx, c) {
    ctx.limits.refresh(c);
  },
} satisfies HandlerMap<UsageClientMsg>;

/** Another floor may run its Claude workers on another account: once someone's there, they see its plan. */
export const usageHooks: FeatureHooks = {
  leaving: (ctx, c) => () => ctx.limits.show(c),
};
