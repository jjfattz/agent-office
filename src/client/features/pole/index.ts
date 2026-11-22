/**
 * The fire pole off the west end of the balcony: E at it climbs you over the railing and slides you
 * all the way down to the street, the quick way out of the building from any floor. It's a way out
 * only: it doesn't stop at the floors on the way down, and from the street it goes nowhere (the
 * elevator in the garage takes you back up).
 */
import { BALCONY, SLAB } from '../../../shared/layout';
import { POLE } from '../../../shared/pole';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { DESK_KEYS } from '../../interaction';
import { toast } from '../../ui/dom';
import { Slide } from './slide';
import { slideSeconds } from './sound';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    pole: true;
  }
}

export interface PoleDeps {
  /** Up off whatever you're sitting on (see features/seating). */
  standUp(): void;
  /** Stops a walk over to someone, if you're on one. */
  stopWalking(): void;
  /** Puts your cigarette out, if you're on a smoke break (see features/smoke). */
  stopSmoking(): void;
}

export function installPole(ctx: Ctx, deps: PoleDeps) {
  const { player } = ctx;
  let slide: Slide | null = null;

  /** Up on your floor (not down on the street under it), out on the balcony. */
  const upHere = () => player.pos.y > -SLAB - 1;
  const onBalcony = () => upHere() && player.pos.z > BALCONY.minZ - 0.1 && player.pos.x > BALCONY.minX - 0.5 && player.pos.x < BALCONY.maxX + 0.5;

  /** Lets go of you: at the bottom, or the office took you somewhere else on the way down. */
  function release() {
    if (!slide) return;
    slide = null;
    player.rig = null;
    player.vy = 0;
    player.grounded = true;
    player.lookPitch = -0.08;
    if (player.view === 'third') player.camYaw = player.facing + Math.PI;
    ctx.hint.invalidate();
  }

  function slideDown() {
    if (slide || ctx.trip() || !ctx.inOffice() || ctx.upTop()) return;
    if (!onBalcony()) return toast('🚒 The fire pole is out on the balcony, past its railing', 'warn');
    const carrying = ctx.carrying();
    if (carrying) return toast(`✋ Your hands are full: put #${carrying.issue} down first (Q)`, 'warn');
    if (player.seat) deps.standUp();
    ctx.activities.stopAll('start');
    deps.stopWalking();
    deps.stopSmoking();
    const bottom = ctx.office.pole.bottom;
    const s = new Slide(player.pos, bottom, player.facing);
    slide = s;
    let grabbed = false;
    let landed = false;
    player.rig = (dt) => {
      const going = s.step(player.pos, dt);
      player.facing = s.heading;
      if (!grabbed && s.phase === 'down') {
        grabbed = true;
        ctx.sound.pole('grab', { x: POLE.x, y: player.pos.y + 1.6, z: POLE.z }, slideSeconds(player.pos.y - bottom));
      }
      if (!landed && (s.phase === 'off' || s.phase === 'done')) {
        landed = true;
        ctx.sound.pole('land', { x: POLE.x, y: bottom, z: POLE.z });
      }
      if (!going) {
        release();
        toast('🚒 Down on the street. The elevator in the garage takes you back up');
      }
    };
    ctx.hint.invalidate();
  }

  ctx.activities.add({
    id: 'pole',
    active: () => !!slide,
    // There's no letting go halfway down: only the office moving you off your floor takes you off it.
    stop: (why) => {
      if (why === 'taken' || why === 'trip' || why === 'map') release();
    },
    // Nothing else is in reach on the way down.
    key: (e) => e.code in DESK_KEYS || e.code === 'KeyF' || e.code === 'KeyG',
    hint: (el) => ctx.hint.draw(el, 'pole', () => [hintTitle('🚒 Sliding down the fire pole'), aside('all the way down to the street')]),
  });
  ctx.ticks.add('play', () => {
    if (slide && (ctx.trip() || ctx.upTop() || !ctx.inOffice())) release();
  });

  ctx.interactions.define('pole', {
    reach: 2.6,
    hint: () =>
      upHere()
        ? { k: 'up', parts: [hintTitle('🚒 Fire pole'), aside('exit only: down to the street'), key('E', 'Slide down')] }
        : { k: 'down', parts: [hintTitle('🚒 Fire pole'), aside('exit only: no climbing up. The elevator in the garage goes up')] },
    use: onE(() => {
      if (upHere()) slideDown();
      else toast("🚒 The fire pole is exit only: there's no climbing up it", 'warn');
    }),
  });

  return { sliding: () => !!slide };
}
