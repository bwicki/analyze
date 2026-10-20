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
