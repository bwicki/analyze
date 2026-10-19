// Kennungen (codes): create, profile ("me"), logo in R2.

import { HttpError, randomCode, isCode, normalizeCode } from './auth.js';
import { logAction } from './log.js';

const LOGO_MAX = 1024 * 1024;                       // 1 MB (design board: PNG/SVG, max. 1 MB)
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
const parseJson = (s, fb = {}) => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : fb; } catch { return fb; } };

/** Public shape of a codes row. */
export function meView(row, counts = null) {
  return {
    code: row.code, displayName: row.display_name || '', logo: !!row.logo_key, logoType: row.logo_type || null, team: !!row.team,
    lang: row.lang || 'de', units: row.units || 'icao', prefs: parseJson(row.prefs), createdAt: row.created_at, lastSeen: row.last_seen || null,
    ...(counts ? { flights: counts.n || 0, bytes: counts.bytes || 0 } : {}),
  };
}

export async function createCode(env, body, request) {
  const displayName = String(body.displayName || '').trim().slice(0, 60);
  const lang = body.lang === 'en' ? 'en' : 'de';
  const units = body.units === 'metric' ? 'metric' : 'icao';
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(6);
    const exists = await env.DB.prepare('SELECT code FROM codes WHERE code = ?1').bind(code).first();
    if (exists) continue;
    const now = Date.now();
    await env.DB.prepare('INSERT INTO codes (code, display_name, lang, units, prefs, created_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)').bind(code, displayName, lang, units, '{}', now).run();
    await logAction(env, code, 'code.create', displayName, request);
    return { code, displayName, lang, units };
  }
  throw new HttpError(500, 'could not allocate a code');
}

export async function counts(env, code) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(track_bytes), 0) AS bytes FROM flights WHERE code = ?1').bind(code).first();
  return r || { n: 0, bytes: 0 };
}

export async function touch(env, code) {
  await env.DB.prepare('UPDATE codes SET last_seen = ?2 WHERE code = ?1').bind(code, Date.now()).run();
}

export async function updateMe(env, user, body) {
  const displayName = body.displayName !== undefined ? String(body.displayName || '').trim().slice(0, 60) : user.display_name;
  const lang = body.lang === 'en' || body.lang === 'de' ? body.lang : user.lang;
  const units = body.units === 'metric' || body.units === 'icao' ? body.units : user.units;
  let prefs = parseJson(user.prefs);
  if (body.prefs && typeof body.prefs === 'object') prefs = { ...prefs, ...body.prefs };
  const prefStr = JSON.stringify(prefs).slice(0, 4000);
  await env.DB.prepare('UPDATE codes SET display_name = ?2, lang = ?3, units = ?4, prefs = ?5 WHERE code = ?1').bind(user.code, displayName, lang, units, prefStr).run();
  const row = await env.DB.prepare('SELECT * FROM codes WHERE code = ?1').bind(user.code).first();
  return meView(row, await counts(env, user.code));
}

export async function putLogo(env, user, request) {
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!LOGO_TYPES.includes(type)) throw new HttpError(415, 'logo must be PNG, JPEG, SVG or WebP');
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) throw new HttpError(400, 'empty logo');
  if (bytes.byteLength > LOGO_MAX) throw new HttpError(413, 'logo larger than 1 MB');
  const key = `logos/${user.code}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
  await env.DB.prepare('UPDATE codes SET logo_key = ?2, logo_type = ?3 WHERE code = ?1').bind(user.code, key, type).run();
  await logAction(env, user.code, 'logo.put', `${type} ${bytes.byteLength} B`, request);
  return { ok: true, logo: true, logoType: type };
}

export async function deleteLogo(env, user, request) {
  if (user.logo_key) await env.FILES.delete(user.logo_key);
  await env.DB.prepare('UPDATE codes SET logo_key = NULL, logo_type = NULL WHERE code = ?1').bind(user.code).run();
  await logAction(env, user.code, 'logo.delete', '', request);
  return { ok: true, logo: false };
}

/** Public: the logo of a code (for the app header, reports and the viewer). 404 → the app shows the default logo. */
export async function getLogo(env, codeRaw) {
  const code = normalizeCode(codeRaw);
  if (!isCode(code)) throw new HttpError(404, 'not found');
  const row = await env.DB.prepare('SELECT logo_key, logo_type, blocked FROM codes WHERE code = ?1').bind(code).first();
  if (!row || !row.logo_key || row.blocked) throw new HttpError(404, 'no logo');
  const obj = await env.FILES.get(row.logo_key);
  if (!obj) throw new HttpError(404, 'no logo');
  // CSP: an SVG opened directly in a tab must not run scripts (inside <img> it never does anyway).
  return new Response(obj.body, { headers: { 'Content-Type': row.logo_type || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } });
}
