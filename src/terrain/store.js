// Terrain along the current track (0.8.0): ≤ 1500 sample positions, ground elevation + water flag,
// cached per position across recomputes; state.terrain = {idx, ground, water, source, waterSource, status}.
// Emits bus 'terrain' whenever the data changes. Nothing here touches the DOM.

import { state, bus } from '../state.js';
import { fetchElevations, fetchWater } from './terrain.js';

const MAX_SAMPLES = 1500;
const groundCache = new Map(), waterCache = new Map();
const key = (lat, lon) => `${lat.toFixed(4)},${lon.toFixed(4)}`;
let running = null, lastTrack = null;

/** Sample indices along the track (fix points only, evenly thinned). */
function sampleIndices(track) {
  const ps = track.points, idx = [];
  let count = 0; for (let i = 0; i < ps.n; i++) if (ps.fix[i]) count++;
  const step = Math.max(1, Math.ceil(count / MAX_SAMPLES));
  let k = 0; for (let i = 0; i < ps.n; i++) { if (!ps.fix[i]) continue; if (k % step === 0) idx.push(i); k++; }
  if (idx.length && idx[idx.length - 1] !== ps.n - 1) { let last = ps.n - 1; while (last > 0 && !ps.fix[last]) last--; if (last !== idx[idx.length - 1]) idx.push(last); }
  return Int32Array.from(idx);
}

/** (Re)load terrain for the current track; no-op when switched off or when the track is unchanged. */
export async function loadTerrain(force = false) {
  const tr = state.track;
  if (!tr || state.settings.terrain === false) { if (state.terrain) { state.terrain = null; bus.emit('terrain'); } return; }
  if (!force && lastTrack === tr && state.terrain && state.terrain.status !== 'error') return;
  lastTrack = tr;
  const idx = sampleIndices(tr), ps = tr.points;
  const pts = Array.from(idx, (i) => ({ lat: ps.lat[i], lon: ps.lon[i] }));
  const ground = new Float32Array(idx.length).fill(NaN), water = new Uint8Array(idx.length);
  const cur = { idx, ground, water, source: '', waterSource: '', status: 'loading', progress: 0 };
  state.terrain = cur; bus.emit('terrain');
  const token = running = {};
  try {
    // elevations: only positions not cached yet
    const need = []; pts.forEach((p, k) => { const g = groundCache.get(key(p.lat, p.lon)); if (g === undefined) need.push(k); else ground[k] = g; });
    if (need.length) {
      const r = await fetchElevations(need.map((k) => pts[k]), (f) => { cur.progress = f * 0.7; bus.emit('terrain'); });
      if (running !== token) return;
      need.forEach((k, j) => { ground[k] = r.ground[j]; groundCache.set(key(pts[k].lat, pts[k].lon), r.ground[j]); });
      cur.source = r.source;
    } else cur.source = 'cache';
    cur.status = 'ground'; bus.emit('terrain');
    // water (best effort)
    try {
      const needW = []; pts.forEach((p, k) => { const w = waterCache.get(key(p.lat, p.lon)); if (w === undefined) needW.push(k); else water[k] = w; });
      if (needW.length) {
        const r = await fetchWater(needW.map((k) => pts[k]), Float32Array.from(needW, (k) => ground[k]), (f) => { cur.progress = 0.7 + f * 0.3; bus.emit('terrain'); });
        if (running !== token) return;
        needW.forEach((k, j) => { water[k] = r.water[j]; waterCache.set(key(pts[k].lat, pts[k].lon), r.water[j]); });
        cur.waterSource = r.source;
      } else cur.waterSource = 'cache';
    } catch (e) { console.warn('water failed:', e && e.message); cur.waterSource = 'none'; for (let k = 0; k < idx.length; k++) if (ground[k] <= 0.5) water[k] = 1; }
    cur.status = 'ready'; cur.progress = 1;
  } catch (e) { console.warn('terrain failed:', e && e.message); cur.status = 'error'; }
  if (running === token) bus.emit('terrain');
}

/** Terrain samples for the profile: [{x, alt, water}] with x = time (ms) or distance (m); ground NaN skipped. */
export function terrainForDisplay(xMode = 'time') {
  const tr = state.terrain, s = state; if (!tr || !s.track || !s.series || tr.status === 'loading') return [];
  const out = [];
  for (let k = 0; k < tr.idx.length; k++) { const i = tr.idx[k]; const g = tr.ground[k]; if (Number.isNaN(g)) continue; out.push({ x: xMode === 'dist' ? s.series.dist[i] : s.track.points.t[i], t: s.track.points.t[i], alt: g, water: tr.water[k] === 1 }); }
  return out;
}

/** Ground elevation at a track index (nearest sample), NaN when unknown – used by the 3D view and the readout. */
export function groundAt(i) {
  const tr = state.terrain; if (!tr || !tr.idx.length) return NaN;
  let lo = 0, hi = tr.idx.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (tr.idx[m] < i) lo = m + 1; else hi = m; }
  const a = lo > 0 && Math.abs(tr.idx[lo - 1] - i) < Math.abs(tr.idx[lo] - i) ? lo - 1 : lo;
  return tr.ground[a];
}

bus.on('track', () => { loadTerrain(); });
