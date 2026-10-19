import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectProfile, analyseHead } from '../src/parse/profiles.js';
import { readWithProfile, readGpx, readIgc, readKml, makeTimeParser } from '../src/parse/readers.js';
import { cleanTimestamps, splitAtRestarts, classifySegments, buildSegments } from '../src/process/segments.js';

const dir = new URL('./fixtures/', import.meta.url);

test('GB-Instrument JSONL: unpadded dates, keys and units', () => {
  const text = readFileSync(new URL('gb26_head.jsonl', dir), 'utf8');
  const det = detectProfile('log_260828_2049.jsonl', text.slice(0, 500));
  assert.equal(det.profile.id, 'gb-instrument-jsonl');
  const r = readWithProfile(text, det.profile);
  assert.ok(r.points.n > 250 && r.bad === 0);
  const i = r.points.n - 1;
  assert.equal(new Date(r.points.t[0]).toISOString().slice(0, 10), '2026-08-28');
  assert.ok(r.points.gs[i] >= 0 && r.points.gs[i] < 30, 'GS converted kt → m/s');
  assert.ok(r.points.fix[i] === 1 || r.points.fix[i] === 0);
});

test('time parser: dd/MM/yy + H:m:s, ISO, unix', () => {
  const p = makeTimeParser({ date: 'D', time: 'T', dateFormat: 'd/M/yy' });
  assert.equal(p({ D: '21/4/26', T: '19:16:9' }), Date.UTC(2026, 3, 21, 19, 16, 9));
  assert.equal(p({ D: '21/04/26', T: '19:16:09' }), Date.UTC(2026, 3, 21, 19, 16, 9));
  const iso = makeTimeParser({ col: 'time' });
  assert.equal(iso({ time: '2026-08-28 23:31:04' }), Date.UTC(2026, 7, 28, 23, 31, 4));
  assert.equal(iso({ time: '2026-08-28T23:31:04Z' }), Date.UTC(2026, 7, 28, 23, 31, 4));
  assert.equal(makeTimeParser({ col: 'u', format: 'unix' })({ u: '1788132000' }), 1788132000000);
});

test('GPX, IGC and KML readers', () => {
  const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="x"><trk><trkseg>
    <trkpt lat="47.44" lon="8.56"><ele>432</ele><time>2026-05-01T06:00:00Z</time></trkpt>
    <trkpt lat="47.45" lon="8.57"><ele>540</ele><time>2026-05-01T06:01:00Z</time></trkpt></trkseg></trk></gpx>`;
  assert.equal(detectProfile('a.gpx', gpx).profile.id, 'gpx');
  const g = readGpx(gpx); assert.equal(g.points.n, 2); assert.equal(g.points.alt[1], 540);
  const igc = 'AXXX001\nHFDTE280826\nB2331314733460N00858340EA0043200450\nB2331414733500N00858400EA0045000468\n';
  assert.equal(detectProfile('a.igc', igc).profile.id, 'igc');
  const i = readIgc(igc); assert.equal(i.points.n, 2); assert.equal(new Date(i.points.t[0]).toISOString(), '2026-08-28T23:31:31.000Z'); assert.ok(Math.abs(i.points.lat[0] - 47.5577) < 0.001);
  const kml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><gx:Track><when>2026-08-28T23:31:31Z</when><when>2026-08-28T23:32:31Z</when><gx:coord>6.974 51.557 43</gx:coord><gx:coord>6.98 51.56 80</gx:coord></gx:Track></Placemark></Document></kml>`;
  assert.equal(detectProfile('a.kml', kml).profile.id, 'kml');
  const k = readKml(kml); assert.equal(k.points.n, 2); assert.equal(k.points.alt[1], 80);
});

test('unknown file analysis', () => {
  const det = detectProfile('foo.txt', 'time,lat,lon,alt_m\n2026-08-28T23:31:04Z,51.55,6.97,46\n');
  assert.ok(det.unknown); assert.equal(det.analysis.delimiter, ','); assert.equal(det.analysis.columns, 4); assert.ok(det.analysis.header);
  assert.equal(analyseHead('a;b\r1;2\r').eol, 'CR');
});

test('timestamp cleaning, restart split, duplicate classification', () => {
  const mk = (ts, runtime) => ({ n: ts.length, t: Float64Array.from(ts), lat: Float32Array.from(ts.map(() => 47)), lon: Float32Array.from(ts.map(() => 8)), alt: Float32Array.from(ts.map(() => 400)), balt: Float32Array.from(ts.map(() => NaN)), press: Float32Array.from(ts.map(() => NaN)), vs: Float32Array.from(ts.map(() => 0)), gs: Float32Array.from(ts.map(() => 0)), hdg: Float32Array.from(ts.map(() => NaN)), runtime: Float32Array.from(runtime), batt: Float32Array.from(ts.map(() => NaN)), fix: Uint8Array.from(ts.map(() => 1)) });
  const base = Date.UTC(2026, 7, 28, 20, 0, 0);
  const ts = [0, 1, 2, 3, 4, 5, 6].map((s) => base + s * 1000); ts[3] = Date.UTC(2026, 1, 10); // outlier
  const c = cleanTimestamps(mk(ts, [1, 2, 3, 4, 5, 6, 7]));
  assert.equal(c.dropped, 1); assert.equal(c.points.n, 6);
  const parts = splitAtRestarts(mk([0, 1, 2, 3].map((s) => base + s * 1000), [10, 11, 1, 2]));
  assert.equal(parts.length, 2);
  const fA = { name: 'a.csv', profile: { id: 'x', priority: 0 }, points: mk([0, 1, 2, 3].map((s) => base + s * 1000), [1, 2, 3, 4]) };
  const fB = { name: 'a.jsonl', profile: { id: 'y', priority: 1 }, points: mk([0, 1, 2, 3].map((s) => base + s * 1000), [1, 2, 3, 4]) };
  const segs = classifySegments(buildSegments([fA, fB]));
  assert.equal(segs.find((s) => s.file === 'a.csv').status, 'dup');
  assert.equal(segs.find((s) => s.file === 'a.jsonl').status, 'use');
});

test('aprs.fi JSON export (array of rows) is recognised and read', async () => {
  const { detectProfile } = await import('../src/parse/profiles.js');
  const { readWithProfile } = await import('../src/parse/readers.js');
  const text = JSON.stringify([{ time: '2026-10-16 12:07:51', lasttime: '2026-10-16 12:07:51', lat: 44.91367, lng: 9.71483, course: 24, speed: 12, altitude: 271.27, srccall: 'HB3XAD-6' }, { time: 1760616000, lat: 44.9125, lng: 9.71117, altitude: 409.96 }]);
  const det = detectProfile('aprsfi_export.json', text.slice(0, 2000));
  assert.equal(det.profile && det.profile.id, 'aprsfi-json');
  const r = readWithProfile(text, det.profile);
  assert.equal(r.points.n, 2); assert.equal(r.bad, 0);
  assert.equal(r.points.t[0], Date.UTC(2026, 9, 16, 12, 7, 51)); assert.ok(Math.abs(r.points.gs[0] - 12 / 3.6) < 0.01); assert.equal(r.points.t[1], 1760616000 * 1000);
});
