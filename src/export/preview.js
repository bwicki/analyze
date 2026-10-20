// Link-preview image (0.8.4): a 1200×630 JPEG of the flight – map tiles of the chosen layer, the track
// coloured by vario, launch/landing markers and a caption – rendered in the browser when a flight is saved
// and uploaded to the Worker (previews/<id>.jpg in R2). Messengers show it next to the short link
// (og:image of the page v/<id>). Tiles are fetched with CORS (OSM, OpenTopoMap, Esri all allow it);
// if the chosen layer fails the OSM layer is tried, and without any tiles a plain background is used.

import { state } from '../state.js';
import { trackPoints } from '../process/track.js';
import { movingMean } from '../process/series.js';
import { VARIO_COLORS, varioClass, LAYERS } from '../ui/map.js';
import { fmtDateUTC, fmtTimeUTC, fmtDurationHM } from '../util/format.js';
import { makeUnits } from '../util/units.js';
import { t } from '../i18n.js';

export const PREVIEW_W = 1200, PREVIEW_H = 630, PREVIEW_MAX_BYTES = 280 * 1024;   // WhatsApp wants < 300 KB
const TILE = 256, PAD = 56, CAPTION_H = 64;

const lon2x = (lon, z) => (lon + 180) / 360 * TILE * 2 ** z;
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * TILE * 2 ** z; };

/**
 * Exact (fractional) fit of the bounds into the map area above the caption: zf = fractional zoom, tiles are
 * drawn at the integer zoom zt = ceil(zf) and scaled by s = 2^(zf − zt) ≤ 1 – so the flight fills the picture
 * up to the padding instead of the next integer zoom leaving it small. left/top are world pixels at zt.
 */
export function fitView(bounds, w = PREVIEW_W, h = PREVIEW_H - CAPTION_H, maxZoom = 16) {
  const aw = w - 2 * PAD, ah = h - 2 * PAD;
  const dx0 = Math.max(1e-9, lon2x(bounds.east, 0) - lon2x(bounds.west, 0)), dy0 = Math.max(1e-9, lat2y(bounds.south, 0) - lat2y(bounds.north, 0));
  const zf = Math.max(1, Math.min(maxZoom, Math.log2(aw / dx0), Math.log2(ah / dy0)));
  const zt = Math.min(maxZoom, Math.ceil(zf)), s = 2 ** (zf - zt);
  const cx = (lon2x(bounds.east, zt) + lon2x(bounds.west, zt)) / 2, cy = (lat2y(bounds.south, zt) + lat2y(bounds.north, zt)) / 2;
  return { z: zt, zf, s, left: cx - w / 2 / s, top: cy - h / 2 / s, w, h };
}

/** Everything the renderer needs from the current analysis (pure; testable without a DOM). */
export function previewData(flightTitle = '') {
  const s = state; if (!s.track || !s.stats) return null;
  const dur = (s.trim.to - s.trim.from) / 1000, step = Math.max(1, Math.ceil(dur / 1500));
  const pts = trackPoints(s.track, s.series, s.trim, step).filter((q) => q.fix);
  if (pts.length < 2) return null;
  const vsS = movingMean(s.track.points.t, s.series.vs, Math.max(45, step));
  for (const q of pts) q.cls = varioClass(vsS[q.i]);
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const q of pts) { if (q.lon < west) west = q.lon; if (q.lon > east) east = q.lon; if (q.lat < south) south = q.lat; if (q.lat > north) north = q.lat; }
  const pad = Math.max(0.01, (east - west) * 0.03, (north - south) * 0.03);
  const st = s.stats, un = makeUnits(s.settings.units);
  const line = [fmtDurationHM(st.durationSec), un.dist(st.distanceM), st.takeoff ? `${t('wp.takeoff')} ${fmtTimeUTC(st.takeoff.t)} UTC` : '', st.landing ? `${t('wp.landing')} ${fmtTimeUTC(st.landing.t)} UTC` : ''].filter(Boolean).join(' · ');
  const title = `${flightTitle || ''}${st.takeoff && s.meta.title ? ` · ${fmtDateUTC(st.takeoff.t)}` : ''}`;
  return { pts, bounds: { west: west - pad, east: east + pad, south: south - pad, north: north + pad }, takeoff: st.takeoff, landing: st.landing, intermediate: st.intermediate, title, line, layer: LAYERS[s.settings.mapLayer] ? s.settings.mapLayer : 'osm' };
}

async function fetchTile(url) {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`tile ${res.status}`);
  return createImageBitmap(await res.blob());
}

