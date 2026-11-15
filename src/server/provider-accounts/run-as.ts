// Whose logins a floor's workers run on: whoever hired them, on their own sign-ins (signins.ts), and
// for the office machine's own login, the provider account the floor picked (see ProviderAccounts).
import { isAccountProvider, type AccountProvider } from '../../shared/protocol.js';
import { providerAdapter } from '../providers/index.js';
import type { SignIns } from '../signins.js';
import type { RunAs } from '../workers/types.js';
import type { ProviderAccounts } from './index.js';

/** `owner` runs `provider` on a sign-in of their own, which no provider account stands in for. */
export const theirOwn = (signins: SignIns, owner: string | undefined, provider: AccountProvider) => provider === 'claude' && !!owner && signins.claudeKey(owner) !== undefined;

export function floorRunAs(floor: string, signins: SignIns, accounts: ProviderAccounts): RunAs {
  return {
    account: (provider, owner) => (isAccountProvider(provider) && !theirOwn(signins, owner, provider) ? accounts.pick(floor, provider) : undefined),
    claudeReady: (owner) => signins.claudeReady(owner),
    why: (which) => signins.why(which),
    apply({ owner, info }, env, dirs) {
      if (owner) {
        if (info.kind === 'agent' && providerAdapter(info.provider)?.signIn && !signins.claudeReady(owner)) {
          return `whoever hired ${info.name} (${info.createdBy}) isn't signed in to Claude — they can sign in under ☰ → 🔐 Your sign-ins, then press R here`;
        }
        signins.apply(owner, env, dirs);
      }
      // An agent keeps the account it was hired on; a shell runs on whatever its floor's are now.
      if (info.account) return accounts.apply(info.account, env, dirs);
      if (info.kind === 'shell') accounts.applyFloor(floor, env, dirs, (p) => theirOwn(signins, owner, p));
      return undefined;
    },
  };
}
