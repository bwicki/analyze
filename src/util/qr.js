// Minimal QR code encoder (byte mode, error correction M, versions 1–10, automatic mask) as SVG –
// enough for a short link such as https://analyze.wicki.aero/v/KQZMWB7R on screen and on the printed
// report. No third-party code; verified against the reference encoder in tests/qr.test.js.

const TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];        // codewords per version
const EC_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];                 // EC codewords per block (level M)
const BLOCKS_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];                        // number of blocks (level M)
const ALIGN = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// ---- GF(256) Reed–Solomon ---------------------------------------------------------------------------
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
function rsGenerator(n) { let g = [1]; for (let i = 0; i < n; i++) { const ng = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); } g = ng; } return g; }
function rsRemainder(data, gen) {
  const r = new Array(gen.length - 1).fill(0);
  for (const b of data) { const f = b ^ r.shift(); r.push(0); for (let j = 0; j < r.length; j++) r[j] ^= mul(gen[j + 1], f); }
  return r;
}

// ---- bit stream --------------------------------------------------------------------------------------
function encodeBytes(bytes, version) {
  const bits = [];
  const push = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  push(4, 4); push(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) push(b, 8);
  const cap = (TOTAL[version] - EC_M[version] * BLOCKS_M[version]) * 8;
  push(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let p = 0xec; bits.length < cap; p ^= 0xec ^ 0x11) push(p, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  return data;
}
function interleave(data, version) {
  const nb = BLOCKS_M[version], ec = EC_M[version], total = TOTAL[version];
  const shortLen = Math.floor(total / nb), numShort = nb - (total % nb);
  const gen = rsGenerator(ec), blocks = []; let off = 0;
  for (let b = 0; b < nb; b++) { const len = shortLen - ec + (b < numShort ? 0 : 1); const d = data.slice(off, off + len); off += len; blocks.push({ d, e: rsRemainder(d, gen) }); }
  const out = [];
  for (let i = 0; i < shortLen - ec + 1; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < ec; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

// ---- matrix ------------------------------------------------------------------------------------------
function makeMatrix(version) {
  const n = 17 + 4 * version;
  const m = Array.from({ length: n }, () => new Uint8Array(n)), fn = Array.from({ length: n }, () => new Uint8Array(n));
  const set = (r, c, v) => { m[r][c] = v; fn[r][c] = 1; };
  const finder = (r0, c0) => { for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) { const rr = r0 + r, cc = c0 + c; if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue; const d = Math.max(Math.abs(r - 3), Math.abs(c - 3)); set(rr, cc, d !== 2 && d !== 4 ? 1 : 0); } };
  finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
  for (let i = 8; i < n - 8; i++) { if (!fn[6][i]) set(6, i, i % 2 === 0 ? 1 : 0); if (!fn[i][6]) set(i, 6, i % 2 === 0 ? 1 : 0); }
  const al = ALIGN[version], last = al.length - 1;
  al.forEach((r, i) => al.forEach((c, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;   // would overlap a finder
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0);
  }));
  // reserve format info (+ dark module) and version info
  for (let i = 0; i < 9; i++) { if (i < n) { fn[8][i] = 1; fn[i][8] = 1; } }
  for (let i = 0; i < 8; i++) { fn[8][n - 1 - i] = 1; fn[n - 1 - i][8] = 1; }
  set(n - 8, 8, 1);
  if (version >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { fn[i][n - 11 + j] = 1; fn[n - 11 + j][i] = 1; }
  return { n, m, fn };
}
function placeData(M, codewords) {
  const { n, m, fn } = M; let bi = 0; const total = codewords.length * 8;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < n; v++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j, up = ((right + 1) & 2) === 0, r = up ? n - 1 - v : v;
        if (fn[r][c]) continue;
        m[r][c] = bi < total ? (codewords[bi >> 3] >> (7 - (bi & 7))) & 1 : 0; bi++;
      }
    }
  }
}
const MASKS = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0, (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];
function applyMask(M, k) { const { n, m, fn } = M; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!fn[r][c] && MASKS[k](r, c)) m[r][c] ^= 1; }
function writeFormat(M, mask) {
  const { n, m } = M;
  const data = (0 << 3) | mask;                                  // EC level M = 00
  let rem = data; for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const b = (i) => (bits >> i) & 1;                            // m[row][col]
  for (let i = 0; i <= 5; i++) m[i][8] = b(i);
  m[7][8] = b(6); m[8][8] = b(7); m[8][7] = b(8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = b(i);
  for (let i = 0; i < 8; i++) m[8][n - 1 - i] = b(i);
  for (let i = 8; i < 15; i++) m[n - 15 + i][8] = b(i);
  m[n - 8][8] = 1;
}
function writeVersion(M, version) {
  if (version < 7) return;
  const { n, m } = M;
  let rem = version; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) { const b = (bits >> i) & 1; const a = Math.floor(i / 3), c = n - 11 + (i % 3); m[a][c] = b; m[c][a] = b; }
}
function penalty(M) {
  const { n, m } = M; let p = 0;
  const runs = (get) => { for (let i = 0; i < n; i++) { let run = 1; for (let j = 1; j < n; j++) { if (get(i, j) === get(i, j - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; } else run = 1; } } };
  runs((i, j) => m[i][j]); runs((i, j) => m[j][i]);
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) { const v = m[r][c]; if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3; }
  const pat = [1, 0, 1, 1, 1, 0, 1];
  const finderLike = (get) => { for (let i = 0; i < n; i++) for (let j = 0; j + 7 <= n; j++) { let ok = true; for (let k = 0; k < 7; k++) if (get(i, j + k) !== pat[k]) { ok = false; break; } if (!ok) continue; const before = j >= 4 && [0, 1, 2, 3].every((k) => get(i, j - 1 - k) === 0), after = j + 11 <= n && [0, 1, 2, 3].every((k) => get(i, j + 7 + k) === 0); if (before || after) p += 40; } };
  finderLike((i, j) => m[i][j]); finderLike((i, j) => m[j][i]);
  let dark = 0; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dark += m[r][c];
  const pct = (dark * 100) / (n * n); p += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return p;
}

/** Encode text (UTF-8) → {size, modules: Uint8Array[]}, EC level M, smallest version 1–10 that fits. */
export function qrEncode(text, { minVersion = 1 } = {}) {
  const bytes = new TextEncoder().encode(text);
  let version = minVersion;
  for (; version <= 10; version++) { const cap = TOTAL[version] - EC_M[version] * BLOCKS_M[version]; if (bytes.length + (version >= 10 ? 3 : 2) <= cap) break; }
  if (version > 10) throw new Error('text too long for QR version 10');
  const codewords = interleave(encodeBytes(bytes, version), version);
  let best = null;
  for (let k = 0; k < 8; k++) {
    const M = makeMatrix(version); placeData(M, codewords); applyMask(M, k); writeFormat(M, k); writeVersion(M, version);
    const p = penalty(M);
    if (!best || p < best.p) best = { p, M, mask: k };
  }
  return { size: best.M.n, modules: best.M.m, version, mask: best.mask };
}

/** SVG string of the code with a 4-module quiet zone. */
export function qrSvg(text, { size = 128, fg = '#14202e', bg = '#ffffff' } = {}) {
  const q = qrEncode(text); const n = q.size + 8;
  let d = '';
  for (let r = 0; r < q.size; r++) for (let c = 0; c < q.size; c++) if (q.modules[r][c]) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR"><rect width="${n}" height="${n}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
}
