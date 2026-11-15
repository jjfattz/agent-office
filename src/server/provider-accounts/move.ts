// Moving a worker already at its desk to another provider account. A worker keeps the account it
// was hired on (see ProviderAccounts), so one hired before its floor picked an account, or on the
// wrong one, stays there until it's moved: its conversation is copied into the new account's folder
// and it carries on there (see workers/account.ts).
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { isAccountProvider, type AccountProvider } from '../../shared/protocol.js';
import type { SignIns } from '../signins.js';
import type { WorkerManager } from '../workers/manager.js';
import type { ProviderAccounts } from './index.js';
import { KINDS, sameDir } from './kinds.js';
import { theirOwn } from './run-as.js';

/** A session id that's safe to look for in a folder by name. */
const SESSION = /^[\w-]{1,160}$/;

/**
 * Copies `provider`'s conversation `id` from config folder `from` into `to`, over any older copy
 * there (it may have been moved there before). Whether there was any of it to copy.
 */
export function carryConversation(provider: AccountProvider, from: string, to: string, id: string): boolean {
  if (!SESSION.test(id) || sameDir(from, to)) return false;
  const found = KINDS[provider].conversation(from, id);
  for (const rel of found) {
    const dest = path.join(to, rel);
    mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    cpSync(path.join(from, rel), dest, { recursive: true, force: true });
  }
  return found.length > 0;
}

/**
 * Puts worker `wid` of `workers` on account `id` (null: the machine's own login), or says why it
 * can't. Moving it where it already is does nothing.
 */
export function moveWorker(accounts: ProviderAccounts, signins: SignIns, workers: WorkerManager, wid: string, id: string | null): string | undefined {
  const info = workers.get(wid);
  if (!info) return 'No such worker';
  const provider = info.provider;
  if (info.kind !== 'agent' || !isAccountProvider(provider)) return `${info.name} doesn't run Claude or Codex, so it has no provider account to change`;
  if (id !== null && accounts.get(id)?.provider !== provider) return 'No such account';
  if ((info.account ?? null) === id) return undefined;
  if (theirOwn(signins, workers.ownerOf(wid), provider)) return `${info.name} runs on ${info.createdBy}’s own Claude sign-in, which no provider account stands in for`;
  const from = accounts.folder(info.account, provider);
  const to = accounts.folder(id ?? undefined, provider);
  return workers.moveAccount(wid, id ?? undefined, (session) => {
    if (!from || !to || !session) return undefined;
    try {
      return carryConversation(provider, from, to, session) ? [from, to] : undefined;
    } catch (err) {
      // It starts a fresh conversation on the new account instead (see ProviderAdapter.freshIfResumeFails).
      console.error(`agent-office: couldn't copy ${info.name}'s conversation into ${to}: ${(err as Error).message}`);
      return undefined;
    }
  });
}
