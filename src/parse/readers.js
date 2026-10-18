// File readers → PointSet. All readers take the whole file text (the worker reads the File) and are
// profile-driven where the format is tabular. They never throw on a bad line – bad lines are counted.
//
// Line endings: GB-Instrument CSV files end lines with a bare CR, so every reader splits on /\r\n|\r|\n/.

import { PointBuilder } from './points.js';
import { unitFactor } from './profiles.js';

const SPLIT = /\r\n|\r|\n/;

// ---- time parsing -------------------------------------------------------------------------
/** dd/MM/yy or d/M/yy (also with '-' or '.') + H:m:s (lenient, no zero padding needed) → ms UTC. */
function parseDateTimeParts(dateStr, timeStr, dateFormat) {
  if (!dateStr || !timeStr) return NaN;
  const d = dateStr.trim().split(/[\/.\-]/), t = timeStr.trim().split(':');
  if (d.length < 3 || t.length < 2) return NaN;
  let day, month, year;
  const f = (dateFormat || 'dd/MM/yy').toLowerCase();
  if (f.startsWith('y')) { year = +d[0]; month = +d[1]; day = +d[2]; }
  else if (f.startsWith('m')) { month = +d[0]; day = +d[1]; year = +d[2]; }
  else { day = +d[0]; month = +d[1]; year = +d[2]; }
  if (year < 100) year += 2000;
  const h = +t[0], mi = +t[1], s = t.length > 2 ? parseFloat(t[2]) : 0;
  if ([day, month, year, h, mi, s].some(Number.isNaN)) return NaN;
  return Date.UTC(year, month - 1, day, h, mi, Math.floor(s), Math.round((s % 1) * 1000));
}
function parseAutoTime(v) {
  if (v === undefined || v === null || v === '') return NaN;
  if (typeof v === 'number') return v > 1e11 ? v : v * 1000; // unix s vs ms
  const s = String(v).trim();
  if (/^\d{9,13}(\.\d+)?$/.test(s)) { const n = parseFloat(s); return n > 1e11 ? n : n * 1000; }
  // "2026-08-28 23:31:04" (aprs.fi, UTC) → make it ISO
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/.test(s) ? s.replace(' ', 'T') + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? '' : 'Z') : s;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? NaN : ms;
}
export function makeTimeParser(spec) {
  if (!spec) return () => NaN;
  if (spec.date && spec.time) return (row) => parseDateTimeParts(row[spec.date], row[spec.time], spec.dateFormat);
  if (spec.format === 'unix') return (row) => { const n = parseFloat(row[spec.col]); return Number.isNaN(n) ? NaN : n * 1000; };
  if (spec.format === 'unixms') return (row) => { const n = parseFloat(row[spec.col]); return Number.isNaN(n) ? NaN : n; };
  return (row) => parseAutoTime(row[spec.col]);
}

function num(v, decimal) {
  if (v === undefined || v === null) return NaN;
  if (typeof v === 'number') return v;
  let s = String(v).trim();
  if (s === '') return NaN;
  if (decimal === ',') s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isNaN(n) ? NaN : n;
}

