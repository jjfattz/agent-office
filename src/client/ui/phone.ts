import './phone.css';
import type { PhoneOs, PhoneState, PhoneTailscale } from '../../shared/protocol';
import { qrEncode, qrSvg } from '../../shared/qr';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { deviceList } from './phone-devices';
import { copyButton } from './team';

// ☰ → 📱 Use on your phone: from "I want this on my phone" to the phone buzzing, by following the
// buttons. Each step's ✅ / ⏳ / ❗ comes from what the office sees of Tailscale every few seconds while
// the window is open (server/phone/), so nobody has to know what state things are in.

const DOWNLOAD: Record<PhoneOs, string> = {
  mac: 'https://tailscale.com/download/mac',
  windows: 'https://tailscale.com/download/windows',
  linux: 'https://tailscale.com/download/linux',
  other: 'https://tailscale.com/download',
};
const APP_STORE = 'https://apps.apple.com/app/tailscale/id1470499037';
const GOOGLE_PLAY = 'https://play.google.com/store/apps/details?id=com.tailscale.ipn';
/** Where MagicDNS and HTTPS certificates are turned on, when Tailscale hasn't handed over its own link yet. */
const ADMIN_DNS = 'https://login.tailscale.com/admin/dns';

type Mark = 'ok' | 'wait' | 'todo' | 'error';
const MARK: Record<Mark, string> = { ok: '✅', wait: '⏳', todo: '⬜', error: '❗' };

const NOT_RUNNING: Record<PhoneOs, string> = {
  mac: 'Tailscale is installed but not running: open it from your Applications folder.',
  windows: 'Tailscale is installed but not running: open it from the Start menu.',
  linux: 'Tailscale is installed but not running: start it with sudo systemctl enable --now tailscaled.',
  other: 'Tailscale is installed but not running: start it.',
};
const SWITCHED_OFF: Record<PhoneOs, string> = {
  mac: 'Tailscale is switched off: turn it on from its icon in the menu bar.',
  windows: 'Tailscale is switched off: turn it on from its icon in the taskbar.',
  linux: 'Tailscale is switched off: turn it on with sudo tailscale up.',
  other: 'Tailscale is switched off: turn it on.',
};

const link = (href: string, text: string, cls = 'btn') => h('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer' }, text);
const note = (...kids: (Node | string)[]) => h('p.note', {}, ...kids);

/** One numbered step: its mark, what it's called, and what to do now. */
function step(n: number, mark: Mark, title: string, ...body: (Node | string | null | false)[]): HTMLElement {
  return h('li.phone-step', { class: mark, 'data-step': String(n) }, h('div.phone-step-head', {}, h('span.phone-mark', { 'aria-label': mark }, MARK[mark]), h('h4', {}, `${n}. ${title}`)), h('div.phone-step-body', {}, ...body));
}

/** A switch, on or off, that sends `onChange` when flipped. */
function toggle(label: string, on: boolean, disabled: boolean, onChange: (on: boolean) => void): HTMLElement {
  const box = h('input', { type: 'checkbox', role: 'switch', checked: on, disabled }) as HTMLInputElement;
  box.addEventListener('change', () => onChange(box.checked));
  return h('label.phone-switch', {}, box, h('span.phone-slider', { 'aria-hidden': 'true' }), h('span', {}, label));
}

/** The QR code for `text`, as an image `px` across. */
function qrImage(text: string, px: number, alt: string): HTMLElement {
  const img = h('img.phone-qr', { width: px, height: px, alt, src: `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg(qrEncode(text)))}` });
  return img;
}

let open = false;

