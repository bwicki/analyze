// Central application state + event bus + settings (localStorage). Nothing here touches the DOM.
// The pipeline (recompute) turns parsed files into segments → track → series → events → trim → stats.

import { buildSegments, classifySegments, mergeSegments, DEFAULTS as SEG_DEFAULTS } from './process/segments.js';
import { deriveSeries } from './process/series.js';
import { detectEvents, proposeTrim, DETECT_DEFAULTS } from './process/detect.js';
import { computeStats } from './process/stats.js';

export const PHASES = ['import', 'clean', 'analyze', 'report', 'export'];
export const VERSION = '0.1.0';

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
  colorBy: 'vario',       // profile line colour: 'vario' | 'alt'
  hideOtherFlights: true,
};

const LS_SETTINGS = 'analyze.settings', LS_META = 'analyze.meta';
function load(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? v : fallback; } catch { return fallback; } }
function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } }

export const state = {
  phase: 'import',
  visited: { import: true },
  settings: { ...DEFAULT_SETTINGS, ...load(LS_SETTINGS, {}), detect: { ...DETECT_DEFAULTS, ...(load(LS_SETTINGS, {}).detect || {}) } },
  meta: { title: '', event: '', purpose: 'private', balloon: '', type: '', gas: '', pic: '', copilot: '', pax: '', startName: '', landName: '', remarks: '', nvfr: '', ...load(LS_META, {}) },
  files: [],        // parser results (one per file / zip entry)
  unknown: [],      // files without profile
  busy: false, progress: '',
  segments: [], track: null, series: null, events: [], states: null, trim: null, stats: null,
  places: { takeoff: null, landing: null }, // reverse-geocoded names
  hover: null,      // index on the track under the cursor (map ↔ profile)
};

export function saveSettings() { save(LS_SETTINGS, state.settings); bus.emit('settings'); }
export function saveMeta() { save(LS_META, state.meta); }

/** Default report title from the stats. */
export function autoTitle(fmtDate) {
  if (!state.stats || !state.stats.takeoff) return '';
  return `${fmtDate(state.stats.takeoff.t)} ${state.meta.balloon || ''}`.trim();
}

/** Re-run the pipeline from the parsed files. keepTrim: keep a user-set trim when it still fits. */
export function recompute({ reclassify = true } = {}) {
  const s = state;
  const files = s.files.filter((f) => f.points && f.points.n);
  if (reclassify || !s.segments.length) {
    const prev = new Map(s.segments.map((x) => [x.file + '#' + x.part, x.status]));
    s.segments = buildSegments(files, { gapSec: s.settings.gapSec });
    for (const sg of s.segments) { const st = prev.get(sg.file + '#' + sg.part); if (st === 'off') sg.status = 'off'; }
    classifySegments(s.segments, { otherFlightHours: s.settings.otherFlightHours });
  }
  s.track = mergeSegments(s.segments, { gapSec: s.settings.gapSec });
  if (!s.track) { s.series = null; s.events = []; s.states = null; s.trim = null; s.stats = null; bus.emit('track'); return; }
  s.series = deriveSeries(s.track, { gapSec: s.settings.gapSec });
  const d = detectEvents(s.track, s.series, s.settings.detect);
  s.events = d.events; s.states = d.states;
  const auto = proposeTrim(s.track, s.events, s.settings.detect);
  const t0 = s.track.points.t[0], t1 = s.track.points.t[s.track.points.n - 1];
  if (!s.trim || s.trim.auto || s.trim.from < t0 || s.trim.to > t1) s.trim = auto;
  s.stats = computeStats(s.track, s.series, s.events, s.trim, { nightLimitDeg: s.settings.nightLimitDeg });
  bus.emit('track');
}

/** Set a manual trim (ms) and recompute stats only. */
export function setTrim(from, to, auto = false) {
  const s = state; if (!s.track) return;
  const t0 = s.track.points.t[0], t1 = s.track.points.t[s.track.points.n - 1];
  if (auto) s.trim = proposeTrim(s.track, s.events, s.settings.detect);
  else s.trim = { from: Math.max(t0, Math.min(from, to)), to: Math.min(t1, Math.max(from, to)), auto: false };
  s.stats = computeStats(s.track, s.series, s.events, s.trim, { nightLimitDeg: s.settings.nightLimitDeg });
  bus.emit('track');
}

/** Override the detected landing (manual) – replaces the last landing with the given time. */
export function setManualLanding(ms) {
  const s = state; if (!s.track) return;
  const t = s.track.points.t; let i = 0; while (i < t.length - 1 && t[i] < ms) i++;
  const ps = s.track.points; let p = i; while (p > 0 && !ps.fix[p]) p--;
  const ev = s.events.filter((e) => e.type !== 'landing' || e.t < ms - 1).filter((e) => !(e.type === 'landing' && e.t > ms));
  ev.push({ type: 'landing', idx: i, t: t[i], lat: ps.lat[p], lon: ps.lon[p], alt: s.series.alt[i], manual: true });
  ev.sort((a, b) => a.t - b.t);
  s.events = ev;
  s.trim = proposeTrim(s.track, s.events, s.settings.detect);
  s.stats = computeStats(s.track, s.series, s.events, s.trim, { nightLimitDeg: s.settings.nightLimitDeg });
  bus.emit('track');
}

export function resetAll() {
  const s = state;
  s.files = []; s.unknown = []; s.segments = []; s.track = null; s.series = null; s.events = []; s.states = null; s.trim = null; s.stats = null; s.places = { takeoff: null, landing: null }; s.hover = null;
  s.visited = { import: true };
  bus.emit('track');
}
