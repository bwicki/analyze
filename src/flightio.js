// Saving and re-opening flights under a Kennung (phase 2): the current analysis → GeoJSON + summary
// for the Worker, and a saved record + GeoJSON → back into the pipeline (same path as an import).

import { state, recompute, resetAll, saveMeta, bus, setEventLog } from './state.js';
import { normalizeEvents, summarizeEvents } from './events/log.js';
import { exportData, summaryForExport } from './export/download.js';
import { toGeoJson } from './export/formats.js';
import { parseFiles } from './parser.js';
import { api } from './api.js';
import { t } from './i18n.js';
import { fmtDateUTC } from './util/format.js';

/** Title shown in lists and on the report when the user typed none. */
export function flightTitle() {
  const st = state.stats, m = state.meta;
  if (m.title) return m.title;
  return st && st.takeoff ? `${fmtDateUTC(st.takeoff.t)}${m.balloon ? ' · ' + m.balloon : ''}` : t('exp.flight');
}

/** What goes to the server: summary + master data + the full-resolution trimmed track as GeoJSON. */
export function buildFlightPayload() {
  const d = exportData(0); if (!d) return null;
  const stats = summaryForExport();
  const extra = { startPlace: state.places.takeoff || '', landPlace: state.places.landing || '', restarts: state.stats.restarts, altMeanM: Math.round(state.stats.altMean), gsMeanMs: +state.stats.gsMean.toFixed(2),
    accVertMax: state.stats.accVertMax ? +state.stats.accVertMax.v.toFixed(3) : null, trackers: [...new Set(state.files.filter((f) => f.profile).map((f) => f.profile.name))], files: state.segments.filter((s) => s.status === 'use').length };
  if (state.evlog) { const sm = summarizeEvents(state.evlog.events); extra.events = { n: sm.n, counts: sm.counts, source: state.evlog.source.kind === 'repo' ? `gb_flight_data/${state.evlog.source.flight}` : state.evlog.source.name || '', ballastStart: sm.ballastStart, ballastEnd: sm.ballastEnd, dropped: sm.dropped }; }
  const geojson = toGeoJson({ ...d, name: flightTitle(), stats: { ...stats, ...extra }, full: true });
  const events = state.evlog ? JSON.stringify(state.evlog.rows) : '';
  return { flight: { title: flightTitle(), stats: { ...stats, ...extra }, meta: { ...state.meta }, points: d.pts.length, public: state.flight ? state.flight.public : true }, geojson, events };
}

/** Save (new) or update (same id, same code) the current analysis. Returns the record. */
export async function saveCurrentFlight({ withTrack = true } = {}) {
  const p = buildFlightPayload(); if (!p) throw new Error('nothing to save');
  let rec;
  if (state.flight && state.flight.id && !state.viewer) rec = await api.flights.update(state.flight.id, p.flight, withTrack ? p.geojson : null, p.events);
  else rec = await api.flights.save(p.flight, p.geojson, p.events);
  state.flight = { id: rec.id, title: rec.title, url: rec.url, updatedAt: rec.updatedAt, public: rec.public };
  bus.emit('flight');
  return rec;
}

/** Load a saved record (list row or viewer data) + its GeoJSON (+ stored event log) into the pipeline. */
export async function openFlight(rec, geojsonText, { viewer = false, eventRows = null } = {}) {
  resetAll();
  state.busy = true; bus.emit('track');
  try {
    const name = `${(rec.title || 'Fahrt').replace(/[\\/:*?"<>|]+/g, '-')}.geojson`;
    const file = new File([geojsonText], name, { type: 'application/geo+json' });
    const results = await parseFiles([file]);
    state.files = results.filter((r) => r.points);
    Object.assign(state.meta, { title: '', event: '', purpose: 'private', balloon: '', type: '', gas: '', pic: '', copilot: '', pax: '', startName: '', landName: '', remarks: '', nvfr: '' }, rec.meta || {});
    if (!viewer) saveMeta();
    state.places = { takeoff: (rec.stats && rec.stats.startPlace) || null, landing: (rec.stats && rec.stats.landPlace) || null };
    recompute({ reclassify: true });
    if (eventRows && eventRows.length) { const src = (rec.stats && rec.stats.events && rec.stats.events.source) || ''; setEventLog({ source: { kind: 'saved', flight: src.replace(/^gb_flight_data\//, ''), name: src }, rows: eventRows, events: normalizeEvents(eventRows) }); }
    state.flight = { id: rec.id, title: rec.title, url: rec.url || `${location.origin}${location.pathname.replace(/\/[^/]*$/, '')}/v/${rec.id}`, updatedAt: rec.updatedAt, public: rec.public };
    state.viewer = viewer ? { id: rec.id, title: rec.title, owner: rec.owner || null } : null;
    state.visited = { import: true, clean: true, analyze: true };
  } finally { state.busy = false; bus.emit('track'); bus.emit('flight'); }
}
