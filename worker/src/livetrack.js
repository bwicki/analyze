// Garmin LiveTrack (0.15.0): inReach users who share through Garmin Connect / Messenger get a LiveTrack page
// (live.garmin.com/<name>, also livetrack.garmin.com/<name>) instead of MapShare – it has no download and no KML feed,
// but the page's own JSON API is reachable without a login. The Worker fetches the page once (CSRF cookie + meta
// token), lists the sessions of the personal link and hands one session's track points to the browser as GPX.
// Only Garmin hosts, a PIN is required, nothing is stored. Undocumented API – checked against live pages 21.10.2026.

import { HttpError } from './auth.js';

const HOSTS = ['live.garmin.com', 'livetrack.garmin.com'];
const API_HOST = 'https://livetrack.garmin.com';
const NAME_RE = /^[A-Za-z0-9_-]{1,60}$/;
const SESSION_RE = /^\/session\/([0-9a-f-]{20,60})\/token\/([A-Za-z0-9]{10,80})\/?$/i;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) analyze.wicki.aero/1.0';
const MAX_POINTS = 20000;

/** Personal link («https://live.garmin.com/bwi», «livetrack.garmin.com/bwi», bare name) or a session link. */
export function parseLiveTrack(share) {
  let s = String(share || '').trim();
  if (!s) throw new HttpError(400, 'LiveTrack address or name missing');
  if (/^[a-z]+\.garmin\.com\//i.test(s)) s = 'https://' + s;
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    if (!HOSTS.includes(u.hostname.toLowerCase())) throw new HttpError(400, 'only Garmin LiveTrack addresses (live.garmin.com/…)');
    const ses = SESSION_RE.exec(u.pathname);
    if (ses) return { kind: 'session', sessionId: ses[1], token: ses[2] };
    const m = /^\/([A-Za-z0-9_-]{1,60})\/?$/.exec(u.pathname);
    if (!m) throw new HttpError(400, 'LiveTrack name not found in the address');
    s = m[1];
  }
  if (!NAME_RE.test(s)) throw new HttpError(400, 'bad LiveTrack name');
  return { kind: 'profile', name: s };
}

