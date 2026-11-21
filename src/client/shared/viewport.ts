// The on-screen keyboard. A phone's browser lays the page out as if the keyboard weren't there and
// slides it over the bottom, so a terminal's key row and the bottom of a window end up under it. The
// part of the screen that's left (visualViewport) is followed instead: styles/phone.css sizes the
// windows to --vv-height from --vv-top, so they shrink above the keyboard, and a terminal, which refits
// to its window, keeps its key row just above it. The 2D view follows it, and the 3D office does too
// on a phone (features/touch).

let following = false;

export function followKeyboard() {
  const vv = window.visualViewport;
  if (!vv || following) return;
  following = true;
  const root = document.documentElement.style;
  let frame = 0;
  const set = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      root.setProperty('--vv-height', `${Math.round(vv.height)}px`);
      root.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
      // Less than three quarters of the screen left: the keyboard is up.
      document.body.classList.toggle('keyboard-up', vv.height < window.innerHeight * 0.75);
    });
  };
  vv.addEventListener('resize', set);
  vv.addEventListener('scroll', set);
  set();
}
