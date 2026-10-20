// Build export files from the current state and hand them to the browser as downloads.

import { state, VERSION } from '../state.js';
import { makeUnits } from '../util/units.js';
import { trackPoints, timeMarkers, waypoints, markerMinutes } from '../process/track.js';
import { toGpx, toGeoJson, toKml, toCsv } from './formats.js';
import { zip } from '../parse/zip.js';
import { t } from '../i18n.js';
import { fmtTimeUTC, fmtDateUTC, fmtDateTimeUTC, fmtDurationHM, fmtBearing, icaoShort } from '../util/format.js';

export function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/** Base file name: 2026-08-28_HB-QWV or 2026-08-28_Fahrt */
export function baseName() {
  const st = state.stats; const d = st && st.takeoff ? new Date(st.takeoff.t) : new Date();
  const date = d.toISOString().slice(0, 10);
  const bal = (state.meta.balloon || '').replace(/[^A-Za-z0-9-]+/g, '') || t('exp.flight');
  return `${date}_${bal}`;
}

function labels() {
  return { takeoff: t('wp.takeoff'), landing: t('wp.landing'), intermediate: t('wp.intermediate'), marker: (ms) => `${fmtTimeUTC(ms)} UTC` };
}

/** Everything an export needs: trimmed points at stepSec, waypoints, name. */
export function exportData(stepSec = 0) {
  const s = state; if (!s.track || !s.stats) return null;
  const pts = trackPoints(s.track, s.series, s.trim, stepSec);
  const markers = timeMarkers(s.track, s.series, s.trim.from, s.trim.to, markerMinutes(s.settings.markerMin, s.stats.durationSec));
  const wps = waypoints(s.stats, markers, labels());
  const name = s.meta.title || `${fmtDateUTC(s.stats.takeoff ? s.stats.takeoff.t : s.trim.from)} ${s.meta.balloon || ''}`.trim();
  return { pts, waypoints: wps, name, stats: summaryForExport(), meta: { ...s.meta } };
}

export function summaryForExport() {
  const st = state.stats; if (!st) return null;
  return { takeoff: st.takeoff && { time: new Date(st.takeoff.t).toISOString(), lat: st.takeoff.lat, lon: st.takeoff.lon, ...(st.takeoff.cut ? { cut: true } : {}) }, landing: st.landing && { time: new Date(st.landing.t).toISOString(), lat: st.landing.lat, lon: st.landing.lon, ...(st.landing.manual ? { manual: true } : st.landing.cut ? { cut: true } : {}) },
    durationSec: Math.round(st.durationSec), landings: st.landings, distanceM: Math.round(st.distanceM), straightM: Math.round(st.straightM), altMaxM: st.altMax && Math.round(st.altMax.v), vsMaxMs: st.vsMax && +st.vsMax.v.toFixed(2), vsMinMs: st.vsMin && +st.vsMin.v.toFixed(2), gsMaxMs: st.gsMax && +st.gsMax.v.toFixed(2), nightSec: Math.round(st.night.totalSec) };
}

export function downloadGpx(stepSec) { const d = exportData(stepSec); if (!d) return; saveBlob(new Blob([toGpx(d)], { type: 'application/gpx+xml' }), `${baseName()}.gpx`); }
export function downloadGeoJson(stepSec) { const d = exportData(stepSec); if (!d) return; saveBlob(new Blob([toGeoJson(d)], { type: 'application/geo+json' }), `${baseName()}.geojson`); }
export function downloadCsv(stepSec) { const d = exportData(stepSec); if (!d) return; saveBlob(new Blob([toCsv(d)], { type: 'text/csv;charset=utf-8' }), `${baseName()}.csv`); }
export async function downloadKmz(stepSec = 10) {
  const d = exportData(stepSec); if (!d) return;
  const kml = toKml({ ...d, description: t('exp.kmlDesc') });
  try {
    const bytes = await zip([{ name: 'doc.kml', data: kml }]);
    saveBlob(new Blob([bytes], { type: 'application/vnd.google-earth.kmz' }), `${baseName()}.kmz`);
  } catch { saveBlob(new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }), `${baseName()}.kml`); }
}
/** Every format in one ZIP: GPX, GeoJSON, KML + KMZ, CSV, key figures (JSON + text), master data, event log, README. */
export async function downloadAllZip(stepSec) {
  const d = exportData(stepSec); if (!d) return;
  const b = baseName(), st = state.stats;
  const kml = toKml({ ...d, description: t('exp.kmlDesc') });
  const entries = [
    { name: `${b}.gpx`, data: toGpx(d) }, { name: `${b}.geojson`, data: toGeoJson(d) }, { name: `${b}.kml`, data: kml },
    { name: `${b}.kmz`, data: await zip([{ name: 'doc.kml', data: kml }]) }, { name: `${b}.csv`, data: toCsv(d) },
    { name: `${b}_kennzahlen.json`, data: JSON.stringify({ app: 'analyze.wicki.aero', version: VERSION, exported: new Date().toISOString(), stepSec, stats: d.stats, places: { ...state.places }, meta: d.meta, ignoredLandings: state.ignoredLandings, trim: { from: new Date(state.trim.from).toISOString(), to: new Date(state.trim.to).toISOString(), auto: state.trim.auto } }, null, 2) },
    { name: `${b}_kennzahlen.txt`, data: summaryText() },
  ];
  if (state.evlog && state.evlog.rows && state.evlog.rows.length) entries.push({ name: `${b}_ereignislog.json`, data: JSON.stringify(state.evlog.rows, null, 2) });
  entries.push({ name: 'README.txt', data: [`analyze.wicki.aero v${VERSION} – ${t('exp.zipReadme')}`, '', `${b}.gpx       GPX 1.1 (${t('exp.fmt.gpx')})`, `${b}.geojson   GeoJSON (${t('exp.fmt.geojson')})`, `${b}.kml/.kmz  Google Earth (${t('exp.fmt.kml')})`, `${b}.csv       CSV (${t('exp.fmt.csv')})`, `${b}_kennzahlen.json/.txt  ${t('exp.fmt.stats')}`, ...(state.evlog && state.evlog.rows && state.evlog.rows.length ? [`${b}_ereignislog.json  ${t('exp.fmt.events')}`] : []), '', `${t('exp.points')}: ${d.pts.length} · ${t('exp.step')}: ${stepSec || t('exp.full')}`, st && st.takeoff ? `${t('st.takeoff')}: ${new Date(st.takeoff.t).toISOString()}` : ''].join('\n') + '\n' });
  const bytes = await zip(entries);
  saveBlob(new Blob([bytes], { type: 'application/zip' }), `${b}_export.zip`);
}

