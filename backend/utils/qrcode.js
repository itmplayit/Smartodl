'use strict';
/**
 * Minimal QR Code encoder (byte mode, EC level L/M, versions 1-15) with an SVG
 * renderer — written in-house because the project takes no new npm dependencies.
 *
 * Enough for UPI intent URIs, which are ~80-200 characters. Implements
 * ISO/IEC 18004: Reed-Solomon ECC over GF(256), block interleaving, the eight
 * mask patterns with penalty scoring, and BCH-protected format/version info.
 */

/* ------------------------------ GF(256) ------------------------------ */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // primitive polynomial
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generator polynomial for `degree` error-correction codewords. */
function rsGenerator(degree) {
  let poly = [1];
  for (let d = 0; d < degree; d += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let i = 0; i < poly.length; i += 1) {
      next[i] ^= gfMul(poly[i], 1);
      next[i + 1] ^= gfMul(poly[i], EXP[d]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < ecLen; i += 1) res[i] ^= gfMul(gen[i + 1], factor);
  }
  return res;
}

/* --------------------------- version tables --------------------------- */
// total codewords per version (index = version - 1)
const TOTAL_CW = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655];

// [ecPerBlock, group1Blocks, group1DataCw, group2Blocks, group2DataCw]
const ECC = {
  L: [
    [7, 1, 19, 0, 0], [10, 1, 34, 0, 0], [15, 1, 55, 0, 0], [20, 1, 80, 0, 0], [26, 1, 108, 0, 0],
    [18, 2, 68, 0, 0], [20, 2, 78, 0, 0], [24, 2, 97, 0, 0], [30, 2, 116, 0, 0], [18, 2, 68, 2, 69],
    [20, 4, 81, 0, 0], [24, 2, 92, 2, 93], [26, 4, 107, 0, 0], [30, 3, 115, 1, 116], [22, 5, 87, 1, 88],
  ],
  M: [
    [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
    [30, 1, 50, 4, 51], [22, 6, 36, 2, 37], [22, 8, 37, 1, 38], [24, 4, 40, 5, 41], [24, 5, 41, 5, 42],
  ],
};

const ALIGN = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42],
  [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
];

const EC_BITS = { L: 0b01, M: 0b00 };

/* ------------------------------ helpers ------------------------------ */
function dataCapacity(version, level) {
  const [ec, b1, d1, b2, d2] = ECC[level][version - 1];
  void ec;
  return b1 * d1 + b2 * d2;
}

/** 15-bit BCH(15,5) format information. */
function formatBits(level, mask) {
  const data = (EC_BITS[level] << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i -= 1) if ((rem >> i) & 1) rem ^= 0b10100110111 << (i - 10);
  return ((data << 10) | rem) ^ 0b101010000010010;
}

/** 18-bit BCH(18,6) version information (versions 7+). */
function versionBits(version) {
  // Golay BCH(18,6), generator x^12+x^11+x^10+x^9+x^8+x^5+x^2+1 = 0x1f25
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ (((rem >>> 11) & 1) * 0x1f25);
  return ((version << 12) | (rem & 0xfff)) >>> 0;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/* --------------------------- matrix building --------------------------- */
function buildMatrix(version, level, codewords, mask) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(null));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));

  const set = (r, c, v) => { m[r][c] = v; fixed[r][c] = true; };

  // finder patterns + separators
  const finder = (R, C) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = R + r;
        const cc = C + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        set(rr, cc, inRing || inCore ? 1 : 0);
      }
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  // timing patterns
  for (let i = 8; i < size - 8; i += 1) { set(6, i, i % 2 === 0 ? 1 : 0); set(i, 6, i % 2 === 0 ? 1 : 0); }

  // alignment patterns
  const centres = ALIGN[version - 1];
  for (const r of centres) {
    for (const c of centres) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          set(r + dr, c + dc, ring === 1 ? 0 : 1);
        }
      }
    }
  }

  // dark module + reserved format areas
  set(size - 8, 8, 1);
  for (let i = 0; i < 9; i += 1) {
    if (m[8][i] === null) set(8, i, 0);
    if (m[i][8] === null) set(i, 8, 0);
  }
  for (let i = 0; i < 8; i += 1) {
    if (m[8][size - 1 - i] === null) set(8, size - 1 - i, 0);
    if (m[size - 1 - i][8] === null) set(size - 1 - i, 8, 0);
  }

  // version information blocks (v7+)
  if (version >= 7) {
    const vb = versionBits(version);
    for (let i = 0; i < 18; i += 1) {
      const bit = (vb >> i) & 1;
      set(Math.floor(i / 3), size - 11 + (i % 3), bit);
      set(size - 11 + (i % 3), Math.floor(i / 3), bit);
    }
  }

  // data placement: two-column zigzag from bottom-right, skipping the timing column
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // column 6 is the vertical timing pattern — step over it
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const c of [right, right - 1]) {
        if (fixed[row][c]) continue;
        let bit = 0;
        if (bitIndex < totalBits) {
          bit = (codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
          bitIndex += 1;
        }
        m[row][c] = MASKS[mask](row, c) ? bit ^ 1 : bit;
      }
    }
    upward = !upward;
  }

  // format information (written twice)
  // Copy 1 runs DOWN column 8 then LEFT along row 8; copy 2 runs RIGHT along
  // row 8 then DOWN column 8. (Getting these two axes the wrong way round
  // produces a well-formed but undecodable symbol.)
  const fb = formatBits(level, mask);
  for (let i = 0; i < 15; i += 1) {
    const bit = (fb >> i) & 1;
    if (i < 6) m[i][8] = bit;
    else if (i === 6) m[7][8] = bit;
    else if (i === 7) m[8][8] = bit;
    else if (i === 8) m[8][7] = bit;
    else m[8][14 - i] = bit;

    if (i < 8) m[8][size - 1 - i] = bit;
    else m[size - 15 + i][8] = bit;
  }

  m[size - 8][8] = 1; // always-dark module, written last

  return m;
}

