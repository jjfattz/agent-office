import { HOLES, scoreName } from '../../../shared/course';
import type { Flight } from '../../../shared/golf';

// A round of golf on the course: three holes, in order round the triangle from whichever tee you
// started at, and the strokes you've taken on each. Your ball is where you'll play your next from:
// teed up on a tee, or wherever the last one stopped. In the water it's dropped on the hole's drop
// zone (or back where you hit it from, on a hole with no water of its own), out of bounds it's back
// where you hit it from, a stroke added either way. Take too many and you pick it up.

/** The most strokes a hole can take: at this many, you pick up and that's your score. */
export const MAX_STROKES = 8;

export interface Ball {
  x: number;
  z: number;
  /** Teed up on a tee, rather than lying on the grass. */
  teed: boolean;
}

/** What became of a shot. */
export type Outcome =
  /** It's lying somewhere: play on from there. */
  | { kind: 'play' }
  /** Into the water or out of bounds: a stroke added, and the ball's back in play. */
  | { kind: 'penalty'; why: 'water' | 'out' }
  /** Hole `hole` is done (in the hole, or picked up), with its score: on to `next`, or the round's over (`next` null). */
  | { kind: 'holed'; hole: number; strokes: number; name: string; next: number | null; picked?: boolean };

const teedOn = (hole: number): Ball => ({ x: HOLES[hole].tee.x, z: HOLES[hole].tee.z, teed: true });

export class GolfRound {
  /** Strokes on each hole (by hole), once it's finished. */
  readonly card: (number | null)[] = HOLES.map(() => null);
  /** The hole you're on, and the strokes on it so far. */
  hole: number;
  strokes = 0;
  ball: Ball;
  /** Where the shot on its way was hit from. */
  private from: Ball | null = null;
  /** All three played. */
  done = false;

  constructor(readonly start: number) {
    this.hole = start;
    this.ball = teedOn(start);
  }

  /** How many holes are finished. */
  get played(): number {
    return this.card.filter((s) => s !== null).length;
  }

  /** Strokes so far, and against par for the holes finished. */
  get total(): number {
    return this.card.reduce<number>((n, s) => n + (s ?? 0), 0);
  }

  get toPar(): number {
    return this.card.reduce<number>((n, s, i) => n + (s === null ? 0 : s - HOLES[i].par), 0);
  }

  /** You hit it: a stroke, from where the ball was. */
  struck(): void {
    this.strokes++;
    this.from = { ...this.ball, teed: this.ball.teed };
  }

  /** Where the shot went (see fly): where you play your next from. */
  landed(f: Flight): Outcome {
    if (f.holed) return this.finish(this.strokes);
    const h = HOLES[this.hole];
    const from = this.from ?? this.ball;
    let out: Outcome = { kind: 'play' };
    if (f.lie === 'water') {
      this.strokes++;
      this.ball = h.water.length ? { x: h.drop.x, z: h.drop.z, teed: false } : { ...from, teed: false };
      out = { kind: 'penalty', why: 'water' };
    } else if (f.lie === 'out' || f.lie === 'roof') {
      this.strokes++;
      this.ball = { ...from };
      out = { kind: 'penalty', why: 'out' };
    } else this.ball = { x: f.rest.x, z: f.rest.z, teed: false };
    if (this.strokes >= MAX_STROKES) return this.finish(MAX_STROKES, true);
    return out;
  }

  /** Gives up on the hole: it goes down as the most a hole can take. */
  pickUp(): Outcome {
    return this.finish(MAX_STROKES, true);
  }

  private finish(strokes: number, picked = false): Outcome {
    const n = Math.min(strokes, MAX_STROKES);
    const hole = this.hole;
    this.card[hole] = n;
    const name = picked ? 'Picked up' : scoreName(n, HOLES[this.hole].par);
    const next = this.played >= HOLES.length ? null : (this.hole + 1) % HOLES.length;
    if (next === null) this.done = true;
    else {
      this.hole = next;
      this.strokes = 0;
      this.ball = teedOn(next);
    }
    this.from = null;
    return { kind: 'holed', hole, strokes: n, name, next, picked };
  }
}
