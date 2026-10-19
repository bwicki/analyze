// Profil-Assistent (concept §5): analyse an unknown text file, propose a mapping of its columns onto
// the Normfelder from column names and value ranges, build a JSON profile for the data-driven readers
// and preview the result. Pure functions – the dialog lives in ui/assist.js, tests in tests/assist.test.js.

import { readWithProfile } from './readers.js';

export const NORM_FIELDS = [
  { key: 'time', required: true, units: [] },
  { key: 'lat', required: true, units: [] },
  { key: 'lon', required: true, units: [] },
  { key: 'alt', required: false, units: ['m', 'ft'] },
  { key: 'balt', required: false, units: ['m', 'ft'] },
  { key: 'press', required: false, units: ['hPa'] },
  { key: 'vs', required: false, units: ['m/s', 'cm/s', 'ft/min'] },
  { key: 'gs', required: false, units: ['kt', 'km/h', 'm/s'] },
  { key: 'hdg', required: false, units: [] },
  { key: 'runtime', required: false, units: [] },
  { key: 'batt', required: false, units: ['V', '%'] },
];
export const TIME_FORMATS = ['auto', 'unix', 'unixms', 'datetime'];   // datetime = separate date + time columns

const SPLIT = /\r\n|\r|\n/;
const num = (v) => { if (v === undefined || v === null) return NaN; const s = String(v).trim().replace(',', '.'); if (!s || !/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return NaN; return parseFloat(s); };

/** Structure of a text file: JSON lines / JSON array / delimited; delimiter, header, decimal, sample rows. */
export function analyseText(text, name = '') {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(SPLIT).filter((l) => l.trim().length);
  const ext = (name.split('.').pop() || '').toLowerCase();
  const eol = /\r\n/.test(clean) ? 'CRLF' : /\r(?!\n)/.test(clean) ? 'CR' : 'LF';
  const first = lines[0] || '';
  // JSON lines: every sampled line is an object
  if (/^\s*\{/.test(first)) {
    const rows = []; let bad = 0;
    for (const ln of lines.slice(0, 300)) { try { const o = JSON.parse(ln); if (o && typeof o === 'object') rows.push(o); else bad++; } catch { bad++; } }
    if (rows.length && bad < rows.length / 4) {
      const columns = Object.keys(rows[0]);
      return { kind: 'jsonl', ext, eol, columns, rows: rows.map((r) => columns.map((c) => r[c])), nRows: lines.length, header: true, delimiter: null, decimal: '.' };
    }
  }
  if (/^\s*\[/.test(clean)) {
    try { const arr = JSON.parse(clean); if (Array.isArray(arr) && arr.length && typeof arr[0] === 'object') { const columns = Object.keys(arr[0]); return { kind: 'json', ext, eol, columns, rows: arr.slice(0, 300).map((r) => columns.map((c) => r[c])), nRows: arr.length, header: true, delimiter: null, decimal: '.' }; } } catch { /* not json */ }
  }
  // delimited: most frequent candidate delimiter in the first lines (consistent count wins)
  const cands = [';', ',', '\t', '|'];
  const sample = lines.slice(0, 50);
  let delimiter = ','; let best = -1;
  for (const d of cands) {
    const counts = sample.map((l) => l.split(d).length - 1);
    const n0 = counts[0]; if (!n0) continue;
    const consistent = counts.filter((c) => c === n0).length / counts.length;
    const score = n0 * consistent;
    if (consistent >= 0.8 && score > best) { best = score; delimiter = d; }
  }
  const split = (l) => splitLine(l, delimiter);
  const headCells = split(first).map((c) => c.trim());
  const header = headCells.filter((c) => /[A-Za-z]/.test(c) && Number.isNaN(num(c))).length >= headCells.length / 2;
  const dataLines = header ? lines.slice(1) : lines;
  const rows = dataLines.slice(0, 300).map(split);
  // decimal comma: numbers like "51,5574" in several cells of the same column
  let commaDec = 0, dotDec = 0;
  for (const r of rows.slice(0, 50)) for (const c of r) { const s = c.trim(); if (/^-?\d+,\d+$/.test(s)) commaDec++; else if (/^-?\d+\.\d+$/.test(s)) dotDec++; }
  const decimal = delimiter !== ',' && commaDec > dotDec ? ',' : '.';
  const columns = header ? headCells : headCells.map((_, i) => `col${i + 1}`);
  return { kind: 'delimited', ext, eol, delimiter, header, decimal, columns, rows, nRows: dataLines.length };
}

/** Re-split a delimited file with user-chosen structure (step 1 of the assistant). */
export function restructure(text, name, { delimiter, header, decimal }) {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(SPLIT).filter((l) => l.trim().length);
  const ext = (name.split('.').pop() || '').toLowerCase();
  const eol = /\r\n/.test(clean) ? 'CRLF' : /\r(?!\n)/.test(clean) ? 'CR' : 'LF';
  const split = (l) => splitLine(l, delimiter);
  const headCells = split(lines[0] || '').map((c) => c.trim());
  const dataLines = header ? lines.slice(1) : lines;
  const columns = header ? headCells : headCells.map((_, i) => `col${i + 1}`);
  return { kind: 'delimited', ext, eol, delimiter, header, decimal, columns, rows: dataLines.slice(0, 300).map(split), nRows: dataLines.length };
}

function splitLine(line, delim) {
  if (!line.includes('"')) return line.split(delim);
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (c === delim && !q) { out.push(cur); cur = ''; } else cur += c; }
  out.push(cur); return out;
}

// ---- suggestions --------------------------------------------------------------------------------------
const NAME_RULES = {
  time: /^(time|zeit|utc|timestamp|ts|datetime|date_?time|gpstime|gps_?time|fix_?time|t)$|time|zeit|timestamp/i,
  date: /^(date|datum|day|gpsdate)$|date|datum/i,
  lat: /^(lat|latitude|breite|y)$|lat|breite/i,
  lon: /^(lon|lng|long|longitude|laenge|länge|x)$|lon|lng|laenge|länge/i,
  alt: /gps.?alt|^(alt|altitude|ele|elevation|hoehe|höhe|h|z)$|altitude|^alt|hoehe|höhe|\bele\b/i,
  balt: /baro|press.*alt|palt|qne|pressure_?alt/i,
  press: /^(press|pressure|druck|hpa|qfe|p)$|pressure|druck|hpa/i,
  vs: /vario|vspeed|v_?speed|^vs$|climb|vertical|steig|var_kal|vsi/i,
  gs: /^(speed|gs|spd|groundspeed|ground_?speed|fahrt|velocity|kmh|kt|knots)$|speed|ground|fahrt/i,
  hdg: /^(course|hdg|heading|kurs|track|cog|bearing|dir)$|course|heading|kurs|bearing/i,
  runtime: /runtime|uptime|millis|elapsed|laufzeit|seconds/i,
  batt: /^(bat|batt|battery|vbat|vbus|volt|voltage|v_?bat|akku)$|batt|vbus|volt|akku/i,
};
const unitFromName = (name, candidates) => {
  const n = ' ' + String(name).toLowerCase().replace(/[_\-[\]()]+/g, ' ') + ' ';
  if (candidates.includes('ft/min') && /fpm|ft\/?min/.test(n)) return 'ft/min';
  if (candidates.includes('cm/s') && /cm/.test(n)) return 'cm/s';
  if (candidates.includes('km/h') && /km\/?h|kmh|kph/.test(n)) return 'km/h';
  if (candidates.includes('kt') && /\bkt|knot|kts/.test(n)) return 'kt';
  if (candidates.includes('m/s') && /m\/?s|ms\b/.test(n) && !/km/.test(n)) return 'm/s';
  if (candidates.includes('ft') && /\bft\b|feet|fuss|fuß/.test(n)) return 'ft';
  if (candidates.includes('%') && /%|pct|percent/.test(n)) return '%';
  if (candidates.includes('V') && /volt|\bv\b|vbus|vbat/.test(n)) return 'V';
  return null;
};
const looksLikeTime = (v) => { if (v === undefined || v === null || v === '') return false; const s = String(v).trim(); if (/^\d{9,13}(\.\d+)?$/.test(s)) return true; if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})/.test(s)) return true; return !Number.isNaN(Date.parse(s)) && /\d{4}/.test(s); };
const looksLikeDate = (v) => /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(String(v || '').trim()) || /^\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}$/.test(String(v || '').trim());
const looksLikeClock = (v) => /^\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(String(v || '').trim());

