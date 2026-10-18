// Ereignislog (concept §9): rows written by the gb_notion_frontend app (reporting.wicki.aero) and
// stored in bwicki/gb_flight_data as data/<FLIGHT>.json (or .csv). Here they are normalised, linked
// to the track by time and summarised. Pure functions – shared by the UI and the node tests.

import { indexAt } from '../process/series.js';
import { haversine } from '../util/geo.js';

export const EVENT_TYPES = ['ATC', 'Ballast', 'Ressources', 'POS', 'PIC', 'Other'];
export const EVENT_COLORS = { ATC: '#1f5fbf', Ballast: '#d98c00', Ressources: '#1f8a4c', POS: '#5b6b7f', PIC: '#7c3aed', Other: '#9aa7b6' };

const num = (v) => { if (v === null || v === undefined || v === '') return NaN; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return Number.isNaN(n) ? NaN : n; };
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'yes';

/** Short one-line text of a row, by type. */
export function eventText(r) {
  const t = str(r.type);
  if (t === 'ATC') {
    const head = [str(r.atc_dir), str(r.atc_station), str(r.atc_freq) && `${str(r.atc_freq)} MHz`, str(r.atc_squawk) && `SQ ${str(r.atc_squawk)}`].filter(Boolean).join(' · ');
    return [head, str(r.atc_msg)].filter(Boolean).join(': ');
  }
  if (t === 'Ballast') {
    const parts = [];
    const action = str(r.ballast_action);
    if (action) parts.push(action);
    const delta = num(r.ballast_delta_kg), abs = num(r.ballast_abs_kg) || num(r.total_ballast_kg);
    if (!Number.isNaN(delta) && delta) parts.push(`${delta > 0 ? '+' : ''}${delta} kg${str(r.ballast_medium) ? ' ' + str(r.ballast_medium) : ''}`);
    if (!Number.isNaN(abs) && abs) parts.push(`${abs} kg total`);
    const sand = num(r.sand_left_kg), water = num(r.water_left_kg);
    if (!Number.isNaN(sand) || !Number.isNaN(water)) parts.push(`(${[!Number.isNaN(sand) ? `sand ${sand}` : '', !Number.isNaN(water) ? `water ${water}` : ''].filter(Boolean).join(', ')})`);
    if (str(r.note)) parts.push(str(r.note));
    return parts.join(' · ');
  }
  if (t === 'Ressources') {
    const parts = [];
    if (!Number.isNaN(num(r.res_battery_pct))) parts.push(`Batt ${num(r.res_battery_pct)} %`);
    if (str(r.res_fuel_cell)) parts.push(`Fuel cell ${str(r.res_fuel_cell)}`);
    if (str(r.res_solar)) parts.push(`Solar ${str(r.res_solar)}`);
    if (!Number.isNaN(num(r.res_methanol_pct))) parts.push(`Methanol ${num(r.res_methanol_pct)} %`);
    if (str(r.res_o2)) parts.push(`O₂ ${str(r.res_o2)}`);
    else if (!Number.isNaN(num(r.res_o2_pct))) parts.push(`O₂ ${num(r.res_o2_pct)} %`);
    if (str(r.note)) parts.push(str(r.note));
    return parts.join(' · ');
  }
  if (t === 'PIC') return [str(r.crew_change) || (str(r.crew_pic) && `PIC ${str(r.crew_pic)}`), str(r.note)].filter(Boolean).join(' · ');
  return str(r.note) || str(r.atc_msg) || '';
}

/** Raw rows (JSON objects or CSV rows as objects) → normalised events sorted by time. */
export function normalizeEvents(rows, opts = {}) {
  const out = [];
  for (const r of rows || []) {
    if (!r || typeof r !== 'object') continue;
    if (r.deleted && !opts.keepDeleted) continue;
    const t = Date.parse(str(r.ts_utc) || str(r.ts) || '');
    if (Number.isNaN(t)) continue;
    const type = EVENT_TYPES.includes(str(r.type)) ? str(r.type) : 'Other';
    const lat = num(r.lat), lon = num(r.lon);
    const fix = !Number.isNaN(lat) && !Number.isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0);
    out.push({
      id: str(r.id) || `${t}-${out.length}`, seq: num(r.seq), t, type, flight: str(r.flight_id), callsign: str(r.callsign), reporter: str(r.reporter),
      lat: fix ? lat : NaN, lon: fix ? lon : NaN, alt: !Number.isNaN(num(r.alt_gps_m)) ? num(r.alt_gps_m) : (!Number.isNaN(num(r.alt_ft)) ? num(r.alt_ft) * 0.3048 : NaN),
      posSource: str(r.pos_source), place: str(r.place), text: eventText(r), note: str(r.note),
      ballastAbs: num(r.ballast_abs_kg) || num(r.total_ballast_kg) || NaN, ballastDelta: num(r.ballast_delta_kg),
      attachments: str(r.attachment_paths) || str(r.attachments), gpsFix: truthy(r.gps_fix), raw: r,
    });
  }
  out.sort((a, b) => a.t - b.t || (a.seq || 0) - (b.seq || 0));
  return out;
}

