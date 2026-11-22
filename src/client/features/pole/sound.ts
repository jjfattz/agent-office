import { slideSpeed } from '../../../shared/pole';
import type { AudioCore } from '../../sound/core';
import { biquad, envelope, pick, rand } from '../../sound/dsp';
import type { Pos } from '../../sound/places';

// ---- The fire pole ------------------------------------------------------------------------------

export type PoleSound = 'grab' | 'land';

/** How long a slide down `drop` meters of pole takes, in seconds (the same steps as Slide's). */
export function slideSeconds(drop: number): number {
  let v = 0;
  let y = drop;
  let t = 0;
  const dt = 1 / 60;
  while (y > 0 && t < 60) {
    v = slideSpeed(v, y, dt);
    y -= v * dt;
    t += dt;
  }
  return t;
}

/**
 * The fire pole: hands and legs clamping on with a clank and the long hiss of sliding down it,
 * `len` seconds of it (`grab`), and the thump onto the mat at the bottom (`land`).
 */
export function pole(a: AudioCore, kind: PoleSound, at: Pos, len = 1) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count(`pole-${kind}`);
  const t0 = ctx.currentTime + 0.005;
  if (kind === 'land') {
    const out = a.panner(at, 3, 1);
    out.connect(a.ambience);
    a.play(pick(a.buf.steps), { gain: 0.9, rate: 0.8, dest: out });
    a.play(pick(a.buf.steps), { gain: 0.5, rate: 0.65, when: t0 + 0.06, dest: out });
    return;
  }
  // Your own slide: heard right with you all the way down, so not from a place.
  const out = ctx.createGain();
  out.connect(a.ambience);
  a.clink(out, t0, rand(780, 860), 0.08);
  a.play(pick(a.buf.steps), { gain: 0.4, rate: 2, dest: out });
  // The hiss of skin and cloth on brass, rising as it picks up speed and easing off at the bottom.
  const hiss = a.noise(a.buf.white, true);
  const band = biquad(ctx, 'bandpass', 1500, 1.4);
  band.frequency.setValueAtTime(900, t0);
  band.frequency.linearRampToValueAtTime(2300, t0 + Math.min(1.2, len * 0.6));
  band.frequency.linearRampToValueAtTime(1200, t0 + len);
  const g = ctx.createGain();
  const up = Math.min(0.5, len * 0.4);
  envelope(g.gain, t0, [
    [up, 0.07],
    [Math.max(up, len), 0.06],
    [Math.max(up, len) + 0.15, 0],
  ]);
  hiss.connect(band).connect(g).connect(out);
  hiss.start(t0);
  hiss.stop(t0 + len + 0.3);
}
