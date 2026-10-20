// Derived series on a merged track: altitude used for display, vertical speed, ground speed and
// cumulative distance – each from the sensor when present, else derived from positions.
// Outliers (GPS jumps) are masked before anything is smoothed (concept §6 step 6).

import { haversine, vincenty } from '../util/geo.js';
import { hasField } from '../parse/points.js';

/** Centred moving mean over ±halfWin seconds on an irregular time base (NaN-aware). */
export function movingMean(t, v, halfWinSec) {
  const n = v.length, out = new Float32Array(n), w = halfWinSec * 1000;
  let lo = 0, hi = 0, sum = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    while (hi < n && t[hi] <= t[i] + w) { if (!Number.isNaN(v[hi])) { sum += v[hi]; cnt++; } hi++; }
    while (lo < hi && t[lo] < t[i] - w) { if (!Number.isNaN(v[lo])) { sum -= v[lo]; cnt--; } lo++; }
    out[i] = cnt ? sum / cnt : NaN;
  }
  return out;
}

/** Central-difference derivative over ±halfWin seconds, NaN where the window is too short. */
export function derivative(t, v, halfWinSec) {
  const n = v.length, out = new Float32Array(n).fill(NaN), w = halfWinSec * 1000;
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    while (a < i && t[a] < t[i] - w) a++;
    while (b < n - 1 && t[b + 1] <= t[i] + w) b++;
    const dt = (t[b] - t[a]) / 1000;
    if (dt >= halfWinSec * 0.8 && !Number.isNaN(v[a]) && !Number.isNaN(v[b])) out[i] = (v[b] - v[a]) / dt;
  }
  return out;
}

/**
 * Build the derived series. Returns {alt, altSource, vs, vsSource, gs, gsSource, dist, speedMask, altMask}
 * alt: GPS where fixed, else pressure altitude shifted by the last known GPS−baro offset.
 */
