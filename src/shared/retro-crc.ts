// Recognizing a game by what's in its file: game databases list every known copy of a game by its
// CRC-32, so the office works out a file's (and, for a zipped game, reads the one the zip already
// keeps for what's inside), whatever the file's called. The server does it for the office's shelf, and
// the page for the games you add in your browser.
import { ARCHIVE_EXTS, RETRO_SYSTEMS, SYSTEM_IDS, extOf } from './retro.js';

const TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

/** CRC-32 (zip's), of `data`, carrying on from `crc` for a file read in pieces. */
export function crc32(data: Uint8Array, crc = 0): number {
  let c = ~crc;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/** A CRC as the databases write it: eight hex digits, in capitals. */
export const crcHex = (n: number) => n.toString(16).toUpperCase().padStart(8, '0');

/** The biggest game looked inside to recognize it. A bigger one (a DS game, say) goes by its name. */
export const MAX_CRC_BYTES = 64 * 1024 * 1024;

/** Reads a file's bytes from `start` up to `end`. */
export type ReadAt = (start: number, end: number) => Promise<Uint8Array>;

/** Every extension a game can have, for picking a game out of a zip. */
const GAME_EXTS = new Set(SYSTEM_IDS.flatMap((id) => RETRO_SYSTEMS[id].exts as readonly string[]));

/**
 * The CRCs a game file could be listed under: the whole file's, and also without the header some
 * copies of a game have in front (an NES game's iNES header, a Super Nintendo game's copier header, an
 * Atari 7800 game's), since a database may list either. For a zip, its games' CRCs from its directory.
 */
export async function crcsOf(file: string, size: number, read: ReadAt): Promise<string[]> {
  const ext = extOf(file);
  if (ext === 'zip') return zipCrcs(size, read).catch(() => []);
  if (ARCHIVE_EXTS.includes(ext) || size <= 0 || size > MAX_CRC_BYTES) return [];
  const data = await read(0, size);
  const out = [crc32(data)];
  const headerless = (n: number) => data.length > n && out.push(crc32(data.subarray(n)));
  if (data[0] === 0x4e && data[1] === 0x45 && data[2] === 0x53 && data[3] === 0x1a) headerless(16);
  else if (['sfc', 'smc', 'fig', 'swc'].includes(ext) && data.length % 1024 === 512) headerless(512);
  else if (ext === 'a78' && String.fromCharCode(...data.subarray(1, 10)) === 'ATARI7800') headerless(128);
  return [...new Set(out.map(crcHex))];
}

/** A zip's directory, at its end: where the directory starts and how long it is. */
export function zipDirectory(tail: Uint8Array, size: number): { start: number; length: number } | null {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let i = tail.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) !== 0x06054b50) continue;
    const length = view.getUint32(i + 12, true);
    const start = view.getUint32(i + 16, true);
    // A zip64 (over 4 GB) says 0xffffffff here; no game zip is that big.
    if (start === 0xffffffff || start + length > size || length > 1024 * 1024) return null;
    return { start, length };
  }
  return null;
}

/** What a zip's directory lists: each file's name, its CRC and its size. */
export function zipEntries(dir: Uint8Array): { name: string; crc: string; size: number }[] {
  const view = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const out: { name: string; crc: string; size: number }[] = [];
  const text = new TextDecoder();
  for (let p = 0; p + 46 <= dir.length && view.getUint32(p, true) === 0x02014b50; ) {
    const nameLength = view.getUint16(p + 28, true);
    const name = text.decode(dir.subarray(p + 46, p + 46 + nameLength));
    if (!name.endsWith('/')) out.push({ name, crc: crcHex(view.getUint32(p + 16, true)), size: view.getUint32(p + 24, true) });
    p += 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return out;
}

/** The CRCs of the games in a zip (its other files, a readme say, aren't games), from its directory alone. */
async function zipCrcs(size: number, read: ReadAt): Promise<string[]> {
  const tailLength = Math.min(size, 65_557);
  const where = zipDirectory(await read(size - tailLength, size), size);
  if (!where) return [];
  const entries = zipEntries(await read(where.start, where.start + where.length));
  return [...new Set(entries.filter((e) => GAME_EXTS.has(extOf(e.name)) && e.size > 0).map((e) => e.crc))].slice(0, 8);
}