/** ISO 18004 penalty rules — lower is better. */
function penalty(m) {
  const n = m.length;
  let score = 0;

  // rule 1: runs of five or more same-coloured modules
  for (let i = 0; i < n; i += 1) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < n; j += 1) {
        const cur = horizontal ? m[i][j] : m[j][i];
        const prev = horizontal ? m[i][j - 1] : m[j - 1][i];
        if (cur === prev) { run += 1; } else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // rule 2: 2x2 blocks of one colour
  for (let r = 0; r < n - 1; r += 1) {
    for (let c = 0; c < n - 1; c += 1) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }

  // rule 3: finder-like 1:1:3:1:1 patterns
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j + 11 <= n; j += 1) {
      let rowHit = true;
      let colHit = true;
      let rowHit2 = true;
      let colHit2 = true;
      for (let k = 0; k < 11; k += 1) {
        if (m[i][j + k] !== P1[k]) rowHit = false;
        if (m[i][j + k] !== P2[k]) rowHit2 = false;
        if (m[j + k][i] !== P1[k]) colHit = false;
        if (m[j + k][i] !== P2[k]) colHit2 = false;
      }
      if (rowHit) score += 40;
      if (rowHit2) score += 40;
      if (colHit) score += 40;
      if (colHit2) score += 40;
    }
  }

  // rule 4: deviation from a 50% dark ratio
  let dark = 0;
  for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) dark += m[r][c];
  const pct = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;

  return score;
}

/* -------------------------------- API -------------------------------- */

/** Encodes `text` and returns the module matrix (1 = dark). */
function encode(text, { level = 'M' } = {}) {
  if (!ECC[level]) throw new Error(`Unsupported EC level: ${level}`);
  const bytes = Array.from(Buffer.from(String(text), 'utf8'));

  let version = 0;
  for (let v = 1; v <= 15; v += 1) {
    const countBits = v < 10 ? 8 : 16;
    const needed = 4 + countBits + bytes.length * 8;
    if (needed <= dataCapacity(v, level) * 8) { version = v; break; }
  }
  if (!version) throw new Error('Payload too long for a version-15 QR code');

  // ---- bit stream
  const bits = [];
  const push = (value, len) => { for (let i = len - 1; i >= 0; i -= 1) bits.push((value >> i) & 1); };
  push(0b0100, 4);                                  // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);

  const capacityBits = dataCapacity(version, level) * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i += 1) bits.push(0);   // terminator
  while (bits.length % 8) bits.push(0);
  const padBytes = [0xec, 0x11];
  for (let i = 0; bits.length < capacityBits; i += 1) push(padBytes[i % 2], 8);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    data.push(byte);
  }

  // ---- split into blocks, compute ECC
  const [ecLen, b1, d1, b2, d2] = ECC[level][version - 1];
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < b1; i += 1) { blocks.push(data.slice(offset, offset + d1)); offset += d1; }
  for (let i = 0; i < b2; i += 1) { blocks.push(data.slice(offset, offset + d2)); offset += d2; }
  const ecBlocks = blocks.map((b) => rsEncode(b, ecLen));

  // ---- interleave
  const out = [];
  const maxData = Math.max(d1, d2);
  for (let i = 0; i < maxData; i += 1) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i += 1) for (const b of ecBlocks) out.push(b[i]);
  // remainder bits are already handled by zero-filling during placement
  if (out.length !== TOTAL_CW[version - 1]) {
    throw new Error(`codeword count mismatch: ${out.length} != ${TOTAL_CW[version - 1]}`);
  }

  // ---- pick the lowest-penalty mask
  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const m = buildMatrix(version, level, out, mask);
    const score = penalty(m);
    if (!best || score < best.score) best = { m, score, mask };
  }
  return best.m;
}

/**
 * Renders `text` as a standalone SVG string.
 * `scale` = pixels per module, `quiet` = quiet-zone width in modules (4 per spec).
 */
function toSvg(text, { level = 'M', scale = 6, quiet = 4, dark = '#000000', light = '#ffffff' } = {}) {
  const m = encode(text, { level });
  const n = m.length;
  const dim = (n + quiet * 2) * scale;

  // one path for every dark module keeps the markup small and crisp at any zoom
  let d = '';
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (m[r][c]) d += `M${(c + quiet) * scale} ${(r + quiet) * scale}h${scale}v${scale}h-${scale}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="QR code">`
    + `<rect width="${dim}" height="${dim}" fill="${light}"/>`
    + `<path d="${d}" fill="${dark}"/></svg>`;
}

/** Data-URI form, convenient for an <img src>. */
const toDataUri = (text, opts) => `data:image/svg+xml;base64,${Buffer.from(toSvg(text, opts), 'utf8').toString('base64')}`;

module.exports = { encode, toSvg, toDataUri };
