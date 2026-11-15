import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ACCOUNT_PROVIDERS, PROVIDER_ACCOUNT_NAME_MAX, isAccountProvider, type AccountProvider, type ProviderAccountHow, type ProviderAccountInfo, type ProviderAccountsState, type ProviderAccountsView } from '../../shared/protocol.js';
import { BAD_CODE, claudeLogin, loginCode, run, type Flow } from '../logins.js';
import { KINDS, sameDir, tilde, untilde } from './kinds.js';

/*
 * Provider accounts
 * -----------------
 * More than one login for an agent on the office's machine: a work Claude and a personal one, say.
 * Each account is a config folder of its own (CLAUDE_CONFIG_DIR, CODEX_HOME), one the office makes
 * under .agent-office/provider-accounts/<id>/ or one you already use, or a pasted token on the
 * machine's own settings. Each floor picks which account its workers run each provider on, so going
 * to another project's floor is going to that project's account, with nothing to switch.
 *
 * A worker keeps the account it was hired on for good (WorkerInfo.account): its conversations are
 * kept in that account's folder, so resuming one anywhere else would start it over. Changing a
 * floor's account changes the workers hired after that. A 🐚 shell has no conversation to keep, and
 * runs on whatever its floor's accounts are each time it starts.
 *
 * Nothing global changes: workers on different accounts run side by side. Someone with an account
 * of their own on the office (see signins.ts) who signed in to their own Claude keeps running their
 * Claude workers on it; provider accounts stand in for the office machine's own login only.
 */

/** An account as it's kept, in .agent-office/provider-accounts.json (mode 600: it can hold tokens). */
interface Saved {
  id: string;
  provider: AccountProvider;
  name: string;
  how: ProviderAccountHow;
  /** Its config folder, absolute, for a folder account. */
  dir?: string;
  /** The office made the folder: removing the account signs it out and deletes it. */
  made?: boolean;
  token?: string;
  /** Who the last look found it signed in as, to show before the next one. */
  who?: string;
}

interface File {
  accounts: Saved[];
  /** Each floor's account for each provider, by floor id. */
  floors: Record<string, Partial<Record<AccountProvider, string>>>;
}

/** What's going on with an account right now: a look at who it is, or a sign-in. */
interface Live {
  status: ProviderAccountInfo['status'];
  error?: string;
  pending?: ProviderAccountInfo['pending'];
  flow?: Required<Flow>;
  looking?: Promise<void>;
}

/** What the accounts need of the building around them. */
export interface ProviderAccountsHooks {
  /** A floor's name, while it's open. */
  floorName(id: string): string | undefined;
  /** The workers on an account, across the building, by name. */
  workersOn(accountId: string): string[];
  /** The accounts or a floor's picks changed: tell whoever needs to know. */
  changed(): void;
}

const ID = /^[0-9a-f]{12}$/;

