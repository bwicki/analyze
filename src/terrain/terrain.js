// Ground elevation and water along the track (0.8.0). Sources, all free and without keys:
//   1. Terrarium DEM tiles (AWS elevation-tiles-prod, Mapzen/SRTM/… mosaic) – decoded in the browser
//   2. open-meteo elevation API (Copernicus DEM 90 m) as fallback when tiles cannot be fetched
//   Water: sea = elevation ≤ 0 from the DEM; lakes/rivers = water polygons of OpenFreeMap vector tiles
//   (OpenMapTiles schema, layer "water").
// Pure helpers (tile math, decoding) are exported for tests; fetching needs a browser.

import { parseTile, insideFeature } from './mvt.js';

export const TERRARIUM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/elevation';
export const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet';

const rad = (d) => d * Math.PI / 180;
export function tileXY(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor((lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2 * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}
/** Sub-tile pixel position (0..size) of a coordinate. */
export function pixelInTile(lat, lon, z, size = 256) {
  const n = 2 ** z;
  const fx = (lon + 180) / 360 * n, fy = (1 - Math.log(Math.tan(rad(lat)) + 1 / Math.cos(rad(lat))) / Math.PI) / 2 * n;
  const x = Math.floor(fx), y = Math.floor(fy);
  return { x, y, px: Math.min(size - 1, Math.floor((fx - x) * size)), py: Math.min(size - 1, Math.floor((fy - y) * size)), fx: (fx - x) * size, fy: (fy - y) * size };
}
/** Highest zoom (≤ 12) at which the bbox needs at most ~48 tiles. */
export function pickZoom(bbox, maxTiles = 48) {
  for (let z = 12; z > 4; z--) {
    const a = tileXY(bbox.maxLat, bbox.minLon, z), b = tileXY(bbox.minLat, bbox.maxLon, z);
    if ((b.x - a.x + 1) * (b.y - a.y + 1) <= maxTiles) return z;
  }
  return 5;
}
export const decodeTerrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;

const bboxOf = (pts) => pts.reduce((o, p) => ({ minLat: Math.min(o.minLat, p.lat), maxLat: Math.max(o.maxLat, p.lat), minLon: Math.min(o.minLon, p.lon), maxLon: Math.max(o.maxLon, p.lon) }), { minLat: 90, maxLat: -90, minLon: 180, maxLon: -180 });

// ---- raster DEM tiles
const demCache = new Map();   // "z/x/y" → ImageData | null
async function demTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (demCache.has(key)) return demCache.get(key);
  const p = (async () => {
    const res = await fetch(TERRARIUM_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y), { mode: 'cors' });
    if (!res.ok) throw new Error(`dem ${res.status}`);
    const bmp = await createImageBitmap(await res.blob());
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
    const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, bmp.width, bmp.height);
  })();
  demCache.set(key, p);
  p.catch(() => demCache.delete(key));
  return p;
}
async function elevationsFromTiles(pts, z, onProgress) {
  const out = new Float32Array(pts.length).fill(NaN);
  const groups = new Map();
  pts.forEach((p, i) => { const t = pixelInTile(p.lat, p.lon, z, 256); const k = `${z}/${t.x}/${t.y}`; if (!groups.has(k)) groups.set(k, { x: t.x, y: t.y, items: [] }); groups.get(k).items.push([i, t.px, t.py]); });
  let done = 0;
  // a few tiles in parallel
  const keys = [...groups.keys()];
  for (let b = 0; b < keys.length; b += 6) {
    await Promise.all(keys.slice(b, b + 6).map(async (k) => {
      const g = groups.get(k);
      const img = await demTile(z, g.x, g.y);
      for (const [i, px, py] of g.items) { const o = (py * img.width + px) * 4; out[i] = decodeTerrarium(img.data[o], img.data[o + 1], img.data[o + 2]); }
      done++; onProgress && onProgress(done / keys.length);
    }));
  }
  return out;
}
// ---- open-meteo fallback (100 coordinates per call)
async function elevationsFromOpenMeteo(pts, onProgress) {
  const out = new Float32Array(pts.length).fill(NaN);
  for (let b = 0; b < pts.length; b += 100) {
    const chunk = pts.slice(b, b + 100);
    const url = `${OPEN_METEO_URL}?latitude=${chunk.map((p) => p.lat.toFixed(5)).join(',')}&longitude=${chunk.map((p) => p.lon.toFixed(5)).join(',')}`;
    const res = await fetch(url); if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const j = await res.json(); (j.elevation || []).forEach((e, k) => { out[b + k] = e; });
    onProgress && onProgress(Math.min(1, (b + 100) / pts.length));
  }
  return out;
}

