// The skeeball machine by the loft's stairs (see shared/skeeball.ts and features/skeeball).

export type SkeeballClientMsg =
  /**
   * You rolled a ball up the skeeball lane: aimed at `aim` across the target (meters from the middle
   * of its rings, positive: right), rolled `power` hard (0–1), ball `n` of the game (from 1), and
   * what it scored. Everyone on your floor runs the same roll (roll in shared/skeeball.ts) to see it
   * go, and counts `points` for it, so every page has the same score even if a bounce goes another way.
   */
  { t: 'skeeball'; aim: number; power: number; n: number; points: number };

export type SkeeballServerMsg =
  /** Someone on your floor rolled a skeeball (see the client's 'skeeball'). */
  { t: 'skeeball'; id: string; aim: number; power: number; n: number; points: number };
