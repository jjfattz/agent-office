// The first time the touch controls are up in this browser: what each thumb does, once.

import { h, openModal } from '../../ui/dom';

/** Seen it: this browser isn't shown it again. */
const SEEN_KEY = 'agent-office.touch-intro';

export function introSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

/** Shows how to play with your thumbs, and remembers it was shown. */
export function showIntro() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // storage blocked: shown on every visit then, which is better than never
  }
  const ok = h('button.btn.primary', { type: 'button' }, 'Got it');
  const el = h(
    'div.modal.touch-intro',
    { role: 'dialog', 'aria-label': 'Touch controls' },
    h('header', {}, h('h2', {}, '👆 Playing with your thumbs')),
    h(
      'div.body',
      {},
      h(
        'ul',
        {},
        h('li', {}, h('b', {}, 'Left thumb walks. '), 'Put it down anywhere on the left and slide it the way you want to go. All the way out runs.'),
        h('li', {}, h('b', {}, 'Right side looks. '), 'Drag to look around; in third person, pinch to zoom. A quick tap uses what’s in the middle.'),
        h('li', {}, h('b', {}, 'Use '), 'does what the hint over it says: open a worker’s terminal, sit down, ride the elevator. Hold it to wind up a shot.'),
        h('li', {}, 'At a desk, its keys (Prompt, Changes, PR…) show above Use. 😀 emotes, 💬 chats, ☰ has everything else.'),
      ),
      h('p.setting-note', {}, 'Back to the 2D view: ☰ → 🗂️ 2D view. Turn these controls on or off under ⚙️ Settings → You.'),
    ),
    h('footer', {}, ok),
  );
  const modal = openModal(el);
  ok.addEventListener('click', () => modal.close());
}
