// Ereignislog from the private repo bwicki/gb_flight_data (written by the gb_notion_frontend app):
// data/_flights.json lists the closed flights, data/<FLIGHT>.json holds the rows. The Worker reads
// them with a fine-grained GitHub token (secret GITHUB_DATA_TOKEN, contents: read) and caches each
// file for a few minutes, so a Kennung never sees the token and GitHub is not hit per click.

import { HttpError } from './auth.js';

const REPO_DEFAULT = 'bwicki/gb_flight_data', BRANCH_DEFAULT = 'main', DIR_DEFAULT = 'data';
const TTL = 300;                                            // seconds in the edge cache

function cfg(env) {
  if (!env.GITHUB_DATA_TOKEN) throw new HttpError(503, 'event log not configured (GITHUB_DATA_TOKEN missing)');
  return { repo: env.DATA_REPO || REPO_DEFAULT, branch: env.DATA_BRANCH || BRANCH_DEFAULT, dir: env.DATA_DIR || DIR_DEFAULT, token: env.GITHUB_DATA_TOKEN };
}

/** Raw file from GitHub (cached). Returns the text or null for 404. */
async function ghFile(env, path, ctx) {
  const c = cfg(env);
  const url = `https://api.github.com/repos/${c.repo}/contents/${path}?ref=${encodeURIComponent(c.branch)}`;
  const cacheKey = new Request(`https://analyze-events.invalid/${c.repo}/${c.branch}/${path}`);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) { const hit = await cache.match(cacheKey); if (hit) return hit.status === 404 ? null : hit.text(); }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github.raw+json', 'User-Agent': 'analyze-worker (analyze.wicki.aero)', 'X-GitHub-Api-Version': '2022-11-28' } });
  if (res.status === 404) { if (cache && ctx) ctx.waitUntil(cache.put(cacheKey, new Response('', { status: 404, headers: { 'Cache-Control': `max-age=${TTL}` } }))); return null; }
  if (res.status === 401 || res.status === 403) throw new HttpError(502, 'GitHub refused the data token');
  if (!res.ok) throw new HttpError(502, `GitHub ${res.status}`);
  const text = await res.text();
  if (cache && ctx) ctx.waitUntil(cache.put(cacheKey, new Response(text, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${TTL}` } })));
  return text;
}

const safeFlight = (s) => /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : null;
const parseRows = (text) => { try { const j = JSON.parse(text); return Array.isArray(j) ? j : []; } catch { return []; } };

/** Closed flights with time span and row count (latest closing per flight name). */
export async function listRepoFlights(env, ctx) {
  const c = cfg(env);
  const idx = parseRows(await ghFile(env, `${c.dir}/_flights.json`, ctx) || '[]');
  const byName = new Map();
  for (const f of idx) { if (!f || !safeFlight(String(f.flight || ''))) continue; const prev = byName.get(f.flight); if (!prev || String(f.closed_at || '') > String(prev.closed_at || '')) byName.set(f.flight, f); }
  const out = [];
  for (const f of byName.values()) {
    const rows = parseRows(await ghFile(env, `${c.dir}/${f.flight}.json`, ctx) || '[]').filter((r) => r && !r.deleted);
    const ts = rows.map((r) => Date.parse(r.ts_utc || '')).filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
    out.push({ flight: f.flight, callsign: (rows.find((r) => r.callsign) || {}).callsign || '', rows: rows.length, closedAt: f.closed_at || null, closedBy: f.closed_by || '', first: ts.length ? new Date(ts[0]).toISOString() : null, last: ts.length ? new Date(ts[ts.length - 1]).toISOString() : null });
  }
  out.sort((a, b) => String(b.first || '').localeCompare(String(a.first || '')));
  return out;
}

/** Rows of one flight, raw as stored (the browser normalises them). */
export async function getRepoFlight(env, flight, ctx) {
  const c = cfg(env);
  const name = safeFlight(flight);
  if (!name) throw new HttpError(404, 'not found');
  const text = await ghFile(env, `${c.dir}/${name}.json`, ctx);
  if (text === null) throw new HttpError(404, 'flight not found in gb_flight_data');
  const rows = parseRows(text).filter((r) => r && !r.deleted);
  return { flight: name, rows, fetchedAt: new Date().toISOString() };
}

/** A media file of the repo (photo attachments) – phase 3 will use this for the photo viewer. */
export async function getRepoMedia(env, file, ctx) {
  const c = cfg(env);
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(file)) throw new HttpError(404, 'not found');
  const url = `https://api.github.com/repos/${c.repo}/contents/${c.dir}/media/${file}?ref=${encodeURIComponent(c.branch)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/vnd.github.raw+json', 'User-Agent': 'analyze-worker (analyze.wicki.aero)' } });
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, 'media not found');
  const type = /\.(jpe?g)$/i.test(file) ? 'image/jpeg' : /\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'application/octet-stream';
  return new Response(res.body, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
}
