// Saving and re-opening flights under a Kennung (phase 2): the current analysis → GeoJSON + summary
// for the Worker, and a saved record + GeoJSON → back into the pipeline (same path as an import).

import { state, recompute, resetAll, saveMeta, bus, setEventLog, setManualLanding } from './state.js';
import { normalizeEvents, summarizeEvents } from './events/log.js';
import { loadPhotos } from './photos/store.js';
import { exportData, summaryForExport } from './export/download.js';
import { toGeoJson } from './export/formats.js';
import { parseFiles } from './parser.js';
import { api, gzipText } from './api.js';
import { t } from './i18n.js';
import { fmtDateUTC } from './util/format.js';
import { renderPreview, previewData } from './export/preview.js';

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
  const extra = { startPlace: state.places.takeoff || '', landPlace: state.places.landing || '', interPlaces: { ...state.places.inter }, ignoredLandings: [...state.ignoredLandings], restarts: state.stats.restarts, altMeanM: Math.round(state.stats.altMean), gsMeanMs: +state.stats.gsMean.toFixed(2),
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
  state.flight = { id: rec.id, title: rec.title, url: rec.url, createdAt: rec.createdAt || (state.flight && state.flight.createdAt) || rec.updatedAt, updatedAt: rec.updatedAt, public: rec.public };
  bus.emit('flight');
  loadPhotos();
  uploadPreview(rec.id);
  uploadRawFiles(rec.id);
  return rec;
}

/** The imported tracker files, gzip-compressed in the browser, stored with the flight (0.8.7). Once per set. */
export async function uploadRawFiles(id) {
  if (!state.rawFiles.length || state.rawUploadedFor === id || state.viewer) return;
  state.rawBusy = true; bus.emit('raw', { id, busy: true });
  try {
    const fd = new FormData();
    fd.set('meta', JSON.stringify(state.rawFiles.map((f) => ({ name: f.name, bytes: f.size }))));
    for (const f of state.rawFiles) fd.append('files', await gzipText(f.file), `${f.name}.gz`);
    const r = await api.flights.putRaw(id, fd);
    state.rawUploadedFor = id; if (state.flight && state.flight.id === id) { state.flight.rawFiles = r.files.length; state.flight.rawBytes = r.files.reduce((a, x) => a + x.gzBytes, 0); }
    state.rawBusy = false; bus.emit('raw', { id, ok: true, n: r.files.length });
  } catch (e) { console.warn('raw files failed:', e && e.message); state.rawBusy = false; bus.emit('raw', { id, ok: false, error: e && e.status }); }
}

/** Link-preview image for messengers (0.8.4): rendered here, stored by the Worker; failures are silent. */
export async function uploadPreview(id) {
  state.previewBusy = true; bus.emit('preview', { id, busy: true });
  try {
    const blob = await renderPreview(previewData(flightTitle()));
    if (blob) await api.flights.preview(id, blob);
    if (blob && state.flight && state.flight.id === id) state.flight.previewAt = Date.now();   // cache-buster for the thumbnail on the export page
    state.previewBusy = false; bus.emit('preview', { id, ok: !!blob });
  } catch (e) { console.warn('preview image failed:', e && e.message); state.previewBusy = false; bus.emit('preview', { id, ok: false }); }
}

/**
 * The saved track is the trimmed one. When its landing was set by hand or by a cut inside the flight, the
 * recording ends in the air and detection finds no landing on reopening – restore it from the saved figures.
 */
function restoreSavedLanding(stats) {
  const st = state.stats, saved = stats && stats.landing;
  if (!st || st.landing || !saved || !saved.time) return;
  const ms = Date.parse(saved.time); if (!Number.isFinite(ms)) return;
  const t = state.track.points.t; if (ms < t[0] - 1000 || ms > t[t.length - 1] + 1000) return;
  setManualLanding(ms, saved.cut ? 'cut' : 'manual');
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
    Object.assign(state.meta, { title: '', event: '', purpose: 'private', balloon: '', type: '', volume: '', pic: '', copilot: '', pax: '', startName: '', landName: '', remarks: '', nvfr: '' }, rec.meta || {});
    if (!viewer) saveMeta();
    state.places = { takeoff: (rec.stats && rec.stats.startPlace) || null, landing: (rec.stats && rec.stats.landPlace) || null, inter: (rec.stats && rec.stats.interPlaces) || {} };
    state.ignoredLandings = Array.isArray(rec.stats && rec.stats.ignoredLandings) ? rec.stats.ignoredLandings.slice() : [];
    recompute({ reclassify: true });
    restoreSavedLanding(rec.stats);
    if (eventRows && eventRows.length) { const src = (rec.stats && rec.stats.events && rec.stats.events.source) || ''; setEventLog({ source: { kind: 'saved', flight: src.replace(/^gb_flight_data\//, ''), name: src }, rows: eventRows, events: normalizeEvents(eventRows) }); }
    state.flight = { id: rec.id, title: rec.title, url: rec.url || `${location.origin}${location.pathname.replace(/\/[^/]*$/, '')}/v/${rec.id}`, createdAt: rec.createdAt, updatedAt: rec.updatedAt, public: rec.public, rawFiles: rec.rawFiles || 0, rawBytes: rec.rawBytes || 0 };
    state.rawUploadedFor = rec.id;   // nothing to upload for a reopened flight (its raw set stays as stored)
    state.viewer = viewer ? { id: rec.id, title: rec.title, owner: rec.owner || null } : null;
    state.visited = { import: true, clean: true, analyze: true };
  } finally { state.busy = false; bus.emit('track'); bus.emit('flight'); }
  loadPhotos();
}
