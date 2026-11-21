// The left thumb's stick: it appears where the thumb lands, and how far and which way the thumb goes
// from there is where you walk and how fast (see stickFrom), into the player's stick (player/stick.ts).

import type { Stick } from '../../player/stick';
import { h } from '../../ui/dom';
import { stickFrom } from './touches';

/** How far the thumb goes from where it landed for the stick to be all the way out, px. */
const RADIUS = 56;

export class Joystick {
  readonly el: HTMLElement;
  private knob: HTMLElement;
  private x0 = 0;
  private y0 = 0;
  active = false;

  constructor(private stick: Stick) {
    this.knob = h('div.touch-knob');
    this.el = h('div.touch-stick.hidden', { 'aria-hidden': 'true' }, this.knob);
  }

  /** The thumb landed at (x, y): the stick's middle is there. */
  start(x: number, y: number) {
    this.active = true;
    this.x0 = x;
    this.y0 = y;
    this.el.style.translate = `${x}px ${y}px`;
    this.knob.style.translate = '0px 0px';
    this.el.classList.remove('hidden', 'run');
  }

  /** The thumb is at (x, y) now. */
  move(x: number, y: number) {
    if (!this.active) return;
    const s = stickFrom(x - this.x0, y - this.y0, RADIUS, this.stick);
    // The knob follows the thumb as far as the rim.
    const dx = x - this.x0;
    const dy = y - this.y0;
    const d = Math.hypot(dx, dy);
    const k = d > RADIUS ? RADIUS / d : 1;
    this.knob.style.translate = `${dx * k}px ${dy * k}px`;
    this.el.classList.toggle('run', s.run);
  }

  /** The thumb came up, or the controls let go of it: you stop where you are. */
  end() {
    this.active = false;
    this.stick.x = 0;
    this.stick.z = 0;
    this.stick.run = false;
    this.el.classList.add('hidden');
  }
}
