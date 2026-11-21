// Return in a prompt box. With a keyboard, Enter sends and Shift+Enter makes a new line; a phone's
// keyboard has no Shift+Enter, and Return there sending a half-written prompt is a trap, so on a touch
// screen Return is a new line and the Send button sends.
import { h } from './dom';
import { touchOnly } from './touch';

/** Makes Enter in `ta` call `send` (not on a touch screen); the hint for the window's footer, or null where there's none to give. */
export function enterSends(ta: HTMLTextAreaElement, send: () => void): HTMLElement | null {
  if (touchOnly()) {
    ta.enterKeyHint = 'enter';
    return null;
  }
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  return h('span', {}, 'Enter to send · Shift+Enter for a new line');
}
