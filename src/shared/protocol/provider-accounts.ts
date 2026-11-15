// Provider accounts: more than one login for an agent on one machine (a work Claude and a personal
// one, say), and which of them each floor's workers run on (see server/provider-accounts/).

/** The providers whose logins the office can keep apart: each keeps its login in a folder an env var points at. */
export const ACCOUNT_PROVIDERS = ['claude', 'codex'] as const;
export type AccountProvider = (typeof ACCOUNT_PROVIDERS)[number];

export function isAccountProvider(v: unknown): v is AccountProvider {
  return (ACCOUNT_PROVIDERS as readonly unknown[]).includes(v);
}

/** The longest name an account may have. */
export const PROVIDER_ACCOUNT_NAME_MAX = 32;

/** How an account signs in: a config folder of its own (one the office made, or one you already use), or a pasted token. */
export type ProviderAccountHow = 'folder' | 'token';

/** One account, by name only: what everyone on a floor is told, to label the floor and its workers. */
export interface ProviderAccountName {
  id: string;
  provider: AccountProvider;
  name: string;
}

/** What everyone on a floor knows: the accounts' names, and which one this floor runs each provider on. */
export interface ProviderAccountsView {
  accounts: ProviderAccountName[];
  /** This floor's account for each provider. None: the office machine's own login. */
  floor: Partial<Record<AccountProvider, string>>;
}

/** One account in full, for admins. */
export interface ProviderAccountInfo extends ProviderAccountName {
  how: ProviderAccountHow;
  /** Its folder (~/… under the home folder), for a folder account. */
  dir?: string;
  /** The office made the folder, and deletes it with the account. */
  made?: boolean;
  /** ok: signed in. none: not yet. busy: signing in, or being looked at. */
  status: 'ok' | 'none' | 'busy';
  /** Who it's signed in as: an email and plan for Claude. */
  who?: string;
  error?: string;
  /** The office is signing it in: the page to open, and whether the code was sent back. */
  pending?: { url?: string; sent?: boolean };
  /** It can be signed in from here (the office runs the provider's own login). */
  signIn: boolean;
  /** The floors that run on it, by name. */
  floors: string[];
  /** The workers on it now, across the building, by name: it can't be removed while there are any. */
  workers: string[];
}

export interface ProviderAccountsState {
  accounts: ProviderAccountInfo[];
  /** Where the machine's own login for each provider lives, for the "office's own" choice. */
  own: Record<AccountProvider, string>;
}

export type ProviderAccountsClientMsg =
  /** The accounts in full, looked at afresh (admins only, like the rest). */
  | { t: 'providerAccounts.get' }
  /** A new account: a folder the office makes, a folder you already use (`dir`), or a token. */
  | { t: 'providerAccounts.add'; provider: AccountProvider; name: string; how: 'new' | ProviderAccountHow; dir?: string; token?: string }
  | { t: 'providerAccounts.rename'; id: string; name: string }
  | { t: 'providerAccounts.remove'; id: string }
  /** What the floor you're on runs `provider` on from now on: an account, or the machine's own login (null). */
  | { t: 'providerAccounts.use'; provider: AccountProvider; id: string | null }
  /** Sign a folder account in from the office: it runs the login and hands back the page to open. */
  | { t: 'providerAccounts.signin'; id: string }
  /** The code the sign-in page gave you. */
  | { t: 'providerAccounts.code'; id: string; code: string }
  | { t: 'providerAccounts.cancel'; id: string };

export type ProviderAccountsServerMsg =
  /** To everyone on a floor, whenever the accounts or the floor's picks change. */
  | { t: 'providerAccounts'; view: ProviderAccountsView }
  /** To admins, when asked and whenever an account changes. */
  | { t: 'providerAccounts.state'; state: ProviderAccountsState };
