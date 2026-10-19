// Supermaster: one-time setup (name + PIN), login → bearer token, overview of codes, flights, usage.

import { HttpError, hashPin, verifyPin, createToken, isCode, normalizeCode, isFlightId } from './auth.js';
import { logAction, listLog } from './log.js';
import { meView } from './codes.js';
import { flightView, removeFlightRow } from './flights.js';

const PIN_MIN = 6;

export async function adminCount(env) {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM admins').first();
  return r ? r.n : 0;
}

export async function setupAdmin(env, body, request) {
  if (await adminCount(env) > 0) throw new HttpError(409, 'already set up');
  const name = String(body.name || '').trim().toLowerCase();
  const pin = String(body.pin || '');
  if (!/^[a-z0-9._-]{2,40}$/.test(name)) throw new HttpError(400, 'name: 2–40 letters, digits, . _ -');
  if (pin.length < PIN_MIN) throw new HttpError(400, `PIN: at least ${PIN_MIN} characters`);
  await env.DB.prepare('INSERT INTO admins (name, pin_hash, created_at) VALUES (?1, ?2, ?3)').bind(name, await hashPin(pin), Date.now()).run();
  await logAction(env, `admin:${name}`, 'admin.setup', '', request);
  return { ok: true, name };
}

export async function loginAdmin(env, body, request) {
  const name = String(body.name || '').trim().toLowerCase();
  const row = await env.DB.prepare('SELECT name, pin_hash FROM admins WHERE name = ?1').bind(name).first();
  if (!row || !(await verifyPin(String(body.pin || ''), row.pin_hash))) {
    await logAction(env, `admin:${name || '?'}`, 'admin.loginFailed', '', request);
    throw new HttpError(401, 'wrong name or PIN');
  }
  await env.DB.prepare('UPDATE admins SET last_login = ?2 WHERE name = ?1').bind(name, Date.now()).run();
  const token = await createToken(env, name);
  await logAction(env, `admin:${name}`, 'admin.login', (request.headers.get('User-Agent') || '').slice(0, 80), request);
  return { token, name };
}

export async function changePin(env, admin, body, request) {
  const row = await env.DB.prepare('SELECT pin_hash FROM admins WHERE name = ?1').bind(admin.name).first();
  if (!row || !(await verifyPin(String(body.oldPin || ''), row.pin_hash))) throw new HttpError(401, 'wrong PIN');
  const pin = String(body.pin || '');
  if (pin.length < PIN_MIN) throw new HttpError(400, `PIN: at least ${PIN_MIN} characters`);
  await env.DB.prepare('UPDATE admins SET pin_hash = ?2 WHERE name = ?1').bind(admin.name, await hashPin(pin)).run();
  await logAction(env, `admin:${admin.name}`, 'admin.pin', '', request);
  return { ok: true };
}

export async function adminCodes(env) {
  const r = await env.DB.prepare(`SELECT c.*, (SELECT COUNT(*) FROM flights f WHERE f.code = c.code) AS n, (SELECT COALESCE(SUM(track_bytes), 0) FROM flights f WHERE f.code = c.code) AS bytes
    FROM codes c ORDER BY COALESCE(c.last_seen, c.created_at) DESC`).all();
  return (r.results || []).map((row) => ({ ...meView(row, { n: row.n, bytes: row.bytes }), blocked: !!row.blocked }));
}

export async function setTeam(env, admin, codeRaw, team, request) {
  const code = normalizeCode(codeRaw);
  if (!isCode(code)) throw new HttpError(404, 'not found');
  await env.DB.prepare('UPDATE codes SET team = ?2 WHERE code = ?1').bind(code, team ? 1 : 0).run();
  await logAction(env, `admin:${admin.name}`, team ? 'code.team' : 'code.unteam', code, request);
  return { ok: true, team: !!team };
}

export async function adminFlights(env, limit = 500) {
  const r = await env.DB.prepare('SELECT * FROM flights ORDER BY updated_at DESC LIMIT ?1').bind(Math.min(2000, Number(limit) || 500)).all();
  return (r.results || []).map((row) => flightView(row, { withOwner: true }));
}

export async function adminStats(env) {
  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM codes').first();
  const f = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(track_bytes), 0) AS bytes, COALESCE(SUM(points), 0) AS points FROM flights').first();
  const l = await env.DB.prepare('SELECT COUNT(*) AS n FROM usage_log WHERE t > ?1').bind(Date.now() - 30 * 86400e3).first();
  return { codes: c ? c.n : 0, flights: f ? f.n : 0, bytes: f ? f.bytes : 0, points: f ? f.points : 0, actions30d: l ? l.n : 0, retentionDays: Number(env.RETENTION_DAYS || 730) };
}

export async function setBlocked(env, admin, codeRaw, blocked, request) {
  const code = normalizeCode(codeRaw);
  if (!isCode(code)) throw new HttpError(404, 'not found');
  await env.DB.prepare('UPDATE codes SET blocked = ?2 WHERE code = ?1').bind(code, blocked ? 1 : 0).run();
  await logAction(env, `admin:${admin.name}`, blocked ? 'code.block' : 'code.unblock', code, request);
  return { ok: true };
}

export async function adminDeleteFlight(env, admin, id, request) {
  if (!isFlightId(id)) throw new HttpError(404, 'not found');
  const row = await env.DB.prepare('SELECT * FROM flights WHERE id = ?1').bind(id).first();
  if (!row) throw new HttpError(404, 'not found');
  await removeFlightRow(env, row);
  await logAction(env, `admin:${admin.name}`, 'flight.delete', `${id} (${row.code})`, request);
  return { ok: true };
}

export async function adminDeleteCode(env, admin, codeRaw, request) {
  const code = normalizeCode(codeRaw);
  if (!isCode(code)) throw new HttpError(404, 'not found');
  const rows = await env.DB.prepare('SELECT * FROM flights WHERE code = ?1').bind(code).all();
  for (const row of rows.results || []) await removeFlightRow(env, row);
  const c = await env.DB.prepare('SELECT logo_key FROM codes WHERE code = ?1').bind(code).first();
  if (c && c.logo_key) await env.FILES.delete(c.logo_key).catch(() => {});
  await env.DB.prepare('DELETE FROM codes WHERE code = ?1').bind(code).run();
  await logAction(env, `admin:${admin.name}`, 'code.delete', `${code} (${(rows.results || []).length} flights)`, request);
  return { ok: true };
}

export const adminLog = (env, limit) => listLog(env, limit);
