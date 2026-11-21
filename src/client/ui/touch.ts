// Whether this is a phone or a tablet with no mouse: for the 2D view's phone-sized behaviour, and the
// same check index.html makes before the 3D office loads.

/** A touch screen and no mouse: a phone or a tablet, which can't walk around the office anyway. */
export function touchOnly(): boolean {
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
}

/** Running as an app from the home screen, not in a browser tab. */
export function standalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** An iPhone or iPad (iPadOS says it's a Mac, but has a touch screen). */
export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}
