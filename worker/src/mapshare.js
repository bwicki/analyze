// Garmin inReach MapShare (0.12.0): the Worker fetches the KML feed of a MapShare page for a time window and hands
// it to the browser (share.garmin.com sends no CORS headers). Only Garmin hosts are allowed (no open proxy),
// a PIN is required, and an optional MapShare password goes as HTTP Basic auth straight to Garmin – never stored.

import { HttpError } from './auth.js';

const HOSTS = ['share.garmin.com', 'explore.garmin.com', 'inreach.garmin.com'];
const NAME_RE = /^[A-Za-z0-9_-]{1,60}$/;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_WINDOW_MS = 31 * 86400000;   // Garmin limits the feed anyway; keep requests bounded

/** Feed URL from a MapShare address («https://share.garmin.com/bwi»), a feed URL or a bare name. */
export function feedUrl(share, { from, to } = {}) {
  let name = String(share || '').trim();
  if (/^https?:\/\//i.test(name)) {
    const u = new URL(name);
    if (!HOSTS.includes(u.hostname.toLowerCase())) throw new HttpError(400, 'only Garmin MapShare addresses');
    const m = /^\/(?:Feed\/Share\/)?([A-Za-z0-9_-]{1,60})\/?$/.exec(u.pathname);
    if (!m) throw new HttpError(400, 'MapShare name not found in the address');
    name = m[1];
  }
  if (!NAME_RE.test(name)) throw new HttpError(400, 'bad MapShare name');
  const q = new URLSearchParams();
  const d1 = ts(from), d2 = ts(to);
  if (d1 && d2 && d2 - d1 > MAX_WINDOW_MS) throw new HttpError(400, 'time window too long (max. 31 days)');
  if (d1) q.set('d1', isoMin(d1)); if (d2) q.set('d2', isoMin(d2));
  return { name, url: `https://share.garmin.com/Feed/Share/${name}${q.toString() ? '?' + q.toString() : ''}` };
}
const ts = (v) => { if (!v) return null; const n = Date.parse(v); if (!Number.isFinite(n)) throw new HttpError(400, 'bad time'); return n; };
const isoMin = (n) => new Date(n).toISOString().slice(0, 16) + 'Z';   // 2026-10-04T06:00Z

export async function fetchMapShare(env, user, params) {
  const { name, url } = feedUrl(params.share, { from: params.from, to: params.to });
  const headers = { 'User-Agent': 'analyze-worker (analyze.wicki.aero)', Accept: 'application/vnd.google-earth.kml+xml, application/xml, text/xml, */*' };
  if (params.pw) headers.Authorization = 'Basic ' + btoa(`mapshare:${params.pw}`);   // Garmin ignores the user name
  let res;
  try { res = await fetch(url, { headers, signal: AbortSignal.timeout(25000) }); }
  catch (e) { throw new HttpError(504, `Garmin not reachable (${e.name || 'error'})`); }
  if (res.status === 401 || res.status === 403) throw new HttpError(401, 'MapShare password missing or wrong');
  if (res.status === 404) throw new HttpError(404, 'MapShare not found (name or sharing switched off)');
  if (!res.ok) throw new HttpError(502, `Garmin ${res.status}`);
  const len = +(res.headers.get('Content-Length') || 0); if (len > MAX_BYTES) throw new HttpError(413, 'feed too large');
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new HttpError(413, 'feed too large');
  if (!/<kml[\s>]/i.test(text)) throw new HttpError(502, 'Garmin did not return KML (sharing off or password page)');
  const points = (text.match(/<Placemark\b/g) || []).length;
  const d1 = params.from ? isoMin(Date.parse(params.from)).slice(0, 10) : 'feed';
  return new Response(text, { headers: { 'Content-Type': 'application/vnd.google-earth.kml+xml; charset=utf-8', 'Cache-Control': 'no-store', 'X-Analyze-Name': `mapshare_${name}_${d1}.kml`, 'X-Analyze-Points': String(points) } });
}
