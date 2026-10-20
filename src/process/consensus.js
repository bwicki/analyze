// Several trackers on one flight (0.8.0): the used segments are grouped by device (tracker profile;
// overlapping recordings of the same format count as separate devices). Where two or more devices
// cover the same time, the track is built either as a CONSENSUS on a time grid (median of position
// and altitude, outliers rejected) or from one PRIMARY device whose gaps are filled by the others.
// Outside such intervals the single covering device keeps its full resolution. Pure, no DOM.

import { FIELDS, slicePoints } from '../parse/points.js';
import { haversine } from '../util/geo.js';

export const MERGE_DEFAULTS = {
  mode: 'consensus',     // 'consensus' | 'primary'
  primary: null,         // device key chosen by the user, else the highest priority / most points
  stepSec: 10,           // consensus grid
  maxSepM: 300,          // devices further than this from the median position are ignored for that point
};

/** Group used segments into devices: same profile name = same device, unless two recordings of it overlap. */
export function groupDevices(segs) {
  const use = segs.filter((s) => s.status === 'use');
  const devices = [];
  for (const s of use) {
    const name = s.profileName || s.file;
    let dev = devices.find((d) => d.name === name && !d.segs.some((o) => o.t0 < s.t1 && s.t0 < o.t1));
    if (!dev) {
      const same = devices.filter((d) => d.name === name).length;
      dev = { key: `${name}#${same + 1}`, name: same ? `${name} (${same + 1})` : name, priority: s.priority || 0, segs: [], n: 0, t0: s.t0, t1: s.t1 };
      devices.push(dev);
    }
    dev.segs.push(s); dev.n += s.n; dev.t0 = Math.min(dev.t0, s.t0); dev.t1 = Math.max(dev.t1, s.t1);
  }
  for (const d of devices) d.segs.sort((a, b) => a.t0 - b.t0);
  devices.sort((a, b) => b.priority - a.priority || b.n - a.n);
  return devices;
}

/** Intervals [from, to] a device really covers (its segments minus internal breaks longer than gapSec). */
export function coverage(dev, gapSec) {
  const iv = [];
  for (const s of dev.segs) {
    const t = s.points.t; let from = t[0];
    for (let i = 1; i < s.n; i++) if (t[i] - t[i - 1] > gapSec * 1000) { iv.push([from, t[i - 1]]); from = t[i]; }
    iv.push([from, t[s.n - 1]]);
  }
  iv.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const x of iv) { const last = merged[merged.length - 1]; if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]); else merged.push([x[0], x[1]]); }
  return merged;
}
const covers = (iv, t) => iv.some((x) => t >= x[0] && t <= x[1]);

/** Time intervals covered by at least `min` devices. */
export function multiIntervals(devCov, min = 2) {
  const ev = [];
  devCov.forEach((iv, d) => { for (const [a, b] of iv) { ev.push([a, 1, d]); ev.push([b, -1, d]); } });
  ev.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
  const out = []; let count = 0, start = null;
  for (const [t, d] of ev) {
    const before = count; count += d;
    if (before < min && count >= min) start = t;
    if (before >= min && count < min && start !== null) { if (t > start) out.push([start, t]); start = null; }
  }
  return out;
}

