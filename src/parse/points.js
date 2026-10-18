// PointSet – struct-of-arrays container for parsed track points. Typed arrays keep 150'000-point
// logs small and transferable from the parser worker. Missing values are NaN (fix = 0 → no GPS).
//
// Normfelder (concept §5): t (ms UTC), lat, lon, alt (GPS m), balt (pressure altitude m),
// press (hPa), vs (m/s), gs (m/s), hdg (deg), runtime (s, tracker clock), batt (V or %).

export const FIELDS = ['t', 'lat', 'lon', 'alt', 'balt', 'press', 'vs', 'gs', 'hdg', 'runtime', 'batt'];

export class PointBuilder {
  constructor(capacity = 4096) {
    this.n = 0; this.cap = capacity;
    this.a = Object.fromEntries(FIELDS.map((f) => [f, f === 't' ? new Float64Array(capacity) : new Float32Array(capacity)]));
    this.fix = new Uint8Array(capacity);
  }
  push(p) {
    if (this.n === this.cap) this.grow();
    const i = this.n++;
    for (const f of FIELDS) { const v = p[f]; this.a[f][i] = v === undefined || v === null || Number.isNaN(v) ? NaN : v; }
    this.fix[i] = p.fix ? 1 : 0;
  }
  grow() {
    this.cap *= 2;
    for (const f of FIELDS) { const old = this.a[f]; const nw = f === 't' ? new Float64Array(this.cap) : new Float32Array(this.cap); nw.set(old); this.a[f] = nw; }
    const of = this.fix; this.fix = new Uint8Array(this.cap); this.fix.set(of);
  }
  finish() {
    const out = { n: this.n };
    for (const f of FIELDS) out[f] = this.a[f].slice(0, this.n);
    out.fix = this.fix.slice(0, this.n);
    return out;
  }
}

/** Sub-range copy [from, to) of a PointSet. */
export function slicePoints(ps, from, to) {
  const out = { n: to - from };
  for (const f of FIELDS) out[f] = ps[f].slice(from, to);
  out.fix = ps.fix.slice(from, to);
  return out;
}

/** Concatenate PointSets in order. */
export function concatPoints(list) {
  const n = list.reduce((s, p) => s + p.n, 0);
  const out = { n };
  for (const f of FIELDS) {
    const arr = f === 't' ? new Float64Array(n) : new Float32Array(n);
    let o = 0; for (const p of list) { arr.set(p[f], o); o += p.n; }
    out[f] = arr;
  }
  const fix = new Uint8Array(n); let o = 0; for (const p of list) { fix.set(p.fix, o); o += p.n; } out.fix = fix;
  return out;
}

/** Buffers to transfer a PointSet between worker and page. */
export function transferables(ps) { return [...FIELDS.map((f) => ps[f].buffer), ps.fix.buffer]; }

/** True when a column carries at least one finite value. */
export function hasField(ps, f) { const a = ps[f]; for (let i = 0; i < ps.n; i++) if (!Number.isNaN(a[i])) return true; return false; }
