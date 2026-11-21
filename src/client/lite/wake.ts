import './wake.css';
// Coming back to the 2D view: a phone puts a page to sleep in the background, and its socket can be
// gone, or dead without saying so, by the time it's back. So coming back to the foreground connects
// again at once (rather than waiting out the backoff), and so does pulling the list down. Until the
// office has sent the floor again, the page says it's *Updating…*, so old cards aren't taken for now.
import type { Net } from '../net';
import { $, modalOpen } from '../ui/dom';
import { standalone, touchOnly } from '../ui/touch';

/** Away at least this long, and the connection is made again on coming back: a phone drops it soon after, a computer doesn't. */
const AWAY_MS = touchOnly() || standalone() ? 5_000 : 60_000;
/** How far the list is pulled before letting go refreshes it. */
const PULL_PX = 72;

export interface Wake {
  /** The office sent the floor: what's on screen is current. */
  updated(): void;
}

export function installWake(net: Net): Wake {
  const conn = $('conn');
  let updating = false;
  const paint = () => {
    conn.textContent = net.up ? 'Updating…' : 'Reconnecting…';
    conn.classList.toggle('hidden', net.up && !updating);
    document.body.classList.toggle('lite-stale', updating || !net.up);
  };
  net.onStatus(paint);
  const refresh = () => {
    updating = true;
    net.reconnect();
    paint();
  };

  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (!net.up || Date.now() - hiddenAt > AWAY_MS) refresh();
  });
  // A page brought back from the back/forward cache has a dead socket too.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) refresh();
  });

  // Pull to refresh: from the top of the list, with no window open.
  const pull = document.createElement('div');
  pull.className = 'lite-pull';
  pull.setAttribute('aria-hidden', 'true');
  document.body.append(pull);
  let startY: number | null = null;
  let dy = 0;
  window.addEventListener(
    'touchstart',
    (e) => {
      startY = window.scrollY <= 0 && !modalOpen() && e.touches.length === 1 ? e.touches[0].clientY : null;
      dy = 0;
    },
    { passive: true },
  );
  window.addEventListener(
    'touchmove',
    (e) => {
      if (startY === null) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      pull.style.setProperty('--pull', `${Math.min(dy, PULL_PX * 1.4)}px`);
      pull.textContent = dy >= PULL_PX ? '↻ Let go to refresh' : '↓ Pull to refresh';
      pull.classList.toggle('on', dy > 12);
    },
    { passive: true },
  );
  const end = () => {
    if (startY !== null && dy >= PULL_PX) refresh();
    startY = null;
    pull.classList.remove('on');
  };
  window.addEventListener('touchend', end, { passive: true });
  window.addEventListener('touchcancel', end, { passive: true });

  return {
    updated() {
      updating = false;
      paint();
    },
  };
}
