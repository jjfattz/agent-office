/**
 * Golf on the course across the street: three par 3s round a triangle (shared/course.ts). E at a tee
 * starts a round there; you play each hole out, tee shot, chip and putts, walking (or driving a golf
 * cart, see features/cars) to wherever your ball stopped and pressing E at it to play the next. A
 * scorecard keeps the round, and your best round and your holes in one are kept in this browser.
 * Everyone on your floor sees you swing and your ball fly, landing in the same spot.
 */
import { HOLES, lieAt, toPar } from '../../../shared/course';
import { clubFor, fly, pinText, puttRoll, type Flight, type Shot } from '../../../shared/golf';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { DESK_KEYS } from '../../interaction';
import { store } from '../../state';
import { h, toast } from '../../ui/dom';
import { BACKSWING_TIME, IMPACT, type Person } from '../../world/character';
import { neighbourBoxes } from '../../world/outside';
import type { Interactable } from '../../world/types';
import { GolfBalls } from './balls';
import { Scorecard } from './card';
import { Golfer } from './controller';
import { PuttGuide } from './guide';
import { BallMarker } from './marker';
import { GolfRound, type Outcome } from './round';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    golf: true;
    golfball: true;
  }
}

export interface GolfDeps {
  /** Up off whatever you're sitting on (see features/seating). */
  standUp(): void;
  /** Stops a walk over to someone, if you're on one. */
  stopWalking(): void;
  /** Puts your cigarette out, if you're on a smoke break (see features/smoke). */
  stopSmoking(): void;
  /** Someone else on your floor, as you see them. */
  personOf(id: string): Person | undefined;
}

/** Your best round (strokes for all three) and how many holes in one you've had, kept in this browser. */
const GOLF_KEY = 'agent-office.golf-course';
function record(): { best: number | null; aces: number } {
  try {
    const r = JSON.parse(localStorage.getItem(GOLF_KEY) ?? '{}') as { best?: unknown; aces?: unknown };
    return { best: typeof r.best === 'number' ? r.best : null, aces: typeof r.aces === 'number' ? r.aces : 0 };
  } catch {
    return { best: null, aces: 0 };
  }
}
function saveRecord(r: { best: number | null; aces: number }) {
  try {
    localStorage.setItem(GOLF_KEY, JSON.stringify(r));
  } catch {
    // private window: it's only for this visit then
  }
}

/** "1st", "2nd", "3rd". */
const nth = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** How long the camera stays on a ball that's stopped before the round moves on (in the hole, longer). */
const LINGER = 2.2;
const LINGER_HOLED = 4;
/** Your next shot this close to where you're standing, you step straight up to it. */
const STEP_UP = 7;
/** How long the scorecard stays up once the round's over (ms). */
const CARD_AFTER = 15000;

