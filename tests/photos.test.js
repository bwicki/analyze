// Photos: EXIF reading (time, zone, GPS, orientation) and the camera-time → UTC rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readExif, exifToUtc } from '../src/photos/exif.js';

const dir = new URL('./fixtures/', import.meta.url);

test('EXIF: DateTimeOriginal, SubSec, OffsetTime, GPS, orientation, model', () => {
  const ex = readExif(readFileSync(new URL('photo_exif.jpg', dir)));
  assert.ok(ex);
  assert.equal(ex.dateTimeOriginal, '2026:08:29 01:31:04'); assert.equal(ex.subSec, '250'); assert.equal(ex.offsetTime, '+02:00');
  assert.ok(Math.abs(ex.lat - (51 + 33 / 60 + 26.75 / 3600)) < 1e-6); assert.ok(Math.abs(ex.lon - (6 + 58 / 60 + 26.54 / 3600)) < 1e-6); assert.equal(ex.alt, 355);
  assert.equal(ex.orientation, 6); assert.equal(ex.model, 'Testcam X'); assert.equal(ex.make, 'Testmaker');
  // the EXIF zone wins over the user's zone; sub-seconds and the fine offset are applied
  assert.equal(exifToUtc(ex, { tzMinutes: 60, offsetSec: 0 }), Date.UTC(2026, 7, 28, 23, 31, 4, 250));
  assert.equal(exifToUtc({ dateTimeOriginal: '2026:08:29 01:31:04' }, { tzMinutes: 120, offsetSec: -30 }), Date.UTC(2026, 7, 28, 23, 30, 34));
  assert.ok(Number.isNaN(exifToUtc({ dateTimeOriginal: '' })));
});

test('JPEG without EXIF and non-JPEG input', () => {
  assert.equal(readExif(readFileSync(new URL('photo_noexif.jpg', dir))), null);
  assert.equal(readExif(new Uint8Array([1, 2, 3])), null);
});

test('placing photos on the GB26 track: zone/offset, track position, Δ to EXIF GPS, zone suggestion', async () => {
  const { placePhotos, photoUtc, suggestCameraZone } = await import('../src/photos/place.js');
  const { detectProfile } = await import('../src/parse/profiles.js');
  const { readWithProfile } = await import('../src/parse/readers.js');
  const { buildSegments, classifySegments, mergeSegments } = await import('../src/process/segments.js');
  const { deriveSeries } = await import('../src/process/series.js');
  const load = (name) => { const text = readFileSync(new URL(name, dir), 'latin1'); const det = detectProfile(name, text.slice(0, 2000)); const r = readWithProfile(text, det.profile); return { name, size: text.length, profile: det.profile, points: r.points, bad: r.bad }; };
  const track = mergeSegments(classifySegments(buildSegments([load('gb26_260828_2049.csv'), load('gb26_260830_0242.csv')]))), series = deriveSeries(track);
  // camera on CEST (UTC+2): 01:31 local = 23:31 UTC (take-off); photo GPS = where the balloon was
  const i = (() => { const t0 = Date.UTC(2026, 7, 28, 23, 31, 4); let k = 0; while (track.points.t[k] < t0) k++; return k; })();
  const photos = [
    { id: 'A', cameraTime: Date.UTC(2026, 7, 29, 1, 31, 4), exifTz: null, exifLat: track.points.lat[i], exifLon: track.points.lon[i] },
    { id: 'B', cameraTime: Date.UTC(2026, 7, 29, 12, 0, 0), exifTz: 120, exifLat: NaN, exifLon: NaN },
    { id: 'C', cameraTime: Date.UTC(2026, 9, 1, 12, 0, 0), exifTz: null, exifLat: NaN, exifLon: NaN },
  ];
  assert.equal(photoUtc(photos[0], { tzMinutes: 120 }), Date.UTC(2026, 7, 28, 23, 31, 4));
  assert.equal(photoUtc(photos[1], { tzMinutes: 0 }), Date.UTC(2026, 7, 29, 10, 0, 0));   // EXIF zone wins
  const placed = placePhotos(photos, track, series, { from: track.points.t[0], to: track.points.t[track.points.n - 1] }, { tzMinutes: 120 });
  const A = placed.find((p) => p.id === 'A'), B = placed.find((p) => p.id === 'B'), C = placed.find((p) => p.id === 'C');
  assert.ok(A.onTrack && A.inTrim && A.distM < 200, `A on the track near its GPS (${A.distM} m)`);
  assert.ok(B.onTrack && !Number.isNaN(B.alt) && Number.isNaN(B.distM));
  assert.ok(!C.onTrack && !C.inTrim && Number.isNaN(C.lat));
  assert.deepEqual(placed.map((p) => p.id), ['A', 'B', 'C']);
  // zone suggestion from two GPS photos taken on home time (UTC+2) while the balloon drifted east
  const j = i + 2000;
  const two = [photos[0], { id: 'D', cameraTime: track.points.t[j] + 2 * 3600000, exifTz: null, exifLat: track.points.lat[j], exifLon: track.points.lon[j] }];
  const sug = suggestCameraZone(two, track, series);
  assert.ok(sug && sug.tzMinutes === 120 && sug.meanDistM < 300, JSON.stringify(sug));
  // manual time (photo without EXIF): UTC as entered – zone and fine offset do not apply; never feeds the suggestion
  const M = { id: 'M', cameraTime: track.points.t[j], manual: true, exifTz: null, exifLat: track.points.lat[j], exifLon: track.points.lon[j] };
  assert.equal(photoUtc(M, { tzMinutes: 120, offsetSec: 90 }), track.points.t[j]);
  const pm = placePhotos([M, { id: 'N', cameraTime: null, manual: false }], track, series, null, { tzMinutes: 120, offsetSec: 90 });
  assert.ok(pm[0].id === 'M' && pm[0].onTrack && pm[0].distM < 50, JSON.stringify(pm[0]));
  assert.ok(pm[1].id === 'N' && Number.isNaN(pm[1].t) && !pm[1].onTrack);
  assert.equal(suggestCameraZone([photos[0], M], track, series), null);
});
