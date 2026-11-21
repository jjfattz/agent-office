export {}; // a module, so its names don't clash with the other pages' scripts

// A pairing link, /pair#<token>, from the QR code in the office's 📱 window: it signs this device in
// as whoever made the link, without a password, then asks what to call the device and opens the 2D
// view. The token rides in the fragment, so it never reaches a server log or a Referer header.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const token = location.hash.slice(1);
// Out of the address bar and the history: it works once anyway.
history.replaceState(null, '', location.pathname);
const form = $<HTMLFormElement>('form');
const name = $<HTMLInputElement>('name');
const submit = $<HTMLButtonElement>('submit');
const error = $('error');

function fail(msg: string) {
  $('sub').textContent = '';
  form.hidden = true;
  error.textContent = msg;
  $('login').hidden = false;
}

async function post(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; body: any }> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

async function pair() {
  if (!token) return fail('This link is missing its code. Scan the QR code in the office’s 📱 window again.');
  try {
    const r = await post('/api/pair', { token });
    if (!r.ok) return fail(r.body.error ?? 'This pairing link doesn’t work. Make a new QR code in the office.');
    const { device, who } = r.body as { device: string; who?: string };
    $('title').textContent = '✅ You’re in';
    $('sub').textContent = who ? `Signed in as ${who}.` : 'Signed in to the office.';
    name.value = device;
    form.hidden = false;
    name.select();
  } catch {
    fail('The office didn’t answer. Is Tailscale connected on this phone?');
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  submit.disabled = true;
  const wanted = name.value.trim();
  // Naming it is a nicety: the office opens either way.
  if (wanted) await post('/api/phone/device', { name: wanted }).catch(() => undefined);
  location.replace('/lite');
});

void pair();
