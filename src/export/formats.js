// Exports (concept §11): GPX 1.1, GeoJSON, KML (gx:Track for Google Earth) and a normalised CSV.
// Input: the trimmed, downsampled point list from track.js (plain objects), stats and meta.

import { isoUTC } from '../util/format.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const f6 = (v) => (Number.isNaN(v) ? '' : v.toFixed(6));
const f1 = (v) => (Number.isNaN(v) || v === null || v === undefined ? '' : v.toFixed(1));
const f2 = (v) => (Number.isNaN(v) || v === null || v === undefined ? '' : v.toFixed(2));

/**
 * pts: [{t, lat, lon, alt, balt, vs, gs, hdg, fix, gap}] (fix points only for GPX/KML/GeoJSON lines)
 * waypoints: [{name, t, lat, lon, alt, kind}]
 */
export function toGpx({ pts, waypoints = [], name = 'Fahrt', creator = 'analyze.wicki.aero', extensions = true }) {
  const out = [`<?xml version="1.0" encoding="UTF-8"?>`,
    `<gpx version="1.1" creator="${esc(creator)}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:an="https://analyze.wicki.aero/gpx/1">`,
    `<metadata><name>${esc(name)}</name><time>${isoUTC(pts.length ? pts[0].t : Date.now())}</time></metadata>`];
  for (const w of waypoints) out.push(`<wpt lat="${f6(w.lat)}" lon="${f6(w.lon)}">${Number.isNaN(w.alt) ? '' : `<ele>${f1(w.alt)}</ele>`}<time>${isoUTC(w.t)}</time><name>${esc(w.name)}</name><type>${esc(w.kind)}</type></wpt>`);
  out.push(`<trk><name>${esc(name)}</name>`);
  let open = false;
  for (const p of pts) {
    if (!p.fix) continue;
    if (p.gap && open) { out.push('</trkseg>'); open = false; }
    if (!open) { out.push('<trkseg>'); open = true; }
    let ext = '';
    if (extensions) {
      const e = [];
      if (!Number.isNaN(p.vs)) e.push(`<an:vs>${f2(p.vs)}</an:vs>`);
      if (!Number.isNaN(p.gs)) e.push(`<an:gs>${f2(p.gs)}</an:gs>`);
      if (!Number.isNaN(p.balt)) e.push(`<an:palt>${f1(p.balt)}</an:palt>`);
      if (!Number.isNaN(p.hdg)) e.push(`<an:hdg>${f1(p.hdg)}</an:hdg>`);
      if (e.length) ext = `<extensions>${e.join('')}</extensions>`;
    }
    out.push(`<trkpt lat="${f6(p.lat)}" lon="${f6(p.lon)}">${Number.isNaN(p.alt) ? '' : `<ele>${f1(p.alt)}</ele>`}<time>${isoUTC(p.t)}</time>${ext}</trkpt>`);
  }
  if (open) out.push('</trkseg>');
  out.push('</trk></gpx>');
  return out.join('\n');
}

/**
 * GeoJSON FeatureCollection: one LineString per gap-free run and per source segment (coordinates
 * [lon, lat, alt]; times and the sensor series as parallel arrays in properties), points for waypoints.
 * A line that starts a new source segment carries restart:true – readGeoJson() restores the segment
 * boundaries from it, so a saved flight re-opens with the same restart count and warm-up masks.
 */
export function toGeoJson({ pts, waypoints = [], name = 'Fahrt', stats = null, meta = null, full = true }) {
  const lines = []; let cur = null, lastSeg = null;
  const num = (v, d) => (v === null || v === undefined || Number.isNaN(v) ? null : +v.toFixed(d));
  for (const p of pts) {
    if (!p.fix) continue;
    const segChange = lastSeg !== null && p.seg !== undefined && p.seg !== lastSeg;
    if (p.gap || segChange || !cur) { cur = { coords: [], times: [], vs: [], gs: [], palt: [], press: [], hdg: [], batt: [], restart: segChange }; lines.push(cur); }
    lastSeg = p.seg;
    cur.coords.push([+p.lon.toFixed(6), +p.lat.toFixed(6), num(p.alt, 1)]);
    cur.times.push(isoUTC(p.t)); cur.vs.push(num(p.vs, 2)); cur.gs.push(num(p.gs, 2));
    if (full) { cur.palt.push(num(p.balt, 1)); cur.press.push(num(p.press, 2)); cur.hdg.push(num(p.hdg, 1)); cur.batt.push(num(p.batt, 2)); }
  }
  const any = (a) => a.some((v) => v !== null);
  const features = lines.map((l, i) => {
    const props = { kind: 'track', segment: i + 1, restart: l.restart, times: l.times, vs_ms: l.vs, gs_ms: l.gs };
    if (full) { if (any(l.palt)) props.palt_m = l.palt; if (any(l.press)) props.press_hpa = l.press; if (any(l.hdg)) props.hdg_deg = l.hdg; if (any(l.batt)) props.batt_v = l.batt; }
    return { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: l.coords } };
  });
  for (const w of waypoints) features.push({ type: 'Feature', properties: { kind: w.kind, name: w.name, time: isoUTC(w.t) }, geometry: { type: 'Point', coordinates: [+w.lon.toFixed(6), +w.lat.toFixed(6), Number.isNaN(w.alt) ? null : +w.alt.toFixed(1)] } });
  return JSON.stringify({ type: 'FeatureCollection', name, properties: { generator: 'analyze.wicki.aero', created: isoUTC(Date.now()), stats, meta }, features });
}

