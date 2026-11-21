// A QR code encoder with no dependencies, for the phone pairing link: the 📱 window draws it, and
// `agent-office phone pair` prints it in a terminal. Byte mode only (a URL), error correction level
// M (or L when asked), the smallest version that fits, and the mask that scores best, as in ISO/IEC
// 18004. It follows Project Nayuki's reference implementation (MIT), cut down to what a link needs.

export type QrLevel = 'L' | 'M';

/** EC codewords per block, and blocks, by level and version (index 0 unused). */
const ECC_PER_BLOCK: Record<QrLevel, readonly number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
};
const BLOCKS: Record<QrLevel, readonly number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
};
/** The two bits the format information names each level by. */
const FORMAT_BITS: Record<QrLevel, number> = { L: 1, M: 0 };

/** A QR code: `size` modules a side, `dark[y][x]` for each. Draw it with a light margin of 4 modules. */
export interface Qr {
  version: number;
  size: number;
  dark: boolean[][];
}

/** The QR code for `text`, or throws when it's too long for any version. */
export function qrEncode(text: string, level: QrLevel = 'M'): Qr {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  for (; ; version++) {
    if (version > 40) throw new Error('Too long for a QR code');
    const countBits = version < 10 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCodewords(version, level) * 8) break;
  }
  const capacity = dataCodewords(version, level) * 8;
  const bits: number[] = [];
  const put = (value: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const q = new Matrix(version);
  q.functionPatterns(level);
  q.place(withEcc(data, version, level));
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    q.mask(mask);
    q.format(level, mask);
    const score = q.penalty();
    if (score < bestScore) [best, bestScore] = [mask, score];
    q.mask(mask); // XOR again: undone
  }
  q.mask(best);
  q.format(level, best);
  return { version, size: q.size, dark: q.dark };
}

function rawDataModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

const dataCodewords = (ver: number, level: QrLevel) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[level][ver] * BLOCKS[level][ver];

/** Splits the data into blocks, adds each one's Reed-Solomon codewords, and interleaves them. */
function withEcc(data: number[], ver: number, level: QrLevel): number[] {
  const blocks = BLOCKS[level][ver];
  const eccLen = ECC_PER_BLOCK[level][ver];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLen);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < shortBlocks) dat.push(0);
    all.push([...dat, ...ecc]);
  }
  const out: number[] = [];
  for (let i = 0; i < all[0].length; i++) {
    all.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) out.push(block[i]);
    });
  }
  return out;
}

function rsMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = rsMul(out[j], root);
      if (j + 1 < degree) out[j] ^= out[j + 1];
    }
    root = rsMul(root, 0x02);
  }
  return out;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const out = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ out.shift()!;
    out.push(0);
    divisor.forEach((coef, i) => (out[i] ^= rsMul(coef, factor)));
  }
  return out;
}

class Matrix {
  readonly size: number;
  readonly dark: boolean[][];
  private fixed: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.dark = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.fixed = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
  }

  private set(x: number, y: number, dark: boolean) {
    this.dark[y][x] = dark;
    this.fixed[y][x] = true;
  }

  functionPatterns(level: QrLevel) {
    const { size } = this;
    for (let i = 0; i < size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [
      [3, 3],
      [size - 4, 3],
      [3, size - 4],
    ]) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          if (x >= 0 && x < size && y >= 0 && y < size) this.set(x, y, d !== 2 && d !== 4);
        }
      }
    }
    const at = this.alignment();
    const last = at.length - 1;
    for (let i = 0; i <= last; i++) {
      for (let j = 0; j <= last; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) this.set(at[i] + dx, at[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
    this.format(level, 0);
    if (this.version >= 7) {
      let rem = this.version;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (this.version << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const on = ((bits >>> i) & 1) === 1;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.set(a, b, on);
        this.set(b, a, on);
      }
    }
  }

  private alignment(): number[] {
    const ver = this.version;
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const out = [6];
    for (let pos = this.size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  format(level: QrLevel, mask: number) {
    const data = (FORMAT_BITS[level] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    const { size } = this;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, size - 15 + i, bit(i));
    this.set(8, size - 8, true);
  }

  /** The codewords, in the zigzag up and down the columns, two at a time. */
  place(codewords: number[]) {
    const { size } = this;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const up = ((right + 1) & 2) === 0;
          const y = up ? size - 1 - vert : vert;
          if (!this.fixed[y][x] && i < codewords.length * 8) {
            this.dark[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
  }

  /** XORs mask `m` over everything but the function patterns (twice undoes it). */
  mask(m: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.fixed[y][x]) continue;
        const flip = [(x + y) % 2, y % 2, x % 3, (x + y) % 3, (Math.floor(x / 3) + Math.floor(y / 2)) % 2, ((x * y) % 2) + ((x * y) % 3), (((x * y) % 2) + ((x * y) % 3)) % 2, (((x + y) % 2) + ((x * y) % 3)) % 2][m] === 0;
        if (flip) this.dark[y][x] = !this.dark[y][x];
      }
    }
  }

  /** How hard it is to scan: long runs, 2×2 blocks, things that look like a finder, and lopsided color. */
  penalty(): number {
    const { size, dark } = this;
    let score = 0;
    const lines: boolean[][] = [];
    for (let i = 0; i < size; i++) lines.push(dark[i], dark.map((row) => row[i]));
    const finder = [true, false, true, true, true, false, true];
    for (const line of lines) {
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && line[i] === line[i - 1]) run++;
        else {
          if (run >= 5) score += 3 + run - 5;
          run = 1;
        }
      }
      const at = (i: number) => i >= 0 && i < size && line[i];
      for (let i = 0; i + 7 <= size; i++) {
        if (!finder.every((v, k) => line[i + k] === v)) continue;
        const lightBefore = [1, 2, 3, 4].every((k) => !at(i - k));
        const lightAfter = [0, 1, 2, 3].every((k) => !at(i + 7 + k));
        if (lightBefore || lightAfter) score += 40;
      }
    }
    let darkCount = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (dark[y][x]) darkCount++;
        if (x < size - 1 && y < size - 1 && dark[y][x] === dark[y][x + 1] && dark[y][x] === dark[y + 1][x] && dark[y][x] === dark[y + 1][x + 1]) score += 3;
      }
    }
    const total = size * size;
    score += Math.max(0, Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
    return score;
  }
}

/** An SVG of the code, with its light margin, scaled to fill whatever box it's put in. */
export function qrSvg(qr: Qr, opts: { dark?: string; light?: string } = {}): string {
  const m = 4;
  const n = qr.size + m * 2;
  let path = '';
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.dark[y][x]) path += `M${x + m} ${y + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${opts.light ?? '#fff'}"/><path d="${path}" fill="${opts.dark ?? '#000'}"/></svg>`;
}

/**
 * The code for a terminal: two rows of modules to a line with half blocks, dark on light whatever
 * the terminal's colors, so a phone's camera reads it.
 */
export function qrTerminal(qr: Qr): string {
  const m = 2;
  const n = qr.size + m * 2;
  const at = (x: number, y: number) => x >= m && y >= m && x < qr.size + m && y < qr.size + m && qr.dark[y - m][x - m];
  const lines: string[] = [];
  for (let y = 0; y < n; y += 2) {
    let line = '\x1b[30;47m';
    for (let x = 0; x < n; x++) {
      const top = at(x, y);
      const bottom = y + 1 < n && at(x, y + 1);
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push(`${line}\x1b[0m`);
  }
  return lines.join('\n');
}
