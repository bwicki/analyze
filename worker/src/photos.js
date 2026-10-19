// Photos of a saved flight (phase 3): JPEG resized in the browser (+ thumbnail), stored in R2 under
// photos/<flight>/<id>.jpg and _t.jpg, rows in D1. Public when the flight is public (short link / QR).

import { HttpError, randomCode, isFlightId } from './auth.js';
import { logAction } from './log.js';
import { counts } from './codes.js';

const IMAGE_MAX = 8 * 1024 * 1024, THUMB_MAX = 400 * 1024, PER_FLIGHT = 300;
const QUOTA_DEFAULT_MB = 300;
const isPhotoId = (s) => /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/.test(s);

export function photoView(row) {
  return { id: row.id, flightId: row.flight_id, name: row.name, cameraTime: row.taken_at, exifTz: row.exif_tz, exifLat: row.exif_lat, exifLon: row.exif_lon, exifAlt: row.exif_alt, caption: row.caption || '', bytes: row.bytes, width: row.width, height: row.height, createdAt: row.created_at };
}

async function ownFlight(env, user, id) {
  if (!isFlightId(id)) throw new HttpError(404, 'not found');
  const row = await env.DB.prepare('SELECT * FROM flights WHERE id = ?1').bind(id).first();
  if (!row || row.code !== user.code) throw new HttpError(404, 'not found');
  return row;
}
async function publicFlight(env, id) {
  if (!isFlightId(id)) throw new HttpError(404, 'not found');
  const row = await env.DB.prepare('SELECT f.*, c.blocked FROM flights f JOIN codes c ON c.code = f.code WHERE f.id = ?1').bind(id).first();
  if (!row || !row.public || row.blocked) throw new HttpError(404, 'not found');
  return row;
}

export async function listPhotos(env, flightId) {
  const r = await env.DB.prepare('SELECT * FROM photos WHERE flight_id = ?1 ORDER BY COALESCE(taken_at, created_at), created_at').bind(flightId).all();
  return (r.results || []).map(photoView);
}
export async function listOwn(env, user, flightId) { await ownFlight(env, user, flightId); return listPhotos(env, flightId); }
export async function listPublic(env, flightId) { await publicFlight(env, flightId); return listPhotos(env, flightId); }

const isJpeg = (u8) => u8 && u8.length > 4 && u8[0] === 0xff && u8[1] === 0xd8;

/** multipart: meta (JSON: name, cameraTime, exifTz, exifLat/Lon/Alt, width, height, caption), image (jpeg), thumb (jpeg) */
export async function uploadPhoto(env, user, flightId, request) {
  await ownFlight(env, user, flightId);
  const fd = await request.formData().catch(() => { throw new HttpError(400, 'multipart expected'); });
  let meta = {}; try { meta = JSON.parse(fd.get('meta') || '{}'); } catch { meta = {}; }
  const img = fd.get('image'), th = fd.get('thumb');
  if (!img || typeof img === 'string' || !th || typeof th === 'string') throw new HttpError(400, 'image and thumb missing');
  const image = new Uint8Array(await img.arrayBuffer()), thumb = new Uint8Array(await th.arrayBuffer());
  if (!isJpeg(image) || !isJpeg(thumb)) throw new HttpError(415, 'JPEG expected');
  if (image.byteLength > IMAGE_MAX) throw new HttpError(413, 'image larger than 8 MB');
  if (thumb.byteLength > THUMB_MAX) throw new HttpError(413, 'thumbnail too large');
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM photos WHERE flight_id = ?1').bind(flightId).first();
  if (n && n.n >= PER_FLIGHT) throw new HttpError(413, `at most ${PER_FLIGHT} photos per flight`);
  const c = await counts(env, user.code);
  const ph = await env.DB.prepare('SELECT COALESCE(SUM(bytes), 0) AS bytes FROM photos WHERE code = ?1').bind(user.code).first();
  const quota = Number(env.QUOTA_MB || QUOTA_DEFAULT_MB) * 1024 * 1024;
  if ((c.bytes || 0) + ((ph && ph.bytes) || 0) + image.byteLength + thumb.byteLength > quota) throw new HttpError(413, 'storage quota of this code exhausted');
  const id = randomCode(10);
  const imageKey = `photos/${flightId}/${id}.jpg`, thumbKey = `photos/${flightId}/${id}_t.jpg`;
  await env.FILES.put(imageKey, image, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { code: user.code, flight: flightId } });
  await env.FILES.put(thumbKey, thumb, { httpMetadata: { contentType: 'image/jpeg' }, customMetadata: { code: user.code, flight: flightId } });
  const num = (v) => (Number.isFinite(v) ? v : null);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO photos (id, flight_id, code, name, taken_at, exif_tz, exif_lat, exif_lon, exif_alt, caption, image_key, thumb_key, bytes, width, height, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)')
    .bind(id, flightId, user.code, String(meta.name || '').slice(0, 120), num(meta.cameraTime), num(meta.exifTz), num(meta.exifLat), num(meta.exifLon), num(meta.exifAlt), String(meta.caption || '').slice(0, 300), imageKey, thumbKey, image.byteLength + thumb.byteLength, num(meta.width), num(meta.height), now).run();
  await env.DB.prepare('UPDATE flights SET updated_at = ?2 WHERE id = ?1').bind(flightId, now).run();
  await logAction(env, user.code, 'photo.upload', `${flightId}/${id} ${image.byteLength} B`, request);
  const row = await env.DB.prepare('SELECT * FROM photos WHERE id = ?1').bind(id).first();
  return photoView(row);
}

