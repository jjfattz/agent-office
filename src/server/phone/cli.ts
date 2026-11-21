// `agent-office phone`: 📱 Use on your phone from a terminal, for a headless server or anyone who'd
// rather. It works whether the office is running or not: the office picks up what it does within a
// minute, since both keep the same settings (config.json's "phone") and devices (devices.json).
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Accounts } from '../accounts.js';
import { officeHome } from '../config.js';
import { qrEncode, qrTerminal } from '../../shared/qr.js';
import { lookAt, serveOffice, unserve, type Looked } from './access.js';
import { Devices, PAIR_TTL_MS } from './pairing.js';
import { readPhone, writePhone } from './saved.js';
import { cliRunner, findTailscale, officeUrl, portUse, type Run } from './tailscale.js';

const HELP = `agent-office phone — reach the office from your phone, over Tailscale

Usage:
  agent-office phone [status]      Where each step of the setup is
  agent-office phone on            Put the office on your tailnet (Tailscale Serve)
  agent-office phone off           Take it off again: removes exactly what "on" added
  agent-office phone pair          A QR code that signs your phone in, once, for 10 minutes
         [--as <name>]             ...as that account (default: the shared office password)

Options:
  -d, --dir <dir>   The office's folder (default: this project if an office ran here,
                    else ~/agent-office, env AGENT_OFFICE_HOME)
  -p, --port <n>    The office's port (default 4600, env PORT)
  -h, --help        Show this help

Nothing goes on the public internet: only devices signed in to your Tailscale
account can open the address, and they still sign in to the office. The same
steps are in the office: ☰ → 📱 Use on your phone.
`;

const ok = (s: string) => `✅ ${s}`;
const todo = (s: string) => `❗ ${s}`;
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** `agent-office phone`: exits 0 when done, 1 when it couldn't, 2 for a usage error. */
export async function phoneCommand(argv: string[], run?: Run): Promise<number> {
  let dir = existsSync(path.join(process.cwd(), '.agent-office', 'config.json')) ? process.cwd() : officeHome();
  let port = Number(process.env.PORT) || 4600;
  let as = '';
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      process.stdout.write(HELP);
      return 0;
    } else if (a === '-d' || a === '--dir') {
      if (!argv[i + 1]) return usage('--dir needs a value');
      dir = path.resolve(argv[++i]);
    } else if (a === '-p' || a === '--port') {
      port = Number(argv[++i]);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) return usage('--port needs a port number');
    } else if (a === '--as') {
      if (!argv[i + 1]) return usage('--as needs an account name');
      as = argv[++i];
    } else if (a.startsWith('-')) return usage(`unknown option ${a}`);
    else args.push(a);
  }
  const dataDir = path.join(dir, '.agent-office');
  try {
    statSync(dataDir);
  } catch {
    return fail(`no office has run in ${dir} yet — start it once with \`agent-office\` there`);
  }
  const bin = run ? 'tailscale' : findTailscale();
  if (!bin) return fail('Tailscale isn’t installed on this computer. Get it at https://tailscale.com/download, then run this again.');
  run ??= cliRunner(bin);
  const look = await lookAt(run);
  const saved = readPhone(dataDir);
  const host = look.status.state === 'running' ? look.status.host : undefined;
  const served = !!host && !!saved.port && portUse(look.serve, host, saved.port, port) === 'office';
  const url = process.env.AGENT_OFFICE_TAILSCALE_HOST ? `https://${process.env.AGENT_OFFICE_TAILSCALE_HOST}` : served ? officeUrl(host!, saved.port!) : undefined;

  const [cmd = 'status'] = args;
  switch (cmd) {
    case 'status':
      return status(look, bin, url, saved.on, new Devices(dataDir));
    case 'on': {
      if (url) {
        console.log(`The office is on your tailnet already: ${url}`);
        writePhone(dataDir, { ...saved, on: true });
        return 0;
      }
      const r = await serveOffice(run, look, port, { onEnableLink: (link) => console.log(`Secure links are off for your tailnet. Turn them on here (this waits for it):\n\n  ${link}\n`) });
      if ('error' in r) return fail(r.operator ? `${r.error}\n\n  sudo tailscale set --operator=$USER` : r.error);
      writePhone(dataDir, { ...readPhone(dataDir), on: true, port: r.port });
      console.log(`📱 The office is on your tailnet: ${officeUrl(look.status.host!, r.port)}${r.moved ? '\n   (another app has https://…/ on this computer, so it took another port)' : ''}`);
      console.log('   Pair your phone: agent-office phone pair');
      return 0;
    }
    case 'off': {
      if (!host) return fail('Tailscale isn’t running and signed in, so it can’t be changed now.');
      const err = await unserve(run, host, port, [...(saved.port ? [saved.port] : []), ...saved.workerPorts]);
      if (err) return fail(`Tailscale couldn’t stop serving the office: ${err}`);
      const { port: _p, ...rest } = saved;
      writePhone(dataDir, { ...rest, on: false, workerPorts: [] });
      console.log('📱 Phone access is off. Your phone can’t reach the office any more.');
      return 0;
    }
    case 'pair': {
      if (!url) return fail('Phone access is off. Turn it on first: agent-office phone on');
      const accounts = new Accounts(dataDir);
      let owner: string | undefined;
      if (as) {
        const a = accounts.byName(as);
        if (!a) return fail(`there's no account called ${as}`);
        owner = a.id;
      } else if (!accounts.sharedPassword) return fail('the shared office password is off: pair as your own account with --as <name>');
      const { token } = new Devices(dataDir).pair(owner);
      const link = `${url}/pair#${token}`;
      console.log(`\n${qrTerminal(qrEncode(link))}\n`);
      console.log(`Scan it with your phone's camera, with Tailscale connected on the phone.`);
      console.log(`It signs the phone in${as ? ` as ${as}` : ''} once, within ${PAIR_TTL_MS / 60_000} minutes:\n\n  ${link}\n`);
      return 0;
    }
    default:
      return usage(`unknown command ${cmd}`);
  }
}

