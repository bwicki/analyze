// Segments: one per file (split at tracker restarts), timestamp plausibility, duplicate and
// "other flight" detection, merge into one track (concept §6 steps 1–3). Pure, no DOM.

import { FIELDS, slicePoints, concatPoints } from '../parse/points.js';
import { multiDeviceParts } from './consensus.js';

export const DEFAULTS = {
  minYear: 2015,
  gapSec: 30,            // longer breaks stay visible as gaps
  restartBackSec: 60,    // time running backwards by more than this → new segment
  otherFlightHours: 12,  // a segment further than this from the main cluster is another flight
  dupOverlap: 0.9,       // overlap share to call two segments duplicates
};

/** Drop implausible timestamps (year range, isolated jumps) and sort by time. Returns {points, dropped}. */
export function cleanTimestamps(ps, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const minT = Date.UTC(o.minYear, 0, 1), maxT = Date.now() + 2 * 86400000;
  const keep = new Uint8Array(ps.n); let dropped = 0;
  const t = ps.t;
  for (let i = 0; i < ps.n; i++) {
    const v = t[i];
    if (Number.isNaN(v) || v < minT || v > maxT) { dropped++; continue; }
    // isolated jump: differs by > 1 day from both neighbours that are themselves close to each other
    const a = i > 0 ? t[i - 1] : NaN, b = i < ps.n - 1 ? t[i + 1] : NaN;
    if (!Number.isNaN(a) && !Number.isNaN(b) && Math.abs(v - a) > 86400000 && Math.abs(v - b) > 86400000 && Math.abs(b - a) < 3600000) { dropped++; continue; }
    keep[i] = 1;
  }
  const idx = []; for (let i = 0; i < ps.n; i++) if (keep[i]) idx.push(i);
  idx.sort((x, y) => t[x] - t[y] || x - y);
  const out = { n: idx.length };
  for (const f of FIELDS) { const src = ps[f], arr = f === 't' ? new Float64Array(idx.length) : new Float32Array(idx.length); for (let k = 0; k < idx.length; k++) arr[k] = src[idx[k]]; out[f] = arr; }
  out.fix = new Uint8Array(idx.length); for (let k = 0; k < idx.length; k++) out.fix[k] = ps.fix[idx[k]];
  return { points: out, dropped };
}

/** Split a (time-sorted) PointSet where the tracker clock (runtime) jumps backwards. */
export function splitAtRestarts(ps) {
  const cuts = [0];
  for (let i = 1; i < ps.n; i++) {
    const r0 = ps.runtime[i - 1], r1 = ps.runtime[i];
    if (!Number.isNaN(r0) && !Number.isNaN(r1) && r1 < r0 - 5) cuts.push(i);
  }
  cuts.push(ps.n);
  const parts = [];
  for (let k = 0; k < cuts.length - 1; k++) if (cuts[k + 1] > cuts[k]) parts.push(slicePoints(ps, cuts[k], cuts[k + 1]));
  return parts;
}

/** Build segments from parsed files: [{name, size, profile, points, bad}] → Segment[] */
export function buildSegments(files, opts = {}) {
  const segs = [];
  let id = 1;
  for (const f of files) {
    if (!f.points || !f.points.n) continue;
    const { points, dropped } = cleanTimestamps(f.points, opts);
    const parts = splitAtRestarts(points);
    parts.forEach((p, k) => {
      let nFix = 0; for (let i = 0; i < p.n; i++) nFix += p.fix[i];
      segs.push({ id: id++, file: f.name, size: f.size || 0, profileId: f.profile && f.profile.id, profileName: f.profile && f.profile.name, priority: (f.profile && f.profile.priority) || 0,
        points: p, n: p.n, nFix, t0: p.t[0], t1: p.t[p.n - 1], bad: f.bad || 0, dropped: k === 0 ? dropped : 0, part: parts.length > 1 ? k + 1 : 0, parts: parts.length,
        status: 'use', dupOf: null });
    });
  }
  segs.sort((a, b) => a.t0 - b.t0 || a.id - b.id);
  return segs;
}

function overlap(a, b) {
  const lo = Math.max(a.t0, b.t0), hi = Math.min(a.t1, b.t1);
  if (hi <= lo) return 0;
  return (hi - lo) / Math.min(a.t1 - a.t0 || 1, b.t1 - b.t0 || 1);
}

/**
 * Mark duplicates (same recording in two formats) and segments that belong to another flight.
 * Mutates status: 'use' | 'dup' | 'other' | 'off' (user exclusion is kept when already set).
 */
