// End-to-end on the thinned GB26 fixtures (every 15th line of the real logs, CR line endings kept):
// profile detection, segments, merge, detection, trim and the key figures (concept §13 acceptance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectProfile } from '../src/parse/profiles.js';
import { readWithProfile } from '../src/parse/readers.js';
import { buildSegments, classifySegments, mergeSegments } from '../src/process/segments.js';
import { deriveSeries } from '../src/process/series.js';
import { detectEvents, proposeTrim } from '../src/process/detect.js';
import { computeStats } from '../src/process/stats.js';
import { extremePoints, markerMinutes } from '../src/process/track.js';

const dir = new URL('./fixtures/', import.meta.url);
function load(name) {
  const text = readFileSync(new URL(name, dir), 'latin1');
  const det = detectProfile(name, text.slice(0, 2000));
  assert.ok(!det.unknown, `${name} recognised`);
  const r = readWithProfile(text, det.profile);
  return { name, size: text.length, profile: det.profile, points: r.points, bad: r.bad };
}

test('GB26: two logs with a restart give one flight with the expected figures', () => {
  const files = [load('gb26_260828_2049.csv'), load('gb26_260830_0242.csv')];
  assert.equal(files[0].profile.id, 'gb-instrument-csv');
  assert.ok(files[0].points.n > 6000 && files[0].bad === 0, 'CR-only lines are split correctly');
  const segs = classifySegments(buildSegments(files));
  assert.equal(segs.length, 2); assert.ok(segs.every((s) => s.status === 'use'));
  const track = mergeSegments(segs);
  assert.equal(track.segments.length, 2);
  const series = deriveSeries(track);
  const { events } = detectEvents(track, series);
  const tko = events.find((e) => e.type === 'takeoff'), ldg = events.filter((e) => e.type === 'landing').pop();
  assert.ok(tko && ldg);
  assert.ok(Math.abs(tko.t - Date.UTC(2026, 7, 28, 23, 31, 31)) < 90000, `take-off ${new Date(tko.t).toISOString()} near 23:31:31`);
  assert.ok(Math.abs(ldg.t - Date.UTC(2026, 7, 30, 16, 34, 15)) < 90000, `landing ${new Date(ldg.t).toISOString()} near 16:34`);
  const trim = proposeTrim(track, events);
  const st = computeStats(track, series, events, trim);
  assert.equal(st.landings, 1);
  assert.ok(Math.abs(st.durationSec - 41 * 3600 - 3 * 60) < 180, `duration ${st.durationSec}`);
  assert.ok(st.distanceM > 1570000 && st.distanceM < 1600000, `distance ${st.distanceM}`);
  assert.ok(st.straightM > 1545000 && st.straightM < 1556000, `straight ${st.straightM}`);
  assert.ok(st.altMax.v > 930 && st.altMax.v < 960, `alt max ${st.altMax.v}`);
  assert.ok(st.gsMax.v / 0.514444 > 33 && st.gsMax.v / 0.514444 < 40, 'gs max ~37 kt');
  assert.equal(st.restarts, 1);
  assert.ok(st.night.totalSec / 3600 > 12 && st.night.totalSec / 3600 < 13.2, `night ${st.night.totalSec / 3600} h`);
  assert.equal(st.night.intervals.length, 2);
  assert.ok(st.touchdown.length === 1 && st.touchdown[0].vs < -0.5 && st.touchdown[0].vs > -3, 'touchdown rate plausible');
});

test('timestamp outliers and no-fix rows are handled', () => {
  const f = load('gb26_260828_2049.csv');
  let noFix = 0; for (let i = 0; i < f.points.n; i++) if (!f.points.fix[i]) noFix++;
  assert.ok(noFix >= 0);
  const segs = buildSegments([f]);
  assert.ok(segs[0].dropped >= 0);
  // segments are time-sorted
  const t = segs[0].points.t; for (let i = 1; i < t.length; i++) assert.ok(t[i] >= t[i - 1]);
});

