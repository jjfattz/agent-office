// The skeeball machine by the loft's stairs (see shared/skeeball.ts and features/skeeball).

export type SkeeballClientMsg =
  /**
   * You rolled a ball up the skeeball lane: aimed `aim` radians off straight (positive: right),
   * rolled `power` hard (0–1), ball `n` of the game (from 1). Everyone on your floor works out where
   * it goes, and what it scores, the same way (roll in shared/skeeball.ts).
   */
  { t: 'skeeball'; aim: number; power: number; n: number };

export type SkeeballServerMsg =
  /** Someone on your floor rolled a skeeball (see the client's 'skeeball'). */
  { t: 'skeeball'; id: string; aim: number; power: number; n: number };