/** Linear interpolation of a device's fields at time t (segment-local index search with a cursor). */
function sampler(dev) {
  const segs = dev.segs; let k = 0, i = 0;
  return (t) => {
    while (k < segs.length - 1 && t > segs[k].t1) { k++; i = 0; }
    while (k > 0 && t < segs[k].t0) { k--; i = 0; }
    const s = segs[k], ps = s.points, tt = ps.t;
    if (t < tt[0] || t > tt[s.n - 1]) return null;
    while (i < s.n - 1 && tt[i + 1] < t) i++;
    while (i > 0 && tt[i] > t) i--;
    const j = Math.min(s.n - 1, i + 1), w = tt[j] === tt[i] ? 0 : (t - tt[i]) / (tt[j] - tt[i]);
    const lerp = (a) => { const x = a[i], y = a[j]; if (Number.isNaN(x)) return y; if (Number.isNaN(y)) return x; return x + (y - x) * w; };
    const near = (a) => (w < 0.5 ? a[i] : a[j]);
    if (!ps.fix[i] && !ps.fix[j]) return { fix: 0, lat: NaN, lon: NaN, alt: lerp(ps.alt), balt: lerp(ps.balt), press: lerp(ps.press), vs: lerp(ps.vs), gs: lerp(ps.gs), hdg: near(ps.hdg), runtime: near(ps.runtime), batt: near(ps.batt), seg: s.id };
    const a = ps.fix[i] ? i : j, b = ps.fix[j] ? j : i;
    const ww = a === b ? 0 : w;
    const lp = (arr) => arr[a] + (arr[b] - arr[a]) * ww;
    return { fix: 1, lat: lp(ps.lat), lon: lp(ps.lon), alt: lerp(ps.alt), balt: lerp(ps.balt), press: lerp(ps.press), vs: lerp(ps.vs), gs: lerp(ps.gs), hdg: near(ps.hdg), runtime: near(ps.runtime), batt: near(ps.batt), seg: s.id };
  };
}