function status(look: Looked, bin: string, url: string | undefined, on: boolean, devices: Devices): number {
  const st = look.status;
  const running = st.state === 'running';
  const lines = [
    ok(`Tailscale is installed (${bin})`),
    st.state === 'down' ? todo('Tailscale isn’t running: open the Tailscale app, or start tailscaled') : running ? ok(`Signed in as ${st.user ?? 'you'} (${st.host})`) : todo(`Tailscale is ${st.state === 'off' ? 'switched off' : st.state === 'approve' ? 'waiting for your tailnet’s admin to approve this computer' : 'signed out: run `tailscale login`'}`),
    !running ? todo('Secure links: sign in first') : st.magicDns && st.https ? ok('Secure links (MagicDNS and HTTPS) are on') : todo('Secure links are off: turn on MagicDNS and HTTPS Certificates at https://login.tailscale.com/admin/dns'),
    url ? ok(`Phone access is on: ${url}`) : on ? todo('Phone access is on, but nothing serves the office yet: agent-office phone on') : todo('Phone access is off: agent-office phone on'),
  ];
  console.log('\n📱 Use on your phone\n');
  lines.forEach((l, i) => console.log(`  ${i + 1}. ${l}`));
  const list = devices.list();
  console.log(`  5. ${list.length ? ok(`Paired: ${list.map((d) => `${d.name}${d.lastSeenAt ? ` (seen ${ago(d.lastSeenAt)})` : ''}`).join(', ')}`) : todo('No phone paired yet: agent-office phone pair')}\n`);
  return 0;
}

function usage(msg: string): number {
  console.error(`agent-office phone: ${msg}\n`);
  process.stderr.write(HELP);
  return 2;
}

function fail(msg: string): number {
  console.error(`agent-office phone: ${msg}`);
  return 1;
}
