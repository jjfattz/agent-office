import type { AudioCore } from './core';
import { biquad, envelope, pick, rand } from './dsp';

// Paper: an issue card, a page of a book.

/** An issue card in your hands: taken off the board, or put down on a desk. */
export function paper(a: AudioCore) {
  if (!a.ctx) return;
  a.play(a.buf.rustle, { gain: 0.5, rate: rand(1.1, 1.3) });
  a.count('paper');
}

/**
 * A page of the book in your hands turning over, at the bookshelf: a soft swish that rises as the
 * page sweeps through the air and falls as it settles, then a light pat as it lands. Quiet, since
 * it comes every screenful you scroll.
 */
export function pageTurn(a: AudioCore) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('pageTurn');
  const t0 = ctx.currentTime + 0.005;
  const len = rand(0.24, 0.32);
  const swish = a.noise(a.buf.white);
  const band = biquad(ctx, 'bandpass', 1000, 0.8);
  band.frequency.setValueAtTime(rand(800, 1100), t0);
  band.frequency.exponentialRampToValueAtTime(rand(2400, 3000), t0 + len * 0.6);
  band.frequency.exponentialRampToValueAtTime(1400, t0 + len);
  const g = ctx.createGain();
  envelope(g.gain, t0, [
    [len * 0.3, 0.075],
    [len * 0.6, 0.13],
    [len, 0],
  ]);
  swish.connect(band).connect(biquad(ctx, 'lowpass', 4500, 0.7)).connect(g).connect(a.ambience);
  swish.start(t0, rand(0, 4.5));
  swish.stop(t0 + len + 0.02);
  a.play(pick(a.buf.steps), { gain: 0.08, rate: rand(2.4, 2.8), when: t0 + len * 0.85 });
}