/** Column statistics over the sample rows. */
export function columnStats(struct) {
  return struct.columns.map((name, i) => {
    const vals = struct.rows.map((r) => r[i]).filter((v) => v !== undefined && v !== null && String(v).trim() !== '');
    const nums = vals.map((v) => num(v)).filter((x) => !Number.isNaN(x));
    const nonZero = nums.filter((x) => x !== 0);
    const s = { name, i, n: vals.length, numeric: vals.length ? nums.length / vals.length : 0, min: nums.length ? Math.min(...nums) : NaN, max: nums.length ? Math.max(...nums) : NaN, example: vals[0] === undefined ? '' : String(vals[0]), time: vals.length ? vals.filter(looksLikeTime).length / vals.length : 0, date: vals.length ? vals.filter(looksLikeDate).length / vals.length : 0, clock: vals.length ? vals.filter(looksLikeClock).length / vals.length : 0 };
    s.minNZ = nonZero.length ? Math.min(...nonZero) : NaN; s.maxNZ = nonZero.length ? Math.max(...nonZero) : NaN;
    s.decimals = nums.length ? nums.filter((x) => !Number.isInteger(x)).length / nums.length : 0;
    return s;
  });
}

/**
 * Suggest a mapping: {time: {col|date+time, format}, lat: {col}, …}, each with .confidence 'sure'|'check'|'none'.
 * Ranges: lat 35–70 / lon −10–40 are typical for our flights but the rules accept the full globe.
 */
