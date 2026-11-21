// ⚙️ Settings → You → Touch controls: whether the 3D office's touch controls are up (features/touch),
// and how hard dragging a finger turns you.

import type { Settings, TouchControls } from '../state';
import { h } from './dom';
import { choiceRow } from './settings-rows';

const NOTE: Record<TouchControls, string> = {
  auto: 'Up by themselves on a phone or a tablet with no mouse: the left thumb walks, the right side looks, and Use does what the hint says.',
  on: 'Always up, on a touchscreen laptop too. The mouse and keys still work as well.',
  off: 'Never up, for a phone or a tablet with a keyboard and mouse of its own. Dragging the office still looks around.',
};

/** The rows: auto / on / off, what that means, and the look speed. `change` saves a change. */
export function touchSetting(settings: () => Settings, change: (some: Partial<Settings>) => void): Node[] {
  const note = h('p.setting-note');
  const paintNote = () => (note.textContent = NOTE[settings().touch]);
  const row = choiceRow<TouchControls>(
    'Touch controls',
    [
      ['auto', '📱 Auto'],
      ['on', '👆 On'],
      ['off', 'Off'],
    ],
    () => settings().touch,
    (touch) => {
      change({ touch });
      paintNote();
    },
  );
  paintNote();
  const slider = h('input', { type: 'range', min: 50, max: 200, step: 5, 'aria-label': 'Look speed with a finger' });
  const pct = h('span.vol-pct');
  const paint = () => {
    const v = Math.round(settings().touchLook * 100);
    slider.value = String(v);
    slider.style.setProperty('--fill', `${((v - 50) / 150) * 100}%`);
    pct.textContent = `${(v / 100).toFixed(2).replace(/0$/, '')}×`;
  };
  paint();
  slider.addEventListener('input', () => {
    change({ touchLook: Number(slider.value) / 100 });
    paint();
  });
  return [row, note, h('div.volume', {}, h('span', { style: 'flex:none;font-weight:900;font-size:14px' }, '👆 Look speed'), slider, pct)];
}
