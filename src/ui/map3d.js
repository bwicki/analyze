// 3D view (0.8.0, MapLibre GL JS, loaded on first use): tilted map with terrain and relief shading,
// the flight as a "curtain" from the ground up to the flight altitude (fill-extrusion quads, coloured
// like the 2D map, darker at night) with a dark top edge = the altitude profile in space; start/landing
// markers, hover/pin as an amber post. Rotate/tilt with right mouse drag or Ctrl + drag, compass control.

import { LAYERS, NIGHT_HALO, extremeHtml } from './map.js';
import { TERRARIUM_URL } from '../terrain/terrain.js';

const EXPAND_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';

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
const FIT_PITCH = 55, FIT_PAD = 36;
/**
 * Bearing of the 3D view for a track (0.9.2): the main axis of the fixes (principal component) runs from left to
 * right, start on the left. A track that is not elongated (ratio of the axes < 1.4) keeps north up.
 */
export function autoBearing(fixes) {
  const n = fixes.length; if (n < 2) return 0;
  let lat0 = 0, lon0 = 0; for (const q of fixes) { lat0 += q.lat; lon0 += q.lon; } lat0 /= n; lon0 /= n;
  const kx = Math.PI / 180 * R * Math.cos(lat0 * Math.PI / 180), ky = Math.PI / 180 * R;
  let sxx = 0, syy = 0, sxy = 0;
  for (const q of fixes) { const x = (q.lon - lon0) * kx, y = (q.lat - lat0) * ky; sxx += x * x; syy += y * y; sxy += x * y; }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(1e-9, tr / 2 - disc);
  if (!(l1 > 0) || Math.sqrt(l1 / l2) < 1.4) return 0;
  const phi = 0.5 * Math.atan2(2 * sxy, sxx - syy);                 // main axis, angle from east (counter-clockwise)
  const ax = Math.cos(phi), ay = Math.sin(phi);
  const dx = (fixes[n - 1].lon - fixes[0].lon) * kx, dy = (fixes[n - 1].lat - fixes[0].lat) * ky;
  const flip = dx * ax + dy * ay < 0 ? 180 : 0;                      // the end of the flight lies ahead
  const compass = (90 - phi * 180 / Math.PI + flip + 360) % 360;      // direction of the axis as a compass course
  let b = compass - 90; while (b > 180) b -= 360; while (b <= -180) b += 360;   // screen-right = that course
  return b;
}
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
  // under the navigation control: ⤢ fits the whole flight again (0.9.2), the second button opens the view large (0.9.1)
  map.addControl({ onAdd() {
    const c = document.createElement('div'); c.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    const mkBtn = (cls, title, html, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.title = title; b.setAttribute('aria-label', title); b.innerHTML = html; b.addEventListener('click', fn); c.appendChild(b); };
    mkBtn('fit3d', opts.fitLabel || 'Fit', '<span style="font-size:18px;line-height:1">⤢</span>', () => fit());
    if (opts.onExpand) mkBtn('xp3d', opts.expandLabel || 'Expand', EXPAND_SVG, () => opts.onExpand());
    this._c = c; return c;
  }, onRemove() { this._c && this._c.remove(); } }, 'top-left');
  let xMarkers = [];   // extreme-value symbols as DOM markers (same glyph as 2D map and figures)
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
    map.getSource('marks').setData({ type: 'FeatureCollection', features: marks });
    // extremes (0.9.0 / 0.9.1): ◆ ▶ ▲ ▼ as DOM markers – identical to the symbols in the figures and the 2D map
    xMarkers.forEach((m) => m.remove()); xMarkers = [];
    for (const x of d.extremes || []) {
      if (Number.isNaN(x.lat)) continue;
      const el = document.createElement('div'); el.className = 'xmark xmark3d'; el.innerHTML = extremeHtml(x); el.title = x.label || '';
      if (d.onExtreme) el.addEventListener('click', (e) => { e.stopPropagation(); d.onExtreme(x); });
      xMarkers.push(new ml.Marker({ element: el, anchor: 'center' }).setLngLat([x.lon, x.lat]).addTo(map));
    }
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
  /**
   * Fit (0.9.2): the flight fills the view. Bearing along the main axis of the track (start left, end right;
   * north-up when the track is not elongated), then the zoom is refined iteratively on the projected points –
   * ground positions and the tops of the curtain – until they span the viewport minus the padding. MapLibre's
   * fitBounds only fits the geographic box at pitch 0, which leaves a diagonal flight small in the middle.
   */
  function fit() {
    if (!bounds || !pts.length) return;
    const W = container.clientWidth, H = container.clientHeight; if (!(W > 0) || !(H > 0)) return;
    const fixes = pts.filter((q) => q.fix && !Number.isNaN(q.lat));
    if (fixes.length < 2) { map.jumpTo({ center: [fixes[0] ? fixes[0].lon : bounds[0][0], fixes[0] ? fixes[0].lat : bounds[0][1]], zoom: 11, pitch: FIT_PITCH, bearing: 0 }); return; }
    const step = Math.max(1, Math.floor(fixes.length / 400));
    const sample = fixes.filter((q, k) => k % step === 0 || k === fixes.length - 1);
    const bearing = autoBearing(fixes);
    let minAlt = Infinity; for (const q of fixes) if (!Number.isNaN(q.alt)) minAlt = Math.min(minAlt, q.alt);
    const hOf = (q) => { if (Number.isNaN(q.alt)) return 0; const g = lastData && lastData.ground ? lastData.ground(q) : NaN; return Math.max(2, q.alt - (Number.isFinite(g) ? g : (Number.isFinite(minAlt) ? minAlt : 0))) * exag; };
    const sinP = Math.sin(FIT_PITCH * Math.PI / 180);
    let center = { lng: (bounds[0][0] + bounds[1][0]) / 2, lat: (bounds[0][1] + bounds[1][1]) / 2 }, zoom = 8;
    try { const cam = map.cameraForBounds(bounds, { padding: FIT_PAD, bearing, pitch: 0 }); if (cam && Number.isFinite(cam.zoom)) { zoom = cam.zoom; if (cam.center) center = cam.center; } } catch { /* keep the guess */ }
    for (let it = 0; it < 5; it++) {
      map.jumpTo({ center, zoom, bearing, pitch: FIT_PITCH });
      const c = map.project([center.lng, center.lat]), c2 = map.project([center.lng + 0.001, center.lat]);
      const ppm = Math.hypot(c2.x - c.x, c2.y - c.y) / (0.001 * Math.PI / 180 * R * Math.cos(center.lat * Math.PI / 180));   // pixels per metre at the centre
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, gy0 = Infinity, gy1 = -Infinity;
      for (const q of sample) {
        const p = map.project([q.lon, q.lat]); if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const top = p.y - hOf(q) * ppm * sinP;
        if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; if (p.y < gy0) gy0 = p.y; if (p.y > gy1) gy1 = p.y; if (top < y0) y0 = top;
      }
      const bw = x1 - x0, bh = y1 - y0; if (!(bw > 0) || !(bh > 0)) break;
      const s = Math.min((W - 2 * FIT_PAD) / bw, (H - 2 * FIT_PAD) / bh);
      // shift so that the box sits in the middle: the ground point now under the box centre becomes the centre
      const cx = (x0 + x1) / 2, cy = Math.min((y0 + y1) / 2, gy1 - 1);
      try { const ll = map.unproject([cx, cy]); if (ll && Number.isFinite(ll.lng) && Math.abs(ll.lat - center.lat) < 20 && Math.abs(ll.lng - center.lng) < 40) center = { lng: ll.lng, lat: ll.lat }; } catch { /* above the horizon */ }
      zoom = Math.max(1, Math.min(18, zoom + Math.log2(s)));
      if (Math.abs(Math.log2(s)) < 0.01 && it > 0) break;
    }
    map.jumpTo({ center, zoom, bearing, pitch: FIT_PITCH });
  }
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
  function destroy() { xMarkers.forEach((m) => m.remove()); xMarkers = []; map.remove(); }
  return { map, setLayer, setTrack, setHover, setPinned, fit, resize, destroy, setExaggeration, get layer() { return current; }, get exaggeration() { return exag; }, get points() { return pts; } };
}