/** Opens the 📱 window. */
export function openPhone(net: Net) {
  if (open) return;
  open = true;
  const body = h('div.body.team.phone');
  const el = h('div.modal', { role: 'dialog', 'aria-label': 'Use on your phone', style: 'width:min(680px,100%)' }, h('header', {}, h('h2', {}, '📱 Use on your phone'), h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕')), body);
  // The big QR code is made once per link, not on every look at Tailscale.
  let qrFor = '';
  let qr: HTMLElement | null = null;
  let renew: ReturnType<typeof setTimeout> | undefined;
  /** A test notification went to a phone of yours that has connected. */
  let tested = false;

  /** A pairing link, asked for while the office is reachable and the last one ran out. */
  const wantPairing = (s: PhoneState) => {
    const p = store.phonePairing;
    if (!s.url || (p && p.expiresAt - Date.now() > 30_000 && p.url.startsWith(s.url))) return;
    net.send({ t: 'phone.pair' });
  };

  const phoneStep = (n: number, s: PhoneState, ts?: PhoneTailscale): HTMLElement => {
    const mine = s.devices.filter((d) => d.mine && d.lastSeenAt).sort((a, b) => b.lastSeenAt! - a.lastSeenAt!);
    if (!s.url) return step(n, 'todo', 'Your phone', note('Once the office is open to your devices (step 4), a QR code here signs your phone in.'));
    const p = store.phonePairing;
    if (p && p.url !== qrFor) {
      qrFor = p.url;
      qr = qrImage(p.url, 220, 'QR code that signs your phone in to the office');
    }
    const appQr = (href: string, name: string) => h('a.phone-store', { href, target: '_blank', rel: 'noopener noreferrer' }, qrImage(href, 72, `QR code for Tailscale on ${name}`), h('span', {}, name));
    const phones = ts?.phones ?? [];
    return step(
      n,
      mine.length ? 'ok' : 'todo',
      'Your phone',
      mine.length ? h('p.team-status.ok', {}, `✅ ${mine[0].name} connected ${timeAgo(mine[0].lastSeenAt!)}`) : null,
      h(
        'div.phone-pair',
        {},
        h('div.phone-pair-code', {}, p && qr ? qr : h('div.phone-qr.phone-qr-wait', {}, 'Making a code…'), h('small', {}, 'Works once, for 10 minutes')),
        h(
          'ol.phone-pair-how',
          {},
          h('li', {}, 'Install the Tailscale app on your phone:', h('div.phone-stores', {}, appQr(APP_STORE, 'App Store'), appQr(GOOGLE_PLAY, 'Google Play'))),
          h('li', {}, `Sign in there with the same account${ts?.user ? ` (${ts.user})` : ''}.`),
          h('li', {}, 'Scan the big code with the phone’s camera. The office opens on the phone, already signed in.'),
        ),
      ),
      ts && !phones.length ? note('No phone on your tailnet yet. If the code opens nothing, check Tailscale is connected on the phone and signed in to the same account as this computer.') : null,
      phones.length ? note(`On your tailnet: ${phones.map((x) => `${x.name}${x.online ? '' : ' (offline)'}`).join(', ')}.`) : null,
      h('div.signin-actions', {}, h('button.btn', { type: 'button', onclick: () => net.send({ t: 'phone.pair' }) }, 'New code'), copyButton('Copy the link', () => store.phonePairing?.url ?? '')),
    );
  };

  const buzzStep = (n: number, s: PhoneState) => {
    const connected = s.devices.some((d) => d.mine && d.lastSeenAt);
    const test = () => {
      net.send({ t: 'phone.test' });
      tested = connected;
      render();
    };
    return step(
      n,
      tested ? 'ok' : 'todo',
      'Get a buzz',
      h('div.signin-actions', {}, h('button.btn', { type: 'button', disabled: !s.url, onclick: test }, '🔔 Send a test notification')),
      note('With the office open on your phone and notifications allowed (tap 🔔 there), a worker that needs you buzzes it. On an iPhone, first add it to your home screen: Share → Add to Home Screen.'),
    );
  };

  const adminSteps = (s: PhoneState, ts: PhoneTailscale): HTMLElement[] => {
    const installed = !['missing', 'down', 'off'].includes(ts.state);
    const running = ts.state === 'running';
    const secure = running && ts.magicDns && ts.https;
    const one = step(
      1,
      ts.state === 'missing' ? 'todo' : installed ? 'ok' : 'error',
      'Get Tailscale on this computer',
      note('Tailscale is a private network just for your devices. Free for personal use.'),
      ts.state === 'missing'
        ? h('div', {}, h('div.signin-actions', {}, link(DOWNLOAD[s.os], 'Download Tailscale ↗', 'btn primary')), ts.brew ? h('div.cmd', {}, h('pre', {}, 'brew install --cask tailscale'), copyButton('Copy', () => 'brew install --cask tailscale')) : null, note('Install it, open it, and this turns ✅ by itself.'))
        : ts.state === 'down'
          ? h('p.team-status.error', {}, NOT_RUNNING[s.os])
          : ts.state === 'off'
            ? h('p.team-status.error', {}, SWITCHED_OFF[s.os])
            : null,
    );
    const two = step(
      2,
      !installed ? 'todo' : running ? 'ok' : ts.state === 'login' ? (ts.loginUrl ? 'wait' : 'todo') : 'wait',
      'Sign in to Tailscale',
      running
        ? h('p.team-status.ok', {}, `✅ Signed in as ${ts.user ?? 'you'}`)
        : !installed
          ? note('Once it’s installed.')
          : ts.state === 'approve'
            ? h('p.team-status', {}, '⏳ Waiting for your tailnet’s admin to let this computer in.')
            : ts.state === 'starting'
              ? h('p.team-status', {}, '⏳ Connecting…')
              : ts.loginUrl
                ? h('div', {}, h('div.signin-actions', {}, link(ts.loginUrl, 'Open Tailscale’s sign-in page ↗', 'btn primary')), note('Sign in with the account you’ll use on your phone too. This turns ✅ by itself.'))
                : h('div.signin-actions', {}, h('button.btn.primary', { type: 'button', onclick: () => net.send({ t: 'phone.login' }) }, 'Sign in')),
    );
    const three = step(
      3,
      !running ? 'todo' : secure ? 'ok' : ts.enableUrl ? 'wait' : 'error',
      'Turn on secure links',
      !running
        ? note('After you’re signed in.')
        : secure
          ? h('p.team-status.ok', {}, '✅ MagicDNS and HTTPS certificates are on')
          : h('div', {}, note('Your tailnet needs MagicDNS and HTTPS certificates on, for a real https:// address.'), h('div.signin-actions', {}, link(ts.enableUrl ?? ADMIN_DNS, 'Turn on ↗', 'btn primary')), note(ts.enableUrl ? 'Tailscale is waiting for this, then it opens the office to your devices.' : 'Turn on both there. This turns ✅ by itself.')),
    );
    const four = step(
      4,
      s.url ? 'ok' : s.problem ? 'error' : s.busy || s.on ? 'wait' : 'todo',
      'Open the office to your devices',
      toggle('Let my devices open the office', s.on, !running || s.busy, (on) => net.send({ t: 'phone.access', on })),
      s.url
        ? h('div.cmd', {}, h('pre', {}, s.url), copyButton('Copy', () => s.url!), h('button.btn', { type: 'button', onclick: () => net.send({ t: 'phone.access', on: false }) }, 'Turn off'))
        : s.busy
          ? h('p.team-status', {}, s.on ? '⏳ Opening it…' : '⏳ Closing it…')
          : null,
      s.movedPort && ts.host ? note(`Another app already uses https://${ts.host}/ on this computer, so the office took another port.`) : null,
      s.problem ? h('p.team-status.error', {}, s.problem) : null,
      ts.operator ? h('div.cmd', {}, h('pre', {}, ts.operator), copyButton('Copy', () => ts.operator!)) : null,
      note('Only devices signed in to your Tailscale account can open it, and they still sign in to the office. Nothing goes on the public internet.'),
    );
    return [one, two, three, four];
  };

  const awakeStep = (n: number, s: PhoneState) =>
    step(
      n,
      !s.awake.on ? 'todo' : s.awake.holding ? 'ok' : 'wait',
      'Keep this computer awake',
      toggle('Keep it awake while phone access is on', s.awake.on, !s.admin, (on) => net.send({ t: 'phone.awake', on })),
      note('Your phone can only reach the office while this computer is on and awake.'),
      s.awake.laptop ? h('p.team-status', {}, `⚠️ ${s.awake.laptop}`) : null,
    );

  const render = () => {
    const s = store.phone;
    if (!s) return body.replaceChildren(h('p.empty', {}, 'Looking at Tailscale…'));
    wantPairing(s);
    const steps: HTMLElement[] = [];
    if (s.managed) {
      steps.push(step(1, 'ok', 'The office is on your tailnet', h('p.team-status.ok', {}, `✅ ${s.url}`), note('It was set up that way on this server, so there’s nothing to do here.')));
      steps.push(phoneStep(2, s), buzzStep(3, s));
    } else if (s.admin && s.tailscale) {
      steps.push(...adminSteps(s, s.tailscale), phoneStep(5, s, s.tailscale), buzzStep(6, s));
      if (s.awake.supported && s.on) steps.push(awakeStep(7, s));
    } else if (!s.url) {
      body.replaceChildren(h('p.team-status', {}, 'Ask an admin to turn on phone access. Then this pairs your phone with a QR code.'));
      return;
    } else steps.push(phoneStep(1, s), buzzStep(2, s));
    const mine = s.devices.filter((d) => d.mine);
    const others = s.devices.filter((d) => !d.mine);
    body.replaceChildren(
      h('p.note.lead', {}, 'Check on your workers from your phone, wherever you are: the office goes on your own private Tailscale network, and your phone pairs with a QR code. No terminal, no address to type, no password.'),
      h('ol.phone-steps', {}, ...steps),
      h('div.team-head', {}, h('h4', {}, 'Your devices')),
      deviceList(net, mine, false, 'None yet: the QR code above pairs one.'),
      ...(others.length ? [h('div.team-head', {}, h('h4', {}, 'Everyone else’s')), deviceList(net, others, true)] : []),
    );
    // Ask for a fresh code just before this one runs out.
    clearTimeout(renew);
    const p = store.phonePairing;
    if (p && s.url) renew = setTimeout(() => net.send({ t: 'phone.pair' }), Math.max(1000, p.expiresAt - Date.now() - 20_000));
  };

  const offs = [store.on('phone', render), store.on('phonePairing', render)];
  const modal = openModal(el, {
    doing: '📱 setting up their phone',
    onClose: () => {
      open = false;
      clearTimeout(renew);
      offs.forEach((off) => off());
      net.send({ t: 'phone.unwatch' });
    },
  });
  el.querySelector('header .close')!.addEventListener('click', () => modal.close());
  render();
  net.send({ t: 'phone.get', watch: true });
}

/** Whether the office is reachable from phones right now, for the top bar. */
export const phoneLive = () => !!store.phone?.url && !store.phone.managed;
