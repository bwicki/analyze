// Übergabe an ops.wicki.aero (0.10.0, Konzept Phase 3): the Worker hands the saved flight – trajectory as
// GeoJSON (thinned to ~30 s), Kennzahlen, Stammdaten, viewer link, Ereignislog reference – to the ops Worker,
// authenticated with a service token both Workers hold (secret OPS_HANDOVER_TOKEN). The browser never sees
// the token; it only picks the target briefing from the list ops returns. Only Kennungen with the team flag
// and the Supermaster may hand over (the client shows the function to the Ballonteam PIN and the Supermaster).

import { HttpError } from './auth.js';
import { logAction } from './log.js';

const OPS_DEFAULT = 'https://briefing-api.balthasar.workers.dev';
const STEP_MS = 30000;            // thinning of the trajectory (concept: track_merged every 30 s)
const MAX_POINTS = 6000;
const LIST_LIMIT = 20;            // decision 20.10.2026: always the last 20 briefings

function cfg(env) {
  if (!env.OPS_HANDOVER_TOKEN) throw new HttpError(503, 'ops handover not configured (OPS_HANDOVER_TOKEN missing)');
  return { base: (env.OPS_API_URL || OPS_DEFAULT).replace(/\/+$/, ''), token: env.OPS_HANDOVER_TOKEN, app: (env.APP_URL || 'https://analyze.wicki.aero').replace(/\/+$/, '') };
}
const allowed = (user) => !!(user && (user.admin || user.team));

async function opsFetch(env, path, init = {}) {
  const c = cfg(env);
  const res = await fetch(`${c.base}${path}`, { ...init, headers: { ...(init.headers || {}), 'X-Handover-Token': c.token, 'User-Agent': 'analyze-worker (analyze.wicki.aero)' } });
  if (res.status === 401 || res.status === 403) throw new HttpError(502, 'ops refused the handover token');
  if (res.status === 404) throw new HttpError(404, 'briefing not found on ops');
  if (!res.ok) throw new HttpError(502, `ops ${res.status}`);
  return res.json();
}

/** The last briefings on ops (id, number, date, site, balloon, status, whether a trajectory is already there). */
export async function opsBriefings(env, user) {
  if (!allowed(user)) throw new HttpError(403, 'handover only for the Ballonteam and the Supermaster');
  const j = await opsFetch(env, `/api/handover/briefings?limit=${LIST_LIMIT}`);
  return { briefings: Array.isArray(j.briefings) ? j.briefings : [], ops: (env.OPS_APP_URL || 'https://ops.wicki.aero') };
}

/** Flight row for the handover: the owner's flight, or any flight for the Supermaster. */
async function flightRow(env, user, id) {
  const row = user.admin
    ? await env.DB.prepare('SELECT * FROM flights WHERE id = ?1').bind(id).first()
    : await env.DB.prepare('SELECT * FROM flights WHERE id = ?1 AND code = ?2').bind(id, user.code).first();
  if (!row) throw new HttpError(404, 'flight not found');
  return row;
}

async function gunzipJson(body) {
  const ds = new DecompressionStream('gzip');
  const text = await new Response(body.pipeThrough(ds)).text();
  return JSON.parse(text);
}

/**
 * Thin the saved GeoJSON (full resolution) to one point per STEP_MS and at most MAX_POINTS; keeps the
 * analyze layout (LineString per segment with times, vs_ms, gs_ms; take-off/landing points) so ops can draw it.
 */
