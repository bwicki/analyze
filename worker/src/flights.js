// Saved flights: D1 row (title, stats, meta) + gzipped GeoJSON track in R2 (tracks/<id>.geojson.gz).
// The browser gzips the GeoJSON itself and sends it as the "track" part of a multipart form; the Worker
// stores the bytes untouched (no decompression on the edge – keeps CPU time tiny for 10-MB tracks).

import { HttpError, randomCode, isFlightId } from './auth.js';
import { logAction } from './log.js';
import { counts } from './codes.js';

const TRACK_MAX = 25 * 1024 * 1024;                 // gzipped bytes per flight
const QUOTA_DEFAULT_MB = 300;                       // per code
const parseJson = (s, fb = {}) => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : fb; } catch { return fb; } };

export function flightView(row, { withOwner = false } = {}) {
  return {
    id: row.id, title: row.title || '', startTs: row.start_ts, endTs: row.end_ts, stats: parseJson(row.stats), meta: parseJson(row.meta),
    points: row.points || 0, bytes: row.track_bytes || 0, public: !!row.public, createdAt: row.created_at, updatedAt: row.updated_at, hasEvents: !!row.events_key,
    ...(withOwner ? { code: row.code } : {}),
  };
}

export async function listFlights(env, user) {
  const r = await env.DB.prepare('SELECT * FROM flights WHERE code = ?1 ORDER BY COALESCE(start_ts, created_at) DESC').bind(user.code).all();
  return (r.results || []).map((row) => flightView(row));
}

const EVENTS_MAX = 2 * 1024 * 1024;                 // JSON bytes of an event log per flight

/**
 * Read the multipart body: meta (JSON string) + optional track (gzip) + optional events (JSON text;
 * an empty string removes the stored log). Also accepts plain JSON (meta only).
 */
async function readFlightBody(request) {
  const ct = (request.headers.get('Content-Type') || '').toLowerCase();
  let meta = {}, track = null, events;
  if (ct.startsWith('multipart/form-data')) {
    const fd = await request.formData();
    meta = parseJson(fd.get('meta') || '{}');
    const f = fd.get('track');
    if (f && typeof f !== 'string') track = new Uint8Array(await f.arrayBuffer());
    const ev = fd.get('events');
    if (ev !== null && ev !== undefined) events = typeof ev === 'string' ? ev : await ev.text();
  } else {
    meta = await request.json().catch(() => ({}));
  }
  if (track) {
    if (track.byteLength < 20 || track[0] !== 0x1f || track[1] !== 0x8b) throw new HttpError(400, 'track must be gzip');
    if (track.byteLength > TRACK_MAX) throw new HttpError(413, 'track larger than 25 MB');
  }
  if (events) {
    if (events.length > EVENTS_MAX) throw new HttpError(413, 'event log larger than 2 MB');
    let j; try { j = JSON.parse(events); } catch { throw new HttpError(400, 'events must be JSON'); }
    if (!Array.isArray(j)) throw new HttpError(400, 'events must be a JSON array');
  }
  return { meta, track, events };
}

async function storeEvents(env, id, events, currentKey) {
  if (events === undefined) return currentKey;
  if (events === '') { if (currentKey) await env.FILES.delete(currentKey).catch(() => {}); return null; }
  const key = `events/${id}.json`;
  await env.FILES.put(key, events, { httpMetadata: { contentType: 'application/json' } });
  return key;
}

function fields(m) {
  const str = (v, n) => String(v ?? '').slice(0, n);
  const stats = m.stats && typeof m.stats === 'object' ? m.stats : {};
  const meta = m.meta && typeof m.meta === 'object' ? m.meta : {};
  const ts = (v) => { const n = Date.parse(v || ''); return Number.isNaN(n) ? null : n; };
  return {
    title: str(m.title, 120), stats: JSON.stringify(stats).slice(0, 20000), meta: JSON.stringify(meta).slice(0, 20000),
    startTs: ts(stats.takeoff && stats.takeoff.time) ?? (Number.isFinite(m.startTs) ? m.startTs : null),
    endTs: ts(stats.landing && stats.landing.time) ?? (Number.isFinite(m.endTs) ? m.endTs : null),
    points: Number.isFinite(m.points) ? Math.max(0, Math.round(m.points)) : 0,
    public: m.public === undefined ? null : (m.public ? 1 : 0),
  };
}

async function checkQuota(env, user, addBytes, excludeId = null) {
  const c = await counts(env, user.code);
  const used = (c.bytes || 0) - (excludeId ? ((await env.DB.prepare('SELECT track_bytes FROM flights WHERE id = ?1').bind(excludeId).first()) || {}).track_bytes || 0 : 0);
  const quota = Number(env.QUOTA_MB || QUOTA_DEFAULT_MB) * 1024 * 1024;
  if (used + addBytes > quota) throw new HttpError(413, 'storage quota of this code exhausted');
}

export async function createFlight(env, user, request) {
  const { meta, track, events } = await readFlightBody(request);
  if (!track) throw new HttpError(400, 'track missing');
  await checkQuota(env, user, track.byteLength);
  const f = fields(meta);
  let id = randomCode(8);
  for (let k = 0; k < 5 && await env.DB.prepare('SELECT id FROM flights WHERE id = ?1').bind(id).first(); k++) id = randomCode(8);
  const key = `tracks/${id}.geojson.gz`;
  await env.FILES.put(key, track, { httpMetadata: { contentType: 'application/gzip' }, customMetadata: { code: user.code } });
  const now = Date.now();
  const eventsKey = await storeEvents(env, id, events, null);
  await env.DB.prepare('INSERT INTO flights (id, code, title, start_ts, end_ts, stats, meta, track_key, track_bytes, points, events_key, public, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)')
    .bind(id, user.code, f.title, f.startTs, f.endTs, f.stats, f.meta, key, track.byteLength, f.points, eventsKey, f.public ?? 1, now).run();
  await logAction(env, user.code, 'flight.create', `${id} ${f.title} ${track.byteLength} B`, request);
  const row = await env.DB.prepare('SELECT * FROM flights WHERE id = ?1').bind(id).first();
  return { ...flightView(row), url: `${env.APP_URL || ''}/v/${id}` };
}