/** Row object → normalised point using the profile's field map. */
function makeRowMapper(profile) {
  const F = profile.fields || {}, decimal = (profile.read && profile.read.decimal) || '.';
  const tp = makeTimeParser(F.time);
  const get = (spec) => spec && spec.col ? (row) => num(row[spec.col], decimal) * (spec.scale ?? unitFactor(spec.unit)) : () => NaN;
  const g = { lat: get(F.lat), lon: get(F.lon), alt: get(F.alt), balt: get(F.balt), press: get(F.press), vs: get(F.vs), gs: get(F.gs), hdg: get(F.hdg), runtime: get(F.runtime), batt: get(F.batt) };
  const noFixZero = !(profile.validity && profile.validity.noFixWhenZero === false);
  return (row) => {
    const lat = g.lat(row), lon = g.lon(row);
    const fix = !Number.isNaN(lat) && !Number.isNaN(lon) && !(noFixZero && Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    return { t: tp(row), lat: fix ? lat : NaN, lon: fix ? lon : NaN, alt: fix ? g.alt(row) : NaN, balt: g.balt(row), press: g.press(row), vs: g.vs(row), gs: g.gs(row), hdg: g.hdg(row), runtime: g.runtime(row), batt: g.batt(row), fix };
  };
}

/** Split one delimited line (simple quotes supported). */
function splitLine(line, delim) {
  if (!line.includes('"')) return line.split(delim);
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === delim && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// ---- readers ------------------------------------------------------------------------------
export function readDelimited(text, profile) {
  const lines = text.replace(/^﻿/, '').split(SPLIT);
  let delim = profile.read.delimiter;
  if (!delim || delim === 'auto') { const f = lines[0] || ''; delim = [';', ',', '\t', '|'].sort((a, b) => (f.split(b).length) - (f.split(a).length))[0]; }
  const header = profile.read.header !== false ? splitLine(lines[0], delim).map((h) => h.trim()) : null;
  const map = makeRowMapper(profile);
  const b = new PointBuilder(Math.max(1024, lines.length));
  let bad = 0, start = header ? 1 : 0;
  const names = header || (profile.read.columns || []);
  for (let i = start; i < lines.length; i++) {
    const ln = lines[i]; if (!ln || !ln.trim()) continue;
    const parts = splitLine(ln, delim);
    if (header && parts.length !== header.length) { bad++; continue; }
    const row = {}; for (let k = 0; k < names.length; k++) row[names[k]] = parts[k];
    const p = map(row);
    if (Number.isNaN(p.t)) { bad++; continue; }
    b.push(p);
  }
  return { points: b.finish(), bad, columns: names };
}

export function readJsonl(text, profile) {
  const lines = text.replace(/^﻿/, '').split(SPLIT);
  const map = makeRowMapper(profile);
  const b = new PointBuilder(Math.max(1024, lines.length));
  let bad = 0, columns = null;
  for (const ln of lines) {
    if (!ln || !ln.trim()) continue;
    let row; try { row = JSON.parse(ln); } catch { bad++; continue; }
    if (!columns) columns = Object.keys(row);
    const p = map(row);
    if (Number.isNaN(p.t)) { bad++; continue; }
    b.push(p);
  }
  return { points: b.finish(), bad, columns: columns || [] };
}

/** GPX: trk/trkseg/trkpt with ele and time (no DOMParser in workers → regex scan). */
export function readGpx(text) {
  const b = new PointBuilder(4096); let bad = 0;
  const re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g; let m;
  while ((m = re.exec(text))) {
    const attrs = m[1], body = m[2];
    const lat = parseFloat((attrs.match(/lat="([^"]+)"/) || [])[1]), lon = parseFloat((attrs.match(/lon="([^"]+)"/) || [])[1]);
    const ele = parseFloat((body.match(/<ele>([^<]+)<\/ele>/) || [])[1]);
    const time = Date.parse(((body.match(/<time>([^<]+)<\/time>/) || [])[1] || '').trim());
    if (Number.isNaN(time) || Number.isNaN(lat) || Number.isNaN(lon)) { bad++; continue; }
    const vs = parseFloat((body.match(/<(?:[a-z0-9]+:)?(?:vario|vspeed|vs)>([^<]+)</i) || [])[1]);
    const gs = parseFloat((body.match(/<(?:[a-z0-9]+:)?speed>([^<]+)</i) || [])[1]);
    const hdg = parseFloat((body.match(/<(?:[a-z0-9]+:)?(?:course|hdg)>([^<]+)</i) || [])[1]);
    b.push({ t: time, lat, lon, alt: ele, vs, gs, hdg, fix: true });
  }
  return { points: b.finish(), bad, columns: ['trkpt'] };
}

/** KML: gx:Track (when + gx:coord) or LineString coordinates with/without timestamps (Garmin inReach, Google Earth). */
export function readKml(text) {
  const b = new PointBuilder(4096); let bad = 0;
  const tracks = text.match(/<gx:Track\b[\s\S]*?<\/gx:Track>/g);
  if (tracks && tracks.length) {
    for (const tr of tracks) {
      const whens = [...tr.matchAll(/<when>([^<]+)<\/when>/g)].map((x) => Date.parse(x[1].trim()));
      const coords = [...tr.matchAll(/<gx:coord>([^<]+)<\/gx:coord>/g)].map((x) => x[1].trim().split(/\s+/).map(Number));
      const n = Math.min(whens.length, coords.length);
      for (let i = 0; i < n; i++) {
        const [lon, lat, alt] = coords[i];
        if (Number.isNaN(whens[i]) || Number.isNaN(lat) || Number.isNaN(lon)) { bad++; continue; }
        b.push({ t: whens[i], lat, lon, alt, fix: true });
      }
    }
    return { points: b.finish(), bad, columns: ['gx:Track'] };
  }
  // Placemarks with TimeStamp + Point (inReach exports) or a LineString without time
  const pms = text.match(/<Placemark\b[\s\S]*?<\/Placemark>/g) || [];
  for (const pm of pms) {
    const when = Date.parse(((pm.match(/<when>([^<]+)<\/when>/) || [])[1] || '').trim());
    const c = (pm.match(/<Point>[\s\S]*?<coordinates>([^<]+)<\/coordinates>/) || [])[1];
    if (!c || Number.isNaN(when)) continue;
    const [lon, lat, alt] = c.trim().split(',').map(Number);
    if (Number.isNaN(lat) || Number.isNaN(lon)) { bad++; continue; }
    b.push({ t: when, lat, lon, alt, fix: true });
  }
  if (b.n === 0) {
    const ls = (text.match(/<LineString>[\s\S]*?<coordinates>([^<]+)<\/coordinates>/) || [])[1];
    if (ls) { // no time → spread over an unknown duration: 1 s per point, flagged by the caller
      let t = 0;
      for (const tri of ls.trim().split(/\s+/)) { const [lon, lat, alt] = tri.split(',').map(Number); if (Number.isNaN(lat)) { bad++; continue; } b.push({ t: t++ * 1000, lat, lon, alt, fix: true }); }
    }
  }
  return { points: b.finish(), bad, columns: ['Placemark'] };
}

/** IGC: HFDTE date + B records (HHMMSS lat lon fix palt galt). */
export function readIgc(text) {
  const b = new PointBuilder(4096); let bad = 0;
  const lines = text.split(SPLIT);
  let day = null;
  for (const ln of lines) {
    const m = ln.match(/^HFDTE(?:DATE:)?(\d{2})(\d{2})(\d{2})/);
    if (m) { day = Date.UTC(2000 + +m[3], +m[2] - 1, +m[1]); break; }
  }
  if (day === null) day = Date.UTC(2000, 0, 1);
  let last = -1, dayOffset = 0;
  for (const ln of lines) {
    if (ln[0] !== 'B' || ln.length < 35) continue;
    const hh = +ln.slice(1, 3), mi = +ln.slice(3, 5), ss = +ln.slice(5, 7);
    const lat = (+ln.slice(7, 9) + (+ln.slice(9, 14)) / 60000) * (ln[14] === 'S' ? -1 : 1);
    const lon = (+ln.slice(15, 18) + (+ln.slice(18, 23)) / 60000) * (ln[23] === 'W' ? -1 : 1);
    const valid = ln[24] === 'A';
    const palt = parseInt(ln.slice(25, 30), 10), galt = parseInt(ln.slice(30, 35), 10);
    let tod = (hh * 3600 + mi * 60 + ss) * 1000;
    if (last >= 0 && tod < last - 3600000) dayOffset += 86400000; // midnight crossing
    last = tod;
    const t = day + dayOffset + tod;
    if ([hh, mi, ss, lat, lon].some(Number.isNaN)) { bad++; continue; }
    b.push({ t, lat: valid ? lat : NaN, lon: valid ? lon : NaN, alt: valid && !Number.isNaN(galt) ? galt : NaN, balt: Number.isNaN(palt) ? NaN : palt, fix: valid });
  }
  return { points: b.finish(), bad, columns: ['B-record'] };
}

/**
 * GeoJSON: LineString features (our own exports, saved flights, QGIS/ogr2ogr output). Times come from
 * properties.times (parallel array, ISO), else properties.time per feature, else the file is timeless.
 * restart:true on a line resets the runtime counter → splitAtRestarts() recreates the source segments.
 */
export function readGeoJson(text) {
  const b = new PointBuilder(4096); let bad = 0;
  let doc; try { doc = JSON.parse(text); } catch { return { points: b.finish(), bad: 1, columns: [] }; }
  const feats = doc.type === 'FeatureCollection' ? doc.features || [] : doc.type === 'Feature' ? [doc] : [];
  let runtime = 0, fake = 0, timeless = false;
  for (const f of feats) {
    const g = f && f.geometry; if (!g) continue;
    const P = f.properties || {};
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    if (P.kind && P.kind !== 'track') continue;
    for (const coords of lines) {
      if (P.restart) runtime = 0;
      const times = Array.isArray(P.times) ? P.times : null;
      let t0 = NaN;
      for (let i = 0; i < coords.length; i++) {
        const c = coords[i]; if (!Array.isArray(c) || c.length < 2) { bad++; continue; }
        const [lon, lat, alt] = c;
        let t = times ? Date.parse(times[i] || '') : NaN;
        if (!times && Array.isArray(P.coordTimes)) t = Date.parse(P.coordTimes[i] || '');  // Mapbox togeojson style
        if (Number.isNaN(t)) { timeless = true; t = fake++ * 1000; }
        if (Number.isNaN(t0)) t0 = t;
        const at = (arr) => (Array.isArray(arr) && arr[i] !== null && arr[i] !== undefined ? +arr[i] : NaN);
        if (typeof lat !== 'number' || typeof lon !== 'number') { bad++; continue; }
        b.push({ t, lat, lon, alt: typeof alt === 'number' ? alt : NaN, balt: at(P.palt_m), press: at(P.press_hpa), vs: at(P.vs_ms), gs: at(P.gs_ms), hdg: at(P.hdg_deg), batt: at(P.batt_v), runtime: runtime + (t - t0) / 1000, fix: true });
      }
      if (!Number.isNaN(t0) && coords.length) { const last = coords.length - 1; const tl = times ? Date.parse(times[last] || '') : NaN; runtime += Number.isNaN(tl) ? coords.length : (tl - t0) / 1000; }
    }
  }
  return { points: b.finish(), bad, columns: ['LineString'], timeless };
}

/** Dispatch by profile.read.kind. */
export function readWithProfile(text, profile) {
  const kind = profile.read && profile.read.kind;
  if (kind === 'delimited') return readDelimited(text, profile);
  if (kind === 'jsonl') return readJsonl(text, profile);
  if (kind === 'gpx') return readGpx(text);
  if (kind === 'kml') return readKml(text);
  if (kind === 'igc') return readIgc(text);
  if (kind === 'geojson') return readGeoJson(text);
  throw new Error(`unknown reader kind ${kind}`);
}
