// Who is using the app: a Kennung (code), a guest without one, or a public viewer (?v=<id>).
// The code is kept in localStorage – it is the only credential (concept decision 4), so it never
// leaves the browser except as the X-Code header to our own Worker.

import { config } from './config.js';

const LS_CODE = 'analyze.code', LS_GUEST = 'analyze.guest', LS_ME = 'analyze.me', SS_ADMIN = 'analyze.admin';
const get = (k, ss = false) => { try { return (ss ? sessionStorage : localStorage).getItem(k); } catch { return null; } };
const set = (k, v, ss = false) => { try { const s = ss ? sessionStorage : localStorage; v === null || v === undefined ? s.removeItem(k) : s.setItem(k, v); } catch { /* private mode */ } };

export const session = {
  code: get(LS_CODE) || null,
  guest: get(LS_GUEST) === '1',
  me: (() => { try { return JSON.parse(get(LS_ME)) || null; } catch { return null; } })(),
  adminToken: get(SS_ADMIN, true) || null,
  adminName: null,
};

export const hasServer = () => !!config.apiBase;
export const hasAccess = () => !!session.code || session.guest;
/** Team / organisation name of the PIN in use (profile → «Team / Organisation»); '' = app default «Wickipartners Ballonteam». */
export const orgName = () => ((session.me && session.me.prefs && session.me.prefs.org) || '').trim();

export function setCode(code, me = null) {
  session.code = code || null; session.me = me; session.guest = false;
  set(LS_CODE, session.code); set(LS_ME, me ? JSON.stringify(me) : null); set(LS_GUEST, null);
}
export function setMe(me) { session.me = me; set(LS_ME, me ? JSON.stringify(me) : null); }
export function setGuest() { session.code = null; session.me = null; session.guest = true; set(LS_CODE, null); set(LS_ME, null); set(LS_GUEST, '1'); }
export function clearSession() { session.code = null; session.me = null; session.guest = false; set(LS_CODE, null); set(LS_ME, null); set(LS_GUEST, null); }
export function setAdmin(token, name) { session.adminToken = token || null; session.adminName = name || null; set(SS_ADMIN, token || null, true); }

/** Logo for a code: the Worker serves it, 404 falls back to the Ballonteam logo (handled by the <img> onerror). */
export function logoUrl(code, hasLogo = true) {
  if (!code || !hasLogo || !config.apiBase) return './img/logo.png';
  return `${config.apiBase.replace(/\/$/, '')}/api/logo/${encodeURIComponent(code)}`;
}
export const DEFAULT_LOGO = './img/logo.png';
