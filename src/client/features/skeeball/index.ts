/**
 * The skeeball machine by the loft's stairs: stepping up to it, balls rolling up its lane (yours and
 * everyone's on the floor) and dropping into its rings, the score on its display, and your best game,
 * kept in this browser.
 */
import * as THREE from 'three';
import { BALLS, roll, type RollEvent } from '../../../shared/skeeball';
import type { Ctx, Hint } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { DESK_KEYS } from '../../interaction';
import { store } from '../../state';
import { clip, h, toast } from '../../ui/dom';
import { Roller } from './controller';
import type { SkeeballMachine } from './world';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    skeeball: true;
  }
}

export interface SkeeballDeps {
  /** Up off whatever you're sitting on (see features/seating). */
  standUp(): void;
  /** Stops a walk over to someone, if you're on one. */
  stopWalking(): void;
}

/** A game on the machine: whose, how many balls they've rolled and how many have dropped, and the score. */
interface Game {
  by: string;
  name: string;
  color: string;
  rolled: number;
  dropped: number;
  score: number;
  /** When its last ball was rolled (performance.now()). */
  at: number;
}

/** A game nobody's rolled in for this long (ms) is over, as far as waiting your turn goes. */
const IDLE = 15000;
/** How long the display shows a game that's over before it goes back to inviting you (ms). */
const OVER_SHOWN = 8000;
/** A game this good gets confetti, and everyone on the floor hears about it. */
const GREAT = 350;