/** Simple CSV (RFC-ish quotes, comma) → row objects by header. */
export function parseCsvRows(text) {
  const rows = []; let cur = [], field = '', q = false; const lines = [];
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { cur.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; cur.push(field); field = ''; lines.push(cur); cur = []; }
    else field += c;
  }
  if (field !== '' || cur.length) { cur.push(field); lines.push(cur); }
  const head = (lines.shift() || []).map((h) => h.trim());
  for (const ln of lines) { if (ln.length < 2) continue; const o = {}; head.forEach((h, k) => { o[h] = ln[k] === undefined ? '' : ln[k]; }); rows.push(o); }
  return rows;
}

/** Text of an uploaded file (JSON array or CSV export of the app) → normalised events; throws on nonsense. */
export function parseEventLog(text, name = '') {
  const s = text.trim();
  let rows;
  if (s.startsWith('[') || s.startsWith('{')) { const j = JSON.parse(s); rows = Array.isArray(j) ? j : Array.isArray(j.rows) ? j.rows : Array.isArray(j.events) ? j.events : []; }
  else rows = parseCsvRows(s);
  const events = normalizeEvents(rows);
  if (!events.length) throw new Error('no events with ts_utc found');
  return events;
}

/**
 * Attach each event to the track: index at its time, track position/altitude, distance between the
 * event's own position and the track, in-range flag (inside the trimmed flight ± 2 h).
 */
export function linkEvents(events, track, series, trim) {
  if (!track || !track.points.n) return events.map((e) => ({ ...e, idx: -1, inRange: false }));
  const ps = track.points, t = ps.t, n = ps.n;
  return events.map((e) => {
    const i = indexAt(t, e.t);
    const inside = e.t >= t[0] - 60000 && e.t <= t[n - 1] + 60000;
    let p = i; while (p > 0 && !ps.fix[p]) p--;
    const onTrack = inside && ps.fix[p] === 1 && Math.abs(t[i] - e.t) < 10 * 60000;
    const tLat = onTrack ? ps.lat[p] : NaN, tLon = onTrack ? ps.lon[p] : NaN;
    const alt = onTrack ? series.alt[i] : e.alt;
    const distM = onTrack && !Number.isNaN(e.lat) ? haversine(e.lat, e.lon, tLat, tLon) : NaN;
    const inTrim = !trim || (e.t >= trim.from && e.t <= trim.to);
    const lat = onTrack ? tLat : e.lat, lon = onTrack ? tLon : e.lon;
    return { ...e, idx: inside ? i : -1, onTrack, inTrim, trackLat: tLat, trackLon: tLon, lat, lon, ownLat: e.lat, ownLon: e.lon, alt, distM, dist: onTrack ? series.dist[i] : NaN };
  });
}

/** Counts per type, ballast at start/end, first/last time. */
export function summarizeEvents(events) {
  const counts = {}; for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
  const ballast = events.filter((e) => e.type === 'Ballast' && !Number.isNaN(e.ballastAbs));
  const drops = events.filter((e) => e.type === 'Ballast' && !Number.isNaN(e.ballastDelta) && e.ballastDelta < 0);
  return {
    n: events.length, counts, first: events.length ? events[0].t : null, last: events.length ? events[events.length - 1].t : null,
    ballastStart: ballast.length ? ballast[0].ballastAbs : null, ballastEnd: ballast.length ? ballast[ballast.length - 1].ballastAbs : null,
    drops: drops.length, dropped: drops.reduce((s, e) => s + Math.abs(e.ballastDelta), 0),
    pics: [...new Set(events.filter((e) => e.type === 'PIC').map((e) => e.text).filter(Boolean))],
  };
}

/** Which repo flight matches a track: overlap of the log's time span with the track's. */
export function scoreFlightMatch(flightMeta, t0, t1) {
  const a = Date.parse(flightMeta.first || ''), b = Date.parse(flightMeta.last || '');
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  const lo = Math.max(a, t0), hi = Math.min(b, t1);
  return hi > lo ? (hi - lo) / Math.max(1, Math.min(b - a, t1 - t0)) : 0;
}