/** GET the page: CSRF meta token + cookies (livetrack_csrf, __cflb) the API calls must carry. */
async function pageSession(path) {
  let res;
  try { res = await fetch(`${API_HOST}${path}`, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw new HttpError(504, `Garmin not reachable (${e.name || 'error'})`); }
  if (res.status === 404) throw new HttpError(404, 'LiveTrack page not found');
  if (!res.ok) throw new HttpError(502, `Garmin ${res.status}`);
  const html = await res.text();
  const meta = /<meta[^>]*name="csrf-token"[^>]*content="([^"]+)"/i.exec(html) || /<meta[^>]*content="([^"]+)"[^>]*name="csrf-token"/i.exec(html);
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  const cookies = raw.map((c) => c.split(';')[0].trim()).filter(Boolean);
  if (!meta || !cookies.some((c) => /^livetrack_csrf=/.test(c))) throw new HttpError(502, 'LiveTrack page without CSRF token – Garmin may have changed the site');
  const headers = { 'User-Agent': UA, Accept: 'application/json', 'Livetrack-Csrf-Token': meta[1], Cookie: cookies.join('; ') };
  return { headers, passcode: /"isPasscodeRequired"\s*:\s*true/.test(html) };
}

async function apiGet(headers, path) {
  let res;
  try { res = await fetch(`${API_HOST}${path}`, { headers, signal: AbortSignal.timeout(25000) }); }
  catch (e) { throw new HttpError(504, `Garmin not reachable (${e.name || 'error'})`); }
  if (res.status === 404) throw new HttpError(404, 'not found on LiveTrack');
  if (res.status === 401 || res.status === 403) throw new HttpError(502, `LiveTrack refused the request (${res.status})`);
  if (!res.ok) throw new HttpError(502, `Garmin ${res.status}`);
  return res.json();
}

const isoDur = (s) => { const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(s || ''); return m ? Math.round((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0)) : null; };
const sessionView = (s, active) => ({ id: s.sessionId, token: s.sessionToken || null, name: s.sessionName || '', start: s.startDate || null, durationSec: isoDur(s.duration), distanceM: Number.isFinite(s.distance) ? Math.round(s.distance) : null, maxElevM: Number.isFinite(s.maxElevation) ? Math.round(s.maxElevation) : null, active, public: !Array.isArray(s.privacyLevels) || s.privacyLevels.includes('EVERYONE') });

/** Sessions of a personal link (active first, then completed, newest first). */
export async function liveTrackSessions(env, user, params) {
  const p = parseLiveTrack(params.share);
  if (p.kind === 'session') return { name: null, passcode: false, sessions: [{ id: p.sessionId, token: p.token, name: 'Session', start: null, durationSec: null, distanceM: null, maxElevM: null, active: null, public: true }] };
  const page = await pageSession(`/${p.name}`);
  const u = await apiGet(page.headers, `/api/personal-url/${encodeURIComponent(p.name)}/user`);
  if (!u || !u.garminGuid) throw new HttpError(404, 'LiveTrack name not found');
  if (u.isPasscodeRequired) throw new HttpError(401, 'this LiveTrack page needs a passcode – not supported');
  const s = await apiGet(page.headers, `/api/v2/user/${encodeURIComponent(u.garminGuid)}/profile-sessions`);
  const sessions = [...(s.activeSessions || []).map((x) => sessionView(x, true)), ...(s.completedSessions || []).map((x) => sessionView(x, false))]
    .filter((x) => x.id && x.token && x.public).sort((a, b) => (b.active - a.active) || String(b.start || '').localeCompare(String(a.start || '')));
  return { name: p.name, passcode: false, sessions };
}

/** Track points of one session as GPX 1.1 (time, ele, speed); the artificial END point of a closed session is dropped. */
export async function liveTrackTrack(env, user, params) {
  const p = parseLiveTrack(params.share);
  const sessionId = p.kind === 'session' ? p.sessionId : String(params.session || '').trim();
  const token = p.kind === 'session' ? p.token : String(params.token || '').trim();
  if (!/^[0-9a-f-]{20,60}$/i.test(sessionId) || !/^[A-Za-z0-9]{10,80}$/.test(token)) throw new HttpError(400, 'session and token required');
  const page = await pageSession(p.kind === 'session' ? `/session/${sessionId}/token/${token}` : `/${p.name}`);
  const j = await apiGet(page.headers, `/api/sessions/${encodeURIComponent(sessionId)}/track-points/common?token=${encodeURIComponent(token)}`);
  const pts = toPoints(j && j.trackPoints);
  if (!pts.length) throw new HttpError(404, 'no track points in this session');
  const name = params.name || (p.kind === 'session' ? 'LiveTrack' : p.name);
  const gpx = toGpx(pts, { name: `${name} ${pts[0].t.slice(0, 16).replace('T', ' ')} UTC`, source: `Garmin LiveTrack ${p.kind === 'session' ? '' : p.name}`.trim() });
  const day = pts[0].t.slice(0, 10);
  return new Response(gpx, { headers: { 'Content-Type': 'application/gpx+xml; charset=utf-8', 'Cache-Control': 'no-store', 'X-Analyze-Name': `livetrack_${p.kind === 'session' ? 'session' : p.name}_${day}.gpx`, 'X-Analyze-Points': String(pts.length) } });
}

export function toPoints(raw) {
  const out = [];
  for (const q of Array.isArray(raw) ? raw : []) {
    const t = Date.parse(q.dateTime || q.reportedTime || ''); const lat = q.position && +q.position.lat, lon = q.position && +q.position.lon;
    if (!Number.isFinite(t) || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    out.push({ t: new Date(t).toISOString(), ms: t, lat, lon, alt: Number.isFinite(+q.altitude) ? +q.altitude : null, speed: Number.isFinite(+q.speed) ? +q.speed : null, events: Array.isArray(q.eventTypes) ? q.eventTypes : [] });
    if (out.length >= MAX_POINTS) break;
  }
  out.sort((a, b) => a.ms - b.ms);
  // a closed session repeats the last position as END, often hours later – that is not a track point
  if (out.length > 1) { const last = out[out.length - 1], prev = out[out.length - 2]; if (last.events.includes('END') && last.lat === prev.lat && last.lon === prev.lon && last.ms - prev.ms > 10 * 60000) out.pop(); }
  return out;
}

const xml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function toGpx(pts, { name = 'LiveTrack', source = 'Garmin LiveTrack' } = {}) {
  const seg = pts.map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.alt === null ? '' : `<ele>${p.alt.toFixed(1)}</ele>`}<time>${p.t}</time>${p.speed === null ? '' : `<extensions><speed>${p.speed.toFixed(2)}</speed></extensions>`}</trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="analyze.wicki.aero (Garmin LiveTrack)" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xml(name)}</name><desc>${xml(source)}</desc><time>${pts[0].t}</time></metadata>
  <trk><name>${xml(name)}</name><src>${xml(source)}</src>
    <trkseg>
${seg}
    </trkseg>
  </trk>
</gpx>
`;
}
