import * as THREE from 'three';
import { BALL_R, lieText, type Flight, type Hit } from '../../../shared/golf';
import { disposeSprite, mesh, textSprite, toon } from '../../world/toon';

// The balls on the course, everyone's, played back along their flights (shared/golf.ts works them
// out). The group sits down on the street (`street` below the floor you're on), and the flights are
// in the street's own frame. Your own ball, once it stops, is the round's to show (see round.ts):
// someone else's lies where it stopped, labelled with who hit it, until they play it again.

export function golfBall(): THREE.Mesh {
  return mesh(new THREE.SphereGeometry(BALL_R, 14, 10), toon('#ffffff'), 0, 0, 0, false);
}

/** The flight's path keeps a point every this many seconds. */
const PER = 1 / 60;

interface Flying {
  flight: Flight;
  /** Seconds since the hit. */
  t: number;
  ball: THREE.Mesh;
  trail: THREE.Line;
  /** The next of `flight.hits` still to happen. */
  next: number;
  /** Who hit it: their id, and their name. */
  id: string;
  who: string;
  mine: boolean;
  /** Seconds since it stopped, or -1 while it's still going. */
  still: number;
  label: THREE.Sprite | null;
}

/** How long a stopped ball of someone else's stays lying there, and its label over it, in seconds. */
const LIE_SECONDS = 240;
const LABEL_SECONDS = 14;
/** At most this many balls about: the oldest go first. */
const MAX_BALLS = 16;

export class GolfBalls {
  readonly group = new THREE.Group();
  private balls: Flying[] = [];
  /** It hit something: `mine` if it's your ball. `at` is in the street's frame. */
  onHit: ((hit: Hit, mine: boolean) => void) | null = null;
  /** It stopped (or went in, or into the water). */
  onRest: ((flight: Flight, who: string, mine: boolean) => void) | null = null;

  /** The street is `street` below the floor you're on. */
  setStreet(street: number) {
    this.group.position.y = street;
  }

  /** Sends a ball off along `flight`, hit by `id` (called `who`). Whatever ball of theirs was lying about is picked up. */
  launch(flight: Flight, id: string, who: string, mine: boolean): void {
    for (const b of this.balls.filter((o) => o.id === id)) this.drop(b);
    const ball = golfBall();
    ball.position.set(flight.path[0], flight.path[1], flight.path[2]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(flight.path, 3));
    geo.setDrawRange(0, 1);
    const trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: mine ? '#ffd166' : '#fffaf3', transparent: true, opacity: 0.85 }));
    trail.frustumCulled = false;
    this.group.add(ball, trail);
    this.balls.push({ flight, t: 0, ball, trail, next: 0, id, who, mine, still: -1, label: null });
    while (this.balls.length > MAX_BALLS) this.drop(this.balls[0]);
  }

  /** Your ball still on its way (or just stopped), for the camera to follow: where it is, in the street's frame. */
  get mine(): { at: THREE.Vector3; flight: Flight; still: number } | null {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (b.mine) return { at: b.ball.position, flight: b.flight, still: b.still };
    }
    return null;
  }

  update(dt: number): void {
    for (const b of [...this.balls]) {
      const f = b.flight;
      if (b.still < 0) {
        b.t = Math.min(b.t + dt, f.seconds);
        const i = b.t / PER;
        const last = f.path.length / 3 - 1;
        const i0 = Math.min(Math.floor(i), last);
        const i1 = Math.min(i0 + 1, last);
        const k = i - i0;
        const p = f.path;
        b.ball.position.set(p[i0 * 3] + (p[i1 * 3] - p[i0 * 3]) * k, p[i0 * 3 + 1] + (p[i1 * 3 + 1] - p[i0 * 3 + 1]) * k, p[i0 * 3 + 2] + (p[i1 * 3 + 2] - p[i0 * 3 + 2]) * k);
        b.trail.geometry.setDrawRange(0, i1 + 1);
        while (b.next < f.hits.length && f.hits[b.next].t <= b.t) this.onHit?.(f.hits[b.next++], b.mine);
        if (b.t >= f.seconds) {
          b.still = 0;
          // In the cup or the water, it's out of sight.
          b.ball.visible = !f.holed && f.lie !== 'water';
          const text = `${b.mine ? '' : `${b.who} · `}${f.holed ? '⛳ ' : ''}${lieText(f)}`;
          b.label = textSprite(text, { bg: f.holed ? '#ffd166' : '#2b2d42', color: f.holed ? '#2b2d42' : '#fffaf3', size: 44, border: '#fffaf3' });
          b.label.position.set(f.rest.x, Math.max(0, f.rest.y) + (f.holed ? 1.2 : 0.7), f.rest.z);
          this.group.add(b.label);
          this.onRest?.(f, b.who, b.mine);
        }
        continue;
      }
      b.still += dt;
      // The trail fades once it's down, then the label; in the end someone else's ball is picked up.
      const trail = b.trail.material as THREE.LineBasicMaterial;
      trail.opacity = Math.max(0, 0.85 - b.still * 0.5);
      b.trail.visible = trail.opacity > 0;
      if (b.label) {
        b.label.material.opacity = THREE.MathUtils.clamp(LABEL_SECONDS - b.still, 0, 1);
        if (b.still > LABEL_SECONDS) {
          this.group.remove(b.label);
          disposeSprite(b.label);
          b.label = null;
        }
      }
      if (b.still > LIE_SECONDS) this.drop(b);
    }
  }

  /** `id`'s balls picked up off the course: yours, once the round has where it stopped. */
  pickUp(id: string): void {
    for (const b of this.balls.filter((o) => o.id === id)) this.drop(b);
  }

  /** Every ball, gone: off to another floor. */
  clear(): void {
    for (const b of [...this.balls]) this.drop(b);
  }

  private drop(b: Flying) {
    this.balls = this.balls.filter((o) => o !== b);
    this.group.remove(b.ball, b.trail);
    b.ball.geometry.dispose();
    b.trail.geometry.dispose();
    (b.trail.material as THREE.Material).dispose();
    if (b.label) {
      this.group.remove(b.label);
      disposeSprite(b.label);
    }
  }
}
