// What the office knows about each provider whose logins it keeps apart (see ACCOUNT_PROVIDERS):
// the env var its config folder goes in, the credentials a worker on another login mustn't get, a
// token in place of a login, and how to ask who it's signed in as.
import os from 'node:os';
import path from 'node:path';
import type { AccountProvider } from '../../shared/protocol.js';
import { API_KEY, CLAUDE_TOKEN, CLAUDE_VARS, claudeStatus, run, seedClaude, trustLikeOffice } from '../logins.js';

type Env = Record<string, string>;

export interface AccountKind {
  /** What it's called in the window and in toasts. */
  label: string;
  /** Its command, to look and sign in with. */
  bin: string;
  /** The env var its config folder (where its login lives) goes in. */
  dirVar: string;
  /** Its config folder when that var isn't set: the machine's own login. */
  home(): string;
  /** Its credentials the office's environment may carry, the folder's var among them: a worker on an account gets none of them but its own. */
  scrub: readonly string[];
  /** The env var a pasted token goes in, or why it isn't one of its tokens. None: it takes no token. */
  token?(token: string): { var: string; name: string } | string;
  /** Readies a config folder for a worker starting in `dirs` (none when it's only being looked at). */
  ready?(dir: string, base: Env, dirs: string[]): void;
  /** Who it's signed in as with `env`, or why it can't say. `pasted` names the token `env` carries. */
  status(bin: string, env: Env, pasted?: string): Promise<{ who?: string; error?: string }>;
  /** The office can run its login and hand the browser the page to open. */
  signsIn: boolean;
  /** What to type in a shell on a floor that runs on it, to sign it in there. */
  shellLogin: string;
}

export const KINDS: Record<AccountProvider, AccountKind> = {
  claude: {
    label: 'Claude',
    bin: 'claude',
    dirVar: 'CLAUDE_CONFIG_DIR',
    home: () => path.join(os.homedir(), '.claude'),
    scrub: CLAUDE_VARS,
    token: (t) => (CLAUDE_TOKEN.test(t) ? (API_KEY.test(t) ? { var: 'ANTHROPIC_API_KEY', name: 'an API key' } : { var: 'CLAUDE_CODE_OAUTH_TOKEN', name: 'a token from claude setup-token' }) : "That isn't a token from `claude setup-token` (sk-ant-oat01-…) or an Anthropic API key (sk-ant-api03-…)"),
    ready(dir, base, dirs) {
      seedClaude(dir);
      if (dirs.length) trustLikeOffice(base, dir, dirs);
    },
    status: claudeStatus,
    signsIn: true,
    shellLogin: 'claude auth login',
  },
  codex: {
    label: 'Codex',
    bin: 'codex',
    dirVar: 'CODEX_HOME',
    home: () => path.join(os.homedir(), '.codex'),
    scrub: ['CODEX_HOME', 'OPENAI_API_KEY', 'CODEX_API_KEY'],
    async status(bin, env) {
      // `codex login status` exits 0 signed in ("Logged in using ChatGPT"), 1 signed out.
      const r = await run(bin, ['login', 'status'], env);
      const said = (r.out.split('\n').find((l) => l.trim()) ?? r.last).trim();
      if (r.code === 0) return { who: said || 'Signed in' };
      return { error: !said || /not logged in/i.test(said) ? undefined : said };
    },
    signsIn: false,
    shellLogin: 'codex login',
  },
};

/** The same folder, however it was written. */
export const sameDir = (a: string, b: string) => path.resolve(a) === path.resolve(b);

/** A folder for showing: ~/… under the home folder. */
export function tilde(dir: string): string {
  const home = os.homedir();
  return dir === home ? '~' : dir.startsWith(home + path.sep) ? `~${dir.slice(home.length)}` : dir;
}

/** A folder someone typed, made absolute: ~ is the home folder. Undefined when it's relative. */
export function untilde(raw: string): string | undefined {
  const t = raw.trim();
  const dir = t === '~' ? os.homedir() : t.startsWith('~/') ? path.join(os.homedir(), t.slice(2)) : t;
  return path.isAbsolute(dir) ? path.resolve(dir) : undefined;
}
