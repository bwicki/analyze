// Principals (concept §4, decisions of 18.10.2026):
//   * code user  – identified by the 6-letter Kennung alone, sent as the `X-Code` header (or ?code=).
//   * Supermaster – name + PIN (PBKDF2-SHA256 via WebCrypto, same as s2ground) → bearer token in D1.
// No dependencies.

const ITER = 100000;
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(secret, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}
export async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(await pbkdf2(pin, salt, ITER))}`;
}
export async function verifyPin(pin, stored) {
  const [algo, iter, salt, hash] = (stored || '').split('$');
  if (algo !== 'pbkdf2') return false;
  const got = new Uint8Array(await pbkdf2(pin, unb64(salt), Number(iter))), want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0; for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];   // constant time
  return diff === 0;
}
export function randomToken(bytes = 32) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Alphabet without 0/O/1/I: a code read over the phone or written on the logbook is unambiguous. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function randomCode(len = 6) {
  const a = crypto.getRandomValues(new Uint8Array(len));
  return [...a].map((v) => CODE_ALPHABET[v % CODE_ALPHABET.length]).join('');
}
/** What a person typed → canonical: upper case, spaces/dashes removed (the alphabet has no 0/O/1/I, so those stay wrong). */
export function normalizeCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
export const isCode = (s) => /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(s);
export const isFlightId = (s) => /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(s);

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Code user from the X-Code header (or ?code=). Returns the codes row or null; blocked codes → 403. */
export async function codeFromRequest(env, request, url) {
  const raw = request.headers.get('X-Code') || (url && url.searchParams.get('code')) || '';
  const code = normalizeCode(raw);
  if (!isCode(code)) return null;
  const row = await env.DB.prepare('SELECT code, display_name, logo_key, logo_type, lang, units, prefs, created_at, last_seen, blocked, team FROM codes WHERE code = ?1').bind(code).first();
  if (!row) return null;
  if (row.blocked) throw new HttpError(403, 'code blocked');
  return row;
}
export function requireCode(user) {
  if (!user) throw new HttpError(401, 'unknown code');
  return user;
}

// ---- Supermaster tokens ------------------------------------------------------------------------
export async function createToken(env, name) {
  const token = randomToken(), now = Date.now(), hours = Number(env.TOKEN_HOURS || 12);
  await env.DB.prepare('INSERT INTO tokens (token, name, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)').bind(token, name, now, now + hours * 3600e3).run();
  await env.DB.prepare('DELETE FROM tokens WHERE expires_at < ?1').bind(now).run();
  return token;
}
export async function deleteToken(env, token) {
  if (token) await env.DB.prepare('DELETE FROM tokens WHERE token = ?1').bind(token).run();
}
/** Bearer token → {name, token} or null. */
export async function adminFromRequest(env, request) {
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const row = await env.DB.prepare('SELECT token, name, expires_at FROM tokens WHERE token = ?1').bind(token).first();
  if (!row || row.expires_at < Date.now()) return null;
  return { name: row.name, token };
}
export function requireAdmin(admin) {
  if (!admin) throw new HttpError(401, 'unauthorized');
  return admin;
}