export function thinTrajectory(geo, stepMs = STEP_MS, maxPoints = MAX_POINTS) {
  const feats = Array.isArray(geo && geo.features) ? geo.features : [];
  const lines = feats.filter((f) => f && f.geometry && f.geometry.type === 'LineString');
  let total = 0; for (const l of lines) total += l.geometry.coordinates.length;
  let step = stepMs;
  // make sure the result stays below maxPoints: widen the step when the flight is long
  for (let k = 0; k < 8 && estimate(lines, step) > maxPoints; k++) step *= 2;
  const out = [];
  for (const l of lines) {
    const p = l.properties || {}, co = l.geometry.coordinates, times = Array.isArray(p.times) ? p.times : [];
    const keep = []; let last = -Infinity;
    for (let i = 0; i < co.length; i++) {
      const t = times[i] ? Date.parse(times[i]) : NaN;
      if (i === co.length - 1 || !Number.isFinite(t) || t - last >= step) { keep.push(i); if (Number.isFinite(t)) last = t; }
    }
    const pick = (arr) => (Array.isArray(arr) ? keep.map((i) => (arr[i] === undefined ? null : arr[i])) : undefined);
    out.push({ type: 'Feature', properties: { kind: 'track', segment: p.segment, restart: !!p.restart, times: pick(times), vs_ms: pick(p.vs_ms), gs_ms: pick(p.gs_ms) }, geometry: { type: 'LineString', coordinates: keep.map((i) => co[i]) } });
  }
  for (const f of feats) if (f && f.geometry && f.geometry.type === 'Point' && f.properties && ['takeoff', 'landing', 'intermediate'].includes(f.properties.kind)) out.push(f);
  return { type: 'FeatureCollection', name: geo.name || '', properties: { generator: 'analyze.wicki.aero', thinnedToSec: step / 1000, sourcePoints: total }, features: out };
}
function estimate(lines, step) {
  let n = 0;
  for (const l of lines) { const times = (l.properties || {}).times || []; const t0 = Date.parse(times[0]), t1 = Date.parse(times[times.length - 1]); n += Number.isFinite(t0) && Number.isFinite(t1) ? Math.ceil((t1 - t0) / step) + 1 : l.geometry.coordinates.length; }
  return n;
}

/** Build the package ops receives (no photos – decision 20.10.2026; the event log only as a reference). */
export function buildPackage(row, geo, { app }) {
  const stats = parse(row.stats), meta = parse(row.meta);
  return {
    source: 'analyze.wicki.aero', format: 1, sentAt: new Date().toISOString(),
    flight: { id: row.id, title: row.title || '', url: `${app}/v/${row.id}`, startTs: row.start_ts, endTs: row.end_ts, points: row.points, public: row.public !== 0, updatedAt: row.updated_at },
    stats, meta,
    events: stats.events ? { source: stats.events.source || '', n: stats.events.n || 0, counts: stats.events.counts || {} } : null,
    trajectory: thinTrajectory(geo),
  };
}
const parse = (s) => { try { const j = JSON.parse(s || '{}'); return j && typeof j === 'object' ? j : {}; } catch { return {}; } };

/** Hand the flight over to the chosen briefing; returns what ops answered (link to the briefing's trajectory page). */
export async function opsHandover(env, user, id, body, request, ctx) {
  if (!allowed(user)) throw new HttpError(403, 'handover only for the Ballonteam and the Supermaster');
  const briefingId = String(body && body.briefingId || '').trim();
  if (!/^[a-z0-9]{1,40}$/.test(briefingId)) throw new HttpError(400, 'briefingId missing');
  const row = await flightRow(env, user, id);
  const obj = row.track_key ? await env.FILES.get(row.track_key) : null;
  if (!obj) throw new HttpError(409, 'flight has no saved track');
  const geo = await gunzipJson(obj.body);
  const c = cfg(env);
  const pkg = buildPackage(row, geo, { app: c.app });
  const res = await opsFetch(env, `/api/handover/briefings/${encodeURIComponent(briefingId)}/trajectory`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pkg) });
  if (ctx) ctx.waitUntil(logAction(env, user.code, 'ops_handover', `${id} → ${briefingId}`, request));
  return { ok: true, briefingId, url: res.url || `${env.OPS_APP_URL || 'https://ops.wicki.aero'}/#/v/${briefingId}/traj`, receivedAt: res.receivedAt || null, points: pkg.trajectory.features.filter((f) => f.geometry.type === 'LineString').reduce((n, f) => n + f.geometry.coordinates.length, 0) };
}
