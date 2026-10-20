import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupDevices, coverage, multiIntervals, combine, multiDeviceParts } from '../src/process/consensus.js';
import { buildSegments, classifySegments, mergeSegments } from '../src/process/segments.js';
import { haversine } from '../src/util/geo.js';

// synthetic "true" flight: 2 h, straight line NE, altitude a slow sine
const T0 = Date.UTC(2026, 8, 5, 6, 0, 0);
const truth = (t) => { const s = (t - T0) / 1000; return { lat: 47 + s * 2e-5, lon: 8 + s * 3e-5, alt: 800 + 400 * Math.sin(s / 900) }; };
function device(name, { from = 0, to = 7200, step = 5, noiseM = 8, altBias = 0, gaps = [], glitchAt = [], glitchM = 1500, priority = 0 } = {}) {
  const pts = [];
  for (let s = from; s <= to; s += step) {
    if (gaps.some(([a, b]) => s >= a && s <= b)) continue;
    const t = T0 + s * 1000, p = truth(t);
    const r = (k) => Math.sin(s * 0.37 + k) * noiseM / 111320;     // deterministic "noise"
    const glitch = glitchAt.includes(s) ? glitchM / 111320 : 0;
    pts.push({ t, lat: p.lat + r(1) + glitch, lon: p.lon + r(2), alt: p.alt + altBias + Math.sin(s * 0.11) * 3, fix: true });
  }
  const n = pts.length, ps = { n, t: new Float64Array(n), lat: new Float32Array(n), lon: new Float32Array(n), alt: new Float32Array(n), fix: new Uint8Array(n) };
  for (const f of ['balt', 'press', 'vs', 'gs', 'hdg', 'runtime', 'batt']) ps[f] = new Float32Array(n).fill(NaN);
  pts.forEach((p, i) => { ps.t[i] = p.t; ps.lat[i] = p.lat; ps.lon[i] = p.lon; ps.alt[i] = p.alt; ps.fix[i] = 1; });
  return { name: `${name}.csv`, size: n * 40, profile: { id: name, name, priority }, points: ps, bad: 0 };
}
const segsOf = (files) => classifySegments(buildSegments(files, { gapSec: 30 }), { otherFlightHours: 12 });

test('devices: grouping by profile, coverage with gaps, multi-device intervals', () => {
  const segs = segsOf([device('GB-Instrument', { priority: 1, gaps: [[3000, 3300]] }), device('aprs.fi', { from: 1800, to: 5400 })]);
  const devs = groupDevices(segs);
  assert.deepEqual(devs.map((d) => d.name), ['GB-Instrument', 'aprs.fi']);
  const cov = coverage(devs[0], 30);
  assert.equal(cov.length, 2); assert.equal(cov[0][1], T0 + 2995 * 1000); assert.equal(cov[1][0], T0 + 3305 * 1000);
  const multi = multiIntervals([cov, coverage(devs[1], 30)]);
  assert.equal(multi.length, 2);
  assert.equal(multi[0][0], T0 + 1800 * 1000); assert.equal(multi[0][1], T0 + 2995 * 1000);
  assert.equal(multi[1][0], T0 + 3305 * 1000); assert.equal(multi[1][1], T0 + 5400 * 1000);
});

test('combine: two devices average, far apart → priority wins; three devices → outlier rejected', () => {
  const a = { fix: 1, lat: 47, lon: 8, alt: 1000 }, b = { fix: 1, lat: 47.0001, lon: 8, alt: 1010 }, far = { fix: 1, lat: 47.05, lon: 8, alt: 3000 };
  const c2 = combine([a, b], 300); assert.ok(Math.abs(c2.lat - 47.00005) < 1e-9 && c2.alt === 1005 && c2.rejected === 0);
  const c2f = combine([a, far], 300); assert.equal(c2f.lat, 47); assert.equal(c2f.rejected, 1);
  const c3 = combine([a, far, b], 300); assert.equal(c3.rejected, 1); assert.ok(Math.abs(c3.lat - 47.00005) < 1e-9); assert.equal(c3.alt, 1005);
  const none = combine([{ fix: 0, lat: NaN, lon: NaN, alt: 900 }], 300); assert.equal(none.fix, 0); assert.equal(none.alt, 900);
});