/**
 * Ground elevation (m) for positions. Returns {ground: Float32Array, source: 'terrarium'|'open-meteo', zoom}.
 */
export async function fetchElevations(pts, onProgress) {
  if (!pts.length) return { ground: new Float32Array(0), source: 'none', zoom: 0 };
  const z = pickZoom(bboxOf(pts));
  try { return { ground: await elevationsFromTiles(pts, z, onProgress), source: 'terrarium', zoom: z }; }
  catch (e) { console.warn('terrain tiles failed, trying open-meteo:', e && e.message); }
  return { ground: await elevationsFromOpenMeteo(pts, onProgress), source: 'open-meteo', zoom: 0 };
}

// ---- water from OpenFreeMap vector tiles
let tileUrlPromise = null;
function waterTileUrl() {
  if (!tileUrlPromise) {
    tileUrlPromise = (async () => {
      const res = await fetch(OPENFREEMAP_TILEJSON); if (!res.ok) throw new Error(`tilejson ${res.status}`);
      const j = await res.json(); const u = (j.tiles || [])[0]; if (!u) throw new Error('no tiles'); return u;
    })();
    tileUrlPromise.catch(() => { tileUrlPromise = null; });
  }
  return tileUrlPromise;
}
const waterCache = new Map();
async function waterTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (waterCache.has(key)) return waterCache.get(key);
  const p = (async () => {
    const url = (await waterTileUrl()).replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const res = await fetch(url, { mode: 'cors' });
    if (res.status === 404 || res.status === 204) return [];
    if (!res.ok) throw new Error(`water ${res.status}`);
    const tile = parseTile(new Uint8Array(await res.arrayBuffer()));
    const layer = tile.layers.water; if (!layer) return [];
    return layer.features.filter((f) => f.type === 3).map((f) => ({ f, extent: layer.extent }));
  })();
  waterCache.set(key, p);
  p.catch(() => waterCache.delete(key));
  return p;
}
/** Water flags (1 = on water) for positions; zoom ≤ 10 keeps the tile count small. Throws when tiles are unavailable. */
export async function fetchWater(pts, ground, onProgress) {
  const out = new Uint8Array(pts.length);
  if (!pts.length) return { water: out, source: 'none' };
  const z = Math.min(10, pickZoom(bboxOf(pts), 40));
  const groups = new Map();
  pts.forEach((p, i) => { const t = pixelInTile(p.lat, p.lon, z, 1); const k = `${z}/${t.x}/${t.y}`; if (!groups.has(k)) groups.set(k, { x: t.x, y: t.y, items: [] }); groups.get(k).items.push([i, t.fx, t.fy]); });
  const keys = [...groups.keys()]; let done = 0;
  for (let b = 0; b < keys.length; b += 6) {
    await Promise.all(keys.slice(b, b + 6).map(async (k) => {
      const g = groups.get(k); const feats = await waterTile(z, g.x, g.y);
      for (const [i, fx, fy] of g.items) {
        if (ground && ground[i] <= 0.5) { out[i] = 1; continue; }     // sea level from the DEM
        for (const { f, extent } of feats) if (insideFeature(f, fx * extent, fy * extent)) { out[i] = 1; break; }
      }
      done++; onProgress && onProgress(done / keys.length);
    }));
  }
  return { water: out, source: 'openfreemap', zoom: z };
}
