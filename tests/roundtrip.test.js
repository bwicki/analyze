// A saved flight (GeoJSON from toGeoJson) must re-open with the same segments and key figures:
// the viewer and "Meine Fahrten → Öffnen" go through readGeoJson() and the normal pipeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectProfile } from '../src/parse/profiles.js';
import { readWithProfile, readGeoJson } from '../src/parse/readers.js';
import { buildSegments, classifySegments, mergeSegments } from '../src/process/segments.js';
import { deriveSeries } from '../src/process/series.js';
import { detectEvents, proposeTrim } from '../src/process/detect.js';
import { computeStats } from '../src/process/stats.js';
import { trackPoints } from '../src/process/track.js';
import { toGeoJson } from '../src/export/formats.js';

const dir = new URL('./fixtures/', import.meta.url);
function load(name, text = readFileSync(new URL(name, dir), 'latin1')) {
  const det = detectProfile(name, text.slice(0, 2000));
  assert.ok(!det.unknown, `${name} recognised`);
  const r = readWithProfile(text, det.profile);
  return { name, size: text.length, profile: det.profile, points: r.points, bad: r.bad };
}
function pipeline(files) {
  const segs = classifySegments(buildSegments(files));
  const track = mergeSegments(segs);
  const series = deriveSeries(track);
  const { events } = detectEvents(track, series);
  const trim = proposeTrim(track, events);
  return { track, series, events, trim, stats: computeStats(track, series, events, trim) };
}

test('GB26 → GeoJSON → GB26: segments, restart, figures survive', () => {
  const a = pipeline([load('gb26_260828_2049.csv'), load('gb26_260830_0242.csv')]);
  const pts = trackPoints(a.track, a.series, a.trim, 0);
  const text = toGeoJson({ pts, name: 'GB26', stats: { x: 1 }, meta: { balloon: 'HB-QWV' } });
  const doc = JSON.parse(text);
  const lines = doc.features.filter((f) => f.geometry.type === 'LineString');
  assert.ok(lines.length >= 2 && lines.some((l) => l.properties.restart === true), 'restart flagged on a line');
  assert.ok(lines[0].properties.palt_m && lines[0].properties.press_hpa && lines[0].properties.batt_v, 'sensor series kept');
  // re-open through profile detection (as the viewer does)
  const det = detectProfile('GB26.geojson', text.slice(0, 2000));
  assert.equal(det.profile.id, 'geojson');
  const b = pipeline([load('GB26.geojson', text)]);
  assert.equal(b.track.segments.length, a.track.segments.length);
  assert.equal(b.stats.restarts, a.stats.restarts);
  assert.equal(b.stats.landings, a.stats.landings);
  assert.ok(Math.abs(b.stats.takeoff.t - a.stats.takeoff.t) < 1000, 'take-off identical');
  assert.ok(Math.abs(b.stats.landing.t - a.stats.landing.t) < 1000, 'landing identical');
  assert.ok(Math.abs(b.stats.durationSec - a.stats.durationSec) < 2);
  assert.ok(Math.abs(b.stats.distanceM - a.stats.distanceM) / a.stats.distanceM < 0.002, `distance ${a.stats.distanceM} vs ${b.stats.distanceM}`);
  assert.ok(Math.abs(b.stats.altMax.v - a.stats.altMax.v) < 1);
  assert.ok(Math.abs(b.stats.vsMax.v - a.stats.vsMax.v) < 0.05 && Math.abs(b.stats.vsMin.v - a.stats.vsMin.v) < 0.05, `vario ${a.stats.vsMax.v}/${b.stats.vsMax.v}`);
  assert.ok(Math.abs(b.stats.baroMax.v - a.stats.baroMax.v) < 1, 'pressure altitude survives');
  assert.ok(Math.abs(b.stats.night.totalSec - a.stats.night.totalSec) < 120);
});

test('foreign GeoJSON without times is read as timeless; Point features are ignored', () => {
  const doc = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[6.97, 51.55, 40], [6.98, 51.56, 60], [6.99, 51.57, 80]] } },
    { type: 'Feature', properties: { kind: 'takeoff' }, geometry: { type: 'Point', coordinates: [6.97, 51.55] } },
  ] };
  const r = readGeoJson(JSON.stringify(doc));
  assert.equal(r.points.n, 3); assert.equal(r.timeless, true); assert.equal(r.points.alt[2], 80);
});
