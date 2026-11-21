import './litesuggest.css';
// Offering the 2D view (/lite) where the 3D office is hard going: on a phone, with no keys to walk
// with, or on a computer where frames come slowly (see framerate.ts).

import { h } from './dom';

import { touchOnly } from './touch';

export { touchOnly };

/** Said to stay in 3D: this browser isn't offered the 2D view again (it's in the ☰ menu). */
const DECLINED_KEY = 'agent-office.lite-declined';
/**
 * On a phone, staying in 3D (🏢 3D, which sets DECLINED_KEY) is a choice of the 3D office, not of its
 * speed: told it's slow, Stay in 3D there is remembered apart.
 */
const SLOW_DECLINED_KEY = 'agent-office.lite-declined-slow';

/** The key that says this browser stayed in 3D when offered the 2D view for `why`. */
function keyFor(why: 'touch' | 'slow'): string {
  return why === 'slow' && touchOnly() ? SLOW_DECLINED_KEY : DECLINED_KEY;
}

function declined(why: 'touch' | 'slow'): boolean {
  try {
    return localStorage.getItem(keyFor(why)) === '1';
  } catch {
    return false;
  }
}

/**
 * Off to the 2D view (☰ → 🗂️ 2D view), forgetting the choice to stay in 3D, so a phone's next visit
 * to the office lands on the 2D view again (index.html).
 */
export function leave3d() {
  try {
    localStorage.removeItem(DECLINED_KEY);
  } catch {
    // storage blocked: nothing was remembered either
  }
  location.assign('/lite');
}

let offered = false;

/** Offers the 2D view, at most once a page, unless this browser said to stay in 3D before. */
export function offerLite(why: 'touch' | 'slow') {
  if (offered || declined(why)) return;
  offered = true;
  const say =
    why === 'touch'
      ? '📱 On a phone? The 2D view is made for it: every worker and how it’s doing, its terminal, and the boards.'
      : `🐢 The 3D office is running slowly on this ${touchOnly() ? 'phone' : 'computer'}. The 2D view has the workers, their terminals and the boards, without the 3D.`;
  const stay = h('button.btn', { type: 'button' }, 'Stay in 3D');
  const el = h(
    'div.lite-offer.panel',
    { role: 'dialog', 'aria-label': 'Try the 2D view' },
    h('p', {}, say),
    h('div.lite-offer-btns', {}, h('a.btn.primary', { href: '/lite' }, 'Open the 2D view'), stay),
  );
  stay.addEventListener('click', () => {
    try {
      localStorage.setItem(keyFor(why), '1');
    } catch {
      // storage blocked: it's only this page then
    }
    el.remove();
  });
  document.body.append(el);
}
