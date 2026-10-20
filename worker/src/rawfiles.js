// Raw tracker files (0.8.7): the files the pilot imported (CSV, GPX, ZIP …) are stored with the flight, gzip
// compressed by the browser, under raw/<flight>/<n>.gz in R2 with one row per file in raw_files. The owner
// uploads them once per save (the set is replaced); owner and Supermaster can list and fetch them, the
// Supermaster's downloads are logged. They count towards the owner's storage quota.

import { HttpError, isFlightId } from './auth.js';
import { logAction } from './log.js';

export const RAW_MAX_FILES = 24;
export const RAW_MAX_FILE = 25 * 1024 * 1024;     // gzip bytes per file
export const RAW_MAX_TOTAL = 80 * 1024 * 1024;    // gzip bytes per flight

const safeName = (s) => String(s || 'datei').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 120);
const key = (flightId, n) => `raw/${flightId}/${n}.gz`;

/** Bytes of raw files a code has stored (for the quota). */
export async function rawBytes(env, code, excludeFlight = null) {
  const r = excludeFlight
    ? await env.DB.prepare('SELECT COALESCE(SUM(gz_bytes), 0) AS b FROM raw_files WHERE code = ?1 AND flight_id <> ?2').bind(code, excludeFlight).first()
    : await env.DB.prepare('SELECT COALESCE(SUM(gz_bytes), 0) AS b FROM raw_files WHERE code = ?1').bind(code).first();
  return (r && r.b) || 0;
}

export async function listRaw(env, flightId) {
  const r = await env.DB.prepare('SELECT n, name, bytes, gz_bytes, created_at FROM raw_files WHERE flight_id = ?1 ORDER BY n').bind(flightId).all();
  return (r.results || []).map((x) => ({ n: x.n, name: x.name, bytes: x.bytes, gzBytes: x.gz_bytes, createdAt: x.created_at }));
}

export async function removeFlightRaw(env, flightId) {
  const r = await env.DB.prepare('SELECT n FROM raw_files WHERE flight_id = ?1').bind(flightId).all();
  for (const row of r.results || []) await env.FILES.delete(key(flightId, row.n)).catch(() => {});
  await env.DB.prepare('DELETE FROM raw_files WHERE flight_id = ?1').bind(flightId).run();
}

/**
 * Replace the raw file set of an own flight. Multipart: `meta` = JSON [{name, bytes}] in file order,
 * `files` = the gzip blobs in the same order. quotaBytes: the code's quota; used: bytes already stored
 * (tracks + raw of other flights) so the new set must fit.
 */
export async function putRaw(env, user, flight, request, { quotaBytes, usedBytes }) {
  const fd = await request.formData();
  let meta = []; try { meta = JSON.parse(fd.get('meta') || '[]'); } catch { meta = []; }
  const blobs = fd.getAll('files').filter((f) => f && typeof f !== 'string');
  if (!blobs.length) throw new HttpError(400, 'no files');
  if (blobs.length > RAW_MAX_FILES) throw new HttpError(413, `more than ${RAW_MAX_FILES} files`);
  let total = 0;
  for (const b of blobs) { if (b.size > RAW_MAX_FILE) throw new HttpError(413, 'raw file larger than 25 MB (compressed)'); total += b.size; }
  if (total > RAW_MAX_TOTAL) throw new HttpError(413, 'raw files larger than 80 MB (compressed)');
  if (usedBytes + total > quotaBytes) throw new HttpError(413, 'storage quota of this code exhausted');
  await removeFlightRaw(env, flight.id);
  const now = Date.now(); const out = [];
  for (let n = 0; n < blobs.length; n++) {
    const m = (Array.isArray(meta) && meta[n]) || {};
    const name = safeName(m.name || blobs[n].name || `datei_${n + 1}`), bytes = Number(m.bytes) || 0;
    await env.FILES.put(key(flight.id, n), blobs[n].stream(), { httpMetadata: { contentType: 'application/gzip' }, customMetadata: { code: user.code, name } });
    await env.DB.prepare('INSERT INTO raw_files (flight_id, n, code, name, bytes, gz_bytes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)').bind(flight.id, n, user.code, name, bytes, blobs[n].size, now).run();
    out.push({ n, name, bytes, gzBytes: blobs[n].size });
  }
  await logAction(env, user.code, 'flight.raw', `${flight.id} ${out.length} files ${total} B`, request);
  return { ok: true, files: out };
}

/** One raw file (gzip as stored); who: 'owner' | 'admin:<name>' for the log. */
export async function getRaw(env, flightId, n, who, request) {
  if (!isFlightId(flightId)) throw new HttpError(404, 'not found');
  const row = await env.DB.prepare('SELECT * FROM raw_files WHERE flight_id = ?1 AND n = ?2').bind(flightId, Number(n)).first();
  if (!row) throw new HttpError(404, 'not found');
  const obj = await env.FILES.get(key(flightId, row.n));
  if (!obj) throw new HttpError(404, 'file missing');
  if (who !== 'owner') await logAction(env, who, 'flight.rawdata', `${flightId} raw ${row.n} ${row.name} (${row.code})`, request);
  return new Response(obj.body, { headers: { 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store', 'X-Analyze-Encoding': 'gzip', 'X-Analyze-Bytes': String(row.bytes), 'X-Analyze-Name': encodeURIComponent(row.name) } });
}