test('consensus: grid inside the overlap, full resolution outside, glitches of one device rejected, track assembled', () => {
  const files = [device('GB-Instrument', { priority: 1, glitchAt: [3600, 3605] }), device('aprs.fi', { from: 1800, to: 5400, step: 20, altBias: 15 }), device('GPX', { from: 2400, to: 4800, step: 10, altBias: -15, glitchAt: [4000] })];
  const segs = segsOf(files);
  assert.ok(segs.every((s) => s.status === 'use'), 'different devices are not duplicates');
  const { parts, info } = multiDeviceParts(segs, { mode: 'consensus', stepSec: 10, gapSec: 30 });
  assert.equal(info.devices.length, 3); assert.equal(info.primary, 'GB-Instrument#1');
  assert.equal(info.multiSec, 3600); assert.equal(info.gridPoints, 361);
  assert.ok(info.rejected >= 2, `glitches rejected (${info.rejected})`);
  const track = mergeSegments(segs, { gapSec: 30, merge: { mode: 'consensus', stepSec: 10 } });
  assert.ok(track.merge && track.merge.mode === 'consensus');
  const ps = track.points;
  // every point within 60 m of the truth (glitch of 1.5 km removed), altitude within 20 m
  let worst = 0, worstAlt = 0;
  for (let i = 0; i < ps.n; i++) { const p = truth(ps.t[i]); worst = Math.max(worst, haversine(ps.lat[i], ps.lon[i], p.lat, p.lon)); worstAlt = Math.max(worstAlt, Math.abs(ps.alt[i] - p.alt)); }
  assert.ok(worst < 60, `max position error ${worst.toFixed(1)} m`); assert.ok(worstAlt < 20, `max altitude error ${worstAlt.toFixed(1)} m`);
  // full resolution (5 s) before the overlap, 10 s grid inside
  const dt = (k) => ps.t[k + 1] - ps.t[k];
  const i0 = ps.t.findIndex((t) => t >= T0 + 1000 * 1000), i1 = ps.t.findIndex((t) => t >= T0 + 3000 * 1000);
  assert.equal(dt(i0), 5000); assert.equal(dt(i1), 10000);
  assert.equal(track.segments.length, 1, 'no fake restarts from the grid');
});

test('primary + gap filling: primary keeps its points, others only fill its breaks', () => {
  const files = [device('GB-Instrument', { priority: 1, gaps: [[2000, 2600]] }), device('aprs.fi', { from: 1800, to: 5400, step: 20, altBias: 15 })];
  const segs = segsOf(files);
  const { parts, info } = multiDeviceParts(segs, { mode: 'primary', gapSec: 30 });
  assert.equal(info.mode, 'primary'); assert.ok(info.filledSec > 500 && info.filledSec < 620, `filled ${info.filledSec}`);
  const track = mergeSegments(segs, { gapSec: 30, merge: { mode: 'primary' } });
  const ps = track.points;
  // inside the primary gap the points come from aprs.fi (20 s spacing, +15 m bias); outside they are the primary's 5 s points
  const k = ps.t.findIndex((t) => t >= T0 + 2300 * 1000);
  assert.equal(ps.t[k + 1] - ps.t[k], 20000);
  assert.ok(Math.abs(ps.alt[k] - truth(ps.t[k]).alt - 15) < 5);
  const j = ps.t.findIndex((t) => t >= T0 + 4000 * 1000);
  assert.equal(ps.t[j + 1] - ps.t[j], 5000);
  // explicit primary choice
  const r2 = multiDeviceParts(segs, { mode: 'primary', primary: 'aprs.fi#1', gapSec: 30 });
  assert.equal(r2.info.primary, 'aprs.fi#1');
});

test('one device only: untouched (same as before)', () => {
  const segs = segsOf([device('GB-Instrument')]);
  const { parts, info } = multiDeviceParts(segs, { gapSec: 30 });
  assert.equal(parts.length, 1); assert.equal(info.devices.length, 1); assert.equal(info.multiSec, 0);
});