export function installGolf(ctx: Ctx, deps: GolfDeps) {
  const balls = new GolfBalls();
  ctx.scene.add(balls.group);
  const marker = new BallMarker();
  ctx.scene.add(marker.group);
  const card = new Scorecard();
  const guide = new PuttGuide();
  ctx.scene.add(guide.group);
  /** The hole whose flagstick you've had out to putt, if you have. */
  let flagOut: number | null = null;
  /** The neighbours' buildings, which a ball comes off. */
  const obstacles = neighbourBoxes();
  /** The round you're playing, if you are. */
  let round: GolfRound | null = null;
  /** Your shot on its way, until the round has where it stopped; and when the round finished. */
  let pending: Flight | null = null;
  let overAt = 0;
  const street = () => ctx.player.street;
  /** Down on the street (rather than up in the office), where the course is. */
  const outside = () => ctx.inOffice() && !ctx.upTop() && Math.abs(ctx.player.pos.y - street()) < 1.2;

  const golf = new Golfer(
    ctx.player,
    ctx.me,
    ctx.camera,
    {
      holding: (on) => ctx.net.send({ t: 'act', golf: on }),
      hit: (shot) => {
        if (!round) return;
        round.struck();
        ctx.net.send({ t: 'golf', ...shot });
        pending = fly(shot, obstacles);
        balls.launch(pending, store.you, store.profile.name, true);
        ctx.sound.golf(shot.club === 'putter' ? 'putt' : 'hit');
      },
      ball: () => balls.mine,
      street,
      skip: () => {
        const b = balls.mine;
        if (pending && b && b.still >= 0) settle(pending);
      },
      done: () => ctx.hint.invalidate(),
    },
    () => (round ? `⛳ Hole ${HOLES[round.hole].n} · ${HOLES[round.hole].name} · Par ${HOLES[round.hole].par} · Shot ${round.strokes + 1}` : '⛳ Golf'),
  );

  /** Q: the round's over, wherever you are in it, and your ball's picked up. */
  function endRound() {
    if (!round) return;
    const was = round;
    golf.stop();
    round = null;
    pending = null;
    balls.pickUp(store.you);
    if (!was.done) toast(`⛳ Round ended${was.played ? ` after ${was.played} hole${was.played === 1 ? '' : 's'}: ${was.total} (${toPar(was.toPar)})` : ''} · the clubs are back in the bag`, 'info');
  }

  // Q ends your round from anywhere, not only over the ball (unless your hands are full: Q's for putting that down).
  ctx.keys.add('activity', (e) => {
    if (e.code !== 'KeyQ' || !round || round.done || golf.active || ctx.carrying() || ctx.holdingBall()) return false;
    if (!e.repeat) endRound();
    return true;
  });

  /** Over your ball, with the club it wants. */
  function address() {
    if (!round || round.done) return;
    const { ball, hole } = round;
    golf.start(ball, hole, ball.teed ? 'iron' : clubFor(hole, ball.x, ball.z));
  }

  /** Where your shot went is settled: on with the round from there. */
  function settle(f: Flight) {
    pending = null;
    balls.pickUp(store.you);
    if (!round) return;
    const out = round.landed(f);
    tell(out, f);
    if (out.kind === 'holed' || round.done) {
      golf.stop();
      return;
    }
    // Lying close to where you're standing (a missed putt, or back where you hit it from): straight up to it.
    const p = ctx.player.pos;
    if (golf.active && Math.hypot(round.ball.x - p.x, round.ball.z - p.z) < STEP_UP) address();
    else golf.stop();
  }

  /** What became of your shot, in a toast (and confetti, for a birdie or better). */
  function tell(out: Outcome, f?: Flight) {
    if (!round) return;
    if (out.kind === 'penalty') {
      const back = out.why === 'water' && HOLES[round.hole].water.length ? 'drop it by the water' : 'play again from where you hit it';
      toast(out.why === 'water' ? `💦 In the water: a stroke added, ${back}` : `🚫 Out of bounds: a stroke added, ${back}`, 'warn');
      return;
    }
    if (out.kind === 'play') {
      if (round.ball.teed || !f) return;
      const far = Math.hypot(round.ball.x - ctx.player.pos.x, round.ball.z - ctx.player.pos.z);
      if (far >= STEP_UP) toast(`🏌️ ${pinText(f.fromPin)} from the pin: walk (or drive a cart) to your ball and press E`, 'info');
      return;
    }
    const hole = HOLES[out.hole];
    const under = out.strokes < hole.par && !out.picked;
    if (under || out.strokes === 1) {
      ctx.confetti.burst(hole.pin.x, street() + 1.2, hole.pin.z, out.strokes === 1 ? 300 : 160, 1.4);
      ctx.sound.golf('cheer');
    }
    const rec = record();
    if (out.strokes === 1) rec.aces++;
    const line = `${out.strokes === 1 ? '🏆' : under ? '🐦' : '⛳'} Hole ${hole.n}: ${out.name}${out.picked ? '' : ` (${out.strokes})`}`;
    if (out.next === null) {
      const best = rec.best === null || round.total < rec.best;
      if (best) rec.best = round.total;
      toast(`${line} · Round over: ${round.total} (${toPar(round.toPar)})${best ? ' · your best yet!' : ` · best ${rec.best}`}`, 'info');
      overAt = performance.now();
    } else toast(`${line} · On to the ${nth(HOLES[out.next].n)} tee`, 'info');
    saveRecord(rec);
  }

  /** E at tee `hole`: a new round from there (or on with this one, if it's your ball teed up there). */
  function teeOff(hole: number) {
    if (golf.active || ctx.trip()) return;
    const carrying = ctx.carrying();
    if (carrying) return toast(`✋ Your hands are full: put #${carrying.issue} down first (Q)`, 'warn');
    if (ctx.holdingBall()) return toast('🏀 Put the ball down first (Q)', 'warn');
    if (round && !round.done && round.hole === hole && !round.ball.teed) return;
    if (!round || round.done || round.hole !== hole) {
      if (round && !round.done && (round.played || round.strokes)) toast(`⛳ New round from hole ${HOLES[hole].n}`, 'info');
      round = new GolfRound(hole);
      pending = null;
      balls.pickUp(store.you);
    }
    getReady();
    address();
  }

  /** E at your ball: up to it to play your next. */
  function playBall() {
    if (golf.active || ctx.trip() || !round || pending) return;
    if (ctx.carrying() || ctx.holdingBall()) return toast('✋ Your hands are full: put it down first (Q)', 'warn');
    getReady();
    address();
  }

  function getReady() {
    if (ctx.player.seat) deps.standUp();
    ctx.activities.stopAll('start');
    deps.stopWalking();
    deps.stopSmoking();
  }

  ctx.activities.add({
    id: 'golf',
    active: () => golf.active,
    // The club goes back for anything but the office moving you off your floor (takenAway leaves it out).
    stop: (why) => {
      if (why !== 'taken') golf.stop();
    },
    // Over the ball, E steps away, C changes club and X picks it up (Space swings, see Golfer); nothing else is in reach, and no emotes mid-swing.
    key: (e) => {
      if (e.code !== 'KeyF' && e.code !== 'KeyG' && e.code !== 'KeyQ' && !(e.code in DESK_KEYS) && !/^(?:Digit|Numpad)[1-6]$/.test(e.code)) return false;
      if (e.repeat) return true;
      if (e.code === 'KeyE') golf.stop();
      else if (e.code === 'KeyC') golf.nextClub();
      else if (e.code === 'KeyX' && round && !pending && golf.doing === 'aim') {
        const out = round.pickUp();
        golf.stop();
        tell(out);
      } else if (e.code === 'KeyQ') endRound();
      return true;
    },
    hint: (el) => renderGolfHint(el),
    takesCamera: true,
    hidesHands: true,
    // Both hands are on the club: no mug in them (see feelTheCoffee in core/loop.ts).
    bothHands: true,
  });

  ctx.ticks.add('play', ({ dt }) => {
    // Pulled away from the ball (sat down, into the elevator, off up the building): the club goes back.
    if (golf.active && (ctx.trip() || ctx.activities.running('hanger') || ctx.player.seat || ctx.upTop())) golf.stop();
    golf.update(dt);
  });
  // The balls in the air, yours where it lies, and the scorecard.
  ctx.ticks.add('play', ({ dt, now }) => {
    balls.setStreet(street());
    balls.update(dt);
    const mine = balls.mine;
    if (pending && (!mine || (mine.still >= 0 && (!golf.active || mine.still > (pending.holed ? LINGER_HOLED : LINGER))))) settle(pending);
    if (round?.done && now - overAt > CARD_AFTER) round = null;
    const lying = round && !round.done && !pending ? round.ball : null;
    const p = ctx.player.pos;
    const near = !!lying && (golf.active || Math.hypot(lying.x - p.x, lying.z - p.z) < 2.5);
    const label = lying && round ? `⛳ Your ball · hole ${HOLES[round.hole].n} · shot ${round.strokes + 1}` : '';
    marker.place(ctx.inOffice() && !ctx.upTop() ? lying : null, street(), label, near);
    // Putting: the flag's out of the cup while your ball's on the green (or you've the putter out), and a line shows your aim.
    const putting = golf.active && golf.club === 'putter';
    const out = round && !round.done && (putting || lieAt(round.ball.x, round.ball.z) === 'green') ? round.hole : null;
    if (out !== flagOut) {
      if (flagOut !== null) ctx.office.course.pin(flagOut, false);
      if (out !== null) ctx.office.course.pin(out, true);
      flagOut = out;
    }
    const lining = putting && round && (golf.doing === 'aim' || golf.doing === 'charge');
    if (lining && round) {
      const b = golf.ball;
      const pin = HOLES[round.hole].pin;
      const charging = golf.doing === 'charge';
      guide.show(b, street(), golf.aim, charging ? puttRoll(golf.power) : Math.hypot(pin.x - b.x, pin.z - b.z), charging);
    } else guide.show(null, 0, 0, 0, false);
    card.show(round && !golf.active && (outside() || round.done) ? round : null, cardNote());
  });
  ctx.usables.add({ usable: () => (marker.interactable.off ? [] : [marker.interactable]), pickable: () => marker.group });

  /** The line under the scorecard: what to do next. */
  function cardNote(): string {
    if (!round) return '';
    if (round.done) {
      const best = record().best;
      return `Round over: ${round.total} (${toPar(round.toPar)})${best !== null ? ` · your best ${best}` : ''}`;
    }
    if (pending) return 'Watching it…';
    const h = HOLES[round.hole];
    const p = ctx.player.pos;
    const far = Math.round(Math.hypot(round.ball.x - p.x, round.ball.z - p.z));
    const where = round.ball.teed ? `Tee off on the ${nth(h.n)}` : `Your ball's ${pinText(Math.hypot(h.pin.x - round.ball.x, h.pin.z - round.ball.z))} from the pin`;
    return far > 3 ? `${where} · ${far} m away · E at it to play · Q ends the round` : `${where} · E to play it · Q ends the round`;
  }

  balls.onHit = (hit, mine) => {
    // Your own ball's heard wherever it lands (the camera's following it); anyone else's from where it is.
    const at = mine ? undefined : { x: hit.at.x, y: hit.at.y + street(), z: hit.at.z };
    if (hit.kind === 'bounce') ctx.sound.golf(hit.lie === 'sand' || hit.lie === 'rough' ? 'thud' : 'bounce', at, hit.speed);
    else if (hit.kind === 'lip') ctx.sound.golf('wall', at, hit.speed);
    else ctx.sound.golf(hit.kind, at, hit.speed);
  };
  balls.onRest = (f, who, mine) => {
    if (!mine && f.holed) {
      const hole = HOLES[f.shot.hole];
      ctx.confetti.burst(hole.pin.x, street() + 1.2, hole.pin.z, 120, 1.2);
      toast(`⛳ ${who} holed out on the ${hole.name}`);
    }
  };

  /** The hole whose tee `it` is. */
  const holeOf = (it: Interactable) => Math.max(0, ctx.office.course.tees.indexOf(it));

  ctx.interactions.define('golf', {
    reach: 3.5,
    hint: (it) => {
      const hole = HOLES[holeOf(it)];
      const on = round && !round.done && round.hole === holeOf(it) ? round : null;
      const { best, aces } = record();
      const about = [`Par ${hole.par}`, `${Math.round(Math.hypot(hole.pin.x - hole.tee.x, hole.pin.z - hole.tee.z))} m`, best !== null ? `your best round ${best}` : '', aces ? `🏆 ${aces} hole${aces === 1 ? '' : 's'} in one` : ''].filter(Boolean).join(' · ');
      // Off this tee already, your ball's out there: nothing to do here but go and find it.
      if (on && !on.ball.teed) return { k: `${hole.n}|out|${on.strokes}`, parts: [hintTitle(`⛳ ${hole.n} · ${hole.name}`), aside(`your ball's out there: shot ${on.strokes + 1} next`)] };
      const what = on ? (on.played ? 'Tee off' : 'Start your round') : round && !round.done ? 'New round here' : 'Start a round';
      return { k: `${hole.n}|${about}|${what}`, parts: [hintTitle(`⛳ ${hole.n} · ${hole.name}`), aside(about), key('E', what)] };
    },
    use: onE((it) => teeOff(holeOf(it))),
  });
  ctx.interactions.define('golfball', {
    reach: 3,
    hint: () => {
      if (!round) return { k: '', parts: [] };
      const h = HOLES[round.hole];
      const pin = pinText(Math.hypot(h.pin.x - round.ball.x, h.pin.z - round.ball.z));
      return { k: `${round.hole}|${round.strokes}|${pin}`, parts: [hintTitle(`⛳ Your ball · hole ${h.n}`), aside(`shot ${round.strokes + 1} · ${pin} from the pin`), key('E', 'Play it'), key('Q', 'End round')] };
    },
    use: onE(() => playBall()),
  });

  ctx.messages.on('golf', (msg) => theirShot(msg.id, { hole: msg.hole, x: msg.x, z: msg.z, club: msg.club, yaw: msg.yaw, loft: msg.loft, power: msg.power }));
  /** Someone else on the floor hit one: their swing, then their ball. */
  function theirShot(id: string, shot: Shot) {
    const p = store.peers.get(id);
    if (!p || !store.onMyFloor(p) || ctx.upTop()) return;
    deps.personOf(id)?.golfSwing(shot.club === 'putter' ? shot.power * 0.35 : shot.power);
    const floor = store.floor;
    setTimeout(() => {
      if (store.floor !== floor || ctx.upTop()) return;
      balls.launch(fly(shot, obstacles), id, p.name, false);
      ctx.sound.golf(shot.club === 'putter' ? 'putt' : 'hit', { x: shot.x, y: street() + 0.1, z: shot.z });
    }, (BACKSWING_TIME + IMPACT) * 1000);
  }

  /** Over the ball: how to aim and swing, or what's happening to it. */
  function renderGolfHint(el: HTMLElement) {
    const title = (text: string) => h('span.title', {}, text);
    const stage = golf.doing;
    ctx.hint.draw(el, `golf|${stage}|${golf.club}`, () =>
      stage === 'watch'
        ? [title('⛳ Fore!'), key('Space', 'Skip'), key('E', 'Step away'), key('Q', 'End round')]
        : stage === 'charge' || stage === 'swing'
          ? [title('⛳ Let go to hit it'), aside('the fuller the meter, the further it goes')]
          : [key('Space', 'Hold to swing'), key('A D', 'Aim'), ...(golf.club === 'putter' ? [] : [key('W S', 'Loft')]), key('C', 'Club'), key('X', 'Pick up'), key('Q', 'End round'), key('E', 'Step away')],
    );
  }

  return { golf, balls, round: () => round };
}