export function deriveSeries(track, opts = {}) {
  const ps = track.points, n = ps.n, t = ps.t;
  const gapSec = opts.gapSec || 30;
  // --- altitude
  const hasGps = hasField(ps, 'alt'), hasBaro = hasField(ps, 'balt');
  const alt = new Float32Array(n); let offset = NaN, altSource = hasGps ? 'gps' : hasBaro ? 'baro' : 'none';
  for (let i = 0; i < n; i++) {
    const g = ps.fix[i] ? ps.alt[i] : NaN, b = ps.balt[i];
    if (!Number.isNaN(g)) { alt[i] = g; if (!Number.isNaN(b)) offset = g - b; }
    else if (!Number.isNaN(b)) alt[i] = b + (Number.isNaN(offset) ? 0 : offset);
    else alt[i] = NaN;
  }
  // altitude outlier mask: (1) implausible values (below −500 m / above 15 000 m – e.g. −65536 fill values),
  // (2) jump of > 20 m/s between consecutive points that is undone within 30 s, (3) points more than 500 m
  // off the median of their ±5 neighbours (isolated spikes that the jump rule misses at low rates)
  const altMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!Number.isNaN(alt[i]) && (alt[i] < -500 || alt[i] > 15000)) altMask[i] = 1;
  for (let i = 1; i < n - 1; i++) {
    const dt1 = (t[i] - t[i - 1]) / 1000, dt2 = (t[i + 1] - t[i]) / 1000;
    if (dt1 <= 0 || dt1 > gapSec || dt2 <= 0 || dt2 > gapSec) continue;
    const r1 = (alt[i] - alt[i - 1]) / dt1, r2 = (alt[i + 1] - alt[i]) / dt2;
    if (Math.abs(r1) > 20 && Math.abs(r2) > 20 && Math.sign(r1) !== Math.sign(r2)) altMask[i] = 1;
  }
  const win = [];
  for (let i = 0; i < n; i++) {
    if (altMask[i] || Number.isNaN(alt[i])) continue;
    win.length = 0;
    for (let k = Math.max(0, i - 5); k <= Math.min(n - 1, i + 5); k++) if (k !== i && !altMask[k] && !Number.isNaN(alt[k]) && Math.abs(t[k] - t[i]) <= 5 * 60000) win.push(alt[k]);
    if (win.length >= 4) { win.sort((a, b) => a - b); const med = win[win.length >> 1]; if (Math.abs(alt[i] - med) > 500) altMask[i] = 1; }
  }
  const altClean = new Float32Array(alt);
  for (let i = 0; i < n; i++) if (altMask[i]) altClean[i] = NaN;
  // --- vertical speed
  let vs, vsSource;
  if (hasField(ps, 'vs')) {
    vs = new Float32Array(ps.vs); vsSource = 'sensor';
    for (let i = 0; i < n; i++) if (Math.abs(vs[i]) > 15 || altMask[i]) vs[i] = NaN; // filter spikes
  } else { vs = derivative(t, altClean, 2); vsSource = 'derived'; }
  // warm-up mask: the first warmupSec after every segment start (tracker restart) – the vario filter settles there
  const warm = (opts.warmupSec ?? 60) * 1000, warmMask = new Uint8Array(n);
  for (const s of track.segments || []) { const t0 = t[s.from]; for (let i = s.from; i < s.to && t[i] - t0 < warm; i++) { warmMask[i] = 1; vs[i] = NaN; } }
  // --- ground speed (m/s)
  let gs, gsSource;
  if (hasField(ps, 'gs')) { gs = new Float32Array(ps.gs); gsSource = 'sensor'; }
  else {
    gs = new Float32Array(n).fill(NaN); gsSource = 'derived';
    let last = -1;
    for (let i = 0; i < n; i++) {
      if (!ps.fix[i]) continue;
      if (last >= 0) { const dt = (t[i] - t[last]) / 1000; if (dt > 0 && dt <= gapSec) gs[i] = haversine(ps.lat[last], ps.lon[last], ps.lat[i], ps.lon[i]) / dt; }
      last = i;
    }
    gs = movingMean(t, gs, 5);
  }
  const speedMask = new Uint8Array(n); for (let i = 0; i < n; i++) if (gs[i] > 60) { speedMask[i] = 1; gs[i] = NaN; } // > 117 kt: GPS glitch
  // --- cumulative distance (m) on the WGS84 ellipsoid (Vincenty), skipping gaps and no-fix points
  const dist = new Float64Array(n); let acc = 0, last = -1;
  for (let i = 0; i < n; i++) {
    if (!ps.fix[i]) { dist[i] = acc; continue; }
    if (last >= 0 && !track.gap[i] && (t[i] - t[last]) <= gapSec * 1000) acc += vincenty(ps.lat[last], ps.lon[last], ps.lat[i], ps.lon[i]);
    dist[i] = acc; last = i;
  }
  return { alt, altClean, altSource, altMask, vs, vsSource, gs, gsSource, speedMask, warmMask, dist };
}

/** Index of the last point with t <= ms (binary search). */
export function indexAt(t, ms) {
  let lo = 0, hi = t.length - 1;
  if (ms <= t[0]) return 0; if (ms >= t[hi]) return hi;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (t[m] <= ms) lo = m; else hi = m - 1; }
  return lo;
}

/** Interpolated position at ms (null when the track has no fix around it). */
export function positionAt(track, ms) {
  const ps = track.points, t = ps.t; const i = indexAt(t, ms);
  let a = i, b = i;
  while (a >= 0 && !ps.fix[a]) a--;
  while (b < ps.n && !ps.fix[b]) b++;
  if (a < 0 && b >= ps.n) return null;
  if (a < 0) return { lat: ps.lat[b], lon: ps.lon[b] };
  if (b >= ps.n || a === b) return { lat: ps.lat[a], lon: ps.lon[a] };
  const f = (ms - t[a]) / (t[b] - t[a] || 1);
  return { lat: ps.lat[a] + (ps.lat[b] - ps.lat[a]) * f, lon: ps.lon[a] + (ps.lon[b] - ps.lon[a]) * f };
}
