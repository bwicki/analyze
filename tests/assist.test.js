// Profil-Assistent: structure analysis, mapping suggestions, profile build, preview – on a Garmin-like
// CSV (as on the design board), a decimal-comma/semicolon file with date+time columns, and JSON lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseText, suggestMapping, buildProfile, missingRequired, previewProfile } from '../src/parse/assist.js';
import { detectProfile, PROFILES } from '../src/parse/profiles.js';
import { readWithProfile } from '../src/parse/readers.js';

const garmin = ['time,lat,lon,alt_m,speed_kmh,course,vspeed_cms,bat',
  '2026-08-28T23:31:04Z,51.557430,6.974040,46.9,0.2,000,0,87', '2026-08-28T23:31:14Z,51.557612,6.974301,52.3,12.7,038,61,87', '2026-08-28T23:31:24Z,51.557990,6.974880,61.0,21.3,041,74,87', '2026-08-28T23:31:34Z,51.558300,6.975400,70.5,24.0,042,80,86'].join('\n');

test('garmin-like CSV: structure, suggestions, profile, preview', () => {
  const st = analyseText(garmin, 'garmin_export.txt');
  assert.equal(st.kind, 'delimited'); assert.equal(st.delimiter, ','); assert.equal(st.header, true); assert.equal(st.decimal, '.'); assert.equal(st.columns.length, 8); assert.equal(st.nRows, 4);
  const m = suggestMapping(st);
  assert.equal(m.time.col, 'time'); assert.equal(m.time.format, 'auto'); assert.equal(m.time.confidence, 'sure');
  assert.equal(m.lat.col, 'lat'); assert.equal(m.lon.col, 'lon'); assert.equal(m.alt.col, 'alt_m'); assert.equal(m.alt.unit, 'm');
  assert.equal(m.gs.col, 'speed_kmh'); assert.equal(m.gs.unit, 'km/h');
  assert.equal(m.vs.col, 'vspeed_cms'); assert.equal(m.vs.unit, 'cm/s');
  assert.equal(m.hdg.col, 'course'); assert.equal(m.batt.col, 'bat'); assert.equal(m.batt.unit, '%');
  assert.deepEqual(missingRequired(m), []);
  const prof = buildProfile(st, m, { name: 'Garmin Test', manufacturer: 'Garmin' });
  assert.equal(prof.read.kind, 'delimited'); assert.equal(prof.detect.headStartsWith, 'time,lat,lon,alt_m,speed_kmh,course,vspeed_cms,bat'); assert.equal(prof.id, 'garmin-test-delimited');
  assert.ok(JSON.stringify(prof).length < 2000, 'profile is plain JSON');
  const r = readWithProfile(garmin, prof);
  assert.equal(r.points.n, 4); assert.equal(r.points.t[0], Date.UTC(2026, 7, 28, 23, 31, 4)); assert.ok(Math.abs(r.points.gs[1] - 12.7 / 3.6) < 0.01); assert.ok(Math.abs(r.points.vs[2] - 0.74) < 1e-6);
  const pv = previewProfile(garmin, prof);
  assert.equal(pv.nFix, 4); assert.ok(pv.plausible); assert.ok(pv.path.startsWith('M'));
  // the saved profile is recognised next time (ahead of the built-in list)
  const det = detectProfile('garmin_export.txt', garmin.slice(0, 2000), [prof, ...PROFILES]);
  assert.equal(det.profile.id, 'garmin-test-delimited');
});

test('semicolon + decimal comma + date/time columns; headerless file; JSON lines', () => {
  const de = ['Datum;Zeit;Breite;Laenge;Hoehe [ft];Vario [ft/min];Fahrt [kt]', '28.08.2026;23:31:04;51,55743;6,97404;154;0;0,2', '28.08.2026;23:31:14;51,55761;6,97430;172;120;12,7', '28.08.2026;23:31:24;51,55799;6,97488;200;140;21,3'].join('\r\n');
  const st = analyseText(de, 'logger.csv');
  assert.equal(st.delimiter, ';'); assert.equal(st.decimal, ','); assert.equal(st.eol, 'CRLF');
  const m = suggestMapping(st);
  assert.equal(m.time.date, 'Datum'); assert.equal(m.time.time, 'Zeit'); assert.equal(m.time.dateFormat, 'dd/MM/yy');
  assert.equal(m.lat.col, 'Breite'); assert.equal(m.lon.col, 'Laenge'); assert.equal(m.alt.unit, 'ft'); assert.equal(m.vs.unit, 'ft/min'); assert.equal(m.gs.unit, 'kt');
  const prof = buildProfile(st, m, { name: 'Logger DE' });
  const r = readWithProfile(de, prof);
  assert.equal(r.points.n, 3); assert.equal(r.points.t[0], Date.UTC(2026, 7, 28, 23, 31, 4)); assert.ok(Math.abs(r.points.lat[0] - 51.55743) < 1e-5); assert.ok(Math.abs(r.points.alt[0] - 154 * 0.3048) < 0.01);
  // headerless: columns named col1..n, user maps them
  const raw = ['1756423864,51.5574,6.9740,46', '1756423874,51.5576,6.9743,52'].join('\n');
  const st2 = analyseText(raw, 'raw.txt');
  assert.equal(st2.header, false); assert.deepEqual(st2.columns, ['col1', 'col2', 'col3', 'col4']);
  const m2 = suggestMapping(st2);
  assert.equal(m2.time.col, 'col1'); assert.equal(m2.time.format, 'unix'); assert.equal(m2.lat.col, 'col2'); assert.equal(m2.lon.col, 'col3');
  const prof2 = buildProfile(st2, { ...m2, alt: { col: 'col4', unit: 'm' } }, { name: 'Raw' });
  const r2 = readWithProfile(raw, prof2);
  assert.equal(r2.points.n, 2); assert.equal(r2.points.t[0], 1756423864000); assert.equal(r2.points.alt[1], 52);
  // JSON lines
  const jl = ['{"ts":"2026-08-28T23:31:04Z","latitude":51.5574,"longitude":6.974,"altitude_ft":154}', '{"ts":"2026-08-28T23:31:14Z","latitude":51.5576,"longitude":6.9743,"altitude_ft":172}'].join('\n');
  const st3 = analyseText(jl, 'x.jsonl');
  assert.equal(st3.kind, 'jsonl'); assert.deepEqual(st3.columns, ['ts', 'latitude', 'longitude', 'altitude_ft']);
  const m3 = suggestMapping(st3);
  assert.equal(m3.time.col, 'ts'); assert.equal(m3.lat.col, 'latitude'); assert.equal(m3.lon.col, 'longitude'); assert.equal(m3.alt.col, 'altitude_ft'); assert.equal(m3.alt.unit, 'ft');
  const prof3 = buildProfile(st3, m3, { name: 'JL' });
  assert.equal(prof3.read.kind, 'jsonl'); assert.equal(prof3.detect.headStartsWith, '{"ts":');
  assert.equal(readWithProfile(jl, prof3).points.n, 2);
});