export function classifySegments(segs, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  for (const s of segs) if (s.status !== 'off') { s.status = 'use'; s.dupOf = null; }
  // duplicates: prefer higher profile priority, then more points
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const a = segs[i], b = segs[j];
    if (a.status === 'off' || b.status === 'off') continue;
    if (overlap(a, b) >= o.dupOverlap && Math.abs(a.n - b.n) / Math.max(a.n, b.n) < 0.2) {
      const loser = (b.priority > a.priority || (b.priority === a.priority && b.n > a.n)) ? a : b;
      const winner = loser === a ? b : a;
      if (loser.status === 'use') { loser.status = 'dup'; loser.dupOf = winner.id; }
    }
  }
  // main cluster: start from the longest used segment, add segments within otherFlightHours (chain)
  const used = segs.filter((s) => s.status === 'use');
  if (used.length) {
    const main = used.reduce((m, s) => (s.t1 - s.t0 > m.t1 - m.t0 ? s : m), used[0]);
    let lo = main.t0, hi = main.t1, changed = true;
    const inCluster = new Set([main.id]);
    const lim = o.otherFlightHours * 3600000;
    while (changed) {
      changed = false;
      for (const s of used) if (!inCluster.has(s.id) && s.t1 >= lo - lim && s.t0 <= hi + lim) { inCluster.add(s.id); lo = Math.min(lo, s.t0); hi = Math.max(hi, s.t1); changed = true; }
    }
    for (const s of used) if (!inCluster.has(s.id)) s.status = 'other';
  }
  return segs;
}

/**
 * Merge the used segments into one track: points sorted, identical timestamps collapsed (first wins),
 * per-point segment id, gap flags for breaks longer than gapSec.
 * Returns {points, seg: Uint16Array, gap: Uint8Array (1 = gap before this point), gaps: [{from, to, sec}], segments: [{id, from, to}]}
 */
export function mergeSegments(segs, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!segs.some((s) => s.status === 'use')) return null;
  // several devices (0.8.0): consensus grid or primary + gap filling where recordings overlap
  let parts = segs.filter((s) => s.status === 'use'), info = null;
  if (opts.merge !== false) { const r = multiDeviceParts(segs, { ...(opts.merge || {}), gapSec: o.gapSec }); parts = r.parts; info = r.info; }
  const track = assembleTrack(parts, o);
  if (track) track.merge = info;
  return track;
}

/** Parts [{id, points, n}] → track (sorted, identical timestamps collapsed, gaps, segment runs). */
export function assembleTrack(use, o = DEFAULTS) {
  if (!use.length) return null;
  const all = concatPoints(use.map((s) => s.points));
  const segIdx = new Uint16Array(all.n); let off = 0;
  for (const s of use) { segIdx.fill(s.id, off, off + s.n); off += s.n; }
  // sort indices by time, collapse identical timestamps
  const idx = Array.from({ length: all.n }, (_, i) => i).sort((a, b) => all.t[a] - all.t[b] || a - b);
  const keep = []; let lastT = -Infinity;
  for (const i of idx) { if (all.t[i] === lastT) continue; keep.push(i); lastT = all.t[i]; }
  const out = { n: keep.length };
  for (const f of FIELDS) { const src = all[f], arr = f === 't' ? new Float64Array(keep.length) : new Float32Array(keep.length); for (let k = 0; k < keep.length; k++) arr[k] = src[keep[k]]; out[f] = arr; }
  out.fix = new Uint8Array(keep.length); const seg = new Uint16Array(keep.length);
  for (let k = 0; k < keep.length; k++) { out.fix[k] = all.fix[keep[k]]; seg[k] = segIdx[keep[k]]; }
  const gap = new Uint8Array(out.n); const gaps = [];
  for (let k = 1; k < out.n; k++) { const d = (out.t[k] - out.t[k - 1]) / 1000; if (d > o.gapSec) { gap[k] = 1; gaps.push({ from: out.t[k - 1], to: out.t[k], sec: d, segFrom: seg[k - 1], segTo: seg[k] }); } }
  const segments = [];
  for (let k = 0; k < out.n; k++) { const last = segments[segments.length - 1]; if (!last || last.id !== seg[k]) segments.push({ id: seg[k], from: k, to: k + 1 }); else last.to = k + 1; }
  return { points: out, seg, gap, gaps, segments, collapsed: all.n - out.n };
}
