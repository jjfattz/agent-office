// The floor's GitHub boards: refreshing them, opening issues, and merging, commenting on, closing,
// labeling and editing issues and pull requests, as whoever asks (see withGitHub).
import type { GitHubClientMsg } from '../../../shared/protocol.js';
import { GH_COMMENT_MAX, GH_LABEL_MAX, GH_TITLE_MAX } from '../../../shared/protocol.js';
import { num, str } from '../../office/input.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const issuesView: ViewPieces['issues'] = (_ctx, floor) => floor?.github.issues ?? { items: [], fetchedAt: 0, loading: false };
export const pullsView: ViewPieces['pulls'] = (_ctx, floor) => floor?.github.pulls ?? { items: [], fetchedAt: 0, loading: false };

export const githubHandlers = {
  'gh.refresh'(ctx, c) {
    void ctx.floorOf(c)?.github.refresh();
  },
  'gh.merge'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const n = num(msg.number);
    const method = (['squash', 'merge', 'rebase'] as const).find((m) => m === msg.method);
    if (!floor || !Number.isSafeInteger(n) || n <= 0 || !method) return;
    ctx.withGitHub(
      c,
      (as) =>
        void floor.github.merge(n, method, msg.deleteBranch === true, msg.auto === true, as).then((error) => {
          ctx.sendTo(c, { t: 'gh.merged', number: n, error });
          if (error) return;
          ctx.toastFloor(floor, msg.auto ? `${who} set PR #${n} to merge once its checks pass` : `🎉 ${who} merged PR #${n}`);
          // An auto-merge rings once GitHub gets round to it and the boards see it merged.
          if (!msg.auto) floor.merged(n, who);
        }),
      (error) => ctx.sendTo(c, { t: 'gh.merged', number: n, error }),
    );
  },
  'gh.comment'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const n = num(msg.number);
    const kind = msg.kind === 'pull' ? 'pull' : 'issue';
    if (!floor || !Number.isSafeInteger(n) || n <= 0) return;
    const body = typeof msg.body === 'string' ? msg.body : '';
    // Refused rather than cut short: a comment that silently lost its end would read as finished.
    const invalid = !body.trim() ? 'The comment is empty' : body.length > GH_COMMENT_MAX ? `GitHub takes comments of up to ${GH_COMMENT_MAX} characters` : '';
    if (invalid) {
      ctx.sendTo(c, { t: 'gh.commented', kind, number: n, error: invalid });
      return;
    }
    ctx.withGitHub(
      c,
      (as) =>
        void floor.github.comment(kind, n, body, as).then((r) => {
          ctx.sendTo(c, { t: 'gh.commented', kind, number: n, ...r });
          if (r.comment) ctx.toastFloor(floor, `💬 ${who} commented on ${kind === 'pull' ? 'PR' : 'issue'} #${n}`);
        }),
      (error) => ctx.sendTo(c, { t: 'gh.commented', kind, number: n, error }),
    );
  },
  'gh.close'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const n = num(msg.number);
    const kind = msg.kind === 'issue' || msg.kind === 'pull' ? msg.kind : undefined;
    if (!floor || !Number.isSafeInteger(n) || n <= 0 || !kind) return;
    const reason = msg.reason === 'not planned' ? 'not planned' : 'completed';
    ctx.withGitHub(
      c,
      (as) =>
        void floor.github.close(kind, n, { comment: str(msg.comment, 20000).trim() || undefined, reason, deleteBranch: msg.deleteBranch === true }, as).then((error) => {
          ctx.sendTo(c, { t: 'gh.closed', kind, number: n, error });
          if (error) return;
          if (kind === 'pull') return ctx.toastFloor(floor, `${who} closed PR #${n} without merging`);
          // Nobody should be seated for an issue that's closed.
          const dropped = floor.queue.dropIssue(n);
          ctx.toastFloor(floor, `${who} closed issue #${n}${reason === 'not planned' ? ' as not planned' : ''}${dropped ? ' and took it off the queue' : ''}`);
        }),
      (error) => ctx.sendTo(c, { t: 'gh.closed', kind, number: n, error }),
    );
  },
  'gh.labels'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const n = num(msg.number);
    const kind = msg.kind === 'issue' || msg.kind === 'pull' ? msg.kind : undefined;
    if (!floor || !Number.isSafeInteger(n) || n <= 0 || !kind) return;
    const names = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map((l) => str(l, GH_LABEL_MAX + 1)).filter((l) => l && l.length <= GH_LABEL_MAX))].slice(0, 100);
    const add = names(msg.add);
    const remove = names(msg.remove).filter((l) => !add.includes(l));
    if (!add.length && !remove.length) {
      ctx.sendTo(c, { t: 'gh.labeled', kind, number: n, error: 'No labels to change' });
      return;
    }
    ctx.withGitHub(
      c,
      (as) =>
        void floor.github.setLabels(kind, n, add, remove, as).then((r) => {
          ctx.sendTo(c, { t: 'gh.labeled', kind, number: n, ...r });
          if (r.labels) ctx.toastFloor(floor, `🏷️ ${who} labeled ${kind === 'pull' ? 'PR' : 'issue'} #${n}: ${[...add.map((l) => `+${l}`), ...remove.map((l) => `−${l}`)].join(' ')}`);
        }),
      (error) => ctx.sendTo(c, { t: 'gh.labeled', kind, number: n, error }),
    );
  },
  'gh.edit'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const n = num(msg.number);
    if (!floor || !Number.isSafeInteger(n) || n <= 0) return;
    const title = typeof msg.title === 'string' ? msg.title.trim() : '';
    const body = typeof msg.body === 'string' ? msg.body : '';
    // Refused rather than cut short, as a comment is.
    const invalid = !title ? 'The issue needs a title' : title.length > GH_TITLE_MAX ? `GitHub takes titles of up to ${GH_TITLE_MAX} characters` : body.length > GH_COMMENT_MAX ? `GitHub takes descriptions of up to ${GH_COMMENT_MAX} characters` : '';
    if (invalid) {
      ctx.sendTo(c, { t: 'gh.edited', number: n, error: invalid });
      return;
    }
    ctx.withGitHub(
      c,
      (as) =>
        void floor.github.edit(n, title, body, as).then((r) => {
          ctx.sendTo(c, { t: 'gh.edited', number: n, ...r });
          if (!r.error) ctx.toastFloor(floor, `✏️ ${who} edited issue #${n}`);
        }),
      (error) => ctx.sendTo(c, { t: 'gh.edited', number: n, error }),
    );
  },
  'gh.create'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const id = str(msg.id, 64);
    if (!floor || !id) return;
    const title = typeof msg.title === 'string' ? msg.title.trim() : '';
    const body = typeof msg.body === 'string' ? msg.body : '';
    const labels = [...new Set((Array.isArray(msg.labels) ? msg.labels : []).map((l) => str(l, GH_LABEL_MAX + 1)).filter((l) => l && l.length <= GH_LABEL_MAX))].slice(0, 100);
    // Refused rather than cut short, as an edit is.
    const invalid = !title ? 'The issue needs a title' : title.length > GH_TITLE_MAX ? `GitHub takes titles of up to ${GH_TITLE_MAX} characters` : body.length > GH_COMMENT_MAX ? `GitHub takes descriptions of up to ${GH_COMMENT_MAX} characters` : '';
    if (invalid) {
      ctx.sendTo(c, { t: 'gh.created', id, error: invalid });
      return;
    }
    ctx.withGitHub(
      c,
      (as) =>
        void floor.github.create(title, body, labels, as).then((r) => {
          ctx.sendTo(c, { t: 'gh.created', id, ...r });
          if (r.issue) ctx.toastFloor(floor, `📝 ${who} opened issue #${r.issue.number}: ${r.issue.title}`);
        }),
      (error) => ctx.sendTo(c, { t: 'gh.created', id, error }),
    );
  },
} satisfies HandlerMap<GitHubClientMsg>;
