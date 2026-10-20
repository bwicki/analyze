// Minimal Leaflet stand-in for sandbox smoke tests (no tiles). Records fitBounds / panInside calls.
window.__fitCalls = 0; window.__panCalls = [];
const mk = (extra) => ({ addTo() { return this; }, bindTooltip() { return this; }, setLatLng() { return this; }, remove() {}, ...extra });
const L = {
  map(el) {
    const handlers = {}; const layers = new Set();
    return { _el: el, on(ev, fn) { ev.split(' ').forEach((e) => { handlers[e] = fn; }); return this; }, fitBounds() { window.__fitCalls++; }, invalidateSize() {}, remove() { handlers.unload && handlers.unload(); }, latLngToContainerPoint() { return { x: 0, y: 0 }; }, hasLayer(l) { return layers.has(l); }, removeLayer(l) { layers.delete(l); }, addLayer(l) { layers.add(l); }, panInside(ll, o) { window.__panCalls.push([ll, o]); }, setView() { return this; }, panTo() { return this; }, getBounds() { return { pad: () => ({ contains: () => true }) }; }, dragging: { disable() {} }, scrollWheelZoom: { disable() {} }, _h: handlers };
  },
  tileLayer() { return mk({}); }, layerGroup() { return mk({ clearLayers() {} }); }, polyline(pts, o) { window.__polys = (window.__polys || []); window.__polys.push(o || {}); return mk({}); },
  circleMarker() { const m = mk({}); m.addTo = function (target) { if (target && target.addLayer) target.addLayer(this); return this; }; return m; },
  marker(ll, o) { window.__markers = (window.__markers || []); window.__markers.push(o || {}); const m = mk({}); m.addTo = function (target) { if (target && target.addLayer) target.addLayer(this); return this; }; return m; },
  divIcon(o) { return o; },
  latLngBounds(a) { return { isValid: () => a.length > 0 }; },
  control(o) { return { onAdd: null, addTo(map) { const div = this.onAdd(map); const corner = document.createElement('div'); const k = map._el.querySelectorAll('.leaflet-top').length; corner.className = 'leaflet-top ' + (o && o.position === 'topleft' ? 'leaflet-left' : 'leaflet-right'); corner.style.cssText = `position:absolute;top:${10 + 90 * k}px;${o && o.position === 'topleft' ? 'left' : 'right'}:10px;z-index:5`; corner.appendChild(div); map._el.appendChild(corner); return this; } }; },
  DomUtil: { create(tag, cls) { const d = document.createElement(tag); d.className = cls; return d; } },
  DomEvent: { disableClickPropagation() {}, disableScrollPropagation() {} },
};
window.L = L;
