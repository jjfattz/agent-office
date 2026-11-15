import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SCORES_KEPT, TITLES, checkScore, isTitle, noScores, type CabinetFrame, type HighScore, type Scores, type Title } from '../shared/cabinet.js';
import { REFEREES, type Referee, type Tally } from './games/index.js';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Best first; of two the same, the one that got there first. */
const byScore = (a: HighScore, b: HighScore) => b.score - a.score || a.at - b.at;

/** A game's score as it stands, for game `title`'s table. */
export type Entry = Omit<HighScore, 'at'> & { title: Title };

/**
 * The arcade's high-score tables, one a game: the whole building's, on every floor's cabinet, saved
 * in the office's .agent-office/arcade.json so they're still there after a restart.
 */
export class HighScores {
  private lists: Scores = noScores();
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'arcade.json');
    this.load();
  }

  top(title: Title): HighScore[] {
    return this.lists[title];
  }

  all(): Scores {
    return this.lists;
  }

  /**
   * Games' scores as they stand, saved together. Each goes on its game's table if it's good enough,
   * and the same game again only ever raises its own score (nobody else's). Says whether a table
   * changed, and which game just took first place from another one on its table, if one did.
   */
  record(...scores: Entry[]): { changed: boolean; first: { title: Title; score: HighScore } | null } {
    const next = { ...this.lists };
    for (const { title, ...s } of scores) {
      const list = next[title];
      const was = list.find((e) => e.game === s.game);
      if (s.score <= 0 || (was && (was.name !== s.name || s.score <= was.score))) continue;
      const after = [...list.filter((e) => e !== was), { ...s, at: Date.now() }].sort(byScore).slice(0, SCORES_KEPT);
      if (after.some((e) => e.game === s.game)) next[title] = after;
    }
    const changed = TITLES.filter((t) => next[t] !== this.lists[t]);
    if (!changed.length) return { changed: false, first: null };
    const leaders = this.lists;
    this.lists = next;
    this.save();
    const title = changed.find((t) => next[t][0].game !== leaders[t][0]?.game && scores.some((s) => s.title === t && s.game === next[t][0].game));
    return { changed: true, first: title ? { title, score: next[title][0] } : null };
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      // From before the cabinet had more than one game: BLOCKFALL's table on its own.
      const tables = Array.isArray(saved) ? { blockfall: saved } : saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
      for (const [title, list] of Object.entries(tables)) {
        if (!isTitle(title) || !Array.isArray(list)) continue;
        this.lists[title] = list
          .flatMap((e: Partial<HighScore> | null) => {
            const s = e && typeof e === 'object' ? checkScore(e) : null;
            if (!s || typeof e!.name !== 'string' || !e!.name || typeof e!.at !== 'number' || !Number.isFinite(e!.at)) return [];
            return [{ ...s, name: e!.name.slice(0, 24), color: typeof e!.color === 'string' && COLOR_RE.test(e!.color) ? e!.color : '#4f86f7', at: e!.at }];
          })
          .sort(byScore)
          .slice(0, SCORES_KEPT);
      }
    } catch {
      // a broken file just means fresh tables
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.lists, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}

/** New games a player can start in a row that go on the table, and how often (ms) another one can after that. */
export const GAME_BURST = 3;
export const GAME_EVERY = 20_000;
/** The high-score tables change (arcade.json written, every floor told) at most this often, in ms. */
export const RECORD_EVERY = 2000;
/** Games kept waiting for their players to come back to them, at most. */
const GAMES_KEPT = 100;
/** Players an Allowance keeps track of before it forgets the ones back to a full allowance. */
const PLAYERS_KEPT = 256;

/** Whose game it is (an account, or a name on the shared password) and how it shows on the table. */
export interface Player {
  owner: string;
  name: string;
  color: string;
  /** The connection it's played over: a new name on it is the same player to the office. */
  connection?: string;
}

/**
 * Something a player can only do so often: `burst` times in a row, and then again as it comes back
 * at `perSecond`. It's kept under each thing they go by (their account or name, and their
 * connection), so a new game, a new name or a new connection doesn't start them over.
 */
class Allowance {
  private readonly used = new Map<string, { left: number; at: number }>();

  constructor(
    private readonly burst: number,
    private readonly perSecond: number,
  ) {}

  /** What's left for the player going by `keys`: the least under any of them. */
  left(keys: readonly string[]): number {
    const now = Date.now();
    return Math.min(...keys.map((k) => this.leftAt(k, now)));
  }

  take(keys: readonly string[], n: number) {
    if (!n) return;
    const now = Date.now();
    for (const k of keys) this.used.set(k, { left: this.leftAt(k, now) - n, at: now });
    // Anyone back to a full allowance is the same as someone never seen.
    if (this.used.size > PLAYERS_KEPT) for (const k of [...this.used.keys()]) if (this.leftAt(k, now) >= this.burst) this.used.delete(k);
  }

  private leftAt(key: string, now: number): number {
    const u = this.used.get(key);
    return u ? Math.min(this.burst, u.left + ((now - u.at) / 1000) * this.perSecond) : this.burst;
  }
}

