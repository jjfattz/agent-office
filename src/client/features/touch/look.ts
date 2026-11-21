// The right thumb on the scene: dragging looks around (first person) or orbits the camera (third), two
// fingers pinch the camera in and out (third person, what the mouse wheel does), and a quick tap uses
// what's in the middle of the screen (or, in third person, what you tapped), as a click does.

import * as THREE from 'three';
import type { PlayerController } from '../../player';

/** A phone's look drag, against the mouse drag's: a thumb crosses less of the screen for a turn. */
const TOUCH_LOOK = 1.25;
/** A tap moves less than this (px) and lasts less than this (ms); anything more was a drag. */
const TAP_PX = 10;
const TAP_MS = 350;
/** Meters the camera moves per pixel the fingers pinch together or apart. */
const PINCH = 0.03;

interface Finger {
  x: number;
  y: number;
  moved: number;
  at: number;
}

export class Look {
  /** The fingers looking, by pointer id, at most two (a pinch). */
  private fingers = new Map<number, Finger>();
  /** How far apart a pinch's fingers were last. */
  private spread = 0;
  /** A pinch happened since the last finger landed: lifting one isn't a tap. */
  private pinched = false;

  constructor(
    private player: PlayerController,
    /** How hard a drag turns you, against TOUCH_LOOK (⚙️ Settings, see settings-touch.ts). */
    private speed: () => number,
    private canvas: HTMLCanvasElement,
  ) {}

  start(id: number, x: number, y: number, now: number) {
    if (this.fingers.size >= 2) return;
    if (!this.fingers.size) this.pinched = false;
    this.fingers.set(id, { x, y, moved: 0, at: now });
    if (this.fingers.size === 2) this.spread = this.apart();
  }

  move(id: number, x: number, y: number) {
    const f = this.fingers.get(id);
    if (!f) return;
    const dx = x - f.x;
    const dy = y - f.y;
    f.x = x;
    f.y = y;
    f.moved += Math.abs(dx) + Math.abs(dy);
    if (this.fingers.size === 2) {
      // Fingers apart pull the camera in, as on a map.
      const spread = this.apart();
      this.player.zoom((this.spread - spread) * PINCH);
      this.spread = spread;
      this.pinched = true;
      return;
    }
    if (this.player.enabled) this.player.turn(dx, dy, TOUCH_LOOK * this.speed());
  }

  /** Finger `id` came up; `tap` says it may count as a tap (not when the browser took it). */
  end(id: number, now: number, tap: boolean) {
    const f = this.fingers.get(id);
    if (!f) return;
    this.fingers.delete(id);
    if (!tap || this.pinched || this.fingers.size || f.moved > TAP_PX || now - f.at > TAP_MS || !this.player.enabled) return;
    if (this.player.view === 'first') return this.player.onClick?.(new THREE.Vector2(0, 0));
    const r = this.canvas.getBoundingClientRect();
    this.player.onClick?.(new THREE.Vector2(((f.x - r.left) / r.width) * 2 - 1, -((f.y - r.top) / r.height) * 2 + 1));
  }

  clear() {
    this.fingers.clear();
    this.pinched = false;
  }

  private apart(): number {
    const [a, b] = this.fingers.values();
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