export async function updatePhoto(env, user, flightId, photoId, body, request) {
  await ownFlight(env, user, flightId);
  if (!isPhotoId(photoId)) throw new HttpError(404, 'not found');
  const row = await env.DB.prepare('SELECT * FROM photos WHERE id = ?1 AND flight_id = ?2').bind(photoId, flightId).first();
  if (!row) throw new HttpError(404, 'not found');
  const caption = body.caption !== undefined ? String(body.caption || '').slice(0, 300) : row.caption;
  const takenAt = body.cameraTime !== undefined ? (Number.isFinite(body.cameraTime) ? body.cameraTime : null) : row.taken_at;
  await env.DB.prepare('UPDATE photos SET caption = ?2, taken_at = ?3 WHERE id = ?1').bind(photoId, caption, takenAt).run();
  const out = await env.DB.prepare('SELECT * FROM photos WHERE id = ?1').bind(photoId).first();
  return photoView(out);
}

export async function deletePhoto(env, user, flightId, photoId, request) {
  await ownFlight(env, user, flightId);
  if (!isPhotoId(photoId)) throw new HttpError(404, 'not found');
  const row = await env.DB.prepare('SELECT * FROM photos WHERE id = ?1 AND flight_id = ?2').bind(photoId, flightId).first();
  if (!row) throw new HttpError(404, 'not found');
  await env.FILES.delete(row.image_key).catch(() => {}); await env.FILES.delete(row.thumb_key).catch(() => {});
  await env.DB.prepare('DELETE FROM photos WHERE id = ?1').bind(photoId).run();
  await logAction(env, user.code, 'photo.delete', `${flightId}/${photoId}`, request);
  return { ok: true };
}

/** All photos of a flight (used when the flight is deleted). */
export async function removeFlightPhotos(env, flightId) {
  const r = await env.DB.prepare('SELECT * FROM photos WHERE flight_id = ?1').bind(flightId).all();
  for (const row of r.results || []) { await env.FILES.delete(row.image_key).catch(() => {}); await env.FILES.delete(row.thumb_key).catch(() => {}); }
  await env.DB.prepare('DELETE FROM photos WHERE flight_id = ?1').bind(flightId).run();
}

/** Image or thumbnail; owner (X-Code) or anyone when the flight is public. */
export async function servePhoto(env, user, photoId, thumb) {
  if (!isPhotoId(photoId)) throw new HttpError(404, 'not found');
  const row = await env.DB.prepare('SELECT p.*, f.public AS fpublic, c.blocked FROM photos p JOIN flights f ON f.id = p.flight_id JOIN codes c ON c.code = f.code WHERE p.id = ?1').bind(photoId).first();
  if (!row) throw new HttpError(404, 'not found');
  const own = user && user.code === row.code;
  if (!own && (!row.fpublic || row.blocked)) throw new HttpError(404, 'not found');
  const obj = await env.FILES.get(thumb ? row.thumb_key : row.image_key);
  if (!obj) throw new HttpError(404, 'not found');
  return new Response(obj.body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': own ? 'private, max-age=3600' : 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
}
