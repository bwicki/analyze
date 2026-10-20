// Link-preview image (0.8.4): view fitting and the data the renderer gets from the pipeline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitView, previewData, PREVIEW_W, PREVIEW_H } from '../src/export/preview.js';
import { state, recompute } from '../src/state.js';
import { detectProfile } from '../src/parse/profiles.js';
import { readWithProfile } from '../src/parse/readers.js';

test('fitView picks the largest zoom at which the bounds fit the map area', () => {
  const v = fitView({ west: 6.5, east: 26.5, south: 51.5, north: 60.5 });          // GB26: Germany → Finland
  assert.equal(v.z, 5); assert.equal(v.w, PREVIEW_W); assert.ok(v.h < PREVIEW_H);
  const lon2x = (lon, z) => (lon + 180) / 360 * 256 * 2 ** z;
  assert.ok(lon2x(6.5, 5) - v.left >= 56 && lon2x(26.5, 5) - v.left <= PREVIEW_W - 56, 'bounds inside the padding');
  assert.equal(fitView({ west: 8.0, east: 8.05, south: 47.0, north: 47.03 }).z, 13);   // short local flight
  assert.equal(fitView({ west: 8.0, east: 8.05, south: 47.0, north: 47.03 }, 1200, 566, 11).z, 11);   // layer max zoom
});

test('previewData: track points with vario classes, padded bounds, markers and caption from the stats', () => {
  const dir = new URL('./fixtures/', import.meta.url);
  const files = ['gb26_260828_2049.csv', 'gb26_260830_0242.csv'].map((name) => { const text = readFileSync(new URL(name, dir), 'latin1'); const det = detectProfile(name, text.slice(0, 2000)); const r = readWithProfile(text, det.profile); return { name, size: text.length, profile: det.profile, points: r.points, bad: r.bad }; });
  state.files = files; state.meta.balloon = 'HB-QPJ'; state.meta.title = '';
  recompute();
  const d = previewData('GB26 Testfahrt');
  assert.ok(d && d.pts.length > 500 && d.pts.length <= 1600, `points ${d && d.pts.length}`);
  assert.ok(d.pts.every((q) => q.cls >= 0 && q.cls <= 4));
  assert.ok(d.bounds.west < 6.6 && d.bounds.east > 26.3 && d.bounds.south < 51.6 && d.bounds.north > 60.4);
  assert.ok(d.takeoff && d.landing && d.intermediate.length === 0);
  assert.equal(d.title, 'GB26 Testfahrt');
  assert.match(d.line.replace(/\u00a0/g, ' '), /41 h 03 min · 1'590 km · wp\.takeoff 23:31 UTC · wp\.landing 16:34 UTC/);   // i18n not loaded under node → keys
  assert.equal(d.layer, 'osm');
});
