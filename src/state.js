// Central application state + event bus + settings (localStorage). Nothing here touches the DOM.
// The pipeline (recompute) turns parsed files into segments → track → series → events → trim → stats.

import { buildSegments, classifySegments, mergeSegments, DEFAULTS as SEG_DEFAULTS } from './process/segments.js';
import { MERGE_DEFAULTS } from './process/consensus.js';
import { deriveSeries } from './process/series.js';
import { detectEvents, proposeTrim, DETECT_DEFAULTS, dropIgnoredLandings, statesFromEvents } from './process/detect.js';
import { computeStats } from './process/stats.js';
import { linkEvents } from './events/log.js';

export const PHASES = ['import', 'clean', 'analyze', 'report', 'export'];
export const VERSION = '0.8.6';

class Bus extends EventTarget {
  on(type, fn) { const h = (e) => fn(e.detail); this.addEventListener(type, h); return () => this.removeEventListener(type, h); }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}
export const bus = new Bus();

export const DEFAULT_SETTINGS = {
  units: 'icao',          // 'icao' (ft, kt, m/s) | 'metric' (m, km/h, m/s)
  markerMin: 60,          // time markers on map and profile
  gapSec: SEG_DEFAULTS.gapSec,
  otherFlightHours: SEG_DEFAULTS.otherFlightHours,
  detect: { ...DETECT_DEFAULTS },
  nightLimitDeg: -6,
  geocode: true,          // fetch place names from OpenStreetMap (Nominatim) for start and landing
  mapLayer: 'osm',
  colorBy: 'vario',       // track/profile colour: 'vario' | 'gs' (ground speed)
  hideOtherFlights: true,
  merge: { mode: MERGE_DEFAULTS.mode, primary: null, stepSec: MERGE_DEFAULTS.stepSec },   // several devices (0.8.0)
  terrain: true,          // ground profile + water along the track (DEM tiles / open-meteo, OpenFreeMap)
  showBottom: false,      // bed of crossed water bodies as a light brown line in the profile
};

const LS_SETTINGS = 'analyze.settings', LS_META = 'analyze.meta';
function load(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? v : fallback; } catch { return fallback; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }

export const state = {
  phase: 'import',
  visited: { import: true },
  settings: { ...DEFAULT_SETTINGS, ...load(LS_SETTINGS, {}), detect: { ...DETECT_DEFAULTS, ...(load(LS_SETTINGS, {}).detect || {}) } },
  meta: { title: '', event: '', purpose: 'private', balloon: '', type: '', volume: '', pic: '', copilot: '', pax: '', crew: '', commandCenter: '', equipment: '', startName: '', landName: '', remarks: '', nvfr: '', ...load(LS_META, {}) },
  files: [],        // parser results (one per file / zip entry)
  unknown: [],      // files without profile
  busy: false, progress: '',
  segments: [], track: null, series: null, events: [], states: null, trim: null, stats: null,
  places: { takeoff: null, landing: null, inter: {} }, // reverse-geocoded names ('CH-Willisau'); inter keyed by landing time
  ignoredLandings: [],  // times (ms) of auto-detected intermediate landings the user removed (false touchdowns)
  hover: null,      // index on the track under the cursor (map ↔ profile)
  terrain: null,    // {idx, ground, water, source, status} – see terrain/store.js
  importedAt: null, // ms: first file of this flight added in this session
  modifiedAt: null, // ms: last change (import, trim, landing, master data)
  evlog: null,      // Ereignislog: {source: {kind: 'repo'|'file'|'saved', flight, name}, rows (raw), events (normalised), linked}
  userProfiles: [], // tracker profiles from the assistant (shared via the Worker + local), ahead of the built-in ones
  photos: [],       // photos of the saved flight (server rows); photosPlaced = on the track (photos/store.js)
  photosPlaced: [],
  flight: null,     // {id, title, url, updatedAt, public} once the current analysis is saved under the Kennung
  viewer: null,     // {id, title, owner:{code, displayName, logo}} when opened through a short link (read-only)
  previewBusy: false, // link-preview image being rendered / uploaded (export page shows a placeholder meanwhile)
};

export function saveSettings() { save(LS_SETTINGS, state.settings); bus.emit('settings'); }
export function saveMeta() { save(LS_META, state.meta); state.modifiedAt = Date.now(); }
export function touch() { state.modifiedAt = Date.now(); if (!state.importedAt) state.importedAt = state.modifiedAt; }

/** Default report title from the stats. */
export function autoTitle(fmtDate) {
  if (!state.stats || !state.stats.takeoff) return '';
  return `${fmtDate(state.stats.takeoff.t)} ${state.meta.balloon || ''}`.trim();
}

