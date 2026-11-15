import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newTracker, priceOf, restoreTracker, scanTracker, trackerUsage, usageOfMessage } from '../src/server/usage.js';

const assistant = (id: string, model: string, more: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', timestamp: new Date(Date.UTC(2026, 9, 1, 12, 0, Number(id))).toISOString(), ...more, message: { id: `msg_${id}`, model, usage: { input_tokens: 10, output_tokens: 5 } } });

test('a Claude session\'s usage names the model its own latest message ran on', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-usage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const transcript = path.join(dir, 'session.jsonl');
  const tracker = newTracker();
  tracker.transcript = transcript;
  assert.equal(trackerUsage(tracker).model, undefined);

  writeFileSync(transcript, `${assistant('1', 'claude-opus-5-5')}\n`);
  assert.equal(scanTracker(tracker), true);
  assert.equal(trackerUsage(tracker).model, 'claude-opus-5-5');
  assert.equal(trackerUsage(tracker).calls, 1);

  // A subagent on another model, and Claude Code's own placeholder messages, don't change what the session runs on.
  const subagents = path.join(dir, 'session', 'subagents');
  mkdirSync(subagents, { recursive: true });
  writeFileSync(path.join(subagents, 'agent-1.jsonl'), `${assistant('2', 'claude-haiku-4-5-20251001')}\n`);
  writeFileSync(transcript, `${assistant('1', 'claude-opus-5-5')}\n${assistant('3', '<synthetic>')}\n${assistant('4', 'claude-haiku-4-5-20251001', { isSidechain: true })}\n`);
  assert.equal(scanTracker(tracker), true);
  assert.equal(trackerUsage(tracker).model, 'claude-opus-5-5');
  assert.equal(trackerUsage(tracker).calls, 4);

  // Switched with /model: the card follows.
  writeFileSync(transcript, `${assistant('1', 'claude-opus-5-5')}\n${assistant('3', '<synthetic>')}\n${assistant('4', 'claude-haiku-4-5-20251001', { isSidechain: true })}\n${assistant('5', 'claude-sonnet-5-5')}\n`);
  scanTracker(tracker);
  assert.equal(trackerUsage(tracker).model, 'claude-sonnet-5-5');

  // And it's kept across a restart, with the rest of the tracker.
  const restored = restoreTracker(JSON.parse(JSON.stringify(tracker)));
  assert.equal(trackerUsage(restored).model, 'claude-sonnet-5-5');
  assert.equal(restoreTracker({ ...tracker, model: 'not a model\u0007' }).model, undefined);
});

test('each Claude model is priced at its own generation\'s rates', () => {
  assert.deepEqual(priceOf('claude-fable-5-2'), [8, 40, 0.2]);
  assert.deepEqual(priceOf('claude-fable-5-1'), [10, 50, 0.25]);
  assert.deepEqual(priceOf('claude-opus-5-5'), [4, 20, 0.2]);
  assert.deepEqual(priceOf('claude-haiku-5-5'), [0.1, 0.5, 0.01]);
  assert.deepEqual(priceOf('claude-haiku-4-5-20251001'), [1, 5, 0.1]);
  assert.deepEqual(priceOf('something-new'), [5, 25, 0.5]);

  // Haiku 5.5 costs five times as much once the prompt, cache included, passes 100K tokens.
  const cost = (u: object) => usageOfMessage('claude-haiku-5-5', u).cost;
  assert.ok(Math.abs(cost({ input_tokens: 1_000_000, output_tokens: 1_000_000 }) - 3) < 1e-9);
  assert.ok(Math.abs(cost({ input_tokens: 50_000, cache_read_input_tokens: 50_000, output_tokens: 1_000 }) - (5_000 + 500 + 500) / 1e6) < 1e-12);
  assert.ok(Math.abs(cost({ input_tokens: 50_000, cache_read_input_tokens: 50_001, output_tokens: 1_000 }) - (25_000 + 50_001 * 0.05 + 2_500) / 1e6) < 1e-12);
});