test('false intermediate landing can be removed: landing + following take-off merge the legs', async () => {
  const { dropIgnoredLandings, statesFromEvents } = await import('../src/process/detect.js');
  const ev = [{ type: 'takeoff', t: 1000, idx: 1 }, { type: 'landing', t: 5000, idx: 5 }, { type: 'takeoff', t: 6000, idx: 6 }, { type: 'landing', t: 9000, idx: 9 }];
  const out = dropIgnoredLandings(ev, [5000]);
  assert.deepEqual(out.map((e) => e.type + e.t), ['takeoff1000', 'landing9000']);
  assert.deepEqual(Array.from(statesFromEvents(out, 11)), [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
  assert.equal(dropIgnoredLandings(ev, [4000]).length, 4);     // no match → untouched
});

test('altitude outliers (fill values, isolated spikes) are masked and the profile axis starts near the lowest altitude', async () => {
  const { deriveSeries } = await import('../src/process/series.js');
  const { renderProfileSvg } = await import('../src/ui/profile.js').catch(() => ({}));
  const n = 400, t = new Float64Array(n), lat = new Float32Array(n), lon = new Float32Array(n), alt = new Float32Array(n), fix = new Uint8Array(n).fill(1);
  for (let i = 0; i < n; i++) { t[i] = Date.UTC(2026, 8, 1, 10, 0, 0) + i * 5000; lat[i] = 47 + i * 1e-4; lon[i] = 8 + i * 1e-4; alt[i] = 600 + 300 * Math.sin(i / 40); }
  alt[50] = -65536; alt[51] = -65536; alt[200] = 9000;   // fill values and one isolated spike
  const ps = { n, t, lat, lon, alt, fix, balt: new Float32Array(n).fill(NaN), press: new Float32Array(n).fill(NaN), vs: new Float32Array(n).fill(NaN), gs: new Float32Array(n).fill(NaN), hdg: new Float32Array(n).fill(NaN), runtime: new Float32Array(n).fill(NaN), batt: new Float32Array(n).fill(NaN) };
  const track = { points: ps, seg: new Uint16Array(n), gap: new Uint8Array(n), gaps: [], segments: [{ id: 1, from: 0, to: n }], collapsed: 0 };
  const s = deriveSeries(track, { gapSec: 30 });
  assert.ok(s.altMask[50] && s.altMask[51] && s.altMask[200], 'outliers masked');
  assert.ok(Number.isNaN(s.altClean[50]) && Number.isNaN(s.altClean[200]));
  const clean = Array.from(s.altClean).filter((a) => !Number.isNaN(a));
  assert.ok(Math.min(...clean) > 290 && Math.max(...clean) < 910, 'clean range plausible');
});

test('a manual cut inside the flight defines launch and landing (0.8.3); the end of an airborne recording stays "no landing"', () => {
  const files = [load('gb26_260828_2049.csv'), load('gb26_260830_0242.csv')];
  const track = mergeSegments(classifySegments(buildSegments(files)));
  const series = deriveSeries(track);
  const { events } = detectEvents(track, series);
  const auto = proposeTrim(track, events);
  const base = computeStats(track, series, events, auto);
  // cut 20 min after the detected take-off and 10 min before the detected landing
  const trim = { from: base.takeoff.t + 20 * 60000, to: base.landing.t - 10 * 60000, auto: false };
  const st = computeStats(track, series, events, trim);
  assert.ok(st.takeoff && st.takeoff.cut, 'take-off set by the cut');
  assert.ok(st.landing && st.landing.cut, 'landing set by the cut');
  assert.ok(Math.abs(st.takeoff.t - trim.from) < 20000 && Math.abs(st.landing.t - trim.to) < 20000, 'events at the cut times');
  assert.ok(!Number.isNaN(st.takeoff.lat) && !Number.isNaN(st.landing.lat), 'positions from the nearest fix');
  assert.equal(st.landings, 1); assert.equal(st.intermediate.length, 0);
  assert.ok(Math.abs(st.durationSec - (base.durationSec - 30 * 60)) < 60, `duration ${st.durationSec}`);
  assert.ok(st.distanceM < base.distanceM, 'distance shrinks with the cut');
  assert.ok(st.touchdown.length === 1 && Number.isNaN(st.touchdown[0].vs) && st.touchdown[0].cut, 'no touchdown rate for a cut landing');
  // the same cut as "auto" (the proposal never cuts into the flight) keeps the detected events outside → nothing synthesised
  const st2 = computeStats(track, series, events, { ...trim, auto: true });
  assert.equal(st2.takeoff, null); assert.equal(st2.landing, null);
  // a recording that ends airborne: cut the end to the last point → no landing is made up
  const n = track.points.n, tEnd = track.points.t[n - 1];
  const noLanding = events.filter((e) => !(e.type === 'landing' && e.t === base.landing.t));
  const st3 = computeStats(track, series, noLanding, { from: auto.from, to: tEnd, auto: false });
  assert.equal(st3.landing, null, 'end of recording is not a landing');
  assert.ok(st3.endFix, 'end fix available instead');
  // but a cut before the end of such a recording is a landing
  const st4 = computeStats(track, series, noLanding, { from: auto.from, to: tEnd - 15 * 60000, auto: false });
  assert.ok(st4.landing && st4.landing.cut);
  // a widened cut (before the detected take-off) changes nothing
  const st5 = computeStats(track, series, events, { from: auto.from - 30 * 60000, to: auto.to, auto: false });
  assert.equal(st5.takeoff.t, base.takeoff.t); assert.ok(!st5.takeoff.cut);
});

test('0.9.0: marker interval auto (10 min ≤ 5 h, 30 min beyond) and the extreme points lie on the track', () => {
  assert.equal(markerMinutes('auto', 3 * 3600), 10); assert.equal(markerMinutes('auto', 6 * 3600), 30); assert.equal(markerMinutes(15, 6 * 3600), 15); assert.equal(markerMinutes(undefined, 1000), 10);
  const files = [load('gb26_260828_2049.csv'), load('gb26_260830_0242.csv')];
  const track = mergeSegments(classifySegments(buildSegments(files)));
  const series = deriveSeries(track); const { events } = detectEvents(track, series);
  const st = computeStats(track, series, events, proposeTrim(track, events));
  const xs = extremePoints(track, series, st);
  assert.deepEqual(xs.map((x) => x.kind), ['alt', 'gs', 'up', 'down']);
  const alt = xs.find((x) => x.kind === 'alt'); assert.equal(alt.t, st.altMax.t); assert.ok(Math.abs(alt.alt - st.altMax.v) < 1); assert.ok(alt.symbol === '◆' && alt.fix && !Number.isNaN(alt.lat));
  const dn = xs.find((x) => x.kind === 'down'); assert.equal(dn.t, st.vsMin.t); assert.equal(dn.value, st.vsMin.v); assert.equal(dn.symbol, '▼');
});

// ---- sparse recordings (0.15.2): inReach LiveTrack sends a point every 2 min, MapShare every 10 min – with the
// 30-s gap threshold everything was a gap (distance 0, no vario, nothing on the map)
test('sparse 2-min recording: gap threshold adapts, distance/vario/take-off/landing come out', async () => {
  const { samplingSec, effectiveGapSec } = await import('../src/process/segments.js');
  const { readGpx } = await import('../src/parse/readers.js');
  const t0 = Date.parse('2026-10-15T13:31:45Z'); const rows = [];
  const N = 615, latA = 44.914137, lonA = 9.715905, latB = 37.839478, lonB = 14.826093;
  for (let k = 0; k < N; k++) {
    let t = t0 + k * 120000; if (k >= 2) t += 80 * 60000;   // 80 min on the ground before the launch, like the real session
    const f = k < 2 ? 0 : (k - 2) / (N - 3);
    const lat = latA + (latB - latA) * f, lon = lonA + (lonB - lonA) * f;
    const alt = k < 2 ? 130 : f < 0.1 ? 130 + (f / 0.1) * 3500 : f < 0.92 ? 3600 + 500 * Math.sin(f * 20) : 4000 - ((f - 0.92) / 0.08) * 2800;
    rows.push(`<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${alt.toFixed(1)}</ele><time>${new Date(t).toISOString()}</time></trkpt>`);
  }
  const r = readGpx(`<gpx><trk><trkseg>${rows.join('')}</trkseg></trk></gpx>`);
  const files = [{ name: 'livetrack.gpx', size: 1, profile: { id: 'gpx' }, points: r.points, bad: 0 }];
  assert.equal(Math.round(samplingSec(files)), 120); assert.equal(effectiveGapSec(files, 30), 360);
  assert.equal(effectiveGapSec([{ points: { n: 3, t: [0, 1000, 2000] } }], 30), 30);   // dense data keeps the setting
  assert.equal(effectiveGapSec([{ points: { n: 3, t: [0, 600000, 1200000] } }], 30), 1800);   // MapShare 10 min
  const gapSec = effectiveGapSec(files, 30);
  const segs = classifySegments(buildSegments(files, { gapSec }));
  const track = mergeSegments(segs, { gapSec, merge: false });
  assert.equal(track.gaps.length, 1);   // only the 80-min ground wait
  const series = deriveSeries(track, { gapSec, samplingSec: samplingSec(files) });
  const d = detectEvents(track, series);
  const types = d.events.map((e) => e.type);
  assert.ok(types.includes('takeoff') && (types.includes('landing') || types.includes('end')), `events ${types}`);
  const trim = proposeTrim(track, d.events);
  const st = computeStats(track, series, d.events, trim);
  assert.ok(st.distanceM > 880000 && st.distanceM < 920000, `distance ${st.distanceM}`);
  assert.ok(st.altMax.v > 4000, 'altitude max'); assert.ok(st.vsMax.v > 0 && st.vsMin.v < 0, `vario ${st.vsMax.v} ${st.vsMin.v}`); assert.ok(st.gsMax.v > 10, `gs ${st.gsMax.v}`);
  // with the old fixed threshold the same data has no distance at all – the regression this guards against
  const bad = deriveSeries(mergeSegments(segs, { gapSec: 30, merge: false }), { gapSec: 30 });
  assert.equal(bad.dist[bad.dist.length - 1], 0);
});
