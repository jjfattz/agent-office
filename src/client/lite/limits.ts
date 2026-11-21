// The Claude plan's 5-hour session and weekly limits under the 2D view's workers, as under the 3D
// office's: of the account the floor you're on runs its Claude workers on (see server/whose-limits.ts),
// so it switches with the floor. Tap it to read them again.
import './limits.css';
import type { Net } from '../net';
import { store } from '../state';
import { $ } from '../ui/dom';
import { renderLimits } from '../ui/limits';

export function installLimits(net: Net) {
  const el = $('limits');
  const show = () => renderLimits(el);
  store.on('limits', show);
  // The reset countdowns tick down between reads.
  setInterval(show, 30_000);
  el.addEventListener('click', () => net.send({ t: 'limits.refresh' }));
  show();
}
