// Signing Claude Code in from the office, and reading what it and other CLIs say: what everyone's own
// sign-ins (signins.ts) and the provider accounts (provider-accounts/) both run.
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as pty from '@lydell/node-pty';

/** Claude's credentials the office's own environment may carry. None of them reach anything run on another login. */
export const CLAUDE_VARS = ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR'];
/** From `claude setup-token` (sk-ant-oat01-…), or an Anthropic API key (sk-ant-api03-…). */
export const CLAUDE_TOKEN = /^sk-ant-[a-z]+\d*-[A-Za-z0-9_-]{20,}$/;
export const API_KEY = /^sk-ant-api/;
/** GitHub's one-time codes last 15 minutes; a Claude sign-in link gets as long. */
export const FLOW_MS = 15 * 60_000;
const RUN_TIMEOUT_MS = 30_000;

/** A sign-in the office is running for someone. */
export interface Flow {
  stop(): void;
  /** Types into it: the code from Claude's sign-in page. */
  write?(data: string): void;
}

export interface ClaudeLoginEvents {
  /** The page to open came up. */
  url(url: string): void;
  /** The code sent back didn't take, and it waits for another: what it said. */
  rejected(said: string): void;
  /** It ended: signed in, or not, and the last thing it said. */
  exit(ok: boolean, said: string): void;
}

/**
 * Runs `claude auth login` with `env` (whose CLAUDE_CONFIG_DIR says where the login goes) and reads
 * the page to open off its screen. The code that page shows goes back in through `write`
 * (see loginCode). Returns why it couldn't start.
 */
export function claudeLogin(bin: string, env: Record<string, string>, cwd: string, on: ClaudeLoginEvents): Required<Flow> | string {
  let p: pty.IPty;
  try {
    // BROWSER=true: Claude "opens" the page with the `true` command and just prints it, for the
    // browser to show. Wide, so the link comes out on one line.
    p = pty.spawn(bin, ['auth', 'login', '--claudeai'], { name: 'xterm-256color', cols: 4000, rows: 40, cwd, env: { ...env, BROWSER: 'true', TERM: 'xterm-256color' } });
  } catch (err) {
    return `Couldn't start Claude Code's sign-in: ${(err as Error).message}`;
  }
  let out = '';
  let url: string | undefined;
  /** Where the output after the code was sent starts, to tell a wrong code apart from the first ask. */
  let sentAt = -1;
  const flow = {
    stop: () => {
      try {
        p.kill();
      } catch {
        // already gone
      }
    },
    write: (data: string) => {
      sentAt = out.length;
      p.write(data);
    },
  };
  const timer = setTimeout(flow.stop, FLOW_MS);
  p.onData((d) => {
    out = (out + d).slice(-50_000);
    if (!url) {
      url = loginUrl(out);
      if (url) on.url(url);
    } else if (sentAt >= 0 && /error|invalid|expired|failed/i.test(plain(out.slice(sentAt)))) {
      // Still running after complaining: the code didn't take, and it waits for another.
      const said = lastWords(out.slice(sentAt));
      sentAt = -1;
      on.rejected(said);
    }
  });
  p.onExit(({ exitCode }) => {
    clearTimeout(timer);
    on.exit(exitCode === 0, lastWords(out));
  });
  return flow;
}

/**
 * The sign-in page `claude auth login` printed so far, once all of it is there. A terminal hands its
 * output over a kilobyte at a time and the link is longer than that, so it can come in two pieces:
 * the first piece alone is the page with the end of its `state` cut off, which Claude's sign-in
 * turns away ("Invalid request format"). The link is whole once something comes after it.
 */
export function loginUrl(out: string): string | undefined {
  return /https:\/\/\S*oauth\/authorize\?\S+(?=\s)/.exec(plain(out))?.[0];
}

/** The code from Claude's sign-in page, as it's typed back in; undefined when it doesn't look like one. */
export function loginCode(code: string): string | undefined {
  const clean = code.trim();
  return /^[A-Za-z0-9#_.~-]{8,2048}$/.test(clean) ? `${clean}\r` : undefined;
}
export const BAD_CODE = "That doesn't look like the code from Claude's sign-in page";

/**
 * Who Claude Code in `env` is signed in as ("you@example.com · Max"), or why it can't say. `pasted`
 * names a token the environment carries, which is taken on trust: whether it works shows when a worker starts.
 */
export async function claudeStatus(bin: string, env: Record<string, string>, pasted?: string): Promise<{ who?: string; error?: string }> {
  const r = await run(bin, ['auth', 'status', '--json'], env);
  let status: { loggedIn?: boolean; email?: string; subscriptionType?: string } = {};
  try {
    status = JSON.parse(r.out);
  } catch {
    // older Claude Code, or it failed: nothing to go on
  }
  const plan = status.subscriptionType ? ` · ${status.subscriptionType[0].toUpperCase()}${status.subscriptionType.slice(1)}` : '';
  const who = status.loggedIn || pasted ? `${status.email ?? pasted ?? 'a token'}${plan}` : undefined;
  // Signed out, `claude auth status` still answers (and exits 1); anything else went wrong.
  return who ? { who } : { error: r.out ? undefined : r.last || undefined };
}

/** Claude's own settings in a config folder of the office's: its first-run questions already answered. */
export function seedClaude(dir: string, change?: (c: any) => void) {
  const file = path.join(dir, '.claude.json');
  let c: any = {};
  try {
    c = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // new
  }
  const before = JSON.stringify(c);
  c.hasCompletedOnboarding = true;
  change?.(c);
  if (JSON.stringify(c) === before) return;
  try {
    writeFileSync(file, JSON.stringify(c, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error(`agent-office: couldn't write ${file}: ${(err as Error).message}`);
  }
}

/**
 * Folders the office's own Claude (in `base`) trusts, the Claude in `configDir` trusts too: they're
 * the same projects. `dirs` are a project and where a worker starts in it (its worktree), trusted
 * together once the project is.
 */
export function trustLikeOffice(base: Record<string, string>, configDir: string, dirs: string[]) {
  let office: any;
  try {
    office = JSON.parse(readFileSync(base.CLAUDE_CONFIG_DIR ? path.join(base.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json'), 'utf8'));
  } catch {
    return;
  }
  const trusted = (d: string) => office?.projects?.[d]?.hasTrustDialogAccepted === true;
  if (!dirs.some(trusted)) return;
  seedClaude(configDir, (c) => {
    c.projects ??= {};
    for (const d of dirs) c.projects[d] = { ...c.projects[d], hasTrustDialogAccepted: true };
  });
}

/** Terminal output as plain text: no colors, links or cursor moves. */
export function plain(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/\r\n?/g, '\n');
}

/** The last thing a command said, minus the link and the prompt, for an error line. */
export function lastWords(s: string): string {
  const lines = plain(s)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/https?:\/\/|paste code|opening browser|press enter/i.test(l));
  return (lines.at(-1) ?? '').slice(0, 300);
}

/** Runs a command to the end; never rejects. `last` is the last line it said on stderr (or stdout). */
export function run(cmd: string, args: string[], env: Record<string, string>, input?: string): Promise<{ code: number; out: string; last: string }> {
  return new Promise((resolve) => {
    const p = execFile(cmd, args, { env, timeout: RUN_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      const e = err as { code?: number | string } | null;
      const code = !e ? 0 : typeof e.code === 'number' ? e.code : -1;
      const last = lastWords(stderr || (err && !stdout ? err.message : ''));
      resolve({ code, out: stdout.trim(), last });
    });
    if (input !== undefined) p.stdin?.end(input);
    else p.stdin?.end();
  });
}
