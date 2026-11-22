import { NowAndThen, type AudioCore } from './core';
import { biquad, pick, rand, randInt } from './dsp';

// ---- Around the room --------------------------------------------------------------------------

/** A few chirps from outside one of the windows. */
function birds(a: AudioCore, now: number) {
  const ctx = a.ctx!;
  a.count('birds');
  const out = a.panner(pick(a.windows()), 2, 1.2);
  // Heard through the glass.
  out.connect(biquad(ctx, 'lowpass', 5000, 0.7)).connect(a.ambience);
  const base = rand(2400, 4200);
  const shape = Math.random();
  let t = now + 0.05;
  for (let i = randInt(2, 6); i > 0; i--) {
    const len = rand(0.06, 0.14);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(base * rand(0.9, 1.05), t);
    if (shape < 0.5) {
      o.frequency.exponentialRampToValueAtTime(base * rand(1.25, 1.6), t + len * 0.6);
      o.frequency.exponentialRampToValueAtTime(base * rand(0.8, 1), t + len);
    } else o.frequency.exponentialRampToValueAtTime(base * rand(0.6, 0.75), t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + len + 0.02);
    t += len + rand(0.04, 0.2);
  }
}

/** A cricket just outside a window, chirping away for a few seconds. */
function crickets(a: AudioCore, now: number) {
  const ctx = a.ctx!;
  a.count('crickets');
  const out = a.panner(pick(a.windows()), 2, 1.2);
  out.connect(biquad(ctx, 'lowpass', 6000, 0.7)).connect(a.ambience);
  const freq = rand(4200, 5200);
  let t = now + 0.05;
  for (let c = randInt(4, 9); c > 0; c--) {
    for (let p = 0; p < 3; p++) {
      const o = ctx.createOscillator();
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.022, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.022);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.03);
      t += 0.035;
    }
    t += rand(0.35, 0.6);
  }
}

/** Birds by day, and not in the rain: every so often, and sometimes another answers from a different window. */
export function birdsong(a: AudioCore): NowAndThen {
  return new NowAndThen(
    () => rand(5, 15),
    // Sometimes another bird answers from a different window.
    () => (Math.random() < 0.35 ? rand(1.5, 4) : rand(12, 35)),
    (now) => {
      const { rain, night } = a.weather;
      // Birds sing by day, and not in the rain (or out in space).
      if (night < 0.5 && rain < 0.1 && !a.hall?.vacuum) birds(a, now);
    },
  );
}

/** A cricket at night, when it's dry. */
export function nightCrickets(a: AudioCore): NowAndThen {
  return new NowAndThen(
    () => rand(2, 6),
    () => rand(3, 8),
    (now) => {
      const { rain, night } = a.weather;
      if (night > 0.6 && rain < 0.05 && !a.hall?.vacuum) crickets(a, now);
    },
  );
}

// ---- The roof ---------------------------------------------------------------------------------

export function startWind(a: AudioCore) {
  const ctx = a.ctx!;
  // Traffic, far below…
  const city = a.noise(a.buf.brown, true);
  const cityG = ctx.createGain();
  cityG.gain.value = 0.08;
  city.connect(biquad(ctx, 'lowpass', 420, 0.6)).connect(cityG).connect(a.outside);
  // …and the wind, gusting and dropping, whistling higher as it picks up.
  const wind = a.noise(a.buf.white, true);
  const tone = biquad(ctx, 'bandpass', 520, 0.8);
  const windG = ctx.createGain();
  windG.gain.value = 0.012;
  const gust = ctx.createOscillator();
  gust.frequency.value = 0.08;
  const gustDepth = ctx.createGain();
  gustDepth.gain.value = 0.009;
  gust.connect(gustDepth).connect(windG.gain);
  const pitch = ctx.createGain();
  pitch.gain.value = 220;
  gust.connect(pitch).connect(tone.frequency);
  wind.connect(tone).connect(windG).connect(a.outside);
  city.start();
  wind.start();
  gust.start();
}
