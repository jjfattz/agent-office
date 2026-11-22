import * as THREE from 'three';
import { BALL_R, TEE_H } from '../../../shared/golf';
import type { Interactable } from '../../world/types';
import { disposeSprite, mesh, textSprite, toon } from '../../world/toon';
import { golfBall } from './balls';
import type { Ball } from './round';

// Your ball, lying where you'll play your next from (teed up on a tee, or on the grass where the last
// one stopped), with a beam of light up from it and a label over it so you can find it from across
// the course, and what you press E at to play it.

export class BallMarker {
  readonly group = new THREE.Group();
  /** What E at your ball is (its `y` is the street's). */
  readonly interactable: Interactable = { kind: 'golfball', x: 0, z: 0, y: 0, radius: 1.8 };
  private readonly ball = golfBall();
  private readonly peg = mesh(new THREE.CylinderGeometry(0.012, 0.006, TEE_H + 0.02, 8), toon('#ffd166'), 0, (TEE_H + 0.02) / 2 - 0.01, 0, false);
  private readonly beam: THREE.Mesh;
  /** What the aim lands on: a ball's too small to point at. */
  private readonly pick: THREE.Mesh;
  private label: THREE.Sprite | null = null;
  private text = '';

  constructor() {
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 7, 8, 1, true), new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.35, depthWrite: false }));
    this.beam.position.y = 3.6;
    this.pick = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    for (const m of [this.ball, this.peg, this.pick]) m.userData.interact = this.interactable;
    this.group.add(this.ball, this.peg, this.beam, this.pick);
    this.group.visible = false;
  }

  /**
   * Shows the ball at `ball` (null hides it), `street` below the floor you're on, with `label` over
   * it; `near` you're up close (or over it), so the beam and the label get out of the way.
   */
  place(ball: Ball | null, street: number, label: string, near: boolean): void {
    this.group.visible = !!ball;
    this.interactable.off = !ball;
    if (!ball) return;
    const lift = ball.teed ? TEE_H : 0;
    this.group.position.set(ball.x, street, ball.z);
    this.ball.position.y = BALL_R + lift;
    this.peg.visible = ball.teed;
    this.beam.visible = !near;
    Object.assign(this.interactable, { x: ball.x, z: ball.z, y: street });
    if (label !== this.text) {
      this.text = label;
      if (this.label) {
        this.group.remove(this.label);
        disposeSprite(this.label);
      }
      this.label = textSprite(label, { bg: '#ffd166', color: '#2b2d42', size: 44, border: '#2b2d42' });
      this.label.position.y = 1.1;
      this.group.add(this.label);
    }
    if (this.label) this.label.visible = !near;
  }
}
