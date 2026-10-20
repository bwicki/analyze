// 3D view (0.8.0, MapLibre GL JS, loaded on first use): tilted map with terrain and relief shading,
// the flight as a "curtain" from the ground up to the flight altitude (fill-extrusion quads, coloured
// like the 2D map, darker at night) with a dark top edge = the altitude profile in space; start/landing
// markers, hover/pin as an amber post. Rotate/tilt with right mouse drag or Ctrl + drag, compass control.

import { LAYERS, NIGHT_HALO } from './map.js';
import { TERRARIUM_URL } from '../terrain/terrain.js';

export const MAPLIBRE = { js: 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js', css: 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css' };

let loader = null;
/** Load MapLibre once (script + stylesheet); resolves with the global. */
export function loadMapLibre() {
  if (globalThis.maplibregl) return Promise.resolve(globalThis.maplibregl);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = MAPLIBRE.css; document.head.appendChild(link);
    const s = document.createElement('script'); s.src = MAPLIBRE.js; s.async = true;
    s.onload = () => (globalThis.maplibregl ? resolve(globalThis.maplibregl) : reject(new Error('maplibre missing')));
    s.onerror = () => { loader = null; reject(new Error('maplibre load failed')); };
    document.head.appendChild(s);
  });
  return loader;
}

