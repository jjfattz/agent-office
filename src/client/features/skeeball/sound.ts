import type { AudioCore } from '../../sound/core';
import { biquad, envelope, pick, rand } from '../../sound/dsp';
import type { Pos } from '../../sound/places';

// ---- The skeeball machine -----------------------------------------------------------------------

export type SkeeballSound = 'roll' | 'hop' | 'thud' | 'click' | 'drop' | 'score' | 'jackpot';

/**
 * The skeeball machine, from where it happens: a ball rumbling up the wooden lane for `len` seconds,
 * its knock off the hump, its thud onto the target or the back wall and its click off a ring's lip
 * or a rail (`points` is how hard, in m/s, for those), its clunk down a hole, and the machine's chime
 * for what it scored (a rising run of notes, more of them for more `points`, and a bell for the 100).
 */
export function skeeball(a: AudioCore, kind: SkeeballSound, at: Pos, points = 0, len = 1) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count(`skeeball-${kind}`);
  const out = a.panner(at, 2, 1.1);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.005;
  if (kind === 'roll') {
    // Hardwood under a hard ball: low, hollow rumble, fading as it slows.
    const n = a.noise(a.buf.brown, true);
    const tone = biquad(ctx, 'lowpass', 420, 0.9);
    const g = ctx.createGain();
    envelope(g.gain, t0, [
      [0.04, 0.32],
      [len * 0.6, 0.22],
      [len, 0],
    ]);
    n.connect(tone).connect(g).connect(out);
    n.start(t0);
    n.stop(t0 + len + 0.05);
  } else if (kind === 'hop') {
    a.play(pick(a.buf.steps), { gain: 0.45, rate: rand(1.3, 1.5), dest: out });
    a.blip(out, t0, 190, 0.7, 0.1, 0.12);
  } else if (kind === 'thud') {
    const loud = Math.min(1, points / 4);
    a.play(pick(a.buf.steps), { gain: 0.15 + 0.4 * loud, rate: rand(0.9, 1.1), dest: out });
    a.blip(out, t0, 120, 0.6, 0.09, 0.04 + 0.08 * loud);
  } else if (kind === 'click') {
    const loud = Math.min(1, points / 2);
    a.blip(out, t0, rand(900, 1200), 0.8, 0.04, 0.03 + 0.07 * loud, 'triangle');
    a.play(pick(a.buf.steps), { gain: 0.1 + 0.2 * loud, rate: rand(2, 2.4), dest: out });
  } else if (kind === 'drop') {
    // Into the hole and down the chute, knocking as it goes.
    for (let i = 0; i < 3; i++) a.play(pick(a.buf.steps), { gain: 0.35 - i * 0.08, rate: rand(1.6, 1.9), when: t0 + i * 0.09, dest: out });
  } else if (kind === 'score') {
    const notes = Math.max(1, Math.round(points / 10));
    for (let i = 0; i < notes; i++) a.blip(out, t0 + i * 0.07, 660 * 2 ** ((i * 2) / 12), 1, 0.16, 0.09, 'square');
  } else {
    // The jackpot bell: rung over and over, with the run of notes under it.
    for (let i = 0; i < 6; i++) {
      const t = t0 + i * 0.12;
      for (const [ratio, amp, l] of [
        [1, 0.12, 0.6],
        [2.76, 0.05, 0.4],
        [5.4, 0.025, 0.2],
      ] as const)
        a.blip(out, t, 1320 * ratio, 0.995, l, amp);
    }
    for (let i = 0; i < 8; i++) a.blip(out, t0 + i * 0.06, 523 * 2 ** ((i * 3) / 12), 1, 0.14, 0.07, 'square');
  }
}