export function installSkeeball(ctx: Ctx, deps: SkeeballDeps) {
  const BEST_KEY = 'agent-office.skeeball';
  let best: number | null = (() => {
    try {
      const n = Number(localStorage.getItem(BEST_KEY));
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  })();
  function saveBest() {
    try {
      localStorage.setItem(BEST_KEY, String(best));
    } catch {
      // private window: it's only for this visit then
    }
  }

  let game: Game | null = null;
  /** When the display goes back to inviting you (performance.now()), once a game's over. */
  let idleAt = 0;

  /** The machine, if the floor you're on has one (the office's own map does; the castle doesn't). */
  function machine(): SkeeballMachine | null {
    const m = ctx.office.skeeball;
    return !ctx.upTop() && ctx.world().interactables.includes(m.interactable) ? m : null;
  }

  const roller = new Roller(ctx.player, ctx.camera, ctx.canvas, {
    roll: (aim, power, n) => {
      const points = roll(aim, power).outcome.points;
      ctx.net.send({ t: 'skeeball', aim, power, n, points });
      rollHere(store.you, aim, power, n, points);
    },
    done: () => ctx.hint.invalidate(),
  });
  ctx.activities.add({
    id: 'skeeball',
    active: () => roller.active,
    stop: () => roller.stop(),
    // At the machine, E steps back (Space rolls, see Roller); nothing else is in reach, and no emotes mid-game.
    key: (e) => {
      if (e.code !== 'KeyF' && e.code !== 'KeyG' && !(e.code in DESK_KEYS) && !/^(?:Digit|Numpad)[1-6]$/.test(e.code)) return false;
      if (e.code === 'KeyE') roller.stop();
      return true;
    },
    hint: (el) => {
      const winding = roller.doing === 'wind';
      ctx.hint.draw(el, `skeeball|${winding}`, () => (winding ? [h('span.title', {}, 'Let go to roll!')] : [key('Mouse', 'Aim'), key('Space', 'Hold to roll'), key('E', 'Step back')]));
    },
    takesCamera: true,
    hidesHands: true,
  });
  ctx.view.add({
    fov: (fov) => (roller.active ? roller.fov : fov),
    // At the machine the camera's just over your head, looking up the lane: you're out of its way (everyone else still sees you there).
    update: () => {
      if (roller.active) ctx.me.root.visible = false;
    },
  });

  /** Someone else's game under way at the machine, if there is one: whose. */
  function playing(): string | null {
    if (!game || game.by === store.you || game.dropped >= BALLS || performance.now() - game.at > IDLE) return null;
    const p = store.peers.get(game.by);
    return p && store.onMyFloor(p) ? game.name : null;
  }

  function stepUp() {
    const m = machine();
    if (!m || roller.active || ctx.trip()) return;
    const other = playing();
    if (other) return toast(`🎳 ${other} is playing — wait your turn`, 'warn');
    if (ctx.player.seat) deps.standUp();
    ctx.activities.stopAll('start');
    deps.stopWalking();
    roller.start(m);
    m.setTrough(BALLS);
    m.display({ kind: 'game', name: store.profile.name, color: store.profile.color, score: 0, ball: 1 });
  }

  function hint(): Hint {
    const other = playing();
    if (other) return { k: `taken|${other}`, parts: [hintTitle('🎳 Skeeball'), aside(`${clip(other, 24)} is playing`)] };
    const about = best !== null ? `your best game: ${best}` : `${BALLS} balls a game`;
    return { k: about, parts: [hintTitle('🎳 Skeeball'), aside(about), key('E', 'Play')] };
  }
  ctx.interactions.define('skeeball', {
    reach: 4,
    hint,
    use: onE(() => stepUp()),
  });

  const at = new THREE.Vector3();
  /**
   * A ball rolled at the machine, by you or anyone else on the floor: up the lane, into a ring, and
   * onto the display. It counts `points`, what it scored for whoever rolled it.
   */
  function rollHere(by: string, aim: number, power: number, n: number, points: number) {
    const m = machine();
    if (!m) return;
    const mine = by === store.you;
    const peer = store.peers.get(by);
    // A new game (or somebody else's): the last one's over.
    if (n === 1 || !game || game.by !== by) {
      game = { by, name: mine ? store.profile.name : (peer?.name ?? 'Someone'), color: mine ? store.profile.color : (peer?.color ?? '#8ecae6'), rolled: 0, dropped: 0, score: 0, at: 0 };
    }
    const it = game;
    it.rolled = Math.max(it.rolled, n);
    it.at = performance.now();
    idleAt = 0;
    m.setTrough(BALLS - it.rolled);
    m.display({ kind: 'game', name: it.name, color: it.color, score: it.score, ball: n });
    const { path, events, outcome } = roll(aim, power);
    const hop = events.find((e) => e.kind === 'hop');
    ctx.sound.skeeball('roll', m.toWorld(0.6, 0, 0.8, at), 0, hop?.t ?? path[path.length - 1].t);
    m.launch(path, events, sound, () => dropped(m, it, points, points === outcome.points ? outcome.label : String(points), mine));
  }

  /** What the ball sounds like as it goes: off the hump, onto the target, off a lip or a rail. */
  function sound(e: RollEvent, where: THREE.Vector3) {
    if (e.kind === 'hop') ctx.sound.skeeball('hop', where);
    else if (e.kind === 'land' || e.kind === 'back') ctx.sound.skeeball('thud', where, e.speed);
    else if (e.kind === 'lip' || e.kind === 'rail') ctx.sound.skeeball('click', where, e.speed);
    else ctx.sound.skeeball('drop', where);
  }

  /** A ball went down its hole: its points on the board, and the game over after the last one. */
  function dropped(m: SkeeballMachine, it: Game, points: number, label: string, mine: boolean) {
    const where = m.toWorld(2.8, 0, 1.2, at);
    // Somebody else's game started while this was on its way: it doesn't count on theirs.
    if (game !== it || it.dropped >= BALLS) return;
    it.dropped++;
    it.score += points;
    if (points) {
      ctx.sound.skeeball(points === 100 ? 'jackpot' : 'score', where, points);
      m.flash(points, points === 100 ? '100!' : `+${points}`, points === 100 ? '#ffbe0b' : points >= 50 ? '#ff3d7f' : '#3a86ff');
    } else m.flash(0, 'Too soft', '#6c757d');
    const over = it.dropped === BALLS;
    if (mine) roller.setInfo(`${label} · ${it.score} so far`);
    if (!over) {
      m.display({ kind: 'game', name: it.name, color: it.color, score: it.score, ball: Math.min(BALLS, it.rolled + 1) });
      return;
    }
    gameOver(m, it, mine);
  }

  function gameOver(m: SkeeballMachine, it: Game, mine: boolean) {
    const beat = mine && (best === null || it.score > best);
    m.display({ kind: 'over', name: it.name, color: it.color, score: it.score, best: beat });
    idleAt = performance.now() + OVER_SHOWN;
    const great = it.score >= GREAT;
    if (great) {
      const top = m.toWorld(2.9, 0, 2.6, at);
      ctx.confetti.burst(top.x, top.y, top.z, 160, 0.8);
    }
    if (!mine) {
      if (great) toast(`🎳 ${it.name} scored ${it.score} at skeeball`);
      return;
    }
    roller.newGame();
    roller.setInfo(`${it.score} with ${BALLS} balls · Space for another game`);
    const was = best;
    if (beat) {
      best = it.score;
      saveBest();
    }
    toast(`🎳 ${it.score} with ${BALLS} balls${beat && was !== null ? ' — your best yet!' : ''}`);
    ctx.hint.invalidate();
  }

  ctx.messages.on('skeeball', (msg) => {
    const p = store.peers.get(msg.id);
    if (!p || !store.onMyFloor(p)) return;
    rollHere(msg.id, msg.aim, msg.power, msg.n, msg.points);
  });

  ctx.ticks.add('play', ({ dt }) => {
    // Pulled away from the machine (sat down, into the elevator, off to another map): the ball goes back.
    if (roller.active && (ctx.trip() || ctx.activities.running('hanger') || ctx.player.seat || !machine())) roller.stop();
    roller.update(dt);
    // A game that's over, or one left half-played, gives the display back to whoever's next.
    const m = ctx.office.skeeball;
    const stale = game && !(game.by === store.you && roller.active) && performance.now() - game.at > IDLE * 2;
    if ((idleAt && performance.now() > idleAt) || stale) {
      idleAt = 0;
      game = null;
      m.setTrough(BALLS);
      m.display({ kind: 'idle', best });
    }
  });

  return { roller };
}