async function ownFlight(env, user, id) {
  if (!isFlightId(id)) throw new HttpError(404, 'not found');
  const row = await env.DB.prepare('SELECT * FROM flights WHERE id = ?1').bind(id).first();
  if (!row || row.code !== user.code) throw new HttpError(404, 'not found');
  return row;
}

export async function getFlight(env, user, id) {
  const row = await ownFlight(env, user, id);
  return { ...flightView(row), url: `${env.APP_URL || ''}/v/${id}` };
}

export async function updateFlight(env, user, id, request) {
  const row = await ownFlight(env, user, id);
  const { meta, track, events } = await readFlightBody(request);
  const f = fields({ title: row.title, stats: parseJson(row.stats), meta: parseJson(row.meta), points: row.points, ...meta });
  let bytes = row.track_bytes;
  if (track) {
    await checkQuota(env, user, track.byteLength, id);
    await env.FILES.put(row.track_key, track, { httpMetadata: { contentType: 'application/gzip' }, customMetadata: { code: user.code } });
    bytes = track.byteLength;
  }
  const eventsKey = await storeEvents(env, id, events, row.events_key);
  await env.DB.prepare('UPDATE flights SET title = ?2, start_ts = ?3, end_ts = ?4, stats = ?5, meta = ?6, track_bytes = ?7, points = ?8, public = ?9, updated_at = ?10, events_key = ?11 WHERE id = ?1')
    .bind(id, f.title, f.startTs, f.endTs, f.stats, f.meta, bytes, f.points, f.public ?? row.public, Date.now(), eventsKey).run();
  await logAction(env, user.code, 'flight.update', `${id} ${f.title}${track ? ` ${bytes} B` : ''}`, request);
  const out = await env.DB.prepare('SELECT * FROM flights WHERE id = ?1').bind(id).first();
  return { ...flightView(out), url: `${env.APP_URL || ''}/v/${id}` };
}

export async function deleteFlight(env, user, id, request) {
  const row = await ownFlight(env, user, id);
  await removeFlightRow(env, row);
  await logAction(env, user.code, 'flight.delete', `${id} ${row.title}`, request);
  return { ok: true };
}

export async function removeFlightRow(env, row) {
  await env.FILES.delete(row.track_key).catch(() => {});
  if (row.events_key) await env.FILES.delete(row.events_key).catch(() => {});
  await env.DB.prepare('DELETE FROM flights WHERE id = ?1').bind(row.id).run();
}

/** The gzipped GeoJSON as stored; the browser inflates it (DecompressionStream). */
async function trackResponse(env, row, cache) {
  const obj = await env.FILES.get(row.track_key);
  if (!obj) throw new HttpError(404, 'track missing');
  return new Response(obj.body, { headers: { 'Content-Type': 'application/gzip', 'Cache-Control': cache, 'X-Analyze-Encoding': 'gzip', 'X-Analyze-Bytes': String(obj.size) } });
}

export async function getTrack(env, user, id) {
  const row = await ownFlight(env, user, id);
  return trackResponse(env, row, 'private, no-store');
}

/** The stored event log (JSON array) or an empty array. */
async function eventsResponse(env, row, cache) {
  if (!row.events_key) return new Response('[]', { headers: { 'Content-Type': 'application/json', 'Cache-Control': cache } });
  const obj = await env.FILES.get(row.events_key);
  return new Response(obj ? obj.body : '[]', { headers: { 'Content-Type': 'application/json', 'Cache-Control': cache } });
}
export async function getEvents(env, user, id) {
  const row = await ownFlight(env, user, id);
  return eventsResponse(env, row, 'private, no-store');
}
export async function viewEvents(env, id) {
  const row = await publicFlight(env, id);
  return eventsResponse(env, row, 'public, max-age=300');
}

// ---- public viewer (short link /v/<id>) ---------------------------------------------------------------
async function publicFlight(env, id) {
  if (!isFlightId(id)) throw new HttpError(404, 'not found');
  const row = await env.DB.prepare('SELECT f.*, c.display_name, c.logo_key, c.blocked FROM flights f JOIN codes c ON c.code = f.code WHERE f.id = ?1').bind(id).first();
  if (!row || !row.public || row.blocked) throw new HttpError(404, 'not found');
  return row;
}
export async function viewFlight(env, id, request) {
  const row = await publicFlight(env, id);
  await logAction(env, '-', 'view', id, request);
  return { ...flightView(row), owner: { code: row.code, displayName: row.display_name || '', logo: !!row.logo_key } };
}
export async function viewTrack(env, id) {
  const row = await publicFlight(env, id);
  return trackResponse(env, row, 'public, max-age=300');
}

// ---- housekeeping (cron) ----------------------------------------------------------------------------
export async function cleanup(env) {
  const days = Number(env.RETENTION_DAYS || 730), limit = Date.now() - days * 86400e3;
  const old = await env.DB.prepare('SELECT * FROM flights WHERE updated_at < ?1 LIMIT 200').bind(limit).all();
  for (const row of old.results || []) await removeFlightRow(env, row);
  await env.DB.prepare('DELETE FROM tokens WHERE expires_at < ?1').bind(Date.now()).run();
  await env.DB.prepare('DELETE FROM usage_log WHERE t < ?1').bind(limit).run();
  return { removed: (old.results || []).length };
}
