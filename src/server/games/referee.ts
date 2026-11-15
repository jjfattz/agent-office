// How the office follows a game on the arcade cabinet frame by frame (see Arcade in server/cabinet.ts),
// so a browser can't post a score it didn't play for. Each game has a referee of its own.

/** How far a game had got, by its last frame that added up. */
export interface Tally {
  score: number;
  /** The level (or wave) it's on. */
  level: number;
}

export interface Referee<F, T extends Tally = Tally> {
  /**
   * How fast a player may go over all their games, in whatever `follow` counts (pieces landed, waves
   * reached): `burst` in a row, and then `perSecond` as it comes back.
   */
  burst: number;
  perSecond: number;
  /** A new game, before its first frame. */
  fresh(): T;
  /**
   * The game after frame `f`, if it adds up after `was` with `left` of its player's pace to spend: its
   * tally then, and how much of that pace it used. Null if it doesn't add up.
   */
  follow(was: T, f: F, left: number): { tally: T; used: number } | null;
}
