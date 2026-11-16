import type { AudioCore } from '../../sound/core';
import { CABINET_AT } from '../../sound/places';
import type { ArcadeSound } from './cart';

// ---- The arcade -------------------------------------------------------------------------------

/**
 * The arcade cabinet's chip bleeps: a piece landing, lines clearing (a longer run up for more at once),
 * a shot, a bug popping or taking a hit, your ship blowing up, a wave coming in, the ball off the
 * paddle, a brick breaking (higher for the bricks worth more), a pill or a battery caught, a crumb
 * hoovered up, a cat caught (a meow), and the game ending.
 */
export function arcade(a: AudioCore, kind: ArcadeSound, lines = 1) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count(`arcade.${kind}`);
  const out = a.panner(CABINET_AT, 1.5, 1.2);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.02;
  if (kind === 'land') a.blip(out, t0, 160, 0.55, 0.07, 0.1, 'square');
  else if (kind === 'clear') [523, 659, 784, 1047, 1319].slice(0, lines + 1).forEach((f, i) => a.blip(out, t0 + i * 0.07, f, 1.02, 0.1, 0.09, 'square'));
  else if (kind === 'shot') a.blip(out, t0, 1500, 0.4, 0.07, 0.035, 'square');
  else if (kind === 'pop') [700, 260].forEach((f, i) => a.blip(out, t0 + i * 0.04, f, 0.4, 0.09, 0.07, 'sawtooth'));
  else if (kind === 'hurt') a.blip(out, t0, 880, 1.25, 0.06, 0.06, 'square');
  else if (kind === 'boom') [330, 220, 147, 98].forEach((f, i) => a.blip(out, t0 + i * 0.09, f, 0.6, 0.16, 0.12, 'sawtooth'));
  else if (kind === 'bounce') a.blip(out, t0, 330, 1.5, 0.06, 0.07, 'square');
  else if (kind === 'brick') a.blip(out, t0, [440, 494, 523, 587, 659, 740, 880, 880][Math.max(0, Math.min(7, lines - 1))], 1.03, 0.08, 0.06, 'square');
  else if (kind === 'power') [523, 784, 1047].forEach((f, i) => a.blip(out, t0 + i * 0.05, f, 1.02, 0.07, 0.07, 'triangle'));
  else if (kind === 'crumb') a.blip(out, t0, 1250, 0.6, 0.035, 0.025, 'triangle');
  else if (kind === 'meow') [[520, 1.5, 0.12], [780, 0.55, 0.22]].forEach(([f, r, len], i) => a.blip(out, t0 + i * 0.1, f, r, len, 0.07, 'triangle'));
  else if (kind === 'wave') [392, 523, 659, 784].forEach((f, i) => a.blip(out, t0 + i * 0.08, f, 1.01, 0.09, 0.07, 'triangle'));
  else [392, 330, 262, 196].forEach((f, i) => a.blip(out, t0 + i * 0.18, f, 0.97, 0.17, 0.14, 'triangle'));
}