/** A name with its whitespace collapsed and its control characters dropped. */
const cleanName = (v: unknown) =>
  typeof v === 'string'
    ? v
        .replace(/[\p{C}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, PROVIDER_ACCOUNT_NAME_MAX)
    : '';

const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

export class ProviderAccounts {
  private file: string;
  private root: string;
  private data: File = { accounts: [], floors: {} };
  private live = new Map<string, Live>();

  constructor(
    dataDir: string,
    /** Each provider's command, or null when it isn't installed. */
    private bins: Record<AccountProvider, string | null>,
    /** The office's own environment, which every account's is built on. */
    private base: () => Record<string, string>,
    private hooks: ProviderAccountsHooks,
  ) {
    this.file = path.join(dataDir, 'provider-accounts.json');
    this.root = path.join(dataDir, 'provider-accounts');
    this.load();
    // A sign-in still waiting for its code shouldn't outlive the office.
    process.once('exit', () => this.shutdown());
  }

  /** What everyone on floor `floor` is told. */
  view(floor: string | undefined): ProviderAccountsView {
    return {
      accounts: this.data.accounts.map(({ id, provider, name }) => ({ id, provider, name })),
      floor: floor ? this.picks(floor) : {},
    };
  }

  /** Every account in full, for admins. */
  state(): ProviderAccountsState {
    const picks = Object.entries(this.data.floors);
    return {
      accounts: this.data.accounts.map((a) => {
        const l = this.live.get(a.id);
        return {
          id: a.id,
          provider: a.provider,
          name: a.name,
          how: a.how,
          ...(a.dir ? { dir: tilde(a.dir) } : {}),
          ...(a.made ? { made: true } : {}),
          status: l?.status ?? (a.who ? 'ok' : 'none'),
          ...(a.who && l?.status !== 'none' ? { who: a.who } : {}),
          ...(l?.error ? { error: l.error } : {}),
          ...(l?.pending ? { pending: l.pending } : {}),
          signIn: a.how === 'folder' && KINDS[a.provider].signsIn && !!this.bins[a.provider],
          floors: picks.filter(([, p]) => p[a.provider] === a.id).map(([f]) => this.hooks.floorName(f)).filter((n): n is string => !!n),
          workers: this.hooks.workersOn(a.id),
        };
      }),
      own: Object.fromEntries(ACCOUNT_PROVIDERS.map((p) => [p, tilde(this.base()[KINDS[p].dirVar] || KINDS[p].home())])) as ProviderAccountsState['own'],
    };
  }

  /** The account `id`, while it's there. */
  get(id: string | undefined): Saved | undefined {
    return id ? this.data.accounts.find((a) => a.id === id) : undefined;
  }

  /** The account floor `floor` runs `provider` on, if it picked one. */
  pick(floor: string, provider: AccountProvider): string | undefined {
    return this.picks(floor)[provider];
  }

  /**
   * A new account: a folder the office makes ('new'), a folder you already use (`dir`), or a token
   * on the machine's own settings. Returns it, or what's wrong.
   */
  add(provider: unknown, rawName: unknown, how: unknown, rawDir?: unknown, rawToken?: unknown): Saved | string {
    if (!isAccountProvider(provider)) return 'The office can only keep Claude and Codex accounts apart';
    const kind = KINDS[provider];
    const name = cleanName(rawName);
    if (!name) return 'Give the account a name';
    if (this.data.accounts.some((a) => a.provider === provider && sameName(a.name, name))) return `There's already a ${kind.label} account called ${name}`;
    const id = randomBytes(6).toString('hex');
    const a: Saved = { id, provider, name, how: how === 'token' ? 'token' : 'folder' };
    if (how === 'new') {
      a.dir = path.join(this.root, id);
      a.made = true;
      try {
        mkdirSync(a.dir, { recursive: true, mode: 0o700 });
      } catch (err) {
        return `Couldn't make its folder: ${(err as Error).message}`;
      }
    } else if (how === 'folder') {
      const dir = typeof rawDir === 'string' ? untilde(rawDir.slice(0, 4096)) : undefined;
      if (!dir) return 'Give the whole path of the folder, like ~/.claude-work';
      try {
        if (!statSync(dir).isDirectory()) return `${tilde(dir)} isn't a folder`;
      } catch {
        return `There's no folder at ${tilde(dir)}`;
      }
      const taken = this.data.accounts.find((o) => o.provider === provider && o.dir && sameDir(o.dir, dir));
      if (taken) return `${taken.name} already runs on ${tilde(dir)}`;
      a.dir = dir;
    } else if (how === 'token') {
      const token = typeof rawToken === 'string' ? rawToken.trim().slice(0, 4096) : '';
      const t = kind.token?.(token);
      if (!t) return `${kind.label} accounts sign in with a folder of their own, not a token`;
      if (typeof t === 'string') return t;
      a.token = token;
    } else return 'Pick how the account signs in';
    this.data.accounts.push(a);
    this.save();
    this.hooks.changed();
    void this.look(id);
    return a;
  }

  rename(id: string, rawName: unknown): string | undefined {
    const a = this.get(id);
    if (!a) return 'No such account';
    const name = cleanName(rawName);
    if (!name) return 'Give the account a name';
    if (this.data.accounts.some((o) => o !== a && o.provider === a.provider && sameName(o.name, name))) return `There's already a ${KINDS[a.provider].label} account called ${name}`;
    a.name = name;
    this.save();
    this.hooks.changed();
    return undefined;
  }

  /**
   * Takes an account away, and any floor that ran on it goes back to the machine's own login. Not
   * while a worker is on it: it would lose its conversations. A folder the office made goes too.
   */
  remove(id: string): string | undefined {
    const a = this.get(id);
    if (!a) return 'No such account';
    const workers = this.hooks.workersOn(id);
    if (workers.length) return `${workers.join(', ')} ${workers.length === 1 ? 'is' : 'are'} still on ${a.name}: send ${workers.length === 1 ? 'them' : 'them all'} home first`;
    this.stopFlow(id);
    // Only ever a folder the office made for it, never the machine's own login or one of yours.
    const dir = a.made && a.dir && ID.test(id) && sameDir(path.dirname(a.dir), this.root) ? a.dir : undefined;
    const env = dir ? this.envOf(a, []) : undefined;
    this.live.delete(id);
    this.data.accounts = this.data.accounts.filter((o) => o !== a);
    for (const picks of Object.values(this.data.floors)) if (picks[a.provider] === id) delete picks[a.provider];
    this.save();
    this.hooks.changed();
    if (dir && env) {
      const bin = this.bins[a.provider];
      const signedIn = env[KINDS[a.provider].dirVar] === dir;
      // On a Mac, Claude keeps the login in the keychain, not the folder: sign out so it goes too.
      const out = bin && signedIn && a.provider === 'claude' ? run(bin, ['auth', 'logout'], env) : Promise.resolve();
      void out.finally(() => {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch (err) {
          console.error(`agent-office: couldn't delete ${dir}: ${(err as Error).message}`);
        }
      });
    }
    return undefined;
  }

  /** What floor `floor` runs `provider` on from now on: account `id`, or the machine's own login (null). */
  use(floor: string, provider: unknown, id: string | null): string | undefined {
    if (!isAccountProvider(provider)) return 'The office can only keep Claude and Codex accounts apart';
    if (id !== null) {
      const a = this.get(id);
      if (!a || a.provider !== provider) return 'No such account';
    }
    const picks = (this.data.floors[floor] ??= {});
    if ((picks[provider] ?? null) === id) return undefined;
    if (id === null) delete picks[provider];
    else picks[provider] = id;
    if (!Object.keys(picks).length) delete this.data.floors[floor];
    this.save();
    this.hooks.changed();
    return undefined;
  }

  /**
   * Puts account `id` in place of the machine's own login in `env` (changed in place). `dirs` are
   * where a worker is about to start. Says why it can't, when the account is gone.
   */
  apply(id: string, env: Record<string, string>, dirs: string[]): string | undefined {
    const a = this.get(id);
    if (!a) return 'the provider account it was hired on is gone: send it home and hire another';
    const kind = KINDS[a.provider];
    const own = env[kind.dirVar];
    for (const k of kind.scrub) delete env[k];
    if (a.how === 'token' && a.token) {
      // The machine's own settings, on this token.
      if (own) env[kind.dirVar] = own;
      const t = kind.token?.(a.token);
      if (t && typeof t !== 'string') env[t.var] = a.token;
      return undefined;
    }
    if (!a.dir) return undefined;
    // The usual folder is the usual login: the provider looks elsewhere for it once it's been told the folder.
    if (sameDir(a.dir, kind.home())) return undefined;
    env[kind.dirVar] = a.dir;
    kind.ready?.(a.dir, this.base(), dirs);
    return undefined;
  }

  /** Puts each of floor `floor`'s accounts in `env` (a shell's), but the providers `skip` keeps. */
  applyFloor(floor: string, env: Record<string, string>, dirs: string[], skip: (p: AccountProvider) => boolean) {
    for (const [p, id] of Object.entries(this.picks(floor)) as [AccountProvider, string][]) if (!skip(p)) this.apply(id, env, dirs);
  }

  /** Looks at who each account (or just `id`) is signed in as. */
  look(id?: string): Promise<void> {
    const all = id ? [this.get(id)].filter((a): a is Saved => !!a) : this.data.accounts;
    return Promise.all(all.map((a) => this.lookAt(a))).then(() => undefined);
  }

  /** Signs folder account `id` in from the office; the page to open comes through state(). Returns why it can't. */
  signIn(id: string): string | undefined {
    const a = this.get(id);
    if (!a) return 'No such account';
    const kind = KINDS[a.provider];
    const bin = this.bins[a.provider];
    if (a.how !== 'folder' || !a.dir) return `${a.name} signs in with a token: remove it and add it again to change that`;
    if (!kind.signsIn) return `Sign ${a.name} in from a 🐚 shell on a floor that runs on it: type ${kind.shellLogin} there`;
    if (!bin) return `${kind.label} isn't installed where the office can run it`;
    this.stopFlow(id);
    const l = this.liveOf(id);
    const flow = claudeLogin(bin, this.envOf(a, []), a.dir, {
      url: (url) => {
        if (l.flow !== flow) return;
        l.pending = { url };
        this.hooks.changed();
      },
      rejected: (said) => {
        if (l.flow !== flow || !l.pending?.url) return;
        l.pending = { url: l.pending.url };
        l.error = said || "That code didn't work — copy it again, or start over";
        this.hooks.changed();
      },
      exit: (ok, said) => {
        if (l.flow !== flow) return;
        l.flow = undefined;
        l.pending = undefined;
        l.status = ok ? 'busy' : 'none';
        l.error = ok ? undefined : said || 'Signing in stopped before it finished';
        this.hooks.changed();
        void this.lookAt(a);
      },
    });
    if (typeof flow === 'string') return flow;
    Object.assign(l, { flow, status: 'busy', pending: {}, error: undefined });
    this.hooks.changed();
    return undefined;
  }

  /** The code the sign-in page showed, typed in where the login waits for it. */
  code(id: string, raw: string): string | undefined {
    const l = this.live.get(id);
    if (!l?.flow) return 'Start signing in first';
    const typed = loginCode(raw);
    if (!typed) return BAD_CODE;
    l.flow.write(typed);
    l.pending = { ...l.pending, sent: true };
    l.error = undefined;
    this.hooks.changed();
    return undefined;
  }

  cancel(id: string) {
    this.stopFlow(id);
    const a = this.get(id);
    if (a) void this.lookAt(a);
  }

  shutdown() {
    for (const id of this.live.keys()) this.stopFlow(id);
  }

  // ---------------------------------------------------------------------------

  /** Floor `floor`'s picks, only of the accounts that are still there. */
  private picks(floor: string): Partial<Record<AccountProvider, string>> {
    const picks = this.data.floors[floor] ?? {};
    return Object.fromEntries(Object.entries(picks).filter(([p, id]) => this.get(id)?.provider === p));
  }

  /** The environment `a`'s provider runs in: the office's own, on `a`. */
  private envOf(a: Saved, dirs: string[]): Record<string, string> {
    const env = this.base();
    this.apply(a.id, env, dirs);
    return env;
  }

  private liveOf(id: string): Live {
    let l = this.live.get(id);
    if (!l) this.live.set(id, (l = { status: this.get(id)?.who ? 'ok' : 'none' }));
    return l;
  }

  private stopFlow(id: string) {
    const l = this.live.get(id);
    const flow = l?.flow;
    if (!l || !flow) return;
    l.flow = undefined;
    l.pending = undefined;
    l.status = this.get(id)?.who ? 'ok' : 'none';
    flow.stop();
  }

  private lookAt(a: Saved): Promise<void> {
    const l = this.liveOf(a.id);
    if (l.looking) return l.looking;
    const bin = this.bins[a.provider];
    const kind = KINDS[a.provider];
    const pasted = a.how === 'token' && a.token ? kind.token?.(a.token) : undefined;
    const said: Promise<{ who?: string; error?: string }> = bin ? kind.status(bin, this.envOf(a, []), pasted && typeof pasted !== 'string' ? pasted.name : undefined) : Promise.resolve({ error: `${kind.label} isn't installed on the office's machine` });
    l.looking = said
      .then(({ who, error }) => {
        // Signing in meanwhile: that says how it went.
        if (l.flow || !this.get(a.id)) return;
        l.status = who ? 'ok' : 'none';
        l.error = error;
        if (a.who !== who) {
          a.who = who;
          this.save();
        }
      })
      .finally(() => {
        l.looking = undefined;
        this.hooks.changed();
      });
    return l.looking;
  }

  private load() {
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<File>;
      const accounts = (Array.isArray(saved.accounts) ? saved.accounts : []).filter(
        (a): a is Saved => !!a && typeof a.id === 'string' && ID.test(a.id) && isAccountProvider(a.provider) && typeof a.name === 'string' && (a.how === 'token' ? typeof a.token === 'string' : a.how === 'folder' && typeof a.dir === 'string' && path.isAbsolute(a.dir)),
      );
      const floors = saved.floors && typeof saved.floors === 'object' ? saved.floors : {};
      this.data = { accounts, floors };
    } catch {
      // none yet
    }
  }

  private save() {
    // Written whole and renamed into place, so nobody ever reads half a file.
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      console.error(`agent-office: couldn't save ${this.file}: ${(err as Error).message}`);
    }
  }
}
