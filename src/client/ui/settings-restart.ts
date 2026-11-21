// ⚙️ Settings' Restart Agent Office, under Building, in the 3D office and the 2D view alike: the office
// stops and whatever started it starts it again (see server/restart.ts). Through the agent-office
// command, that looks for a newer version first, so it's how to pick up updates.
import type { Net } from '../net';
import { store } from '../state';
import { h } from './dom';
import { confirmDialog } from './prompt';

/** The setting, made by `frame` from what goes in it: the button and a note. Kept up to date while `paint` is called. */
export function restartSetting(net: Net, frame: (body: Node[]) => HTMLElement): { section: HTMLElement; paint: () => void } {
  const go = h('button.btn.danger', { type: 'button' }, '🔄 Restart Agent Office') as HTMLButtonElement;
  const note = h('p.setting-note');
  go.addEventListener('click', () =>
    confirmDialog(
      '🔄 Restart Agent Office?',
      store.upgrade.restarter === 'launcher'
        ? 'The office closes, looks for a newer version, and opens again, usually in a few seconds (a minute or so when there is one to build). Everyone is put back where they were.'
        : 'The office closes and opens again in a few seconds. Everyone is put back where they were.',
      'Restart',
      () => net.send({ t: 'office.restart' }),
    ),
  );
  const paint = () => {
    const u = store.upgrade;
    const admin = store.me.admin;
    const busy = u.phase === 'building' || u.phase === 'restarting';
    go.disabled = !u.restarter || !admin || busy;
    const how =
      u.restarter === 'launcher'
        ? 'Closes the office and has the agent-office command start it again, building and installing the newest version first when there is one. That’s how to pick up updates.'
        : u.restarter === 'service'
          ? 'Closes the office, and its service starts it again on the same version.'
          : 'This office can’t restart itself: it wasn’t started by the agent-office command, or by a service that starts it again. Restart it where it runs (Ctrl+C, then start it again).';
    const workers = u.restarter ? ' Workers keep working through it, and every browser reconnects by itself (onto the new version, if there is one).' : '';
    note.textContent = how + workers + (u.restarter && !admin ? ' Admins can restart it.' : '') + (busy ? ' It’s restarting now.' : '');
  };
  paint();
  return { section: frame([h('div.volume', {}, go), note]), paint };
}
