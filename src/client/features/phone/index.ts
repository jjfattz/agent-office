/**
 * 📱 Use on your phone, in the 3D office: the store learns whether the office can be reached from
 * phones as you arrive (the top bar's "📱 On"), a test notification sent from the window buzzes this
 * device when it's a paired phone, and the window is offered once, the first time you hire a worker.
 * The window itself is ui/phone.ts.
 */
import type { Ctx } from '../../core/context';
import { buzz } from '../../notify';
import { store } from '../../state';
import { h, toast } from '../../ui/dom';
import { openPhone } from '../../ui/phone';

/** Set once the offer was made in this browser, so it's never made again. */
const OFFERED = 'ao.phoneOffered';

export function installPhone(ctx: Ctx) {
  const { net } = ctx;
  ctx.messages.on('welcome', () => net.send({ t: 'phone.get' }));
  ctx.messages.on('phone.buzz', (m) => {
    buzz(m.title, m.body);
    toast(`${m.title} ${m.body}`);
  });

  // The workers already on the floor as you arrive aren't news; one you hire after is.
  let known: Set<string> | null = null;
  store.on('floor', () => (known = new Set(store.workers.keys())));
  store.on('workers', () => {
    if (!known) return;
    const fresh = [...store.workers.values()].filter((w) => !known!.has(w.id));
    for (const w of fresh) known.add(w.id);
    if (fresh.some((w) => w.createdBy === store.profile.name)) offer();
  });

  function offer() {
    const p = store.phone;
    if (!store.me.admin || !p || p.on || p.managed || offered()) return;
    try {
      localStorage.setItem(OFFERED, '1');
    } catch {
      // private browsing: it may be offered again
    }
    const el = h(
      'div.toast.info.phone-offer',
      {},
      '📱 Want to know when your workers need you while you’re away from your desk? ',
      h('button.btn', { type: 'button', onclick: () => (el.remove(), openPhone(net)) }, 'Use on your phone'),
    );
    document.getElementById('toasts')!.append(el);
    setTimeout(() => el.remove(), 15_000);
  }
}

function offered(): boolean {
  try {
    return localStorage.getItem(OFFERED) === '1';
  } catch {
    return true;
  }
}
