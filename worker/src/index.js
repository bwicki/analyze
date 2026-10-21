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
//   PUT  /api/flights/<id>/preview (JPEG, owner) · GET /api/view/<id>/preview.jpg   link-preview image for messengers
//   GET|POST /api/flights/<id>/raw · GET /api/flights/<id>/raw/<n>   raw tracker files as imported (owner; Supermaster: /api/admin/flights/<id>/raw[/<n>])
//   GET  /api/events/flights · /api/events/<flight> · /api/events/media/<file>   Ereignislog from gb_flight_data (X-Code with team, or Supermaster token)
//   GET  /api/flights/<id>/ops/briefings · POST /api/flights/<id>/ops   Übergabe an ops.wicki.aero (team or Supermaster; secret OPS_HANDOVER_TOKEN)
//   GET  /api/mapshare?share=&from=&to=[&pw=]   Garmin inReach MapShare feed (KML) for the import – any PIN, Garmin hosts only
//   GET  /api/livetrack/sessions?share= · /api/livetrack/track?share=&session=&token=   Garmin LiveTrack (live.garmin.com) sessions / one session as GPX (0.15.0)
//   GET  /api/view/<id>/report.pdf        Fahrtbericht als PDF vom Server (public flights; Browser Rendering, secrets CF_BR_TOKEN + CF_ACCOUNT_ID)
//   GET  /api/profiles (public) · POST /api/profiles (X-Code) · DELETE /api/profiles/<id> (owner or Supermaster)
//   GET|POST /api/flights/<id>/photos · PUT|DELETE /api/flights/<id>/photos/<pid> · GET /api/view/<id>/photos (public)
//   GET  /api/photos/<pid>[/thumb]   image (owner, or anyone when the flight is public)
//   GET  /api/admin/setup · POST /api/admin/setup · POST /api/admin/login · POST /api/admin/logout · PUT /api/admin/pin
//   GET  /api/admin/stats|codes|flights|log · POST /api/admin/codes/<code>/block|unblock|team · DELETE /api/admin/codes/<code> · DELETE /api/admin/flights/<id>
//   GET  /api/admin/flights/<id>/track|events   raw data of any flight (Supermaster)

import { HttpError, codeFromRequest, requireCode, adminFromRequest, requireAdmin, deleteToken } from './auth.js';
import { createCode, meView, counts, touch, updateMe, putLogo, deleteLogo, getLogo } from './codes.js';
import { previewHtml, removePreview } from './preview.js';
import { listFlights, createFlight, getFlight, updateFlight, deleteFlight, getTrack, getEvents, viewFlight, viewTrack, viewEvents, cleanup, putPreview, viewPreviewImage, listOwnRaw, putOwnRaw, getOwnRaw, publicFlightRow } from './flights.js';
import { listRaw, getRaw } from './rawfiles.js';
import { listRepoFlights, getRepoFlight, getRepoMedia } from './events.js';
import { opsBriefings, opsHandover } from './ops.js';
import { fetchMapShare } from './mapshare.js';
import { liveTrackSessions, liveTrackTrack } from './livetrack.js';
import { reportPdf } from './pdf.js';
import { adminCount, setupAdmin, loginAdmin, changePin, adminCodes, adminFlights, adminStats, setBlocked, setTeam, adminDeleteFlight, adminDeleteCode, adminLog, adminFlightFile } from './admin.js';
import { logAction } from './log.js';
import { listProfiles, createProfile, deleteProfile } from './profiles.js';
import { listOwn as listOwnPhotos, listPublic as listPublicPhotos, uploadPhoto, updatePhoto, deletePhoto, servePhoto } from './photos.js';

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });

/** CORS allow-list from wrangler.toml APP_ORIGINS (app on GitHub Pages / own domain, local dev). */
export function corsHeaders(env, request) {
  const origin = request.headers.get('Origin');
  const allowed = String(env.APP_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !(allowed.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Code', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Expose-Headers': 'X-Analyze-Encoding, X-Analyze-Bytes, X-Analyze-Name, X-Analyze-Points', 'Access-Control-Max-Age': '600', Vary: 'Origin' };
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
  // Fahrtbericht als PDF vom Server (0.13.0): public flights; cached in R2 until the flight changes
  const viewPdfId = seg(/^\/api\/view\/([^/]+)\/report\.pdf$/);
  if (viewPdfId && m === 'GET') { if (rateLimited('pdf:' + ip, 20)) throw new HttpError(429, 'too many PDF requests'); return reportPdf(env, ctx, await publicFlightRow(env, viewPdfId)); }
  const viewTrackId = seg(/^\/api\/view\/([^/]+)\/track$/);
  if (viewTrackId && m === 'GET') return viewTrack(env, viewTrackId);
  const viewEventsId = seg(/^\/api\/view\/([^/]+)\/events$/);
  if (viewEventsId && m === 'GET') return viewEvents(env, viewEventsId);
  const viewPreviewId = seg(/^\/api\/view\/([^/]+)\/preview\.jpg$/);
  if (viewPreviewId && m === 'GET') return viewPreviewImage(env, viewPreviewId);
  const viewPhotosId = seg(/^\/api\/view\/([^/]+)\/photos$/);
  if (viewPhotosId && m === 'GET') return json(await listPublicPhotos(env, viewPhotosId), 200, { 'Cache-Control': 'public, max-age=60' });
  const photoGet = /^\/api\/photos\/([^/]+)(\/thumb)?$/.exec(path);
  if (photoGet && m === 'GET') return servePhoto(env, await codeFromRequest(env, request, url).catch(() => null), decodeURIComponent(photoGet[1]), !!photoGet[2]);

  if (path === '/api/profiles' && m === 'GET') return json(await listProfiles(env), 200, { 'Cache-Control': 'public, max-age=120' });

  if (path === '/api/codes' && m === 'POST') {
    if (rateLimited('create:' + ip, 5)) throw new HttpError(429, 'too many new codes – try again later');
    return json(await createCode(env, await readJson(request), request));
  }

  // ---- code user ---------------------------------------------------------------------------------
  if (path === '/api/me' || path === '/api/me/logo' || path === '/api/mapshare' || path.startsWith('/api/livetrack/') || path.startsWith('/api/flights') || path.startsWith('/api/events') || path.startsWith('/api/profiles')) {
    let user = await codeFromRequest(env, request, url);
    if (!user && (path.startsWith('/api/events') || /\/ops(\/briefings)?$/.test(path))) { const adm = await adminFromRequest(env, request); if (adm) user = { code: `admin:${adm.name}`, team: true, admin: true }; }   // Supermaster without a PIN (0.8.7; 0.10.0 also for the ops handover)
    if (!user) {
      if (rateLimited('guess:' + ip, 30)) throw new HttpError(429, 'too many attempts');
      throw new HttpError(401, 'unknown code');
    }
    if (path === '/api/me' && m === 'GET') { await touch(env, user.code); return json(meView(user, await counts(env, user.code))); }
    if (path === '/api/me' && m === 'PUT') return json(await updateMe(env, user, await readJson(request)));
    if (path === '/api/me/logo' && m === 'PUT') return json(await putLogo(env, user, request));
    if (path === '/api/me/logo' && m === 'DELETE') return json(await deleteLogo(env, user, request));
    // Garmin inReach MapShare feed for the import (0.12.0): any PIN, 20 calls per 10 min
    if (path === '/api/livetrack/sessions' && m === 'GET') { if (rateLimited('livetrack:' + user.code, 30)) throw new HttpError(429, 'too many LiveTrack requests'); return liveTrackSessions(env, user, { share: url.searchParams.get('share') }); }
    if (path === '/api/livetrack/track' && m === 'GET') { if (rateLimited('livetrack:' + user.code, 30)) throw new HttpError(429, 'too many LiveTrack requests'); return liveTrackTrack(env, user, { share: url.searchParams.get('share'), session: url.searchParams.get('session'), token: url.searchParams.get('token'), name: url.searchParams.get('name') || '' }); }
    if (path === '/api/mapshare' && m === 'GET') { if (rateLimited('mapshare:' + user.code, 20)) throw new HttpError(429, 'too many MapShare requests'); return fetchMapShare(env, user, { share: url.searchParams.get('share'), from: url.searchParams.get('from'), to: url.searchParams.get('to'), pw: url.searchParams.get('pw') || '' }); }
    if (path === '/api/flights' && m === 'GET') return json(await listFlights(env, user));
    if (path === '/api/flights' && m === 'POST') return json(await createFlight(env, user, request, ctx));
    // Übergabe an ops.wicki.aero (0.10.0): list of the last briefings, then the handover of one saved flight
    const opsList = seg(/^\/api\/flights\/([^/]+)\/ops\/briefings$/);
    if (opsList && m === 'GET') return json(await opsBriefings(env, user));
    const opsId = seg(/^\/api\/flights\/([^/]+)\/ops$/);
    if (opsId && m === 'POST') return json(await opsHandover(env, user, opsId, await readJson(request), request, ctx));
    const trackId = seg(/^\/api\/flights\/([^/]+)\/track$/);
    if (trackId && m === 'GET') return getTrack(env, user, trackId);
    const eventsId = seg(/^\/api\/flights\/([^/]+)\/events$/);
    if (eventsId && m === 'GET') return getEvents(env, user, eventsId);
    const rawId = seg(/^\/api\/flights\/([^/]+)\/raw$/);
    if (rawId && m === 'GET') return json(await listOwnRaw(env, user, rawId));
    if (rawId && m === 'POST') return json(await putOwnRaw(env, user, rawId, request));
    const rawOne = /^\/api\/flights\/([^/]+)\/raw\/(\d+)$/.exec(path);
    if (rawOne && m === 'GET') return getOwnRaw(env, user, decodeURIComponent(rawOne[1]), rawOne[2], request);
    const previewId = seg(/^\/api\/flights\/([^/]+)\/preview$/);
    if (previewId && m === 'PUT') return json(await putPreview(env, user, previewId, request));
    const photosId = seg(/^\/api\/flights\/([^/]+)\/photos$/);
    if (photosId && m === 'GET') return json(await listOwnPhotos(env, user, photosId));
    if (photosId && m === 'POST') return json(await uploadPhoto(env, user, photosId, request));
    const photoOne = /^\/api\/flights\/([^/]+)\/photos\/([^/]+)$/.exec(path);
    if (photoOne && m === 'PUT') return json(await updatePhoto(env, user, decodeURIComponent(photoOne[1]), decodeURIComponent(photoOne[2]), await readJson(request), request));
    if (photoOne && m === 'DELETE') return json(await deletePhoto(env, user, decodeURIComponent(photoOne[1]), decodeURIComponent(photoOne[2]), request));
    if (path === '/api/profiles' && m === 'POST') { if (rateLimited('profile:' + ip, 10)) throw new HttpError(429, 'too many profiles'); return json(await createProfile(env, user, await readJson(request), request)); }
    const profId = seg(/^\/api\/profiles\/([^/]+)$/);
    if (profId && m === 'DELETE') return json(await deleteProfile(env, { code: user.code }, profId, request));
    // Ereignislog straight from the repo: only Kennungen the Supermaster flagged as team (decision 19.10.2026)
    if (path.startsWith('/api/events') && !user.team) throw new HttpError(403, 'code not enabled for the event log');
    if (path === '/api/events/flights' && m === 'GET') return json(await listRepoFlights(env, ctx));
    const mediaFile = seg(/^\/api\/events\/media\/([^/]+)$/);
    if (mediaFile && m === 'GET') return getRepoMedia(env, mediaFile, ctx);
    const repoFlight = seg(/^\/api\/events\/([^/]+)$/);
    if (repoFlight && m === 'GET') return json(await getRepoFlight(env, repoFlight, ctx));
    const id = seg(/^\/api\/flights\/([^/]+)$/);
    if (id && m === 'GET') return json(await getFlight(env, user, id));
    if (id && m === 'PUT') return json(await updateFlight(env, user, id, request, ctx));
    if (id && m === 'DELETE') return json(await deleteFlight(env, user, id, request, ctx));
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
    if (path === '/api/admin/stats' && m === 'GET') return json({ ...(await adminStats(env)), secrets: { dataToken: !!env.GITHUB_DATA_TOKEN, pagesToken: !!env.GITHUB_PAGES_TOKEN, opsToken: !!env.OPS_HANDOVER_TOKEN, pdfToken: !!(env.CF_BR_TOKEN && env.CF_ACCOUNT_ID) }, apiUrl: env.API_URL || '' });
    if (path === '/api/admin/codes' && m === 'GET') return json(await adminCodes(env));
    if (path === '/api/admin/flights' && m === 'GET') return json(await adminFlights(env, url.searchParams.get('limit')));
    if (path === '/api/admin/log' && m === 'GET') return json(await adminLog(env, url.searchParams.get('limit')));
    if (path === '/api/admin/profiles' && m === 'GET') return json(await listProfiles(env, { all: true }));
    const admProf = seg(/^\/api\/admin\/profiles\/([^/]+)$/);
    if (admProf && m === 'DELETE') return json(await deleteProfile(env, { admin: true, name: admin.name }, admProf, request));
    const blockCode = seg(/^\/api\/admin\/codes\/([^/]+)\/block$/);
    if (blockCode && m === 'POST') return json(await setBlocked(env, admin, blockCode, true, request));
    const unblockCode = seg(/^\/api\/admin\/codes\/([^/]+)\/unblock$/);
    if (unblockCode && m === 'POST') return json(await setBlocked(env, admin, unblockCode, false, request));
    const teamCode = seg(/^\/api\/admin\/codes\/([^/]+)\/team$/);
    if (teamCode && m === 'POST') return json(await setTeam(env, admin, teamCode, !!(await readJson(request)).team, request));
    const delCode = seg(/^\/api\/admin\/codes\/([^/]+)$/);
    if (delCode && m === 'DELETE') return json(await adminDeleteCode(env, admin, delCode, request));
    const admRaw = seg(/^\/api\/admin\/flights\/([^/]+)\/raw$/);
    if (admRaw && m === 'GET') return json(await listRaw(env, admRaw));
    const admRawOne = /^\/api\/admin\/flights\/([^/]+)\/raw\/(\d+)$/.exec(path);
    if (admRawOne && m === 'GET') return getRaw(env, decodeURIComponent(admRawOne[1]), admRawOne[2], `admin:${admin.name}`, request);
    const admFile = /^\/api\/admin\/flights\/([^/]+)\/(track|events)$/.exec(path);
    if (admFile && m === 'GET') return adminFlightFile(env, admin, decodeURIComponent(admFile[1]), admFile[2], request);
    const delFlight = seg(/^\/api\/admin\/flights\/([^/]+)$/);
    if (delFlight && m === 'DELETE') { const r = await adminDeleteFlight(env, admin, delFlight, request); ctx.waitUntil(removePreview(env, delFlight)); return json(r); }
    if (path === '/api/admin/cleanup' && m === 'POST') return json(await cleanup(env));
  }

  throw new HttpError(404, 'not found');
}

// Columns added after the first schema: applied once per isolate so a "migrate" run is not needed
// for small additions (CREATE TABLE IF NOT EXISTS cannot add columns to an existing table).
const MIGRATIONS = [
  { test: 'SELECT team FROM codes LIMIT 1', apply: 'ALTER TABLE codes ADD COLUMN team INTEGER NOT NULL DEFAULT 0' },
  { test: 'SELECT id FROM photos LIMIT 1', apply: 'CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, flight_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL DEFAULT \'\', taken_at INTEGER, exif_tz INTEGER, manual INTEGER NOT NULL DEFAULT 0, manual_at INTEGER, exif_lat REAL, exif_lon REAL, exif_alt REAL, caption TEXT NOT NULL DEFAULT \'\', image_key TEXT NOT NULL, thumb_key TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, width INTEGER, height INTEGER, created_at INTEGER NOT NULL)' },
  { test: 'SELECT id FROM photos LIMIT 1', apply: 'CREATE INDEX IF NOT EXISTS photos_flight ON photos(flight_id, taken_at)', always: true },
  { test: 'SELECT manual FROM photos LIMIT 1', apply: 'ALTER TABLE photos ADD COLUMN manual INTEGER NOT NULL DEFAULT 0' },
  { test: 'SELECT manual_at FROM photos LIMIT 1', apply: 'ALTER TABLE photos ADD COLUMN manual_at INTEGER' },
  { test: 'SELECT n FROM raw_files LIMIT 1', apply: 'CREATE TABLE IF NOT EXISTS raw_files (flight_id TEXT NOT NULL, n INTEGER NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, gz_bytes INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, PRIMARY KEY (flight_id, n))' },
  { test: 'SELECT n FROM raw_files LIMIT 1', apply: 'CREATE INDEX IF NOT EXISTS raw_files_code ON raw_files(code)', always: true },
];
let migrated = null;
function ensureSchema(env) {
  if (!migrated) migrated = (async () => {
    for (const mg of MIGRATIONS) {
      let ok = false;
      if (!mg.always) { try { await env.DB.prepare(mg.test).first(); ok = true; } catch { ok = false; } }
      if (ok) continue;
      try { await env.DB.prepare(mg.apply).run(); console.log('migrated:', mg.apply.slice(0, 60)); } catch (e) { console.error('migration failed', mg.apply.slice(0, 60), e); }
    }
  })().catch(() => { migrated = null; });
  return migrated;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname.startsWith('/api/')) {
        await ensureSchema(env);
        const res = await api(request, env, url, ctx);
        for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
        return res;
      }
      // link preview page of a public flight (the same page is committed to the Pages repo, see preview.js)
      const pv = /^\/v\/([A-Z2-9]{8})\/?$/.exec(url.pathname);
      if (pv && request.method === 'GET') {
        await ensureSchema(env);
        const row = await env.DB.prepare('SELECT f.*, c.blocked FROM flights f JOIN codes c ON c.code = f.code WHERE f.id = ?1').bind(pv[1]).first();
        if (!row || !row.public || row.blocked) return new Response('not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
        const lang = /^en/i.test(request.headers.get('Accept-Language') || '') ? 'en' : 'de';
        return new Response(previewHtml(row, env.APP_URL || 'https://analyze.wicki.aero', lang, env.API_URL || ''), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
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