/** Re-run the pipeline from the parsed files. keepTrim: keep a user-set trim when it still fits. */
export function recompute({ reclassify = true } = {}) {
  const s = state; touch();
  const files = s.files.filter((f) => f.points && f.points.n);
  if (reclassify || !s.segments.length) {
    const prev = new Map(s.segments.map((x) => [x.file + '#' + x.part, { status: x.status, keep: !!x.keep }]));
    s.segments = buildSegments(files, { gapSec: s.settings.gapSec });
    for (const sg of s.segments) { const p = prev.get(sg.file + '#' + sg.part); if (p && p.status === 'off') sg.status = 'off'; if (p && p.keep) sg.keep = true; }
    classifySegments(s.segments, { otherFlightHours: s.settings.otherFlightHours });
    for (const sg of s.segments) if (sg.keep && sg.status === 'other') sg.status = 'use';   // "other flight" kept on purpose
  }
  s.track = mergeSegments(s.segments, { gapSec: s.settings.gapSec, merge: s.settings.merge || MERGE_DEFAULTS });
  if (!s.track) { s.series = null; s.events = []; s.states = null; s.trim = null; s.stats = null; bus.emit('track'); return; }
  s.series = deriveSeries(s.track, { gapSec: s.settings.gapSec });
  const d = detectEvents(s.track, s.series, s.settings.detect);
  s.events = dropIgnoredLandings(d.events, s.ignoredLandings); s.states = statesFromEvents(s.events, s.track.points.n);
  const auto = proposeTrim(s.track, s.events, s.settings.detect);
  const t0 = s.track.points.t[0], t1 = s.track.points.t[s.track.points.n - 1];
  if (!s.trim || s.trim.auto || s.trim.from < t0 || s.trim.to > t1) s.trim = auto;
  s.stats = computeStats(s.track, s.series, s.events, s.trim, { nightLimitDeg: s.settings.nightLimitDeg });
  relinkEvents();
  bus.emit('track');
}

/** Attach the Ereignislog to the current track (positions, altitudes, in-trim flags). */
export function relinkEvents() {
  const s = state;
  if (!s.evlog) return;
  s.evlog.linked = s.track && s.series ? linkEvents(s.evlog.events, s.track, s.series, s.trim) : s.evlog.events.map((e) => ({ ...e, idx: -1, inTrim: false, onTrack: false }));
}

/** Set (or clear with null) the Ereignislog. */
export function setEventLog(evlog) {
  state.evlog = evlog;
  relinkEvents();
  bus.emit('events');
}

/** Set a manual trim (ms) and recompute stats only. */
export function setTrim(from, to, auto = false) {
  const s = state; if (!s.track) return; touch();
  const t0 = s.track.points.t[0], t1 = s.track.points.t[s.track.points.n - 1];
  if (auto) s.trim = proposeTrim(s.track, s.events, s.settings.detect);
  else s.trim = { from: Math.max(t0, Math.min(from, to)), to: Math.min(t1, Math.max(from, to)), auto: false };
  s.stats = computeStats(s.track, s.series, s.events, s.trim, { nightLimitDeg: s.settings.nightLimitDeg });
  relinkEvents();
  bus.emit('track');
}

/** Remove a false intermediate landing (and the take-off after it); restore with restoreLandings(). */
export function ignoreLanding(ms) {
  const s = state; if (!s.track) return; touch();
  if (!s.ignoredLandings.some((x) => Math.abs(x - ms) < 1000)) s.ignoredLandings.push(ms);
  const d = detectEvents(s.track, s.series, s.settings.detect);
  s.events = dropIgnoredLandings(d.events, s.ignoredLandings); s.states = statesFromEvents(s.events, s.track.points.n);
  s.trim = s.trim && !s.trim.auto ? s.trim : proposeTrim(s.track, s.events, s.settings.detect);
  s.stats = computeStats(s.track, s.series, s.events, s.trim, { nightLimitDeg: s.settings.nightLimitDeg });
  relinkEvents();
  bus.emit('track');
}
export function restoreLandings() {
  state.ignoredLandings = [];
  recompute({ reclassify: false });
}

/** Override the detected landing (manual) – replaces the last landing with the given time. flag: 'manual' (set by hand) | 'cut' (restored cut of a saved flight). */
export function setManualLanding(ms, flag = 'manual') {
  const s = state; if (!s.track) return; touch();
  const t = s.track.points.t; let i = 0; while (i < t.length - 1 && t[i] < ms) i++;
  const ps = s.track.points; let p = i; while (p > 0 && !ps.fix[p]) p--;
  const ev = s.events.filter((e) => e.type !== 'landing' || e.t < ms - 1).filter((e) => !(e.type === 'landing' && e.t > ms));
  ev.push({ type: 'landing', idx: i, t: t[i], lat: ps.lat[p], lon: ps.lon[p], alt: s.series.alt[i], [flag]: true });
  ev.sort((a, b) => a.t - b.t);
  s.events = ev;
  s.trim = proposeTrim(s.track, s.events, s.settings.detect);
  s.stats = computeStats(s.track, s.series, s.events, s.trim, { nightLimitDeg: s.settings.nightLimitDeg });
  relinkEvents();
  bus.emit('track');
}

export function resetAll() {
  const s = state;
  s.files = []; s.unknown = []; s.segments = []; s.track = null; s.series = null; s.events = []; s.states = null; s.trim = null; s.stats = null; s.places = { takeoff: null, landing: null, inter: {} }; s.hover = null; s.ignoredLandings = []; s.importedAt = null; s.modifiedAt = null;
  s.flight = null; s.viewer = null; s.evlog = null; s.photos = []; s.photosPlaced = [];
  s.visited = { import: true };
  bus.emit('track');
}
