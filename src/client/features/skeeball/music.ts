import type { AudioCore } from '../../sound/core';
import { biquad, rand } from '../../sound/dsp';
import { SPEAKER } from './sound';

// ---- The skeeball machine's music ---------------------------------------------------------------

/**
 * What the machine's speaker plays: nothing (off the floor it's on), an attract jingle now and then
 * while nobody's playing, the game tune while a game's on, or the same faster on the last ball.
 */
export type SkeeballMusic = 'off' | 'attract' | 'game' | 'hurry';

/** Beats a minute of the game tune, and on the last ball. */
const BPM = { game: 138, hurry: 168 };
/** How far ahead notes are scheduled (s): more than a hidden tab's timer is late by, so it doesn't stutter. */
const AHEAD = 1.3;
/** Seconds between attract jingles, while nobody's playing. */
const ATTRACT_GAP: [number, number] = [50, 110];
/** How loud the whole tune is, before your music volume. */
const LEVEL = 1.3;

// The game tune: four bars of 16ths, C, A minor, F, G, round and round. Lead notes are MIDI numbers, 0 a rest.
const LEAD = [
  [76, 0, 79, 0, 84, 0, 79, 0, 76, 0, 79, 0, 81, 79, 76, 0],
  [76, 0, 72, 0, 69, 0, 72, 0, 76, 0, 74, 0, 72, 0, 0, 0],
  [77, 0, 81, 0, 84, 0, 81, 0, 77, 0, 81, 0, 84, 86, 84, 0],
  [83, 0, 79, 0, 74, 0, 79, 0, 83, 0, 86, 0, 84, 0, 83, 0],
];
/** Each bar's bass root (MIDI), bounced between octaves on the 8ths. */
const ROOTS = [36, 45, 41, 43];
/** The attract jingle: [step (16ths from its start), MIDI notes, length in 16ths]. */
const JINGLE: [number, number[], number][] = [
  [0, [72], 1],
  [1, [76], 1],
  [2, [79], 1],
  [3, [84], 2],
  [6, [83], 1],
  [7, [84], 1],
  [8, [86], 1],
  [9, [88], 2],
  [12, [84, 88, 91], 6],
];

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const playing = (m: SkeeballMusic) => m === 'game' || m === 'hurry';

export class SkeeballTunes {
  private out!: PannerNode;
  private mode: SkeeballMusic = 'off';
  /** The tune playing now, into a gain of its own so stopping it silences notes already scheduled. */
  private run: { gain: GainNode; step: number; at: number } | null = null;
  private nextJingle = 0;
  /** Notes scheduled so far, for quick checks from the console. */
  notes = 0;

  constructor(private readonly a: AudioCore) {}

  /** The machine's speaker, into your music volume (see Jukebox.connect). */
  connect(musicBus: GainNode) {
    this.out = this.a.panner(SPEAKER, 3, 1.3);
    this.out.connect(musicBus);
    // On a timer rather than every frame, so it carries on in a background tab.
    window.setInterval(() => this.tick(), 200);
  }

  /** What it plays from now on; it starts on the next tick, once there's audio. */
  set(mode: SkeeballMusic) {
    if (mode === this.mode) return;
    const was = this.mode;
    this.mode = mode;
    this.nextJingle = 0;
    // From the game tune to the faster one, it carries on where it is.
    if (!(playing(was) && playing(mode)) && this.a.ctx) this.stop();
  }

  private begin(at: number) {
    const ctx = this.a.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = LEVEL;
    gain.connect(this.out);
    this.run = { gain, step: 0, at };
    this.a.count('skeeball-music');
  }

  private stop() {
    const r = this.run;
    if (!r) return;
    this.run = null;
    const now = this.a.ctx!.currentTime;
    r.gain.gain.setTargetAtTime(0, now, 0.05);
    window.setTimeout(() => r.gain.disconnect(), (AHEAD + 0.5) * 1000);
  }

  private tick() {
    const ctx = this.a.ctx;
    if (!ctx || ctx.state !== 'running' || !this.out) return;
    const now = ctx.currentTime;
    if (this.mode === 'attract') {
      // The first one a while after it goes quiet (or audio starts), not straight away.
      if (!this.nextJingle) this.nextJingle = now + rand(...ATTRACT_GAP) / 3;
      else if (now >= this.nextJingle) {
        this.jingle(now + 0.05);
        this.nextJingle = now + rand(...ATTRACT_GAP);
      }
    }
    if (playing(this.mode) && !this.run) this.begin(now + 0.1);
    const r = this.run;
    if (!r) return;
    // Fell behind (the tab was asleep): pick up from now rather than cramming the missed notes in.
    if (r.at < now) r.at = now + 0.05;
    const step = 60 / BPM[this.mode === 'hurry' ? 'hurry' : 'game'] / 4;
    while (r.at < now + AHEAD) {
      this.gameStep(r.gain, r.step, r.at, step);
      r.step++;
      r.at += step;
    }
  }

  /** One 16th of the game tune: lead, bass on the 8ths, a kick on the beat and a hat between. */
  private gameStep(dest: AudioNode, n: number, when: number, step: number) {
    const bar = Math.floor(n / 16) % LEAD.length;
    const i = n % 16;
    const lead = LEAD[bar][i];
    // Every other time round, the lead goes up an octave for the last two bars.
    const lift = Math.floor(n / 64) % 2 && bar >= 2 ? 12 : 0;
    if (lead) this.note(dest, when, hz(lead + lift), step * 1.6, 0.06, 'square');
    if (i % 2 === 0) this.note(dest, when, hz(ROOTS[bar] + (i % 4 ? 12 : 0)), step * 1.8, 0.11, 'triangle');
    if (i % 4 === 0) this.a.blip(dest, when, 140, 0.35, 0.12, 0.16);
    if (i % 4 === 2) this.hat(dest, when, 0.05);
  }

  /** The attract jingle: a quick run up, and a chord. */
  private jingle(t0: number) {
    const ctx = this.a.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = LEVEL * 0.8;
    gain.connect(this.out);
    const step = 60 / 150 / 4;
    for (const [at, notes, len] of JINGLE) for (const m of notes) this.note(gain, t0 + at * step, hz(m), len * step * 1.4, 0.05 / notes.length + 0.02, 'square');
    window.setTimeout(() => gain.disconnect(), 4000);
    this.a.count('skeeball-attract');
  }

  private note(dest: AudioNode, when: number, f: number, len: number, gain: number, type: OscillatorType) {
    this.a.blip(dest, when, f, 1, len, gain, type);
    this.notes++;
  }

  /** A closed hat: a few ms of white noise, high-passed. */
  private hat(dest: AudioNode, when: number, gain: number) {
    const ctx = this.a.ctx!;
    const src = this.a.noise(this.a.buf.white);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    src.connect(biquad(ctx, 'highpass', 7000, 0.7)).connect(g).connect(dest);
    src.start(when, rand(0, 0.5));
    src.stop(when + 0.05);
  }
}