interface Game extends Player {
  id: string;
  title: Title;
  /** What its player goes by, for their allowances. */
  keys: string[];
  /** How far it had got, by its last frame that added up (see Referee). */
  tally: Tally;
  /** Someone's at it; otherwise it waits for its player to come back to it. */
  playing: boolean;
  /** One too many new games in a row: it's followed like any other, but it never goes on the table. */
  counts: boolean;
  /** The score last put up for the table. */
  offered: number;
}

/** What the office made of a frame: it added up, it didn't (and its game is off the table for good), or there's no game of theirs to follow. */
export type Verdict = 'ok' | 'void' | 'none';

/**
 * The office's side of the arcade. It starts every game, follows each one frame by frame and puts
 * the scores on the high-score tables itself, so a browser can't post a score it didn't play for.
 *
 * Each game's referee (server/games/) says whether a frame adds up after the last, and how much of
 * its player's pace it took: pieces landed, waves reached, across all their games of it. A game with
 * a frame that doesn't add up never goes on the table again, and nor does one started after
 * GAME_BURST others in a row. However many games end at once, the tables change at most every
 * RECORD_EVERY ms.
 */
export class Arcade {
  private readonly games = new Map<string, Game>();
  /** Scores waiting to go on the table, by game, with the floor each was played on. */
  private readonly pending = new Map<string, { score: Entry; floor: string }>();
  /** How fast each player is going at each game. */
  private readonly pace = Object.fromEntries(TITLES.map((t) => [t, new Allowance(REFEREES[t].burst, REFEREES[t].perSecond)])) as Record<Title, Allowance>;
  private readonly starts = new Allowance(GAME_BURST, 1000 / GAME_EVERY);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private recordedAt = -Infinity;

  constructor(
    private readonly table: HighScores,
    /** The tables changed. `first` is a game that just took first place on its table, and the floor it was played on. */
    private readonly changed: (first: { title: Title; score: HighScore; floor: string } | null) => void,
  ) {}

  /** `player` steps up to the cabinet to play `title`: back to game `resume` if it's theirs, of that, and waiting for them, else a new game. Says which. */
  start(title: Title, player: Player, resume?: unknown): string {
    const keys = [player.owner, ...(player.connection ? [`connection:${player.connection}`] : [])];
    const was = typeof resume === 'string' ? this.games.get(resume) : undefined;
    if (was && was.owner === player.owner && was.title === title && !was.playing) {
      was.playing = true;
      was.keys = keys;
      // Played again: the last to go when there are too many.
      this.games.delete(was.id);
      this.games.set(was.id, was);
      return was.id;
    }
    this.prune();
    const id = randomBytes(8).toString('hex');
    const counts = this.starts.left(keys) >= 1;
    if (counts) this.starts.take(keys, 1);
    this.games.set(id, { ...player, id, title, keys, tally: REFEREES[title].fresh(), playing: true, counts, offered: 0 });
    return id;
  }

  /** Whether game `id` can go on the table: false for one started after too many others in a row (and one that's gone). */
  counts(id: string | undefined): boolean {
    return !!(id && this.games.get(id)?.counts);
  }

  /** A frame from the player of game `id`, on `floor`. A game's last frame puts its score up for the table. */
  frame(id: string | undefined, f: CabinetFrame, floor: string): Verdict {
    const g = id === undefined ? undefined : this.games.get(id);
    if (!g || !g.playing) return 'none';
    const pace = this.pace[g.title];
    // Each referee only ever sees frames of its own game.
    const referee = REFEREES[g.title] as Referee<CabinetFrame>;
    const next = f.title === g.title ? referee.follow(g.tally, f, pace.left(g.keys)) : null;
    if (!next) {
      this.games.delete(g.id);
      return 'void';
    }
    pace.take(g.keys, next.used);
    g.tally = next.tally;
    if (f.state === 'over') {
      this.offer(g, floor);
      this.games.delete(g.id);
    }
    return 'ok';
  }

  /** The player of game `id` stepped away from it on `floor` (or left the office): it waits for them, with its score so far up for the table. */
  leave(id: string | undefined, floor: string) {
    const g = id === undefined ? undefined : this.games.get(id);
    if (!g || !g.playing) return;
    g.playing = false;
    this.offer(g, floor);
  }

  /** Puts the scores waiting on the tables now. */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending.size) return;
    this.recordedAt = Date.now();
    const waiting = [...this.pending.values()];
    this.pending.clear();
    const { changed, first } = this.table.record(...waiting.map((w) => w.score));
    if (changed) this.changed(first && { ...first, floor: waiting.find((w) => w.score.game === first.score.game)!.floor });
  }

  private offer(g: Game, floor: string) {
    const { score, level } = g.tally;
    if (!g.counts || score <= g.offered) return;
    g.offered = score;
    this.pending.set(g.id, { score: { title: g.title, game: g.id, name: g.name, color: g.color, score, level }, floor });
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), Math.max(0, this.recordedAt + RECORD_EVERY - Date.now()));
    this.timer.unref?.();
  }

  /** Makes room for a new game, by dropping the ones left waiting longest. */
  private prune() {
    for (const g of this.games.values()) {
      if (this.games.size < GAMES_KEPT) return;
      if (!g.playing) this.games.delete(g.id);
    }
  }
}