/** Draw the tiles of one layer into ctx; resolves false when any tile failed (caller falls back). */
async function drawTiles(ctx, view, layerKey) {
  const layer = LAYERS[layerKey]; const z = view.z, n = 2 ** z, s = view.s;
  const x0 = Math.floor(view.left / TILE), x1 = Math.floor((view.left + view.w / s) / TILE), y0 = Math.max(0, Math.floor(view.top / TILE)), y1 = Math.min(n - 1, Math.floor((view.top + view.h / s) / TILE));
  const jobs = [];
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const wx = ((tx % n) + n) % n, sub = 'abc'[(tx + ty) % 3];
    const url = layer.url.replace('{z}', z).replace('{x}', wx).replace('{y}', ty).replace('{s}', sub);
    jobs.push(fetchTile(url).then((img) => { ctx.drawImage(img, (tx * TILE - view.left) * s, (ty * TILE - view.top) * s, TILE * s + 0.5, TILE * s + 0.5); img.close && img.close(); }));
  }
  const res = await Promise.allSettled(jobs);
  return res.every((r) => r.status === 'fulfilled');
}

/** Render the preview; returns a JPEG Blob (or null when nothing can be drawn). */
export async function renderPreview(data, { canvasFactory = null } = {}) {
  if (!data || typeof document === 'undefined') return null;
  const W = PREVIEW_W, H = PREVIEW_H, MAPH = H - CAPTION_H;
  const canvas = canvasFactory ? canvasFactory(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d');
  let layer = data.layer, ok = false;
  let view = fitView(data.bounds, W, MAPH, LAYERS[layer].maxZoom || 19);
  ctx.fillStyle = '#e9eef3'; ctx.fillRect(0, 0, W, H);
  try { ok = await drawTiles(ctx, view, layer); } catch { ok = false; }
  if (!ok && layer !== 'osm') { ctx.fillStyle = '#e9eef3'; ctx.fillRect(0, 0, W, MAPH); layer = 'osm'; view = fitView(data.bounds, W, MAPH, LAYERS.osm.maxZoom || 19); try { ok = await drawTiles(ctx, view, 'osm'); } catch { ok = false; } }
  const z = view.z, sc = view.s;
  const X = (lon) => (lon2x(lon, z) - view.left) * sc, Y = (lat) => (lat2y(lat, z) - view.top) * sc;
  if (data.layer === 'sat' && ok) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, 0, W, MAPH); }   // tone the imagery down a little
  // track: white halo, then runs coloured by vario class
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const runs = []; let run = null;
  for (const q of data.pts) { if (!run || q.gap || q.cls !== run.cls) { run = { cls: q.cls, pts: run && !q.gap ? [run.pts[run.pts.length - 1]] : [] }; runs.push(run); } run.pts.push([X(q.lon), Y(q.lat)]); }
  for (const pass of [0, 1]) for (const r of runs) {
    if (r.pts.length < 2) continue;
    ctx.beginPath(); ctx.moveTo(r.pts[0][0], r.pts[0][1]); for (let k = 1; k < r.pts.length; k++) ctx.lineTo(r.pts[k][0], r.pts[k][1]);
    if (pass === 0) { ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 7; } else { ctx.strokeStyle = VARIO_COLORS[r.cls] || '#1f5fbf'; ctx.lineWidth = 3.5; }
    ctx.stroke();
  }
  const dot = (p, color, r = 9) => { if (!p || Number.isNaN(p.lat)) return; ctx.beginPath(); ctx.arc(X(p.lon), Y(p.lat), r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); };
  for (const l of data.intermediate || []) dot(l, '#d98c00', 7);
  dot(data.takeoff, '#1f8a4c'); dot(data.landing, '#c0392b');
  // attribution (OSM/ODbL requires it) and caption bar
  ctx.font = '13px IBM Plex Sans, system-ui, sans-serif'; ctx.textBaseline = 'bottom';
  const attr = LAYERS[layer].attribution.replace(/<[^>]+>/g, '');
  const aw = ctx.measureText(attr).width + 12; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(W - aw, MAPH - 20, aw, 20); ctx.fillStyle = '#5b6b7f'; ctx.textAlign = 'right'; ctx.fillText(attr, W - 6, MAPH - 3);
  ctx.fillStyle = '#14202e'; ctx.fillRect(0, MAPH, W, CAPTION_H);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = '600 24px IBM Plex Sans, system-ui, sans-serif'; ctx.fillText(fitText(ctx, data.title, W - 48), 24, MAPH + 22);
  ctx.font = '16px IBM Plex Sans, system-ui, sans-serif'; ctx.fillStyle = '#c9d3df'; ctx.fillText(fitText(ctx, data.line, W - 48), 24, MAPH + 46);
  ctx.textAlign = 'right'; ctx.fillStyle = '#8fb6e6'; ctx.font = '600 15px IBM Plex Sans, system-ui, sans-serif'; ctx.fillText('analyze.wicki.aero', W - 24, MAPH + 46);
  // JPEG under the messenger limit
  for (const q of [0.82, 0.7, 0.58, 0.45]) { const blob = await toBlob(canvas, q); if (blob && blob.size <= PREVIEW_MAX_BYTES) return blob; if (q === 0.45) return blob; }
  return null;
}

function fitText(ctx, s, maxW) { let out = s || ''; while (out.length > 4 && ctx.measureText(out).width > maxW) out = out.slice(0, -2).trimEnd() + '…'; return out; }
function toBlob(canvas, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}