/** KML with gx:Track (time slider in Google Earth), absolute altitudes, start/landing/event placemarks. */
export function toKml({ pts, waypoints = [], name = 'Fahrt', description = '' }) {
  const out = [`<?xml version="1.0" encoding="UTF-8"?>`,
    `<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><name>${esc(name)}</name><description>${esc(description)}</description>`,
    `<Style id="trk"><LineStyle><color>ffbf5f1f</color><width>3</width></LineStyle><PolyStyle><color>40bf5f1f</color></PolyStyle></Style>`,
    `<Style id="start"><IconStyle><color>ff4c8a1f</color><scale>1.2</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/grn-circle.png</href></Icon></IconStyle></Style>`,
    `<Style id="landing"><IconStyle><color>ff2b39c0</color><scale>1.2</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon></IconStyle></Style>`,
    `<Style id="mark"><IconStyle><scale>0.6</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle><LabelStyle><scale>0.7</scale></LabelStyle></Style>`,
    `<Folder><name>Track</name>`];
  let open = false, k = 0;
  const openSeg = () => { k++; out.push(`<Placemark><name>${esc(name)} ${k}</name><styleUrl>#trk</styleUrl><gx:Track><altitudeMode>absolute</altitudeMode><extrude>1</extrude>`); open = true; };
  const whens = [], coords = [];
  const flush = () => { out.push(whens.map((w) => `<when>${w}</when>`).join('')); out.push(coords.map((c) => `<gx:coord>${c}</gx:coord>`).join('')); out.push('</gx:Track></Placemark>'); whens.length = 0; coords.length = 0; open = false; };
  for (const p of pts) {
    if (!p.fix) continue;
    if (p.gap && open) flush();
    if (!open) openSeg();
    whens.push(isoUTC(p.t)); coords.push(`${f6(p.lon)} ${f6(p.lat)} ${Number.isNaN(p.alt) ? 0 : p.alt.toFixed(1)}`);
  }
  if (open) flush();
  out.push('</Folder><Folder><name>Marker</name>');
  for (const w of waypoints) {
    const style = w.kind === 'takeoff' ? 'start' : w.kind === 'landing' ? 'landing' : 'mark';
    out.push(`<Placemark><name>${esc(w.name)}</name><styleUrl>#${style}</styleUrl><TimeStamp><when>${isoUTC(w.t)}</when></TimeStamp><Point><altitudeMode>absolute</altitudeMode><coordinates>${f6(w.lon)},${f6(w.lat)},${Number.isNaN(w.alt) ? 0 : w.alt.toFixed(1)}</coordinates></Point></Placemark>`);
  }
  out.push('</Folder></Document></kml>');
  return out.join('\n');
}

/** Normalised CSV, SI units, semicolon, UTF-8 with BOM for Excel. */
export function toCsv({ pts }) {
  const head = ['time_utc', 'lat', 'lon', 'alt_gps_m', 'alt_press_m', 'press_hpa', 'vs_ms', 'gs_ms', 'hdg_deg', 'fix', 'gap_before'];
  const rows = [head.join(';')];
  for (const p of pts) rows.push([isoUTC(p.t), f6(p.lat), f6(p.lon), f1(p.alt), f1(p.balt), f2(p.press), f2(p.vs), f2(p.gs), f1(p.hdg), p.fix ? 1 : 0, p.gap ? 1 : 0].join(';'));
  return '﻿' + rows.join('\r\n');
}
