#!/usr/bin/env node
// A stand-in for Tailscale's command line, for tests/phone.test.ts: it answers from files in
// $FAKE_TS_DIR and writes down every command it's given (log.jsonl), so the whole 📱 flow runs
// without Tailscale.
//
//   status.json   what `status --json` prints (missing: the daemon is down)
//   serve.json    Serve's settings, which `serve ... ` changes like the real one
//   https-off     while there, `serve --bg` prints the link that turns HTTPS on and waits
//   denied        while there, `serve --bg` is refused like Linux without an operator
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.env.FAKE_TS_DIR;
const args = process.argv.slice(2);
appendFileSync(path.join(dir, 'log.jsonl'), `${JSON.stringify(args)}\n`);
const file = (name) => path.join(dir, name);
const read = (name, fallback) => (existsSync(file(name)) ? JSON.parse(readFileSync(file(name), 'utf8')) : fallback);
const host = () => read('status.json', {}).Self?.DNSName?.replace(/\.$/, '') ?? 'box.tail0.ts.net';
const wait = () => setInterval(() => {}, 1 << 30);

if (args[0] === 'status') {
  if (!existsSync(file('status.json'))) {
    process.stderr.write('failed to connect to local tailscaled; it doesn’t appear to be running\n');
    process.exit(1);
  }
  process.stdout.write(readFileSync(file('status.json'), 'utf8'));
} else if (args[0] === 'login') {
  process.stdout.write('\nTo authenticate, visit:\n\n\thttps://login.tailscale.com/a/fake123\n\n');
  wait();
} else if (args[0] === 'serve' && args[1] === 'status') {
  process.stdout.write(JSON.stringify(read('serve.json', {})));
} else if (args[0] === 'serve') {
  const port = /^--https=(\d+)$/.exec(args.find((a) => a.startsWith('--https=')) ?? '')?.[1];
  const cfg = read('serve.json', {});
  const key = `${host()}:${port}`;
  if (args.at(-1) === 'off') {
    if (args.includes('--set-path=/')) delete cfg.Web?.[key]?.Handlers?.['/'];
    else {
      delete cfg.TCP?.[port];
      delete cfg.Web?.[key];
    }
    writeFileSync(file('serve.json'), JSON.stringify(cfg));
  } else if (existsSync(file('denied'))) {
    process.stderr.write('sending serve config: Access denied: serve config denied\nUse \'sudo tailscale serve\' or run \'sudo tailscale set --operator=$USER\'\n');
    process.exit(1);
  } else if (existsSync(file('https-off'))) {
    process.stdout.write('Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=nFAKE\n\n');
    wait();
  } else {
    cfg.TCP = { ...cfg.TCP, [port]: { HTTPS: true } };
    cfg.Web = { ...cfg.Web, [key]: { Handlers: { '/': { Proxy: args.at(-1) } } } };
    writeFileSync(file('serve.json'), JSON.stringify(cfg));
    process.stdout.write(`Available within your tailnet:\n\nhttps://${key}/\n|-- proxy ${args.at(-1)}\n`);
  }
} else {
  process.stderr.write(`fake tailscale: unknown command ${args.join(' ')}\n`);
  process.exit(2);
}