/** Key figures as plain text (same lines as «Tabelle kopieren»). */
export function summaryText() {
  const st = state.stats; if (!st) return '';
  const un = makeUnits(state.settings.units), L = [];
  const place = (k, p) => `${state.places[k] ? state.places[k] + ' ' : ''}${icaoShort(p.lat, p.lon)}`;
  L.push(`${t('st.takeoff')}: ${fmtDateTimeUTC(st.takeoff.t)} ${place('takeoff', st.takeoff)}`);
  if (st.landing) L.push(`${t('st.landingAt')}: ${fmtDateTimeUTC(st.landing.t)} ${place('landing', st.landing)}`);
  else if (st.endFix) L.push(`${t('st.landingAt')}: ${fmtDateTimeUTC(st.endFix.t)} ${icaoShort(st.endFix.lat, st.endFix.lon)} (${t('st.endOfRecording')})`);
  L.push(`${t('st.landings')}: ${st.landings}`, `${t('st.duration')}: ${fmtDurationHM(st.durationSec)}`, `${t('st.distanceLine')}: ${un.dist(st.distanceM)} / ${un.dist(st.straightM)} / ${fmtBearing(st.bearingDeg)}`);
  if (st.altMax) L.push(`${t('st.altMaxGps')}: ${un.alt(st.altMax.v, true)} (${fmtDateTimeUTC(st.altMax.t)})`);
  if (st.baroMax) L.push(`${t('st.altMaxBaro')}: ${un.alt(st.baroMax.v, true)}`);
  L.push(`${t('st.altMean')}: ${un.alt(st.altMean, true)}`);
  if (st.vsMax) L.push(`${t('st.vsMax')}: ${un.vs(st.vsMax.v)} (${fmtDateTimeUTC(st.vsMax.t)})`); if (st.vsMin) L.push(`${t('st.vsMin')}: ${un.vs(st.vsMin.v)} (${fmtDateTimeUTC(st.vsMin.t)})`);
  if (st.gsMax) L.push(`${t('st.gsLine')}: ${un.speed(st.gsMax.v)} / ${un.speed(st.gsMean)}`);
  if (st.accVertMax) L.push(`${t('st.accV')}: ${un.acc(st.accVertMax.v)}`);
  if (st.touchdown.length) L.push(`${t('st.touchdown')}: ${st.touchdown.map((x) => un.vs(x.vs)).join(' / ')}`);
  L.push(`${t('st.nightLine')}: ${fmtDurationHM(st.night.totalSec)}${st.night.intervals.length ? ' (' + st.night.intervals.map((iv) => `${fmtTimeUTC(iv.from)}–${fmtTimeUTC(iv.to)} UTC`).join(', ') + ')' : ''}`);
  L.push(`${t('st.segments')}: ${state.track.segments.length} / ${st.restarts}`);
  return L.join('\n').replace(/\u00a0/g, ' ') + '\n';
}

/** Estimated sizes (bytes) for the export page. */
export function estimateSizes(stepSec) {
  const d = exportData(stepSec); if (!d) return null;
  const n = d.pts.length;
  return { points: n, gpx: n * 150, geojson: n * 70, kmz: n * 20, csv: n * 95 };
}