export function suggestMapping(struct) {
  const st = columnStats(struct);
  const used = new Set();
  const pick = (key, test) => {
    const scored = st.filter((c) => !used.has(c.i)).map((c) => ({ c, s: test(c) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    if (!scored.length) return null;
    used.add(scored[0].c.i); return { col: scored[0].c, score: scored[0].s };
  };
  const nameScore = (c, re) => (re.test(c.name) ? 1 : 0);
  const out = {};
  // time: ISO/unix column, or date + time pair
  const dateCol = st.find((c) => c.date > 0.8 && !c.time), clockCol = st.find((c) => c.clock > 0.8);
  const tcol = pick('time', (c) => (c.time > 0.8 ? 2 : 0) + nameScore(c, NAME_RULES.time) * (c.time > 0.5 ? 1 : 0.2));
  if (tcol && tcol.col.time > 0.8) {
    const ex = String(tcol.col.example).trim();
    const format = /^\d{13}$/.test(ex) ? 'unixms' : /^\d{9,10}(\.\d+)?$/.test(ex) ? 'unix' : 'auto';
    out.time = { col: tcol.col.name, format, confidence: 'sure', example: ex };
  } else if (dateCol && clockCol) {
    used.add(dateCol.i); used.add(clockCol.i);
    const ex = String(dateCol.example).trim();
    const dateFormat = /^\d{4}/.test(ex) ? 'yyyy-MM-dd' : (+ex.split(/[\/.-]/)[0] > 12 ? 'dd/MM/yy' : 'dd/MM/yy');
    out.time = { date: dateCol.name, time: clockCol.name, dateFormat, tz: 'UTC', confidence: 'check', example: `${dateCol.example} ${clockCol.example}` };
  } else out.time = { confidence: 'none' };
  const inRange = (c, lo, hi) => (c.numeric > 0.8 && c.minNZ >= lo && c.maxNZ <= hi ? 1 : 0);
  const lat = pick('lat', (c) => inRange(c, -90, 90) * c.decimals * (1 + 2 * nameScore(c, NAME_RULES.lat)) * (Math.abs(c.maxNZ) > 1 ? 1 : 0.3));
  out.lat = lat ? { col: lat.col.name, confidence: NAME_RULES.lat.test(lat.col.name) ? 'sure' : 'check', example: lat.col.example } : { confidence: 'none' };
  const lon = pick('lon', (c) => inRange(c, -180, 180) * c.decimals * (1 + 2 * nameScore(c, NAME_RULES.lon)) * (Math.abs(c.maxNZ) > 1 ? 1 : 0.3));
  out.lon = lon ? { col: lon.col.name, confidence: NAME_RULES.lon.test(lon.col.name) ? 'sure' : 'check', example: lon.col.example } : { confidence: 'none' };
  const numeric = (key, re, lo, hi, units) => {
    const p = pick(key, (c) => (c.numeric > 0.8 ? 1 : 0) * (nameScore(c, re) * 3 + (c.max <= hi && c.min >= lo ? 0.5 : 0)) * (nameScore(c, re) ? 1 : 0));
    if (!p) return { confidence: 'none' };
    const u = units.length ? (unitFromName(p.col.name, units) || units[0]) : undefined;
    return { col: p.col.name, unit: u, confidence: unitFromName(p.col.name, units) || !units.length ? 'sure' : 'check', example: p.col.example };
  };
  out.balt = numeric('balt', NAME_RULES.balt, -1000, 60000, ['m', 'ft']);
  out.alt = numeric('alt', NAME_RULES.alt, -1000, 60000, ['m', 'ft']);
  out.press = numeric('press', NAME_RULES.press, 100, 1100, ['hPa']);
  out.vs = numeric('vs', NAME_RULES.vs, -5000, 5000, ['m/s', 'cm/s', 'ft/min']);
  out.gs = numeric('gs', NAME_RULES.gs, 0, 1000, ['kt', 'km/h', 'm/s']);
  out.hdg = numeric('hdg', NAME_RULES.hdg, 0, 360, []);
  out.runtime = numeric('runtime', NAME_RULES.runtime, 0, 1e9, []);
  out.batt = numeric('batt', NAME_RULES.batt, 0, 100, ['V', '%']);
  if (out.batt.col && out.batt.unit === 'V') { const c = st.find((x) => x.name === out.batt.col); if (c && c.max > 20) out.batt.unit = '%'; }
  // vs unit sanity: |values| > 30 → probably cm/s or ft/min
  if (out.vs.col) { const c = st.find((x) => x.name === out.vs.col); if (c && Math.max(Math.abs(c.min), Math.abs(c.max)) > 30 && out.vs.unit === 'm/s') { out.vs.unit = 'cm/s'; out.vs.confidence = 'check'; } }
  return out;
}

/** Mapping (from suggestMapping, possibly edited) + structure + naming → profile JSON for the readers/detection. */
export function buildProfile(struct, mapping, meta = {}) {
  const fields = {};
  const m = mapping.time || {};
  if (m.date && m.time) fields.time = { date: m.date, time: m.time, dateFormat: m.dateFormat || 'dd/MM/yy', tz: 'UTC' };
  else if (m.col) fields.time = { col: m.col, format: m.format && m.format !== 'auto' ? m.format : 'auto' };
  for (const f of NORM_FIELDS) {
    if (f.key === 'time') continue;
    const x = mapping[f.key]; if (!x || !x.col) continue;
    fields[f.key] = { col: x.col }; if (x.unit) fields[f.key].unit = x.unit;
  }
  const headLine = struct.kind === 'delimited' ? struct.columns.join(struct.delimiter) : struct.kind === 'jsonl' ? `{"${struct.columns[0]}":` : '[';
  const id = (meta.id || `${slug(meta.name || 'tracker')}-${slug(struct.kind)}`).slice(0, 60);
  return {
    id, name: meta.name || 'Tracker', manufacturer: meta.manufacturer || '', version: 1, user: true,
    detect: { ext: [struct.ext || 'csv'], ...(struct.header || struct.kind !== 'delimited' ? { headStartsWith: headLine.slice(0, 80) } : {}), ...(struct.kind === 'json' ? { headContains: `"${struct.columns[0]}"` } : {}) },
    read: struct.kind === 'delimited' ? { kind: 'delimited', delimiter: struct.delimiter, header: !!struct.header, decimal: struct.decimal, columns: struct.header ? undefined : struct.columns } : { kind: struct.kind },
    fields,
    validity: { noFixWhenZero: meta.noFixWhenZero !== false, minYear: meta.minYear || 2015 },
    notes: meta.notes || '',
  };
}
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';

/** Mandatory fields present? → list of missing keys. */
export function missingRequired(mapping) {
  const out = [];
  if (!(mapping.time && (mapping.time.col || (mapping.time.date && mapping.time.time)))) out.push('time');
  if (!(mapping.lat && mapping.lat.col)) out.push('lat');
  if (!(mapping.lon && mapping.lon.col)) out.push('lon');
  return out;
}

/** Parse the (possibly truncated) text with the profile and summarise for the preview. */
export function previewProfile(text, profile, maxLines = 20000) {
  const lines = text.split(SPLIT);
  const slice = lines.length > maxLines ? lines.slice(0, maxLines).join('\n') : text;
  const r = readWithProfile(slice, profile);
  const ps = r.points; const n = ps.n;
  let nFix = 0, tMin = Infinity, tMax = -Infinity, aMin = Infinity, aMax = -Infinity, latMin = 90, latMax = -90, lonMin = 180, lonMax = -180;
  for (let i = 0; i < n; i++) {
    const tt = ps.t[i]; if (tt >= Date.UTC(2015, 0, 1)) { if (tt < tMin) tMin = tt; if (tt > tMax) tMax = tt; }
    if (ps.fix[i]) { nFix++; latMin = Math.min(latMin, ps.lat[i]); latMax = Math.max(latMax, ps.lat[i]); lonMin = Math.min(lonMin, ps.lon[i]); lonMax = Math.max(lonMax, ps.lon[i]); }
    const a = ps.alt[i]; if (!Number.isNaN(a)) { aMin = Math.min(aMin, a); aMax = Math.max(aMax, a); }
  }
  // tiny track sketch (SVG path in a 200×120 box)
  let path = '';
  if (nFix > 1 && latMax > latMin && lonMax > lonMin) {
    const cosLat = Math.cos((latMin + latMax) / 2 * Math.PI / 180);
    const k = Math.min(196 / ((lonMax - lonMin) * cosLat), 116 / (latMax - latMin));
    const step = Math.max(1, Math.floor(nFix / 400)); let c = 0, first = true;
    for (let i = 0; i < n; i++) { if (!ps.fix[i]) continue; if (c++ % step) continue; const x = 2 + (ps.lon[i] - lonMin) * cosLat * k, y = 118 - (ps.lat[i] - latMin) * k; path += `${first ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`; first = false; }
  }
  return { n, nFix, bad: r.bad, truncated: lines.length > maxLines, t0: tMin === Infinity ? null : tMin, t1: tMax === -Infinity ? null : tMax, altMin: aMin === Infinity ? null : aMin, altMax: aMax === -Infinity ? null : aMax, bbox: nFix ? [latMin, lonMin, latMax, lonMax] : null, path, plausible: nFix > 1 && tMin !== Infinity && tMax > tMin };
}
