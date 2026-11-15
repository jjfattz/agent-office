import type { AccountProvider, ProviderAccountsState, ProviderAccountsView } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The provider accounts' names, and which of them this floor's workers run on. */
    providerAccounts: ProviderAccountsView;
    /** Every provider account in full; only admins get these. */
    providerAccountsState: ProviderAccountsState | null;
    /** What a worker on `provider` hired here now runs on: its account's name, or none for the machine's own login. */
    floorAccount(provider: AccountProvider): string | undefined;
    /** The name of the provider account `id`, while there is one. */
    accountName(id: string | undefined): string | undefined;
  }
  interface Topics {
    providerAccounts: true;
    providerAccountsState: true;
  }
}

const NONE: ProviderAccountsView = { accounts: [], floor: {} };

export const providerAccounts: Slice = {
  init(s) {
    s.providerAccounts = NONE;
    s.providerAccountsState = null;
  },
  methods: {
    floorAccount(provider: AccountProvider) {
      return this.accountName(this.providerAccounts.floor[provider]);
    },
    accountName(id: string | undefined) {
      return id ? this.providerAccounts.accounts.find((a) => a.id === id)?.name : undefined;
    },
  },
  on: {
    providerAccounts(s, m) {
      s.providerAccounts = m.view;
      return ['providerAccounts'];
    },
    'providerAccounts.state'(s, m) {
      s.providerAccountsState = m.state;
      return ['providerAccountsState'];
    },
  },
  enter(s, v) {
    s.providerAccounts = v.providerAccounts ?? NONE;
    return ['providerAccounts'];
  },
};
