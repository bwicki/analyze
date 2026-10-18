// Ereignislog: normalisation of the reporting app's rows, CSV export, linking to the GB26 fixture track.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeEvents, parseEventLog, parseCsvRows, linkEvents, summarizeEvents, scoreFlightMatch, eventText } from '../src/events/log.js';
import { detectProfile } from '../src/parse/profiles.js';
import { readWithProfile } from '../src/parse/readers.js';
import { buildSegments, classifySegments, mergeSegments } from '../src/process/segments.js';
import { deriveSeries } from '../src/process/series.js';
import { detectEvents, proposeTrim } from '../src/process/detect.js';

const dir = new URL('./fixtures/', import.meta.url);
const sample = readFileSync(new URL('eventlog_sample.json', dir), 'utf8');

test('normalise rows: types, positions, text, deleted and bad rows dropped, sorted by time', () => {
  const ev = normalizeEvents(JSON.parse(sample));
  assert.equal(ev.length, 6);                                   // e7 deleted, e8 no date
  assert.deepEqual(ev.map((e) => e.id), ['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  assert.equal(ev[0].type, 'ATC'); assert.equal(ev[0].text, 'RX · Test Radar · 128.555 MHz · SQ 7000: Identified');
  assert.equal(ev[1].text, 'count · 596 kg total · (sand 564, water 32)');
  assert.equal(ev[2].text, 'drop · -10 kg sand · 586 kg total');
  assert.ok(Number.isNaN(ev[3].lat)); assert.equal(ev[3].text, 'Batt 80 % · Fuel cell on · O₂ 2\'900 lit (88%)');
  assert.equal(ev[4].text, 'PIC Change, new: Crew A');
  assert.equal(eventText({ type: 'POS' }), '');
});

test('CSV export of the app is read like the JSON', () => {
  const csv = 'flight_id,ts_utc,type,lat,lon,atc_msg,note\nTEST26,2026-08-28T23:40:00Z,ATC,51.6,7.04,"Hello, ""World""",\nTEST26,2026-08-28T23:50:00Z,Ballast,,,,"two\nlines"\n';
  const rows = parseCsvRows(csv);
  assert.equal(rows.length, 2); assert.equal(rows[0].atc_msg, 'Hello, "World"'); assert.equal(rows[1].note, 'two\nlines');
  const ev = parseEventLog(csv, 'x.csv');
  assert.equal(ev.length, 2); assert.equal(ev[0].lat, 51.6);
  assert.throws(() => parseEventLog('a,b\n1,2', 'y.csv'));
});

test('linking to the GB26 track: track positions, Δ distance, in-trim flag; summary', () => {
  const load = (name) => { const text = readFileSync(new URL(name, dir), 'latin1'); const det = detectProfile(name, text.slice(0, 2000)); const r = readWithProfile(text, det.profile); return { name, size: text.length, profile: det.profile, points: r.points, bad: r.bad }; };
  const segs = classifySegments(buildSegments([load('gb26_260828_2049.csv'), load('gb26_260830_0242.csv')]));
  const track = mergeSegments(segs), series = deriveSeries(track);
  const { events } = detectEvents(track, series); const trim = proposeTrim(track, events);
  const linked = linkEvents(normalizeEvents(JSON.parse(sample)), track, series, trim);
  const e1 = linked.find((e) => e.id === 'e1');
  assert.ok(e1.onTrack && e1.inTrim && e1.idx > 0, 'ATC event lies on the track');
  assert.ok(e1.distM < 5000, `reported position within 5 km of the track (${e1.distM})`);
  assert.ok(!Number.isNaN(e1.alt) && e1.alt > 100 && e1.alt < 1000, 'altitude from the track');
  const e4 = linked.find((e) => e.id === 'e4');
  assert.ok(e4.onTrack && !Number.isNaN(e4.lat), 'event without own position gets the track position');
  const e6 = linked.find((e) => e.id === 'e6');
  assert.ok(!e6.onTrack && !e6.inTrim && e6.lat === 60, 'event a week later keeps its own position and is outside the trim');
  const sm = summarizeEvents(normalizeEvents(JSON.parse(sample)));
  assert.equal(sm.n, 6); assert.equal(sm.counts.Ballast, 2); assert.equal(sm.ballastStart, 596); assert.equal(sm.ballastEnd, 586); assert.equal(sm.drops, 1); assert.equal(sm.dropped, 10);
  assert.ok(scoreFlightMatch({ first: '2026-08-28T23:40:00Z', last: '2026-08-30T12:00:00Z' }, trim.from, trim.to) > 0.8);
  assert.equal(scoreFlightMatch({ first: '2026-09-05T00:00:00Z', last: '2026-09-06T00:00:00Z' }, trim.from, trim.to), 0);
});
