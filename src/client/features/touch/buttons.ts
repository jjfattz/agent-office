// The right thumb's buttons. They follow the hint bar (core/hintbar.ts), which already says, for
// whatever you're facing or in the middle of, which keys do something and what: E is the big Use
// button (*Use: Open terminal*), Space is Jump unless the hint has it for something else (*Brake*,
// *Hold to throw*), and the rest (P, C, X, O, Q…) fan out above them, only while they do something.
// 😀 opens the emote wheel and 💬 the chat. Each presses its key (see keys.ts), so holding one holds
// the key: the ball, the darts, the axes and the golf swing wind up while you hold and go when you
// let go, as they do on a keyboard.

import { h } from '../../ui/dom';
import { keyDown, keyUp, tapKey } from './keys';
import { codeOf, hintKeys, type HintKey } from './touches';

/** A button that holds its key down while a thumb's on it. */
function holdButton(el: HTMLElement, code: () => string | null) {
  let down: string | null = null;
  const up = () => {
    if (down) keyUp(down);
    down = null;
    el.classList.remove('down');
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const c = code();
    if (!c) return;
    el.setPointerCapture?.(e.pointerId);
    down = c;
    el.classList.add('down');
    keyDown(c);
  });
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
  // No menu or text selection from a long press (holding to wind up a shot).
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return up;
}

export class TouchButtons {
  readonly el: HTMLElement;
  private use: HTMLButtonElement;
  private useLabel: HTMLElement;
  private jump: HTMLButtonElement;
  private fan: HTMLElement;
  /** What the hint bar offers now. */
  private keys: HintKey[] = [];
  private fanKey = '';
  private lets: (() => void)[] = [];

  constructor(private hint: HTMLElement) {
    this.useLabel = h('span.touch-sub', {}, '');
    this.use = h('button.touch-btn.touch-use', { type: 'button', 'aria-label': 'Use (E)' }, h('span.touch-cap', {}, 'Use'), this.useLabel);
    this.jump = h('button.touch-btn.touch-jump', { type: 'button', 'aria-label': 'Jump (Space)' }, 'Jump');
    const emote = h('button.touch-btn.touch-small', { type: 'button', 'aria-label': 'Emotes (G)', title: 'Emotes' }, '😀');
    const chat = h('button.touch-btn.touch-small', { type: 'button', 'aria-label': 'Chat (T)', title: 'Chat' }, '💬');
    this.fan = h('div.touch-fan');
    this.el = h('div.touch-pad', { role: 'group', 'aria-label': 'Touch controls' }, this.fan, h('div.touch-row', {}, chat, emote, this.jump, this.use));
    this.lets.push(holdButton(this.use, () => (this.has('KeyE') ? 'KeyE' : null)));
    this.lets.push(holdButton(this.jump, () => 'Space'));
    // A tap opens the wheel and leaves it open, to tap an emote on it.
    this.lets.push(holdButton(emote, () => 'KeyG'));
    // The chat box takes the focus, and the phone's keyboard comes up only from a tap itself (iOS), so it's on the click.
    chat.addEventListener('pointerdown', (e) => e.preventDefault());
    chat.addEventListener('click', () => tapKey('KeyT'));
    // What's in the hint bar, and whether it shows (not what read() marks in it, which would wake it again).
    const observer = new MutationObserver(() => this.read());
    observer.observe(hint, { childList: true, subtree: true, characterData: true });
    observer.observe(hint, { attributes: true, attributeFilter: ['class'] });
    // How tall the buttons stand, with the fan however many rows it has: the hint bar sits just above (ui.css).
    new ResizeObserver(() => document.body.style.setProperty('--touch-pad-h', `${this.el.offsetHeight}px`)).observe(this.el);
    this.read();
  }

  /** Lets go of every button (a window opened, the tab went away). */
  letGo() {
    for (const up of this.lets) up();
  }

  private has(code: string): boolean {
    return this.keys.some((k) => k.code === code);
  }

  /** Reads the hint bar's key caps again, now it has changed. */
  private read() {
    const shown = !this.hint.classList.contains('hidden');
    const caps = shown ? [...this.hint.querySelectorAll('.key')] : [];
    this.keys = hintKeys(caps.map((cap) => ({ cap: cap.textContent ?? '', label: (cap.parentElement?.textContent ?? '').slice((cap.textContent ?? '').length) })));
    // A key with a button of its own says so there: the hint bar keeps the rest (what you face, "A D Aim").
    // And W A S D (or the mouse, aiming a dart) is the stick here.
    for (const cap of caps) {
      const text = cap.textContent ?? '';
      if (codeOf(text)) cap.parentElement?.classList.add('touch-on-btn');
      else if (/^(?:[WASD](?: [WASD])*|Mouse)$/.test(text)) cap.classList.add('touch-stick-cap');
    }
    const e = this.keys.find((k) => k.code === 'KeyE');
    this.use.classList.toggle('off', !e);
    this.use.setAttribute('aria-disabled', String(!e));
    this.useLabel.textContent = e?.label ?? '';
    this.use.setAttribute('aria-label', e ? `Use: ${e.label} (E)` : 'Use (E): nothing in reach');
    const space = this.keys.find((k) => k.code === 'Space');
    // "Hold to throw" says Throw: holding is what a button does anyway.
    const what = space?.label.replace(/^Hold to /, '') ?? 'Jump';
    this.jump.textContent = what.charAt(0).toUpperCase() + what.slice(1);
    this.jump.classList.toggle('busy', !!space);
    const rest = this.keys.filter((k) => k.code !== 'KeyE' && k.code !== 'Space');
    const fanKey = rest.map((k) => `${k.code}:${k.label}`).join('|');
    if (fanKey === this.fanKey) return;
    this.fanKey = fanKey;
    // The old buttons go, letting go of any key they held.
    for (const b of this.fan.children) b.dispatchEvent(new Event('pointercancel'));
    this.fan.replaceChildren(
      ...rest.map((k) => {
        const b = h('button.touch-btn.touch-key', { type: 'button', 'aria-label': `${k.label} (${k.cap})`, title: k.label }, h('span.key', {}, k.cap), h('span.touch-sub', {}, k.label));
        holdButton(b, () => k.code);
        return b;
      }),
    );
  }
}
