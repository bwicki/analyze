// Logbuch (0.11.0): rows from the stored Kennzahlen/Stammdaten, totals, CSV for Excel (no track needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logbookRows, logbookTotals, logbookCsv } from '../src/ui/logbook.js';

const iso = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo - 1, d, h, mi)).toISOString();
const flights = [
  { id: 'A1', title: 'GB26', startTs: Date.UTC(2026, 7, 28, 23, 31), stats: { takeoff: { time: iso(2026, 8, 28, 23, 31), lat: 51.55, lon: 6.97 }, landing: { time: iso(2026, 8, 30, 16, 34), lat: 60.47, lon: 26.4 }, durationSec: 147780, nightSec: 44940, distanceM: 1590000, straightM: 1555000, altMaxM: 947, landings: 1, startPlace: 'DE-Gladbeck', landPlace: 'FI-Loviisa' }, meta: { balloon: 'HB-QWV', type: 'NL-STU71000', pic: 'B. Wicki', copilot: 'P. Süss', pax: '', purpose: 'competition', event: 'GB26' }, url: 'https://analyze.wicki.aero/v/A1' },
  { id: 'B2', title: '', startTs: Date.UTC(2025, 5, 3, 5, 10), stats: { takeoff: { time: iso(2025, 6, 3, 5, 10), lat: 47.1, lon: 8.3 }, landing: { time: iso(2025, 6, 3, 6, 40), lat: 47.2, lon: 8.5 }, durationSec: 5400, nightSec: 0, distanceM: 18500, straightM: 17000, altMaxM: 1200, landings: 1 }, meta: { balloon: 'HB-QWZ', pic: 'B. Wicki', pax: 'A, B, C', purpose: 'commercial', startName: 'Hochdorf', landName: 'Sins' } },
  { id: 'C3', title: 'ohne Stats', startTs: Date.UTC(2025, 0, 1), stats: {}, meta: {} },
];

test('logbookRows: newest first, places from report fields or ICAO, multi-day landing with date, pax count', () => {
  const rows = logbookRows(flights, 'metric');
  assert.deepEqual(rows.map((r) => r.id), ['A1', 'B2', 'C3']);
  const a = rows[0];
  assert.equal(a.date, '28.08.2026'); assert.equal(a.takeoff, '23:31'); assert.equal(a.landing, '30.08.2026 16:34');
  assert.equal(a.takeoffPlace, 'DE-Gladbeck'); assert.equal(a.landingPlace, 'FI-Loviisa'); assert.equal(a.year, 2026);
  assert.equal(a.duration, '41:03'); assert.equal(a.night, '12:29'); assert.match(a.distance, /1'590/); assert.equal(a.balloon, 'HB-QWV NL-STU71000'); assert.equal(a.copilot, 'P. Süss'); assert.equal(a.pax, 0);
  const b = rows[1];
  assert.equal(b.takeoffPlace, 'Hochdorf'); assert.equal(b.landing, '06:40'); assert.equal(b.pax, 3); assert.equal(b.title, '');
  const c = rows[2];
  assert.equal(c.date, '01.01.2025'); assert.equal(c.duration, ''); assert.equal(c.takeoffPlace, '');
  const tot = logbookTotals(rows);
  assert.equal(tot.n, 3); assert.equal(tot.durationSec, 153180); assert.equal(tot.distanceM, 1608500); assert.equal(tot.landings, 2);
});

test('logbookCsv: BOM, semicolons, CRLF, quoting, totals line', () => {
  const rows = logbookRows(flights.slice(0, 2), 'metric');
  const csv = logbookCsv(rows);
  assert.ok(csv.startsWith('﻿')); assert.ok(csv.includes('\r\n'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 4);   // head + 2 flights + totals
  assert.equal(lines[0].split(';').length, 19);
  assert.ok(lines[1].includes('28.08.2026;23:31;DE-Gladbeck;30.08.2026 16:34;FI-Loviisa;41:03;12:29;'));
  assert.ok(lines[3].startsWith('lb.total') || lines[3].startsWith('Total'));   // key falls back without dictionaries
  assert.ok(!/ /.test(csv), 'no NBSP in CSV');
});