const R = 6371000;
/** Offset a position by dx/dy metres (east/north). */
function offset(lat, lon, dx, dy) { return [lon + dx / (R * Math.cos(lat * Math.PI / 180)) * 180 / Math.PI, lat + dy / R * 180 / Math.PI]; }
function darken(hex, f = 0.6) { const n = parseInt(hex.slice(1), 16); const c = (x) => Math.round(x * f).toString(16).padStart(2, '0'); return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`; }

/**
 * Curtain + top-edge features. pts: display points (lat, lon, alt, cls, t, fix, gap); ground(i) → m or NaN.
 * widthM: wall thickness; night(t) → boolean.
 */
export function curtainFeatures(pts, { colors, ground, widthM, night, exag = 1 }) {
  const walls = [], tops = [];
  const g = (q) => { const v = ground ? ground(q) : NaN; return Number.isFinite(v) ? v : NaN; };
  let minAlt = Infinity; for (const q of pts) if (q.fix && !Number.isNaN(q.alt)) minAlt = Math.min(minAlt, q.alt);
  if (!Number.isFinite(minAlt)) minAlt = 0;
  for (let k = 1; k < pts.length; k++) {
    const p = pts[k - 1], q = pts[k];
    if (!p.fix || !q.fix || q.gap || Number.isNaN(p.alt) || Number.isNaN(q.alt)) continue;
    const dLat = (q.lat - p.lat) * Math.PI / 180 * R, dLon = (q.lon - p.lon) * Math.PI / 180 * R * Math.cos(p.lat * Math.PI / 180);
    const len = Math.hypot(dLat, dLon); if (len < 0.5) continue;
    const nx = -dLat / len * widthM / 2, ny = dLon / len * widthM / 2;      // unit normal × half width (east, north)
    const ex = dLon / len * widthM / 2, ey = dLat / len * widthM / 2;        // lengthwise extension so neighbours overlap at turns
    const gp = g(p), gq = g(q);
    const hp = Number.isFinite(gp) ? Math.max(2, p.alt - gp) : Math.max(2, p.alt - minAlt), hq = Number.isFinite(gq) ? Math.max(2, q.alt - gq) : Math.max(2, q.alt - minAlt);
    const h = (hp + hq) / 2 * exag;
    const ring = [offset(p.lat, p.lon, nx - ex, ny - ey), offset(q.lat, q.lon, nx + ex, ny + ey), offset(q.lat, q.lon, -nx + ex, -ny + ey), offset(p.lat, p.lon, -nx - ex, -ny - ey)];
    ring.push(ring[0]);
    const isNight = night ? night(q.t) : false;
    const col = colors[q.cls] || colors[2];
    walls.push({ type: 'Feature', properties: { h, color: isNight ? darken(col) : col, night: isNight ? 1 : 0, t: q.t, alt: q.alt }, geometry: { type: 'Polygon', coordinates: [ring] } });
    const cap = Math.max(4, h * 0.025);
    tops.push({ type: 'Feature', properties: { h, base: Math.max(0, h - cap), color: isNight ? '#0b1420' : '#14202e' }, geometry: { type: 'Polygon', coordinates: [ring] } });
  }
  return { walls: { type: 'FeatureCollection', features: walls }, tops: { type: 'FeatureCollection', features: tops } };
}

/** Track extent in metres (longer side of the bounding box). */
export function extentOf(pts) {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const q of pts) if (q.fix) { minLat = Math.min(minLat, q.lat); maxLat = Math.max(maxLat, q.lat); minLon = Math.min(minLon, q.lon); maxLon = Math.max(maxLon, q.lon); }
  return Math.max(1000, (maxLat - minLat) * Math.PI / 180 * R, (maxLon - minLon) * Math.PI / 180 * R * Math.cos((minLat + maxLat) / 2 * Math.PI / 180));
}
/** Wall thickness from the track extent (looks right at the fitted zoom). */
export function widthForExtent(pts) { return Math.max(25, extentOf(pts) / 700); }
/** Vertical exaggeration so that the highest point above ground reads as ~1/12 of the extent (1 … 50). */
export function autoExaggeration(pts, ground) {
  let maxAgl = 0, minAlt = Infinity;
  for (const q of pts) if (q.fix && !Number.isNaN(q.alt)) minAlt = Math.min(minAlt, q.alt);
  for (const q of pts) { if (!q.fix || Number.isNaN(q.alt)) continue; const g = ground ? ground(q) : NaN; maxAgl = Math.max(maxAgl, q.alt - (Number.isFinite(g) ? g : minAlt)); }
  if (!(maxAgl > 0)) return 1;
  return Math.min(100, Math.max(1, Math.round(extentOf(pts) / 8 / maxAgl)));
}

/** Create the 3D map in container. Resolves with a controller once MapLibre is loaded. */
export async function create3D(container, opts = {}) {
  const ml = await loadMapLibre();
  const rasterSource = (k) => ({ type: 'raster', tiles: [LAYERS[k].url.replace('{s}', 'a')], tileSize: 256, maxzoom: LAYERS[k].maxZoom, attribution: LAYERS[k].attribution });
  let current = opts.layer && LAYERS[opts.layer] ? opts.layer : 'osm';
  const style = {
    version: 8,
    sources: { base: rasterSource(current), dem: { type: 'raster-dem', tiles: [TERRARIUM_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 14, attribution: 'Terrain: Mapzen/AWS' }, walls: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }, tops: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }, marks: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }, pin: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }, hover: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
    layers: [
      { id: 'base', type: 'raster', source: 'base' },
      { id: 'hills', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#4a5a6e' } },
      { id: 'walls', type: 'fill-extrusion', source: 'walls', paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.62, 'fill-extrusion-vertical-gradient': true } },
      { id: 'tops', type: 'fill-extrusion', source: 'tops', paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 1 } },
      { id: 'pin', type: 'fill-extrusion', source: 'pin', paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.95 } },
      { id: 'hover', type: 'fill-extrusion', source: 'hover', paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.95 } },
      { id: 'marks', type: 'circle', source: 'marks', paint: { 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } },
    ],
  };
  const map = new ml.Map({ container, style, center: [8, 47], zoom: 6, pitch: 55, bearing: -15, maxPitch: 80, attributionControl: { compact: true }, antialias: true });
  map.addControl(new ml.NavigationControl({ visualizePitch: true, showZoom: true }), 'top-left');
  map.on('load', () => { try { map.setTerrain({ source: 'dem', exaggeration: 1 }); } catch (e) { console.warn('terrain', e); } });
  map.on('error', (e) => { if (e && e.error && /dem|terrain/i.test(String(e.error.message || ''))) return; });
  let bounds = null, pts = [], width = 100, lastData = null, exag = 1, exagMode = opts.exaggeration === undefined || opts.exaggeration === null || opts.exaggeration === '' ? 'auto' : opts.exaggeration;

  function setLayer(k) { if (!LAYERS[k] || k === current) return; current = k; const src = map.getSource('base'); if (src && src.setTiles) src.setTiles([LAYERS[k].url.replace('{s}', 'a')]); else { map.removeLayer('base'); map.removeSource('base'); map.addSource('base', rasterSource(k)); map.addLayer({ id: 'base', type: 'raster', source: 'base' }, 'hills'); } }
  const applyData = () => {
    if (!lastData) return;
    const d = lastData; pts = d.pts; width = widthForExtent(pts);
    exag = exagMode === 'auto' ? autoExaggeration(pts, d.ground) : +exagMode;
    const nightAt = (t) => d.night.some((iv) => t >= iv.from && t <= iv.to);
    const { walls, tops } = curtainFeatures(pts, { colors: d.colors, ground: d.ground, widthM: width, night: nightAt, exag });
    map.getSource('walls').setData(walls); map.getSource('tops').setData(tops);
    const marks = []; const mk = (p, color) => { if (p && !Number.isNaN(p.lat)) marks.push({ type: 'Feature', properties: { color }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }); };
    mk(d.takeoff, '#1f8a4c'); for (const l of d.intermediate || []) mk(l, '#d98c00'); mk(d.landing, '#c0392b');
    for (const x of d.extremes || []) mk(x, x.color || '#14202e');   // extremes (0.9.0)
    map.getSource('marks').setData({ type: 'FeatureCollection', features: marks });
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const q of pts) if (q.fix) { minLat = Math.min(minLat, q.lat); maxLat = Math.max(maxLat, q.lat); minLon = Math.min(minLon, q.lon); maxLon = Math.max(maxLon, q.lon); }
    bounds = minLat <= maxLat ? [[minLon, minLat], [maxLon, maxLat]] : null;
    opts.onApplied && opts.onApplied();
  };
  /** data: {pts, colors, night, takeoff, landing, intermediate, ground(i)} */
  function setTrack(data, { refit = true } = {}) {
    lastData = data;
    const run = () => { applyData(); if (refit) fit(); };
    if (map.isStyleLoaded()) run(); else map.once('load', run);
  }
  function fit() { if (bounds) map.fitBounds(bounds, { padding: 48, pitch: 55, bearing: map.getBearing(), duration: 0 }); }
  function post(q, color, id) {
    const src = map.getSource(id); if (!src) return;
    if (!q || !q.fix) { src.setData({ type: 'FeatureCollection', features: [] }); return; }
    const g = lastData && lastData.ground ? lastData.ground(q) : NaN;
    const h = (Number.isFinite(g) ? Math.max(5, q.alt - g) : Math.max(5, q.alt - (pts.length ? Math.min(...pts.filter((p) => p.fix).map((p) => p.alt)) : 0))) * exag + width * 0.05;
    const w = width * 1.6; const ring = [offset(q.lat, q.lon, -w / 2, -w / 2), offset(q.lat, q.lon, w / 2, -w / 2), offset(q.lat, q.lon, w / 2, w / 2), offset(q.lat, q.lon, -w / 2, w / 2)]; ring.push(ring[0]);
    src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { h, color }, geometry: { type: 'Polygon', coordinates: [ring] } }] });
  }
  function setHover(q) { post(q, '#f6b03d', 'hover'); }
  function setPinned(q) { post(q, '#1f5fbf', 'pin'); }
  function resize() { map.resize(); }
  function setExaggeration(mode) { exagMode = mode; applyData(); }
  function destroy() { map.remove(); }
  return { map, setLayer, setTrack, setHover, setPinned, fit, resize, destroy, setExaggeration, get layer() { return current; }, get exaggeration() { return exag; } };
}
