// analyze – Cloudflare Worker entry (API only). The web app is served by GitHub Pages
// (analyze.wicki.aero) and reaches this Worker through src/config.js (apiBase).
//
// Auth:  code users send the Kennung as `X-Code` header; the Supermaster sends `Authorization: Bearer <token>`.
// Data:  D1 (codes, flights, admins, tokens, tracker_profiles, usage_log) + R2 (tracks/, logos/).
//
// Routes (README §6):
//   GET  /api/health
//   POST /api/codes                          create a Kennung → {code}
//   GET  /api/me · PUT /api/me               profile of the Kennung (X-Code)
//   PUT  /api/me/logo · DELETE /api/me/logo  own logo (raw image body, ≤ 1 MB)
//   GET  /api/logo/<code>                    public logo (404 → app shows the default)
//   GET  /api/flights · POST /api/flights    list / save (multipart: meta JSON + track gzip)
//   GET|PUT|DELETE /api/flights/<id>         one flight (owner); GET /api/flights/<id>/track → gzip GeoJSON
//   GET  /api/flights/<id>/events · /api/view/<id>/events   stored event log (JSON array)
//   GET  /api/view/<id> · /api/view/<id>/track   public viewer data (short link /v/<id>)
//   GET  /api/events/flights · /api/events/<flight> · /api/events/media/<file>   Ereignislog from gb_flight_data (X-Code)
//   GET  /api/admin/setup · POST /api/admin/setup · POST /api/admin/login · POST /api/admin/logout · PUT /api/admin/pin
//   GET  /api/admin/stats|codes|flights|log · POST /api/admin/codes/<code>/block|unblock|team · DELETE /api/admin/codes/<code> · DELETE /api/admin/flights/<id>

import { HttpError, codeFromRequest, requireCode, adminFromRequest, requireAdmin, deleteToken } from './auth.js';
import { createCode, meView, counts, touch, updateMe, putLogo, deleteLogo, getLogo } from './codes.js';
import { listFlights, createFlight, getFlight, updateFlight, deleteFlight, getTrack, getEvents, viewFlight, viewTrack, viewEvents, cleanup } from './flights.js';
import { listRepoFlights, getRepoFlight, getRepoMedia } from './events.js';
import { adminCount, setupAdmin, loginAdmin, changePin, adminCodes, adminFlights, adminStats, setBlocked, setTeam, adminDeleteFlight, adminDeleteCode, adminLog } from './admin.js';
import { logAction } from './log.js';

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });

/** CORS allow-list from wrangler.toml APP_ORIGINS (app on GitHub Pages / own domain, local dev). */
export function corsHeaders(env, request) {
  const origin = request.headers.get('Origin');
  const allowed = String(env.APP_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !(allowed.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Code', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Expose-Headers': 'X-Analyze-Encoding, X-Analyze-Bytes', 'Access-Control-Max-Age': '600', Vary: 'Origin' };
}

// Small per-isolate rate limiter: code creation, code guessing and admin logins per client IP.
const attempts = new Map();
function rateLimited(key, max, windowMs = 10 * 60e3) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now); attempts.set(key, list);
  if (attempts.size > 5000) attempts.clear();
  return list.length > max;
}
const readJson = (request) => request.json().catch(() => ({}));

