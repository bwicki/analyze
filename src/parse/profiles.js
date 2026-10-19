// Built-in tracker profiles (concept §5). A profile says how to recognise a file and how its
// columns/keys map onto the Normfelder. User-made profiles from the assistant (phase 2) use the
// same shape, so the delimited/JSONL readers are fully data-driven.
//
// field spec: {col: 'Column name' | key, unit: 'm'|'ft'|'kt'|'m/s'|'km/h'|'cm/s'|'ft/min'|'V'|'%', scale?: number}
// time spec:  {col: 'ISO column'} | {date: 'Date col', time: 'Time col', dateFormat: 'dd/MM/yy', tz: 'UTC'} | {col, format: 'unix'|'unixms'}

export const PROFILES = [
  {
    id: 'gb-instrument-csv', name: 'GB-Instrument CSV', manufacturer: 'Wicki Partners Ballonteam', version: 1,
    detect: { ext: ['csv', 'txt'], headStartsWith: 'Runtime;VbusVolt' },
    read: { kind: 'delimited', delimiter: ';', header: true, decimal: '.' },
    fields: {
      time: { date: 'Date', time: 'Time', dateFormat: 'dd/MM/yy', tz: 'UTC' },
      lat: { col: 'Lat [deg]' }, lon: { col: 'Lon [deg]' },
      alt: { col: 'GPS_Alt [m]', unit: 'm' }, balt: { col: 'Baro_Alt [m]', unit: 'm' },
      press: { col: 'Pressure [hpa]' }, vs: { col: 'VAR_Kal [m/s]', unit: 'm/s' },
      gs: { col: 'GS [kt]', unit: 'kt' }, hdg: { col: 'HDG [deg]' },
      runtime: { col: 'Runtime' }, batt: { col: 'VbusVolt', unit: 'V' },
    },
    validity: { noFixWhenZero: true, minYear: 2015 },
    notes: 'QNH fest 1013.25 hPa: Baro_Alt ist Druckhöhe (QNE). Spalte Master ist ein Filterzustand, keine Beschleunigung.',
  },
  {
    id: 'gb-instrument-jsonl', name: 'GB-Instrument JSONL', manufacturer: 'Wicki Partners Ballonteam', version: 1,
    detect: { ext: ['jsonl', 'json', 'txt'], headStartsWith: '{"Runtime":' },
    read: { kind: 'jsonl' },
    fields: {
      time: { date: 'Date', time: 'Time', dateFormat: 'd/M/yy', tz: 'UTC' },
      lat: { col: 'Lat_deg' }, lon: { col: 'Lon_deg' },
      alt: { col: 'GPS_Alt_m', unit: 'm' }, balt: { col: 'Baro_Alt_m', unit: 'm' },
      press: { col: 'Pressure_hpa' }, vs: { col: 'VAR_Kal_m_s', unit: 'm/s' },
      gs: { col: 'GS_kt', unit: 'kt' }, hdg: { col: 'HDG_deg' },
      runtime: { col: 'Runtime' }, batt: { col: 'VbusVolt', unit: 'V' },
    },
    validity: { noFixWhenZero: true, minYear: 2015 },
    priority: 1, // preferred over the CSV twin of the same recording
  },
  {
    id: 'aprsfi-csv', name: 'aprs.fi CSV-Export', manufacturer: 'aprs.fi', version: 1,
    detect: { ext: ['csv'], headMatches: /^\s*"?time"?\s*[,;](?:\s*"?[a-z_]+"?\s*[,;])*\s*"?lat"?\s*[,;]\s*"?lng"?/i },
    read: { kind: 'delimited', delimiter: 'auto', header: true, decimal: '.' },
    fields: {
      time: { col: 'time', format: 'auto' }, lat: { col: 'lat' }, lon: { col: 'lng' },
      alt: { col: 'altitude', unit: 'm' }, gs: { col: 'speed', unit: 'km/h' }, hdg: { col: 'course' },
    },
    validity: { noFixWhenZero: true, minYear: 2015 },
  },
  {
    id: 'aprsfi-json', name: 'aprs.fi JSON-Export', manufacturer: 'aprs.fi', version: 1,
    detect: { ext: ['json'], headMatches: /^\s*(\{\s*"[a-z_]+"\s*:\s*)?\[\s*\{[^}]*"time"\s*:[^}]*"lng"\s*:/ },
    read: { kind: 'json' },
    fields: {
      time: { col: 'time', format: 'auto' }, lat: { col: 'lat' }, lon: { col: 'lng' },
      alt: { col: 'altitude', unit: 'm' }, gs: { col: 'speed', unit: 'km/h' }, hdg: { col: 'course' },
    },
    validity: { noFixWhenZero: true, minYear: 2015 },
  },
  { id: 'gpx', name: 'GPX 1.0/1.1', manufacturer: 'Standard', version: 1, detect: { ext: ['gpx'], headMatches: /<gpx[\s>]/i }, read: { kind: 'gpx' } },
  { id: 'kml', name: 'KML (Google Earth, Garmin inReach)', manufacturer: 'Standard', version: 1, detect: { ext: ['kml'], headMatches: /<kml[\s>]/i }, read: { kind: 'kml' } },
  { id: 'igc', name: 'IGC (FAI-Logger)', manufacturer: 'Standard', version: 1, detect: { ext: ['igc'], headMatches: /^A[A-Z0-9]{3}/m }, read: { kind: 'igc' } },
  { id: 'geojson', name: 'GeoJSON (analyze, QGIS)', manufacturer: 'Standard', version: 1, detect: { ext: ['geojson', 'json'], headMatches: /"type"\s*:\s*"(FeatureCollection|Feature)"/ }, read: { kind: 'geojson' } },
];

const UNIT_TO_SI = { m: 1, ft: 0.3048, kt: 0.514444, 'm/s': 1, 'km/h': 1 / 3.6, 'cm/s': 0.01, 'ft/min': 0.00508, V: 1, '%': 1, hPa: 1 };
export function unitFactor(u) { return UNIT_TO_SI[u] ?? 1; }

/**
 * Pick the profile for a file from its name and the first ~2 KB of text.
 * Returns {profile} or {unknown: true, analysis} for the assistant.
 */
export function detectProfile(name, head, profiles = PROFILES) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const h = head.replace(/^﻿/, '');
  for (const p of profiles) {
    const d = p.detect || {};
    if (d.headStartsWith && h.startsWith(d.headStartsWith)) return { profile: p };
    if (d.headContains && h.includes(d.headContains) && (!d.ext || d.ext.includes(ext))) return { profile: p };
    if (d.headMatches && (d.headMatches instanceof RegExp ? d.headMatches : new RegExp(d.headMatches)).test(h)) return { profile: p };
  }
  // second pass: by extension only when the content is plausible text
  for (const p of profiles) {
    const d = p.detect || {};
    if (d.ext && d.ext.includes(ext) && !d.headStartsWith && !d.headMatches && !d.headContains) return { profile: p };
  }
  return { unknown: true, analysis: analyseHead(h) };
}

