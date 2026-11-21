// The QR encoder the 📱 window and `agent-office phone pair` draw pairing links with (src/shared/qr.ts).
// The pinned codes below were each read back by a QR decoder (jsQR) when they were pinned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { qrEncode, qrSvg, qrTerminal, type Qr } from '../src/shared/qr.js';

const fingerprint = (q: Qr) =>
  createHash('sha256')
    .update(q.dark.map((r) => r.map((d) => (d ? 1 : 0)).join('')).join('\n'))
    .digest('hex')
    .slice(0, 16);

test('the codes it makes are the ones a decoder read back', () => {
  assert.deepEqual(
    [
      ['https://my-mac.tail1234.ts.net/pair#Qm9vb2tzQXJlR3JlYXRUb1JlYWRBbmRXcml0ZQ', 'M'],
      ['https://apps.apple.com/app/tailscale/id1470499037', 'M'],
      ['HELLO', 'L'],
    ].map(([text, level]) => {
      const q = qrEncode(text, level as 'M' | 'L');
      return [q.version, fingerprint(q)];
    }),
    [
      [5, 'c7b90dee2f85c896'],
      [4, 'f29641a88901c86f'],
      [1, 'd51e6b3d78d8b096'],
    ],
  );
});

test('the smallest version that fits, at the published capacities', () => {
  // Byte mode at level M holds 14 bytes in version 1, 26 in 2, 62 in 4, 213 in 10 (with a 16-bit length).
  for (const [len, version] of [
    [1, 1],
    [14, 1],
    [15, 2],
    [26, 2],
    [27, 3],
    [62, 4],
    [63, 5],
    [213, 10],
    [214, 11],
  ]) {
    assert.equal(qrEncode('x'.repeat(len)).version, version, `${len} bytes`);
  }
});

test('finder and timing patterns, and both copies of the format bits agree', () => {
  for (const len of [1, 60, 200, 400]) {
    const q = qrEncode('x'.repeat(len));
    assert.equal(q.size, q.version * 4 + 17);
    const at = (x: number, y: number) => q.dark[y][x];
    for (const [cx, cy] of [
      [3, 3],
      [q.size - 4, 3],
      [3, q.size - 4],
    ]) {
      assert.ok(at(cx, cy) && at(cx - 3, cy - 3) && !at(cx - 2, cy - 2), `finder at ${cx},${cy}`);
    }
    for (let i = 8; i < q.size - 8; i++) assert.equal(at(i, 6), i % 2 === 0, `timing ${i}`);
    const first = [0, 1, 2, 3, 4, 5, 7, 8].map((y) => at(8, y)).concat([7, 5, 4, 3, 2, 1, 0].map((x) => at(x, 8)));
    const second = [...Array(8)].map((_, i) => at(q.size - 1 - i, 8)).concat([...Array(7)].map((_, i) => at(8, q.size - 7 + i)));
    assert.deepEqual(first, second, `${len} bytes`);
    assert.ok(at(8, q.size - 8), 'the dark module');
  }
});

test('too long for any version is an error, not a broken code', () => {
  assert.throws(() => qrEncode('x'.repeat(3000)), /too long/i);
});

test('draws as an SVG and in a terminal', () => {
  const q = qrEncode('https://example.ts.net/pair#abc');
  assert.match(qrSvg(q), /^<svg [^>]*viewBox="0 0 \d+ \d+"/);
  const lines = qrTerminal(q).split('\n');
  assert.equal(lines.length, Math.ceil((q.size + 4) / 2));
});