export async function api(request, env, url, ctx) {
  const path = url.pathname.replace(/\/+$/, '');
  const m = request.method;
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const seg = (re) => { const x = re.exec(path); return x ? decodeURIComponent(x[1]) : null; };

  if (path === '/api/health') return json({ ok: true, t: Date.now(), app: 'analyze' });

  // ---- public ------------------------------------------------------------------------------------
  const logoCode = seg(/^\/api\/logo\/([^/]+)$/);
  if (logoCode && m === 'GET') return getLogo(env, logoCode);
  const viewId = seg(/^\/api\/view\/([^/]+)$/);
  if (viewId && m === 'GET') return json(await viewFlight(env, viewId, request));
  const viewTrackId = seg(/^\/api\/view\/([^/]+)\/track$/);
  if (viewTrackId && m === 'GET') return viewTrack(env, viewTrackId);
  const viewEventsId = seg(/^\/api\/view\/([^/]+)\/events$/);
  if (viewEventsId && m === 'GET') return viewEvents(env, viewEventsId);

  if (path === '/api/codes' && m === 'POST') {
    if (rateLimited('create:' + ip, 5)) throw new HttpError(429, 'too many new codes – try again later');
    return json(await createCode(env, await readJson(request), request));
  }

  // ---- code user ---------------------------------------------------------------------------------
  if (path === '/api/me' || path === '/api/me/logo' || path.startsWith('/api/flights') || path.startsWith('/api/events')) {
    const user = await codeFromRequest(env, request, url);
    if (!user) {
      if (rateLimited('guess:' + ip, 30)) throw new HttpError(429, 'too many attempts');
      throw new HttpError(401, 'unknown code');
    }
    if (path === '/api/me' && m === 'GET') { await touch(env, user.code); return json(meView(user, await counts(env, user.code))); }
    if (path === '/api/me' && m === 'PUT') return json(await updateMe(env, user, await readJson(request)));
    if (path === '/api/me/logo' && m === 'PUT') return json(await putLogo(env, user, request));
    if (path === '/api/me/logo' && m === 'DELETE') return json(await deleteLogo(env, user, request));
    if (path === '/api/flights' && m === 'GET') return json(await listFlights(env, user));
    if (path === '/api/flights' && m === 'POST') return json(await createFlight(env, user, request));
    const trackId = seg(/^\/api\/flights\/([^/]+)\/track$/);
    if (trackId && m === 'GET') return getTrack(env, user, trackId);
    const eventsId = seg(/^\/api\/flights\/([^/]+)\/events$/);
    if (eventsId && m === 'GET') return getEvents(env, user, eventsId);
    // Ereignislog straight from the repo: only Kennungen the Supermaster flagged as team (decision 19.10.2026)
    if (path.startsWith('/api/events') && !user.team) throw new HttpError(403, 'code not enabled for the event log');
    if (path === '/api/events/flights' && m === 'GET') return json(await listRepoFlights(env, ctx));
    const mediaFile = seg(/^\/api\/events\/media\/([^/]+)$/);
    if (mediaFile && m === 'GET') return getRepoMedia(env, mediaFile, ctx);
    const repoFlight = seg(/^\/api\/events\/([^/]+)$/);
    if (repoFlight && m === 'GET') return json(await getRepoFlight(env, repoFlight, ctx));
    const id = seg(/^\/api\/flights\/([^/]+)$/);
    if (id && m === 'GET') return json(await getFlight(env, user, id));
    if (id && m === 'PUT') return json(await updateFlight(env, user, id, request));
    if (id && m === 'DELETE') return json(await deleteFlight(env, user, id, request));
  }

  // ---- Supermaster -------------------------------------------------------------------------------
  if (path.startsWith('/api/admin')) {
    if (path === '/api/admin/setup' && m === 'GET') return json({ needed: (await adminCount(env)) === 0 });
    if (path === '/api/admin/setup' && m === 'POST') { if (rateLimited('admin:' + ip, 5)) throw new HttpError(429, 'too many attempts'); return json(await setupAdmin(env, await readJson(request), request)); }
    if (path === '/api/admin/login' && m === 'POST') { if (rateLimited('admin:' + ip, 10)) throw new HttpError(429, 'too many attempts'); return json(await loginAdmin(env, await readJson(request), request)); }
    const admin = await adminFromRequest(env, request);
    if (path === '/api/admin/logout' && m === 'POST') { await deleteToken(env, admin && admin.token); return json({ ok: true }); }
    requireAdmin(admin);
    if (path === '/api/admin/me' && m === 'GET') return json({ name: admin.name });
    if (path === '/api/admin/pin' && m === 'PUT') return json(await changePin(env, admin, await readJson(request), request));
    if (path === '/api/admin/stats' && m === 'GET') return json(await adminStats(env));
    if (path === '/api/admin/codes' && m === 'GET') return json(await adminCodes(env));
    if (path === '/api/admin/flights' && m === 'GET') return json(await adminFlights(env, url.searchParams.get('limit')));
    if (path === '/api/admin/log' && m === 'GET') return json(await adminLog(env, url.searchParams.get('limit')));
    const blockCode = seg(/^\/api\/admin\/codes\/([^/]+)\/block$/);
    if (blockCode && m === 'POST') return json(await setBlocked(env, admin, blockCode, true, request));
    const unblockCode = seg(/^\/api\/admin\/codes\/([^/]+)\/unblock$/);
    if (unblockCode && m === 'POST') return json(await setBlocked(env, admin, unblockCode, false, request));
    const teamCode = seg(/^\/api\/admin\/codes\/([^/]+)\/team$/);
    if (teamCode && m === 'POST') return json(await setTeam(env, admin, teamCode, !!(await readJson(request)).team, request));
    const delCode = seg(/^\/api\/admin\/codes\/([^/]+)$/);
    if (delCode && m === 'DELETE') return json(await adminDeleteCode(env, admin, delCode, request));
    const delFlight = seg(/^\/api\/admin\/flights\/([^/]+)$/);
    if (delFlight && m === 'DELETE') return json(await adminDeleteFlight(env, admin, delFlight, request));
    if (path === '/api/admin/cleanup' && m === 'POST') return json(await cleanup(env));
  }

  throw new HttpError(404, 'not found');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname.startsWith('/api/')) {
        const res = await api(request, env, url, ctx);
        for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
        return res;
      }
      return json({ error: 'not found', app: env.APP_URL || 'https://analyze.wicki.aero' }, 404, cors);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return json({ error: status === 500 ? 'internal error' : e.message }, status, cors);
    }
  },
  /** Daily: flights past RETENTION_DAYS, expired tokens, old log lines. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanup(env).then((r) => logAction(env, '-', 'cron.cleanup', `${r.removed} flights removed`)));
  },
};
