import type { Ctx } from '../../core/context';
import { Retro, type RetroDeps } from './ui';

/**
 * The boss's computer upstairs: retro games for the NES, the SNES, the Genesis, the Atari 2600 and
 * more, from the boss's chair (the chair's E plays them, see features/seating). See docs/retro.md.
 */
export function installRetro(ctx: Ctx, deps: RetroDeps): Retro {
  const retro = new Retro(ctx.office.bossScreen, deps);
  ctx.ticks.add('play', ({ dt }) => retro.update(ctx.camera, dt));
  // With the camera up at the monitor, the game has the screen: no hands drawn over it.
  ctx.view.add({ covers: () => retro.zoomed });
  return retro;
}
