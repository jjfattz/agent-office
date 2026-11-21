// Reading a waiting agent's numbered choices off its screen (server/workers/choices.ts), to answer it
// from its card or a notification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChoices } from '../src/server/workers/choices.js';

test("reads Claude Code's permission prompt", () => {
  const screen = [
    '⏺ Bash(npm test)',
    '',
    '────────────────────────────────────────────',
    ' Bash command',
    '',
    '   npm test',
    '   Run the tests',
    '',
    ' Do you want to proceed?',
    ' ❯ 1. Yes',
    "   2. Yes, and don't ask again for npm test commands in",
    '   /Users/me/work/app',
    '   3. No, and tell Claude what to do differently (esc)',
    '',
    '',
  ].join('\n');
  assert.deepEqual(readChoices(screen), [
    { key: '1', label: 'Yes' },
    { key: '2', label: "Yes, and don't ask again for npm test commands in" },
    { key: '3', label: 'No, and tell Claude what to do differently (esc)' },
  ]);
});

test('reads one drawn in a box, with the cursor further down', () => {
  const screen = ['╭──────────────────────────────╮', '│ Do you want to make this edit? │', '│   1. Yes                       │', '│ ❯ 2. No                        │', '╰──────────────────────────────╯'].join('\n');
  assert.deepEqual(readChoices(screen), [
    { key: '1', label: 'Yes' },
    { key: '2', label: 'No' },
  ]);
});

test('reads Codex’s approval prompt', () => {
  const screen = ['Would you like to run the following command?', '  $ cargo test', '', '› 1. Yes, proceed (y)', "  2. Yes, and don't ask again for this command (a)", '  3. No, and tell Codex what to do differently (esc)', '', 'Press enter to confirm or esc to cancel'].join('\n');
  assert.deepEqual(readChoices(screen)?.map((c) => c.key), ['1', '2', '3']);
});

test('finds nothing in a numbered list with no cursor, or a lone option', () => {
  assert.equal(readChoices(['Here is the plan:', '1. Fix the login', '2. Add a test', '3. Ship it', '', '> '].join('\n')), undefined);
  assert.equal(readChoices(['❯ 1. Yes'].join('\n')), undefined);
  assert.equal(readChoices(''), undefined);
});

test('keeps labels short enough for a button', () => {
  const long = `❯ 1. ${'x'.repeat(200)}\n  2. No`;
  const c = readChoices(long)!;
  assert.ok(c[0].label.length <= 60);
  assert.ok(c[0].label.endsWith('…'));
});
