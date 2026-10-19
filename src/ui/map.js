// Leaflet map wrapper: track coloured by vario or altitude, night runs darker, gaps dashed,
// time markers, start/landing, hover marker synchronised with the profile.

import { fmtTimeUTC, fmtDayUTC } from '../util/format.js';

export const LAYERS = {
  osm: { name: 'OSM', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 },
  topo: { name: 'Topo', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap, SRTM · © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)', maxZoom: 17 },
  sat: { name: 'Sat', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles © Esri', maxZoom: 19 },
};

export const VARIO_COLORS = ['#c0392b', '#e39b92', '#8b98a8', '#8fb6e6', '#1f5fbf'];
export const VARIO_LIMITS = [-0.5, -0.15, 0.15, 0.5];
export function varioClass(v) { if (Number.isNaN(v)) return 2; if (v <= VARIO_LIMITS[0]) return 0; if (v <= VARIO_LIMITS[1]) return 1; if (v < VARIO_LIMITS[2]) return 2; if (v < VARIO_LIMITS[3]) return 3; return 4; }
export const ALT_COLORS = ['#c9dcf7', '#8fb6e6', '#4f86d6', '#1f5fbf', '#0f3570'];
export function altClass(a, min, max) { if (Number.isNaN(a) || max <= min) return 2; return Math.min(4, Math.max(0, Math.floor((a - min) / (max - min) * 5))); }

export function createMap(container, opts = {}) {
  if (typeof L === 'undefined') { container.innerHTML = '<div class="muted" style="padding:20px">Leaflet not loaded</div>'; return null; }
  const map = L.map(container, { zoomControl: true, preferCanvas: true });
  const layers = Object.fromEntries(Object.entries(LAYERS).map(([k, v]) => [k, L.tileLayer(v.url, { attribution: v.attribution, maxZoom: v.maxZoom, subdomains: 'abc' })]));
  let current = opts.layer && layers[opts.layer] ? opts.layer : 'osm';
  layers[current].addTo(map);
  const trackLayer = L.layerGroup().addTo(map), markerLayer = L.layerGroup().addTo(map);
  const hoverDot = L.circleMarker([0, 0], { radius: 6, color: '#14202e', weight: 1.5, fillColor: '#f6b03d', fillOpacity: 1 });
  const pinDot = L.circleMarker([0, 0], { radius: 8, color: '#1f5fbf', weight: 3, fillColor: '#fff', fillOpacity: 1 });
  let pts = [], hoverCb = null, clickCb = null, lastHover = -1, bounds = null;

  const nearest = (latlng, maxPx) => {
    const p = map.latLngToContainerPoint(latlng); let best = -1, bd = maxPx * maxPx;
    for (let i = 0; i < pts.length; i++) { const q = pts[i]; if (!q.fix || q._px === undefined) continue; const dx = q._px.x - p.x, dy = q._px.y - p.y, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
    return best;
  };
  map.on('mousemove', (e) => {
    if (!pts.length || !hoverCb) return;
    const best = nearest(e.latlng, 14);
    if (best !== lastHover) { lastHover = best; hoverCb(best >= 0 ? pts[best] : null); }
  });
  // click on (or near) the track pins the point – the profile shows the same moment (and vice versa)
  map.on('click', (e) => {
    if (!pts.length || !clickCb) return;
    const best = nearest(e.latlng, 24);
    clickCb(best >= 0 ? pts[best] : null);
  });
  map.on('moveend zoomend', () => project());
  function project() { for (const q of pts) if (q.fix) q._px = map.latLngToContainerPoint([q.lat, q.lon]); }
  // × on an intermediate-landing label removes that landing (false touchdown)
  container.addEventListener('click', (e) => { const x = e.target.closest('[data-ignore]'); if (x && ignoreCb) { e.stopPropagation(); ignoreCb(+x.dataset.ignore); } });
  let ignoreCb = null;

  function setLayer(k) { if (!layers[k] || k === current) return; map.removeLayer(layers[current]); current = k; layers[k].addTo(map); }

  /**
   * data: {pts (display points with .cls colour class), colors, night: [{from,to}], markers, takeoff, landing, labelEvery}
   */
  function setTrack(data) {
    pts = data.pts; trackLayer.clearLayers(); markerLayer.clearLayers();
    const nightAt = (t) => data.night.some((iv) => t >= iv.from && t <= iv.to);
    // runs of same colour class; gaps as dashed grey lines
    let run = [], runCls = -1, runNight = false, prev = null;
    const flush = () => { if (run.length > 1) L.polyline(run, { color: runNight ? darken(data.colors[runCls]) : data.colors[runCls], weight: runNight ? 3.5 : 3, opacity: 1, lineJoin: 'round' }).addTo(trackLayer); };
    for (const q of pts) {
      if (!q.fix) continue;
      const cls = q.cls, nt = nightAt(q.t);
      if (q.gap && prev) { flush(); L.polyline([[prev.lat, prev.lon], [q.lat, q.lon]], { color: '#9aa7b6', weight: 2, dashArray: '6 6' }).addTo(trackLayer); run = []; }
      if (cls !== runCls || nt !== runNight) { flush(); run = prev && !q.gap ? [[prev.lat, prev.lon]] : []; runCls = cls; runNight = nt; }
      run.push([q.lat, q.lon]); prev = q;
    }
    flush();
    // time markers
    const every = data.labelEvery || 1;
    data.markers.forEach((m, k) => {
      const major = k % every === 0;
      const c = L.circleMarker([m.lat, m.lon], { radius: major ? 4.5 : 3, color: '#14202e', weight: 1.5, fillColor: '#fff', fillOpacity: 1 }).addTo(markerLayer);
      c.bindTooltip(`${fmtTimeUTC(m.t)}`, { permanent: major, direction: 'right', className: 'tm', offset: [6, 0] });
    });
    const big = (p, color, label, html = false) => { if (!p || Number.isNaN(p.lat)) return; L.circleMarker([p.lat, p.lon], { radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(markerLayer).bindTooltip(label, { permanent: true, direction: 'bottom', offset: [0, 8], interactive: html, className: html ? 'tt-inter' : '' }); };
    big(data.takeoff, '#1f8a4c', data.takeoffLabel);
    ignoreCb = data.onIgnoreIntermediate || null;
    for (const l of data.intermediate || []) {
      const lab = ignoreCb && l.t ? `${escHtml(data.intermediateLabel)}${l.name ? ' · ' + escHtml(l.name) : ''}<button type="button" class="tt-x" data-ignore="${l.t}" title="${escHtml(data.ignoreLabel || '')}">×</button>` : `${data.intermediateLabel}${l.name ? ' · ' + l.name : ''}`;
      big(l, '#d98c00', lab, !!(ignoreCb && l.t));
    }
    big(data.landing, '#c0392b', data.landingLabel);
    for (const e of data.events || []) L.circleMarker([e.lat, e.lon], { radius: 5, color: e.color || '#1f5fbf', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(markerLayer).bindTooltip(e.label);
    const fixed = pts.filter((q) => q.fix);
    bounds = fixed.length ? L.latLngBounds(fixed.map((q) => [q.lat, q.lon])) : null;
    fit();
    setTimeout(project, 50);
  }
  /** Whole flight in view (also after the container got its real size). */
  function fit() { if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28] }); }
  function setHover(q) { if (!q || !q.fix) { if (map.hasLayer(hoverDot)) map.removeLayer(hoverDot); return; } hoverDot.setLatLng([q.lat, q.lon]); if (!map.hasLayer(hoverDot)) hoverDot.addTo(map); }
  function setPinned(q) { if (!q || !q.fix) { if (map.hasLayer(pinDot)) map.removeLayer(pinDot); return; } pinDot.setLatLng([q.lat, q.lon]); if (!map.hasLayer(pinDot)) pinDot.addTo(map); }
  function onHover(cb) { hoverCb = cb; }
  function onClick(cb) { clickCb = cb; }
  function invalidate() { map.invalidateSize(); fit(); project(); }
  function destroy() { map.remove(); }
  return { map, setLayer, setTrack, setHover, setPinned, onHover, onClick, invalidate, fit, destroy, get layer() { return current; } };
}
function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function darken(hex) {
  const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (x) => Math.round(x * 0.55).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}
