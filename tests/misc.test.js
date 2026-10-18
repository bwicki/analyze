import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fmtInt, fmtNum, fmtSigned, fmtDurationHM, fmtDurationClock, icaoShort, fmtBearing, isoUTC, fmtLocalByLon } from '../src/util/format.js';
import { haversine, bearing, sunElevation, nightIntervals } from '../src/util/geo.js';
import { toGpx, toGeoJson, toKml, toCsv } from '../src/export/formats.js';
import { makeUnits } from '../src/util/units.js';

test('formatting', () => {
  assert.equal(fmtInt(1587612), "1'587'612");
  assert.equal(fmtNum(-2.26, 1), '−2.3');
  assert.equal(fmtSigned(3.04, 1), '+3.0');
  assert.equal(fmtDurationHM(41 * 3600 + 3 * 60 + 20), '41 h 03 min');
  assert.equal(fmtDurationClock(41 * 3600 + 3 * 60), '41:03');
  assert.equal(icaoShort(51.5574, 6.974), '5133N00658E');
  assert.equal(icaoShort(60.4642, 26.3927), '6028N02624E');
  assert.equal(fmtBearing(42.8), '043°');
  assert.equal(isoUTC(Date.UTC(2026, 7, 28, 23, 31, 31)), '2026-08-28T23:31:31Z');
  assert.match(fmtLocalByLon(Date.UTC(2026, 7, 30, 16, 34), 26.39), /18:34 \(UTC\+2\)/);
});

test('units', () => {
  const i = makeUnits('icao'), m = makeUnits('metric');
  assert.equal(i.alt(944), "3'097 ft"); assert.equal(m.alt(944), '944 m');
  assert.equal(i.speed(19.1), '37 kt'); assert.equal(m.speed(19.1), '69 km/h');
  assert.equal(i.vs(3.04), '+3.0 m/s');
  assert.equal(i.dist(1587612), "1'588 km");
});

test('geodesy and sun', () => {
  assert.ok(Math.abs(haversine(51.5574, 6.974, 60.4642, 26.3927) / 1000 - 1551) < 3);
  assert.ok(Math.abs(bearing(51.5574, 6.974, 60.4642, 26.3927) - 43) < 1);
  // Equinox noon on the equator: sun near the zenith; local midnight: far below
  const e1 = sunElevation(Date.UTC(2026, 2, 20, 12, 0, 0), 0, 0), e2 = sunElevation(Date.UTC(2026, 2, 20, 0, 0, 0), 0, 0);
  assert.ok(e1 > 85 && e2 < -85, `${e1} ${e2}`);
  // Gladbeck 28.08.2026: civil dusk ~19:00 UTC, dawn ~04:00 UTC
  const n = nightIntervals(Date.UTC(2026, 7, 28, 12), Date.UTC(2026, 7, 29, 12), () => ({ lat: 51.56, lon: 6.97 }));
  assert.equal(n.intervals.length, 1);
  const from = new Date(n.intervals[0].from).getUTCHours(), to = new Date(n.intervals[0].to).getUTCHours();
  assert.ok(from >= 18 && from <= 19, `dusk hour ${from}`); assert.ok(to >= 3 && to <= 4, `dawn hour ${to}`);
  assert.ok(n.totalSec / 3600 > 8 && n.totalSec / 3600 < 10);
});

test('exports are well-formed', () => {
  const pts = [
    { t: Date.UTC(2026, 7, 28, 23, 31, 31), lat: 51.5574, lon: 6.974, alt: 43, balt: 52, press: 1007, vs: 0.1, gs: 0.2, hdg: 40, fix: true, gap: false },
    { t: Date.UTC(2026, 7, 28, 23, 32, 31), lat: 51.56, lon: 6.98, alt: 120, balt: 130, press: 998, vs: 1.2, gs: 5, hdg: 42, fix: true, gap: false },
    { t: Date.UTC(2026, 7, 28, 23, 40, 31), lat: 51.58, lon: 7.0, alt: 300, balt: NaN, press: NaN, vs: NaN, gs: 8, hdg: NaN, fix: true, gap: true },
  ];
  const wps = [{ kind: 'takeoff', name: 'Start', t: pts[0].t, lat: pts[0].lat, lon: pts[0].lon, alt: 43 }];
  const gpx = toGpx({ pts, waypoints: wps, name: 'Test' });
  assert.equal((gpx.match(/<trkpt /g) || []).length, 3); assert.equal((gpx.match(/<trkseg>/g) || []).length, 2); assert.ok(gpx.includes('<wpt '));
  const gj = JSON.parse(toGeoJson({ pts, waypoints: wps, name: 'Test' }));
  assert.equal(gj.type, 'FeatureCollection'); assert.equal(gj.features.filter((f) => f.geometry.type === 'LineString').length, 2);
  assert.deepEqual(gj.features[0].geometry.coordinates[0].slice(0, 2), [6.974, 51.5574]);
  const kml = toKml({ pts, waypoints: wps, name: 'Test' });
  assert.equal((kml.match(/<gx:Track>/g) || []).length, 2); assert.ok(kml.includes('<when>2026-08-28T23:31:31Z</when>')); assert.ok(kml.includes('altitudeMode>absolute'));
  const csv = toCsv({ pts }); const lines = csv.split('\r\n');
  assert.equal(lines.length, 4); assert.ok(lines[0].startsWith('﻿time_utc;lat;lon'));
});

test('i18n: EN covers DE, placeholders match', () => {
  const de = JSON.parse(readFileSync(new URL('../i18n/de.json', import.meta.url), 'utf8')), en = JSON.parse(readFileSync(new URL('../i18n/en.json', import.meta.url), 'utf8'));
  for (const k of Object.keys(de)) {
    assert.ok(k in en, `EN missing ${k}`);
    const pd = (de[k].match(/\{\w+\}/g) || []).sort().join(), pe = (en[k].match(/\{\w+\}/g) || []).sort().join();
    assert.equal(pe, pd, `placeholders differ in ${k}`);
  }
});
