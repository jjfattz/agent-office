import { GAME_NAMES, TITLES, scoreText } from '../../../shared/cabinet';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { Cabinet } from './ui';
import { clip } from '../../ui/dom';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    cabinet: true;
  }
}

export interface CabinetDeps {
  /** A worker's terminal: one of yours needing you stops the game, with a button to it. */
  openTerminal(id: string): void;
}

/** The arcade cabinet by the jukebox: its games up close, and on its screen for everyone else on the floor. */
export function installCabinet(ctx: Ctx, deps: CabinetDeps): Cabinet {
  // The arcade cabinet next to it: its games up close, and on its screen for everyone else on the floor.
  const cabinet = new Cabinet(ctx.office.cabinet.screen, ctx.net, { openTerminal: (id) => deps.openTerminal(id), sound: (kind, n) => ctx.sound.arcade(kind, n) });
  ctx.ticks.add('play', ({ dt }) => cabinet.update(ctx.camera, dt));
  ctx.interactions.define('cabinet', {
    reach: 4,
    hint: () => {
      const c = store.cabinet;
      const f = store.cabinetFrame;
      if (c.player && c.player.id !== store.you) {
        const who = c.player.name;
        const game = GAME_NAMES[c.player.title];
        return { k: `${who}|${game}|${f?.score}`, parts: [hintTitle('🕹️ Arcade'), aside(`▶ ${clip(who, 24)} is playing ${game}${f ? ` · ${scoreText(f.score)}` : ''}`), key('E', 'Watch')] };
      }
      const left = cabinet.paused();
      const about = left ? `your ${GAME_NAMES[left.title]} game's paused at ${scoreText(left.score)}` : TITLES.map((t) => GAME_NAMES[t]).join(' · ');
      return { k: about, parts: [hintTitle('🕹️ Arcade'), aside(about), key('E', 'Play')] };
    },
    use: onE(() => cabinet.play()),
  });
  // With the camera up at its screen, the game has the screen: no hands drawn over it.
  ctx.view.add({ covers: () => cabinet.zoomed });
  return cabinet;
}
