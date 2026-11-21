// A button that stands for a key presses that key, down when the thumb lands and up when it lifts, so
// whatever the key does on a keyboard happens the same way, holding included: the ball winds up while
// you hold Use and flies when you let go, a dart's throw likewise on Space, the emote wheel opens on 😀.
//
// The press goes to the window as a KeyboardEvent, where the keyboard's own listeners take it: the
// key chain in ctx.keys (input/keyboard.ts) with whatever you're in the middle of first, the keys you
// hold (player/pointer.ts), and the keyups the ball, the emote wheel and the tee and the oche wait
// for. Each key's doing stays in one place, its handler, rather than being done again here. None of
// them asks whether a key was really typed (isTrusted): tests/touch.test.ts keeps it that way.

/** The keys held down by the touch controls now, to let go of together. */
const held = new Set<string>();

function keyOf(code: string): string {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase();
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return ' ';
  return code;
}

function send(type: 'keydown' | 'keyup', code: string) {
  window.dispatchEvent(new KeyboardEvent(type, { code, key: keyOf(code), bubbles: true, cancelable: true }));
}

/** Puts the key `code` down, as the thumb lands on its button. Already down, it isn't pressed again. */
export function keyDown(code: string) {
  if (held.has(code)) return;
  held.add(code);
  send('keydown', code);
}

/** Lets the key `code` up, as the thumb lifts. */
export function keyUp(code: string) {
  if (!held.delete(code)) return;
  send('keyup', code);
}

/** A key pressed and let go at once. */
export function tapKey(code: string) {
  keyDown(code);
  keyUp(code);
}

/** Lets go of every key the touch controls hold (a stuck one would keep you jumping or winding up). */
export function releaseKeys() {
  for (const code of [...held]) keyUp(code);
}
