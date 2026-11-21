import './install.css';
// 📲 Add to home screen: the 2D view as an app, with its own icon, opening full screen without the
// address bar, and (on an iPhone, where it's the only way) able to get notifications. Offered once:
// Android's own install prompt (beforeinstallprompt), or on an iPhone, which has no prompt, a card
// showing where Share → Add to Home Screen is.
import { h } from '../ui/dom';
import { isIos, standalone, touchOnly } from '../ui/touch';

const SEEN_KEY = 'agent-office.install-hint';
/** Not straight away: the workers first. */
const AFTER_MS = 4000;

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // no storage: it would come back every time, so not at all
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // storage blocked
  }
}

/** The iPhone's Share button, as Safari draws it. */
const SHARE_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 10H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const ADD_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8.5v7M8.5 12h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

function card(...body: (HTMLElement | string)[]): { el: HTMLElement; close: () => void } {
  const x = h('button.btn.install-x', { type: 'button', 'aria-label': 'Not now' }, '✕');
  const el = h('aside.install-hint.panel', { role: 'dialog', 'aria-label': 'Add to home screen' }, x, ...body);
  const close = () => {
    markSeen();
    el.remove();
  };
  x.addEventListener('click', close);
  document.body.append(el);
  return { el, close };
}

/** Offers to put the office on the home screen, once, on a phone that hasn't yet. */
export function installHint() {
  if (standalone() || seen()) return;
  let deferred: InstallPrompt | undefined;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
  });
  window.addEventListener('appinstalled', markSeen);
  setTimeout(() => {
    if (standalone() || seen() || document.querySelector('.backdrop')) return;
    if (deferred) {
      const prompt = deferred;
      const add = h('button.btn.primary', { type: 'button' }, '📲 Add to home screen');
      const c = card(h('h3', {}, '📲 Make it an app'), h('p', {}, 'Put the office on your home screen: it opens like an app, and can buzz you when a worker needs you.'), add);
      add.addEventListener('click', async () => {
        c.close();
        await prompt.prompt().catch(() => {});
      });
    } else if (isIos() && touchOnly()) {
      const step = (n: number, icon: string, text: string) => {
        const i = h('span.install-icon', {});
        i.innerHTML = icon;
        return h('li', {}, h('span.install-n', {}, String(n)), i, h('span', {}, text));
      };
      const ok = h('button.btn.primary', { type: 'button' }, 'Got it');
      const c = card(
        h('h3', {}, '📲 Add to Home Screen'),
        h('p', {}, 'It opens like an app, and it’s how an iPhone lets the office buzz you when a worker needs you.'),
        h('ol.install-steps', {}, step(1, SHARE_ICON, 'Tap Share, at the bottom of Safari'), step(2, ADD_ICON, 'Tap Add to Home Screen'), step(3, '<img src="/icons/apple-touch-icon.png" alt="" width="22" height="22">', 'Open the office from its new icon')),
        ok,
      );
      ok.addEventListener('click', c.close);
    }
  }, AFTER_MS);
}
