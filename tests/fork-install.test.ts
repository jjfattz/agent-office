// scripts/fork/install-local.sh and the `agent-office` launcher it writes, which looks for a newer
// main each time it starts. Against a fork of its own (a bare repository in a temp folder), with a
// stand-in npm that "builds" in no time, so nothing is downloaded and no office starts: the
// installed bin/agent-office.js only says which version it is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = path.join(import.meta.dirname, '..');
const script = path.join(repo, 'scripts', 'fork', 'install-local.sh');

// npm as the script and install.sh use it: ci (the build, which fails in a commit with
// break-the-build in it), version, pack; the typecheck and the tests pass.
const FAKE_NPM = `#!/bin/sh
case "$1" in
  ci) if [ -f break-the-build ]; then echo "the build broke" >&2; exit 1; fi ;;
  version) node -e 'const fs = require("fs"); const p = JSON.parse(fs.readFileSync("package.json", "utf8")); p.version = process.argv[1]; fs.writeFileSync("package.json", JSON.stringify(p))' "$2" ;;
  pack)
    v="$(node -p 'require("./package.json").version')"
    d="$(mktemp -d)"
    mkdir "$d/package"
    cp -R package.json npm-shrinkwrap.json bin "$d/package/"
    tar -czf "agent-office-$v.tgz" -C "$d" package
    rm -rf "$d"
    ;;
esac
exit 0
`;

const root = mkdtempSync(path.join(tmpdir(), 'agent-office-fork-'));
const bare = path.join(root, 'fork.git');
const work = path.join(root, 'work');
const installDir = path.join(root, 'install');
const binDir = path.join(root, 'bin');
const launcher = path.join(binDir, 'agent-office');
const state = path.join(installDir, 'fork');

const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('AGENT_OFFICE_') && !k.startsWith('GIT_')));
Object.assign(env, {
  PATH: `${path.join(root, 'tools')}${path.delimiter}${process.env.PATH}`,
  HOME: root,
  AGENT_OFFICE_INSTALL_DIR: installDir,
  AGENT_OFFICE_BIN_DIR: binDir,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
});

const git = (...args: string[]) => execFileSync('git', args, { cwd: work, env, encoding: 'utf8' }).trim();

/** Commits to the fork's main and pushes it; returns the version a build of it installs. */
function push(message: string, files: Record<string, string> = {}) {
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(work, name), text);
  git('add', '-A');
  git('commit', '--quiet', '--allow-empty', '-m', message);
  git('push', '--quiet', 'origin', 'main');
  return `0.1.${git('rev-list', '--count', 'HEAD')}-fork.g${git('rev-parse', '--short=7', 'HEAD')}`;
}

/** Runs `agent-office`, as someone would to start the office. */
function start(args: string[] = [], extra: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(launcher, args, { env: { ...env, ...extra }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

let first = '';

test.before(() => {
  mkdirSync(path.join(root, 'tools'));
  writeFileSync(path.join(root, 'tools', 'npm'), FAKE_NPM);
  chmodSync(path.join(root, 'tools', 'npm'), 0o755);
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', bare], { env });
  execFileSync('git', ['init', '--quiet', '-b', 'main', work], { env });
  git('remote', 'add', 'origin', bare);
  mkdirSync(path.join(work, 'bin'));
  mkdirSync(path.join(work, 'scripts', 'fork'), { recursive: true });
  copyFileSync(path.join(repo, 'install.sh'), path.join(work, 'install.sh'));
  copyFileSync(script, path.join(work, 'scripts', 'fork', 'install-local.sh'));
  first = push('the first version', {
    'package.json': JSON.stringify({ name: 'agent-office', version: '0.1.0' }),
    'package-lock.json': JSON.stringify({ name: 'agent-office', version: '0.1.0', lockfileVersion: 3, packages: {} }),
    'bin/agent-office.js': "console.log('started', require('../package.json').version, process.argv.slice(2).join(' '));\n",
  });
});

test.after(() => rmSync(root, { recursive: true, force: true }));

test('install-local.sh installs the fork as an agent-office that looks for updates as it starts', () => {
  execFileSync('bash', [script], { env: { ...env, AGENT_OFFICE_FORK_REMOTE: bare }, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(readFileSync(launcher, 'utf8'), /--on-start/);
  const r = start(['--port', '4999']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `started ${first} --port 4999\n`);
  assert.match(r.err, /Up to date: v/);
});

let second = '';

test('a start after a new commit builds, tests and installs it, then starts it', () => {
  second = push('the second version');
  const r = start();
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /Building main at .*: the second version/);
  assert.match(r.err, /Typecheck and tests/);
  assert.equal(r.out, `started ${second} \n`, 'the new version is the one that starts');
  assert.match(readFileSync(launcher, 'utf8'), new RegExp(`v${second}/bin/agent-office\\.js`), 'and the launcher points at it');
  assert.equal(start().out, `started ${second} \n`);
});

test("AGENT_OFFICE_NO_UPDATE=1, and the commands that don't start the office, don't look", () => {
  const third = push('the third version');
  const skipped = start([], { AGENT_OFFICE_NO_UPDATE: '1' });
  assert.equal(skipped.out, `started ${second} \n`);
  assert.doesNotMatch(skipped.err, /Looking for updates/);
  const accounts = start(['accounts', 'list']);
  assert.equal(accounts.out, `started ${second} accounts list\n`);
  assert.doesNotMatch(accounts.err, /Looking for updates/);
  assert.equal(start().out, `started ${third} \n`, 'the next start of the office does');
  second = third;
});

test('a commit that fails to build is skipped, and the office starts what is installed', () => {
  push('a broken version', { 'break-the-build': '' });
  const r = start();
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `started ${second} \n`);
  assert.match(r.err, /the build of \w+ failed/);
  assert.match(r.err, new RegExp(`starting the installed v${second} instead`));
  assert.match(readFileSync(path.join(state, 'failed.log'), 'utf8'), /the build broke/);
  const again = start();
  assert.equal(again.out, `started ${second} \n`);
  assert.match(again.err, /failed to build or pass its tests/, 'the next start says so');
  assert.doesNotMatch(again.err, /Building/, "and doesn't try it again");
});

test("without the network, the office starts what's installed", () => {
  renameSync(bare, `${bare}.away`);
  try {
    const r = start();
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, `started ${second} \n`);
    assert.match(r.err, /couldn't fetch/);
  } finally {
    renameSync(`${bare}.away`, bare);
  }
});

test('a launcher written by an older version of the script catches up', () => {
  const entry = path.join(installDir, 'versions', `v${second}`, 'bin', 'agent-office.js');
  writeFileSync(launcher, `#!/bin/sh\n# agent-office launcher, written by install.sh, by way of scripts/fork/install-local.sh.\nexec node '${entry}' "$@"\n`);
  // What the launchd agent older versions set up ran every few minutes.
  execFileSync('bash', [path.join(state, 'install-local.sh'), '--if-changed', '--ref', 'main'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(readFileSync(launcher, 'utf8'), /--on-start/);
  assert.equal(start().out, `started ${second} \n`);
});

test('--status says that agent-office looks for updates as it starts', () => {
  const out = execFileSync('bash', [path.join(state, 'install-local.sh'), '--status'], { env, encoding: 'utf8' });
  assert.match(out, /updates: +looked for each time .*agent-office starts/);
  assert.match(out, /last failed commit:/);
});
