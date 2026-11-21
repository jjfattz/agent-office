// An analog stick's say in where you walk, next to the keys: the touch controls' joystick
// (features/touch) sets it, and the player reads it where it reads W A S D (see index.ts).

/**
 * Where a stick is pushed: `x` to the right and `z` back (as the keys have it: W is z −1), each −1 to
 * 1, at most 1 long. How long it is says how fast you walk; `run` is pushed all the way, at a run.
 */
export interface Stick {
  x: number;
  z: number;
  run: boolean;
}

/** How far the stick has to go one way to count as that way's key, for what reads keys (a car's pedals, aiming at the tee). */
export const STICK_KEY_AT = 0.35;

/** Whether the stick, pushed as it is, holds down the key `code` (W A S D, the arrows, Shift). */
export function stickHolds(s: Stick, code: string): boolean {
  switch (code) {
    case 'KeyW':
    case 'ArrowUp':
      return s.z <= -STICK_KEY_AT;
    case 'KeyS':
    case 'ArrowDown':
      return s.z >= STICK_KEY_AT;
    case 'KeyA':
    case 'ArrowLeft':
      return s.x <= -STICK_KEY_AT;
    case 'KeyD':
    case 'ArrowRight':
      return s.x >= STICK_KEY_AT;
    case 'ShiftLeft':
    case 'ShiftRight':
      return s.run;
    default:
      return false;
  }
}

/** Whether the stick is pushed at all. */
export function stickPushed(s: Stick): boolean {
  return s.x !== 0 || s.z !== 0;
}
