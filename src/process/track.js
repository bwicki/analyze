// The final track for display and export: trimmed to [from, to], optionally downsampled, as plain
// point objects. Also the waypoint list (start, landings, hourly markers) shared by map, profile and exports.

import { indexAt } from './series.js';

/** Plain points between trim.from and trim.to, every `stepSec` seconds (0 = every point). */
export function trackPoints(track, series, trim, stepSec = 0) {
  const ps = track.points, t = ps.t;
  const i0 = indexAt(t, trim.from), i1 = indexAt(t, trim.to);
  const out = []; let nextT = -Infinity, lastKept = -1;
  for (let i = i0; i <= i1; i++) {
    const isGap = track.gap[i] === 1;
    if (stepSec > 0 && t[i] < nextT && !isGap && i !== i1) continue;
    out.push({ i, t: t[i], lat: ps.lat[i], lon: ps.lon[i], alt: series.altClean[i], balt: ps.balt[i], press: ps.press[i], vs: series.vs[i], gs: series.gs[i], hdg: ps.hdg[i], batt: ps.batt[i], dist: series.dist[i], fix: ps.fix[i] === 1, gap: isGap || (lastKept >= 0 && hasGapBetween(track, lastKept, i)), seg: track.seg ? track.seg[i] : 0 });
    lastKept = i; nextT = t[i] + stepSec * 1000;
  }
  return out;
}
function hasGapBetween(track, a, b) { for (let k = a + 1; k <= b; k++) if (track.gap[k]) return true; return false; }

/** Hourly time markers (full hours UTC) between from and to, interpolated on the track. */
export function timeMarkers(track, series, from, to, intervalMin = 60) {
  const ps = track.points, t = ps.t, out = [];
  const step = intervalMin * 60000;
  let m = Math.ceil(from / step) * step;
  for (; m <= to; m += step) {
    const i = indexAt(t, m);
    let p = i; while (p >= 0 && !ps.fix[p]) p--;
    if (p < 0) continue;
    if (Math.abs(t[i] - m) > 10 * 60000) continue; // inside a long gap
    out.push({ t: m, lat: ps.lat[p], lon: ps.lon[p], alt: series.altClean[i], i });
  }
  return out;
}

/** Waypoints for exports: take-off, intermediate landings, landing, hourly markers. */
export function waypoints(stats, markers, labels) {
  const w = [];
  if (stats.takeoff && !Number.isNaN(stats.takeoff.lat)) w.push({ kind: 'takeoff', name: labels.takeoff, t: stats.takeoff.t, lat: stats.takeoff.lat, lon: stats.takeoff.lon, alt: stats.takeoff.alt });
  for (const l of stats.intermediate) w.push({ kind: 'landing', name: labels.intermediate, t: l.t, lat: l.lat, lon: l.lon, alt: l.alt });
  if (stats.landing && !Number.isNaN(stats.landing.lat)) w.push({ kind: 'landing', name: labels.landing, t: stats.landing.t, lat: stats.landing.lat, lon: stats.landing.lon, alt: stats.landing.alt });
  for (const m of markers) w.push({ kind: 'marker', name: labels.marker(m.t), t: m.t, lat: m.lat, lon: m.lon, alt: m.alt });
  return w;
}

/** Where the extremes lie (0.9.0): altitude max, ground-speed max, strongest climb and sink – as display points. */
export const EXTREME_KINDS = { alt: { symbol: '◆', color: '#14202e' }, gs: { symbol: '▶', color: '#0f766e' }, up: { symbol: '▲', color: '#1f5fbf' }, down: { symbol: '▼', color: '#c0392b' } };
export function extremePoints(track, series, stats) {
  if (!track || !series || !stats) return [];
  const ps = track.points, t = ps.t, out = [];
  const add = (kind, e) => {
    if (!e || Number.isNaN(e.t)) return;
    const i = indexAt(t, e.t); let p = i; while (p > 0 && !ps.fix[p]) p--;
    if (!ps.fix[p]) return;
    out.push({ kind, ...EXTREME_KINDS[kind], i, t: t[i], lat: ps.lat[p], lon: ps.lon[p], alt: series.altClean[i], dist: series.dist[i], gs: series.gs[i], vsS: series.vs[i], value: e.v, fix: true });
  };
  add('alt', stats.altMax); add('gs', stats.gsMax); add('up', stats.vsMax); add('down', stats.vsMin);
  return out;
}

/** Time-marker interval in minutes: 'auto' = 10 min up to 5 h of flight, 30 min beyond (0.9.0). */
export function markerMinutes(setting, durationSec) {
  if (setting === 'auto' || setting === undefined || setting === null || setting === '') return durationSec > 5 * 3600 ? 30 : 10;
  const n = +setting; return Number.isFinite(n) && n > 0 ? n : (durationSec > 5 * 3600 ? 30 : 10);
}