/** Rough structural analysis of an unknown text file (delimiter, line ending, header, columns). */
export function analyseHead(h) {
  const crlf = (h.match(/\r\n/g) || []).length, lf = (h.match(/(?<!\r)\n/g) || []).length, cr = (h.match(/\r(?!\n)/g) || []).length;
  const eol = crlf >= lf && crlf >= cr ? 'CRLF' : cr > lf ? 'CR' : 'LF';
  const lines = h.split(/\r\n|\r|\n/).filter((l) => l.trim()).slice(0, 6);
  const first = lines[0] || '';
  const counts = { ';': (first.match(/;/g) || []).length, ',': (first.match(/,/g) || []).length, '\t': (first.match(/\t/g) || []).length, '|': (first.match(/\|/g) || []).length };
  const delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const delim = delimiter && delimiter[1] > 0 ? delimiter[0] : null;
  const cols = delim ? first.split(delim).map((c) => c.trim()) : [first];
  const headerLike = delim ? cols.filter((c) => /[A-Za-z]/.test(c)).length >= cols.length / 2 : false;
  const json = /^\s*[{[]/.test(h);
  const xml = /^\s*<\?xml|^\s*</.test(h);
  return { eol, delimiter: delim, columns: cols.length, header: headerLike, headerRow: headerLike ? cols : null, sample: lines, json, xml };
}
