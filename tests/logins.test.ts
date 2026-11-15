import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claudeLogin, loginUrl } from '../src/server/logins.js';

/** A sign-in page the shape of the one `claude auth login --claudeai` prints, longer than the kilobyte a terminal hands over at once. */
const URL =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=00000000-0000-4000-8000-000000000000&response_type=code' +
  '&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback' +
  '&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code+user%3Amcp_servers+user%3Afile_upload+user%3Aplugins+user%3Aprivacy_consents%3Awrite' +
  '&code_challenge=challenge0123456789abcdefghijklmnopqrstuvwx&code_challenge_method=S256&state=state0123456789abcdefghijklmnopqrstuvwxyzAB';

/** What it prints: the page as a terminal link, then shown in color, then the prompt for the code. */
const SAID = `Opening browser to sign in…\r\nIf the browser didn't open, visit: \x1b]8;;${URL}\x07\x1b[94m${URL}\x1b[39m\x1b]8;;\x07\r\nPaste code here if prompted > `;

test('the sign-in page is only taken whole, wherever the output is cut', () => {
  assert.ok(SAID.length > 1024, 'the output should be longer than one read from a terminal');
  assert.equal(loginUrl(SAID), URL);
  for (let cut = 0; cut <= SAID.length; cut++) {
    const got = loginUrl(SAID.slice(0, cut));
    assert.ok(got === undefined || got === URL, `cut at ${cut} gave ${got}`);
  }
  // Cut where Claude Code's own output was: inside the shown link's state.
  assert.equal(loginUrl(SAID.slice(0, SAID.lastIndexOf('wxyzAB'))), undefined);
});

test('signing in hands over the whole page when the link comes in two pieces', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-logins-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // A stand-in for `claude auth login`: the page in two writes a moment apart, then it waits for the code.
  const bin = path.join(dir, 'claude');
  const cut = SAID.lastIndexOf('wxyzAB');
  writeFileSync(
    bin,
    `#!${process.execPath}
const said = ${JSON.stringify(SAID)};
process.stdout.write(said.slice(0, ${cut}));
setTimeout(() => process.stdout.write(said.slice(${cut})), 300);
process.stdin.once('data', (d) => process.exit(d.toString().trim() === 'the-code#state' ? 0 : 1));
`,
  );
  chmodSync(bin, 0o755);
  const urls: string[] = [];
  const ended = new Promise<boolean>((resolve) => {
    const flow = claudeLogin(bin, { PATH: process.env.PATH ?? '/usr/bin:/bin' }, dir, {
      url: (url) => {
        urls.push(url);
        if (typeof flow !== 'string') flow.write('the-code#state\r');
      },
      rejected: () => {},
      exit: (ok) => resolve(ok),
    });
    assert.equal(typeof flow, 'object', String(flow));
  });
  assert.equal(await ended, true);
  assert.deepEqual(urls, [URL]);
});
