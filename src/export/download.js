// Build export files from the current state and hand them to the browser as downloads.

import { state } from '../state.js';
import { trackPoints, timeMarkers, waypoints } from '../process/track.js';
import { toGpx, toGeoJson, toKml, toCsv } from './formats.js';
import { zip } from '../parse/zip.js';
import { t } from '../i18n.js';
import { fmtTimeUTC, fmtDateUTC } from '../util/format.js';

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
  const markers = timeMarkers(s.track, s.series, s.trim.from, s.trim.to, s.settings.markerMin);
  const wps = waypoints(s.stats, markers, labels());
  const name = s.meta.title || `${fmtDateUTC(s.stats.takeoff ? s.stats.takeoff.t : s.trim.from)} ${s.meta.balloon || ''}`.trim();
  return { pts, waypoints: wps, name, stats: summaryForExport(), meta: { ...s.meta } };
}

export function summaryForExport() {
  const st = state.stats; if (!st) return null;
  return { takeoff: st.takeoff && { time: new Date(st.takeoff.t).toISOString(), lat: st.takeoff.lat, lon: st.takeoff.lon }, landing: st.landing && { time: new Date(st.landing.t).toISOString(), lat: st.landing.lat, lon: st.landing.lon },
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
export async function downloadAllZip(stepSec) {
  const d = exportData(stepSec); if (!d) return;
  const b = baseName();
  const entries = [
    { name: `${b}.gpx`, data: toGpx(d) }, { name: `${b}.geojson`, data: toGeoJson(d) }, { name: `${b}.kml`, data: toKml({ ...d, description: t('exp.kmlDesc') }) }, { name: `${b}.csv`, data: toCsv(d) },
  ];
  const bytes = await zip(entries);
  saveBlob(new Blob([bytes], { type: 'application/zip' }), `${b}_export.zip`);
}

/** Estimated sizes (bytes) for the export page. */
export function estimateSizes(stepSec) {
  const d = exportData(stepSec); if (!d) return null;
  const n = d.pts.length;
  return { points: n, gpx: n * 150, geojson: n * 70, kmz: n * 20, csv: n * 95 };
}
