import type { CabinetFrame, HighScore, PlayState, Title } from '../../../shared/cabinet';

// What a game on the arcade cabinet is to the cabinet (ui.ts): a cartridge for each, listed in
// games.ts, that starts your games, says which keys they take, and paints anyone's frames of it.

/** What the cabinet makes a noise about (see sound.ts); `n` is how many lines cleared at once, or the brick that broke. */
export type ArcadeSound = 'land' | 'clear' | 'over' | 'shot' | 'pop' | 'hurt' | 'boom' | 'wave' | 'bounce' | 'brick' | 'power';

/** One of your games on the cabinet. */
export interface CabinetGame {
  /** Which game this is on the high-score table: the office names it when you start playing. */
  id: string;
  readonly state: PlayState;
  readonly score: number;
  /** Up by one whenever the picture changes. */
  readonly version: number;
  readonly over: boolean;
  /** Anything has happened in it yet: a game you never got going isn't worth coming back to. */
  readonly started: boolean;
  /** Moves the game on by `dt` seconds. */
  update(dt: number): void;
  frame(): CabinetFrame;
  pause(on: boolean): void;
  /** One of the game's keys (by what it's for, from its cartridge's `keys`) went down, or came back up. */
  input(action: string, down: boolean): void;
}

/** Everything a game's screen shows besides the game itself. */
export interface ScreenView {
  /** Who's playing. */
  player?: string;
  /** The game's high-score table. */
  scores: readonly HighScore[];
  /** A game to pick out on the table: your own. */
  mine?: string;
  /** Said over a paused game: why it's paused. */
  note?: string;
  /** What to press, under a game that's over. */
  prompt?: string;
  /** Seconds, for anything that moves on its own. */
  t: number;
}

export interface Cartridge<F extends CabinetFrame = CabinetFrame> {
  title: Title;
  /** A line about it, for the menu. */
  blurb: string;
  /** Its name in lights: these colors, letter by letter. */
  colors: readonly string[];
  /** Its keys, by `code`, to what each is for. P pauses, Enter starts again and M goes back to the games on any of them. */
  keys: Readonly<Record<string, string>>;
  /** Its keys, said under the screen. */
  tip: string;
  /** Your game goes out to everyone watching at most this often (ms). */
  frameMs: number;
  /** A new game of it, making its noises with `sound`. */
  start(sound: (kind: ArcadeSound, n?: number) => void): CabinetGame;
  /** Draws the whole screen: frame `f` of it, and around it `v`. */
  paint(g: CanvasRenderingContext2D, f: F, v: ScreenView): void;
  /** What someone watching hears, as one frame of someone else's game follows another. The game ending is the cabinet's. */
  hear(was: F, f: F, sound: (kind: ArcadeSound, n?: number) => void): void;
  /** A little picture of it for the menu, `size` across, centered on (x, y). */
  icon(g: CanvasRenderingContext2D, x: number, y: number, size: number): void;
}
