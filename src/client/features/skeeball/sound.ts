import type { AudioCore } from '../../sound/core';
import { biquad, envelope, pick, rand } from '../../sound/dsp';
import type { Pos } from '../../sound/places';
import { SIZE, SKEEBALL } from '../../../shared/skeeball';

// ---- The skeeball machine -----------------------------------------------------------------------

export type SkeeballSound = 'coin' | 'release' | 'roll' | 'hop' | 'thud' | 'click' | 'drop' | 'score' | 'jackpot' | 'gutter' | 'over' | 'best' | 'tickets';

/** The machine's speaker, in the marquee over the target (its music is in music.ts). */
export const SPEAKER: Pos = { x: SKEEBALL.x + SKEEBALL.length - 0.25, y: 2.2 * SIZE, z: SKEEBALL.z };
/** The trough at its front, where the balls come back to you. */
export const TROUGH: Pos = { x: SKEEBALL.x + 0.15, y: 0.7 * SIZE, z: SKEEBALL.z };

/**
 * The skeeball machine, from where it happens: a ball rumbling up the wooden lane for `len` seconds,
 * its knock off the hump, its thud onto the target or the back wall and its click off a ring's lip
 * or a rail (`points` is how hard, in m/s, for those), its clunk down a hole, and the machine's chime
 * for what it scored (a rising run of notes, more of them for more `points`, and a bell for the 100).
 * And round a game: the coin going in and the start-up chirp, the balls rattling down into the trough,
 * the buzzer for a ball that scored nothing, the game-over tune (a sadder one for a low score, a
 * fanfare for a great one, `points` being the game's score), the extra flourish for your best yet,
 * and the ticket dispenser chattering out `len` tickets.
 */
export function skeeball(a: AudioCore, kind: SkeeballSound, at: Pos, points = 0, len = 1) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count(`skeeball-${kind}`);
  const out = a.panner(at, 2, 1.1);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.005;
  if (kind === 'coin') {
    // The coin in, rattling down to the box, and the machine waking up.
    a.clink(out, t0, 2600, 0.05);
    a.clink(out, t0 + 0.11, 3100, 0.03);
    a.play(pick(a.buf.steps), { gain: 0.2, rate: 2.6, when: t0 + 0.2, dest: out });
    [523, 659, 784, 1047, 1319].forEach((f, i) => a.blip(out, t0 + 0.35 + i * 0.06, f, 1.01, 0.09, 0.07, 'square'));
  } else if (kind === 'release') {
    // The balls let go, rattling down the return and knocking into each other in the trough.
    const n = a.noise(a.buf.brown, true);
    const g = ctx.createGain();
    envelope(g.gain, t0, [
      [0.08, 0.25],
      [0.8, 0.12],
      [1.1, 0],
    ]);
    n.connect(biquad(ctx, 'bandpass', 380, 1.2)).connect(g).connect(out);
    n.start(t0);
    n.stop(t0 + 1.2);
    for (let i = 0; i < 9; i++) a.play(pick(a.buf.steps), { gain: rand(0.15, 0.3), rate: rand(1.7, 2.3), when: t0 + 0.15 + i * 0.09 + rand(0, 0.03), dest: out });
  } else if (kind === 'roll') {
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
  } else if (kind === 'gutter') {
    // Nothing: the machine's low buzz.
    [196, 147].forEach((f, i) => a.blip(out, t0 + i * 0.16, f, 0.98, 0.15, 0.06, 'sawtooth'));
  } else if (kind === 'over') {
    gameOver(a, out, t0, points);
  } else if (kind === 'best') {
    // Your best yet: a trill on top, and up again.
    for (let i = 0; i < 8; i++) a.blip(out, t0 + i * 0.05, i % 2 ? 1568 : 1319, 1, 0.06, 0.05, 'square');
    [1047, 1319, 1568, 2093].forEach((f, i) => a.blip(out, t0 + 0.45 + i * 0.09, f, 1.01, i === 3 ? 0.5 : 0.1, 0.07, 'square'));
  } else if (kind === 'tickets') {
    // The ticket dispenser: a little motor, and a click for every ticket out.
    const n = a.noise(a.buf.white, true);
    const g = ctx.createGain();
    const end = len * 0.07 + 0.1;
    envelope(g.gain, t0, [
      [0.03, 0.025],
      [end, 0.025],
      [end + 0.05, 0],
    ]);
    n.connect(biquad(ctx, 'bandpass', 1800, 3)).connect(g).connect(out);
    n.start(t0);
    n.stop(t0 + end + 0.1);
    for (let i = 0; i < len; i++) a.blip(out, t0 + 0.05 + i * 0.07, 2200, 0.7, 0.02, 0.04, 'square');
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

/** How the game ended: a slow run down for a low score, a bright run up for a fair one, a fanfare for a great one. */
function gameOver(a: AudioCore, out: AudioNode, t0: number, score: number) {
  if (score < 150) {
    [392, 370, 349, 262].forEach((f, i) => a.blip(out, t0 + i * 0.2, f, i === 3 ? 0.9 : 0.99, i === 3 ? 0.5 : 0.18, 0.08, 'triangle'));
    return;
  }
  if (score < 300) {
    [523, 659, 784, 659, 784, 1047].forEach((f, i) => a.blip(out, t0 + i * 0.1, f, 1.01, i === 5 ? 0.4 : 0.1, 0.07, 'square'));
    return;
  }
  // The fanfare: da-da-da-daaa, then the chord.
  [784, 784, 784, 1047].forEach((f, i) => a.blip(out, t0 + i * 0.13, f, 1, i === 3 ? 0.35 : 0.1, 0.08, 'square'));
  for (const f of [523, 659, 784, 1047]) a.blip(out, t0 + 0.75, f, 1, 0.9, 0.05, 'square');
  for (const f of [131, 65]) a.blip(out, t0 + 0.75, f, 1, 0.9, 0.12, 'triangle');
}