const median = (arr) => { const a = arr.filter((v) => !Number.isNaN(v)).sort((x, y) => x - y); if (!a.length) return NaN; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const mean = (arr) => { const a = arr.filter((v) => !Number.isNaN(v)); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN; };

/** Combine the samples of several devices at one grid time: {lat, lon, alt, …, fix, used, rejected}. */
export function combine(samples, maxSepM) {
  const withFix = samples.filter((s) => s && s.fix);
  let lat = NaN, lon = NaN, used = [], rejected = 0;
  if (withFix.length === 1) { lat = withFix[0].lat; lon = withFix[0].lon; used = withFix; }
  else if (withFix.length === 2) {
    const [a, b] = withFix;
    if (haversine(a.lat, a.lon, b.lat, b.lon) > maxSepM) { lat = a.lat; lon = a.lon; used = [a]; rejected = 1; }  // samples arrive in priority order
    else { lat = (a.lat + b.lat) / 2; lon = (a.lon + b.lon) / 2; used = withFix; }
  } else if (withFix.length > 2) {
    const mLat = median(withFix.map((s) => s.lat)), mLon = median(withFix.map((s) => s.lon));
    used = withFix.filter((s) => haversine(s.lat, s.lon, mLat, mLon) <= maxSepM); rejected = withFix.length - used.length;
    if (!used.length) used = withFix;
    lat = mean(used.map((s) => s.lat)); lon = mean(used.map((s) => s.lon));
  }
  const pool = used.length ? used : samples.filter(Boolean);
  const alt = used.length ? median(used.map((s) => s.alt)) : median(pool.map((s) => s.alt));
  const first = (f) => { for (const s of pool) if (!Number.isNaN(s[f])) return s[f]; return NaN; };
  return { fix: withFix.length ? 1 : 0, lat, lon, alt, balt: median(pool.map((s) => s.balt)), press: median(pool.map((s) => s.press)), vs: median(pool.map((s) => s.vs)), gs: median(pool.map((s) => s.gs)), hdg: first('hdg'), runtime: NaN, batt: first('batt'), used: used.length, rejected };
}

function emptyPoints(n) {
  const out = { n };
  for (const f of FIELDS) out[f] = f === 't' ? new Float64Array(n) : new Float32Array(n).fill(NaN);
  out.fix = new Uint8Array(n);
  return out;
}

/** Part of a segment outside the given intervals → list of {id, points} parts. */
function outsideParts(seg, intervals) {
  const t = seg.points.t, parts = []; let from = -1;
  const inside = (v) => intervals.some(([a, b]) => v >= a && v <= b);
  for (let i = 0; i <= seg.n; i++) {
    const out = i < seg.n && !inside(t[i]);
    if (out && from < 0) from = i;
    if (!out && from >= 0) { parts.push({ id: seg.id, points: slicePoints(seg.points, from, i), n: i - from, status: 'use' }); from = -1; }
  }
  return parts;
}

/**
 * Build the parts for mergeSegments from several devices.
 * Returns {parts, info} – info: {mode, devices: [{key, name, n, segIds, coverageSec}], multiSec, gridPoints, rejected, filledSec, primary}
 */
export function multiDeviceParts(segs, opts = {}) {
  const o = { ...MERGE_DEFAULTS, ...opts }, gapSec = o.gapSec || 30;
  const devices = groupDevices(segs);
  const info = { mode: o.mode, devices: devices.map((d) => ({ key: d.key, name: d.name, n: d.n, priority: d.priority, segIds: d.segs.map((s) => s.id), coverageSec: coverage(d, gapSec).reduce((s, [a, b]) => s + (b - a) / 1000, 0) })), multiSec: 0, gridPoints: 0, rejected: 0, filledSec: 0, primary: null };
  if (devices.length < 2) return { parts: segs.filter((s) => s.status === 'use'), info };
  const devCov = devices.map((d) => coverage(d, gapSec));
  const multi = multiIntervals(devCov, 2);
  info.multiSec = multi.reduce((s, [a, b]) => s + (b - a) / 1000, 0);
  if (!multi.length) return { parts: segs.filter((s) => s.status === 'use'), info };
  const primary = devices.find((d) => d.key === o.primary) || devices[0];
  info.primary = primary.key;
  const pi = devices.indexOf(primary);
  const ordered = [primary, ...devices.filter((d) => d !== primary)];   // priority order for ties
  const orderedCov = ordered.map((d) => devCov[devices.indexOf(d)]);

  if (o.mode === 'primary') {
    // primary keeps everything; others contribute only where the primary has no coverage
    const parts = [...primary.segs.map((s) => ({ id: s.id, points: s.points, n: s.n, status: 'use' }))];
    for (let k = 1; k < ordered.length; k++) {
      for (const s of ordered[k].segs) {
        const sub = outsideParts(s, devCov[pi]);
        for (const p of sub) {
          // only where no higher-ranked device covers either
          const prior = orderedCov.slice(0, k).flat();
          const parts2 = outsideParts(p, prior);
          for (const q of parts2) { parts.push(q); info.filledSec += (q.points.t[q.n - 1] - q.points.t[0]) / 1000; }
        }
      }
    }
    return { parts, info };
  }

  // consensus: original points outside the multi intervals, grid points inside
  const parts = [];
  for (const d of devices) for (const s of d.segs) parts.push(...outsideParts(s, multi));
  const samplers = ordered.map((d) => sampler(d));
  const step = Math.max(1, o.stepSec) * 1000;
  for (const [a, b] of multi) {
    const times = []; for (let t = a; t <= b; t += step) times.push(t); if (times[times.length - 1] < b) times.push(b);
    const pts = emptyPoints(times.length); const segOf = new Uint16Array(times.length);
    times.forEach((t, k) => {
      const samples = samplers.map((f, di) => (covers(orderedCov[di], t) ? f(t) : null));
      const c = combine(samples, o.maxSepM);
      pts.t[k] = t; pts.fix[k] = c.fix;
      for (const f of FIELDS) if (f !== 't') pts[f][k] = c[f];
      info.rejected += c.rejected;
      const prim = samples[0]; segOf[k] = prim ? prim.seg : (samples.find(Boolean) || {}).seg || 0;
    });
    // split by segment id runs so restarts of the primary device stay visible
    let from = 0;
    for (let k = 1; k <= times.length; k++) if (k === times.length || segOf[k] !== segOf[from]) { parts.push({ id: segOf[from], points: slicePoints(pts, from, k), n: k - from, status: 'use', consensus: true }); from = k; }
    info.gridPoints += times.length;
  }
  return { parts, info };
}
