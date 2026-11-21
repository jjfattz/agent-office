/**
 * Touch controls over the 3D office, for a phone or a tablet: the left thumb walks with a stick that
 * appears where it lands (joystick.ts), the right side looks around and pinches (look.ts), and buttons
 * that follow the hint bar use things (buttons.ts). They're up by themselves on a touch screen with no
 * mouse (touchOnly), and ⚙️ Settings turns them on or off (settings.touch). With a mouse, nothing here
 * shows or listens.
 *
 * The stick goes to the player as an analog input next to its keys (player/stick.ts), so it walks,
 * climbs, rides and gets up off seats as W A S D do, and the buttons press the keys they stand for
 * (keys.ts), so each does exactly what its key does.
 */
import './ui.css';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { followKeyboard } from '../../shared/viewport';
import { $, modalOpen } from '../../ui/dom';
import { touchOnly } from '../../ui/touch';
import { TouchButtons } from './buttons';
import { introSeen, showIntro } from './intro';
import { Joystick } from './joystick';
import { releaseKeys } from './keys';
import { Look } from './look';
import { Touches } from './touches';

/** The viewport as index.html has it, and with the browser's own pinch zoom off and the page under the notch (for the safe-area insets). */
const VIEWPORT = 'width=device-width, initial-scale=1';
const VIEWPORT_TOUCH = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

export function installTouch(ctx: Ctx) {
  const { player, canvas, settings } = ctx;
  const touches = new Touches();
  const joystick = new Joystick(player.stick);
  const look = new Look(player, () => settings.touchLook, canvas);
  const buttons = new TouchButtons($('hint'));
  $('hud').append(joystick.el, buttons.el);
  let on = false;
  /** The first-time overlay is waiting for the office to be on screen (see introWhenInView). */
  let introAsked = false;

  /** Every finger and every key lets go: you stop, and nothing's left held down. */
  function letGo() {
    touches.clear();
    joystick.end();
    look.clear();
    buttons.letGo();
    releaseKeys();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!on || e.pointerType === 'mouse' || !player.enabled || modalOpen()) return;
    e.preventDefault();
    const role = touches.start(e.pointerId, e.clientX, window.innerWidth);
    if (role === 'stick') joystick.start(e.clientX, e.clientY);
    else look.start(e.pointerId, e.clientX, e.clientY, e.timeStamp);
  });
  window.addEventListener('pointermove', (e) => {
    const role = touches.role(e.pointerId);
    if (role === 'stick') joystick.move(e.clientX, e.clientY);
    else if (role === 'look') look.move(e.pointerId, e.clientX, e.clientY);
  });
  const lift = (e: PointerEvent) => {
    const role = touches.end(e.pointerId);
    if (role === 'stick') joystick.end();
    else if (role === 'look') look.end(e.pointerId, e.timeStamp, e.type === 'pointerup');
  };
  window.addEventListener('pointerup', lift);
  window.addEventListener('pointercancel', lift);
  // A touch the browser took for itself, the tab hidden or the window losing focus: no stuck stick or key.
  window.addEventListener('touchcancel', letGo);
  window.addEventListener('blur', letGo);
  document.addEventListener('visibilitychange', () => document.hidden && letGo());
  ctx.windowOpened.add(letGo);
  // iOS Safari's own pinch zoom, which user-scalable=no doesn't stop there.
  document.addEventListener('gesturestart', (e) => on && e.preventDefault());

  /** Puts the controls up or takes them down. */
  function apply(want: boolean) {
    if (want === on) return;
    on = want;
    letGo();
    player.fingers = on;
    document.body.classList.toggle('touch-ui', on);
    paintPhone();
    document.querySelector('meta[name=viewport]')?.setAttribute('content', on ? VIEWPORT_TOUCH : VIEWPORT);
    if (on && !introSeen()) introWhenInView();
  }
  /** A phone's windows (styles/phone.css): full screen, above its keyboard, a thumb's size, a terminal with its keypad. */
  function paintPhone() {
    const phone = on || touchScreen;
    document.body.classList.toggle('phone-ui', phone);
    if (phone) followKeyboard();
  }
  /** A touch screen and no mouse, kept up to date as a mouse comes and goes (read every frame, so not asked for each time). */
  let touchScreen = touchOnly();
  for (const q of ['(pointer: coarse)', '(any-pointer: fine)']) {
    matchMedia(q).addEventListener('change', () => {
      touchScreen = touchOnly();
      paintPhone();
    });
  }
  const wanted = () => settings.touch === 'on' || (settings.touch === 'auto' && touchScreen);
  apply(wanted());
  paintPhone();
  // ⚙️ Settings changes settings in place (features/hud): picked up on the next frame.
  ctx.ticks.add('hud', () => {
    if (wanted() !== on) apply(!on);
  });

  /**
   * Shows the first-time overlay once the office is on screen: past the loading screen and the
   * character select, on a floor, with no window open. Looked for every half second until then.
   */
  function introWhenInView() {
    if (introAsked) return;
    introAsked = true;
    const check = () => {
      if (!on) return void (introAsked = false);
      const loading = document.getElementById('loading');
      if (!store.floor || modalOpen() || (loading && !loading.classList.contains('gone'))) return void setTimeout(check, 500);
      if (!introSeen()) showIntro();
    };
    check();
  }

  return { active: () => on };
}
