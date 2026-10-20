// Client of the analyze Worker (worker/src/index.js). All paths are prefixed with config.apiBase.
// Code users send their Kennung as X-Code; the Supermaster a bearer token. Tracks travel as gzipped
// GeoJSON (CompressionStream in the browser, stored untouched in R2, inflated again here).

import { config } from './config.js';
import { session } from './session.js';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const base = () => (config.apiBase || '').replace(/\/$/, '');

async function request(method, path, { body, headers = {}, raw = false, code = session.code, admin = false } = {}) {
  if (!config.apiBase) throw new ApiError(0, 'no server configured');
  const h = { ...headers };
  if (code) h['X-Code'] = code;
  if (admin && session.adminToken) h.Authorization = `Bearer ${session.adminToken}`;
  let b = body;
  if (body !== undefined && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && typeof body !== 'string') { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch(base() + path, { method, headers: h, body: b }); } catch (e) { throw new ApiError(0, 'network'); }
  if (raw) { if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError(res.status, d.error || res.statusText); } return res; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || res.statusText);
  return data;
}

export async function gzipText(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}
export async function gunzipToText(blob) {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

async function trackText(path, opts) {
  const res = await request('GET', path, { ...opts, raw: true });
  const blob = await res.blob();
  if (res.headers.get('X-Analyze-Encoding') === 'gzip' || res.headers.get('Content-Type') === 'application/gzip') return gunzipToText(blob);
  return blob.text();
}

function flightForm(flight, gzBlob, events) {
  const fd = new FormData();
  fd.set('meta', JSON.stringify(flight));
  if (gzBlob) fd.set('track', gzBlob, 'track.geojson.gz');
  if (events !== undefined && events !== null) fd.set('events', events);       // JSON text; '' removes the stored log
  return fd;
}

export const api = {
  enabled: () => !!config.apiBase,
  health: () => request('GET', '/api/health', { code: null }),
  codes: {
    create: (displayName, lang, units) => request('POST', '/api/codes', { body: { displayName, lang, units }, code: null }),
  },
  me: {
    get: (code = session.code) => request('GET', '/api/me', { code }),
    update: (patch) => request('PUT', '/api/me', { body: patch }),
    putLogo: (file) => request('PUT', '/api/me/logo', { body: file, headers: { 'Content-Type': file.type } }),
    deleteLogo: () => request('DELETE', '/api/me/logo'),
  },
  flights: {
    list: () => request('GET', '/api/flights'),
    /** flight: {title, stats, meta, points, public}; geojsonText: the full-resolution GeoJSON; eventsJson: raw log rows as JSON text ('' = none). */
    save: async (flight, geojsonText, eventsJson) => request('POST', '/api/flights', { body: flightForm(flight, await gzipText(geojsonText), eventsJson) }),
    update: async (id, flight, geojsonText = null, eventsJson) => request('PUT', `/api/flights/${id}`, { body: flightForm(flight, geojsonText === null ? null : await gzipText(geojsonText), eventsJson) }),
    get: (id) => request('GET', `/api/flights/${id}`),
    track: (id) => trackText(`/api/flights/${id}/track`),
    events: (id) => request('GET', `/api/flights/${id}/events`),
    remove: (id) => request('DELETE', `/api/flights/${id}`),
    preview: (id, blob) => request('PUT', `/api/flights/${id}/preview`, { body: blob, headers: { 'Content-Type': 'image/jpeg' } }),
  },
  view: {
    get: (id) => request('GET', `/api/view/${id}`, { code: null }),
    track: (id) => trackText(`/api/view/${id}/track`, { code: null }),
    events: (id) => request('GET', `/api/view/${id}/events`, { code: null }),
  },
  photos: {
    list: (flightId) => request('GET', `/api/flights/${flightId}/photos`),
    listPublic: (flightId) => request('GET', `/api/view/${flightId}/photos`, { code: null }),
    upload: (flightId, meta, image, thumb) => { const fd = new FormData(); fd.set('meta', JSON.stringify(meta)); fd.set('image', image, 'image.jpg'); fd.set('thumb', thumb, 'thumb.jpg'); return request('POST', `/api/flights/${flightId}/photos`, { body: fd }); },
    update: (flightId, id, patch) => request('PUT', `/api/flights/${flightId}/photos/${id}`, { body: patch }),
    remove: (flightId, id) => request('DELETE', `/api/flights/${flightId}/photos/${id}`),
    url: (id, thumb = false) => `${base()}/api/photos/${id}${thumb ? '/thumb' : ''}${session.code ? `?code=${encodeURIComponent(session.code)}` : ''}`,
  },
  profiles: {
    list: () => request('GET', '/api/profiles', { code: null }),
    create: (name, manufacturer, spec, isPublic = true) => request('POST', '/api/profiles', { body: { name, manufacturer, spec, public: isPublic } }),
    remove: (id) => request('DELETE', `/api/profiles/${encodeURIComponent(id)}`),
  },
  /** Ereignislog straight from bwicki/gb_flight_data (needs a Kennung; the Worker holds the token). */
  events: {
    repoFlights: () => request('GET', '/api/events/flights'),
    repoFlight: (flight) => request('GET', `/api/events/${encodeURIComponent(flight)}`),
    mediaUrl: (file) => `${base()}/api/events/media/${encodeURIComponent(file)}`,
  },
  admin: {
    setupNeeded: () => request('GET', '/api/admin/setup', { code: null }).then((r) => !!r.needed),
    setup: (name, pin) => request('POST', '/api/admin/setup', { body: { name, pin }, code: null }),
    login: (name, pin) => request('POST', '/api/admin/login', { body: { name, pin }, code: null }),
    logout: () => request('POST', '/api/admin/logout', { admin: true, code: null }).catch(() => null),
    me: () => request('GET', '/api/admin/me', { admin: true, code: null }),
    changePin: (oldPin, pin) => request('PUT', '/api/admin/pin', { body: { oldPin, pin }, admin: true, code: null }),
    stats: () => request('GET', '/api/admin/stats', { admin: true, code: null }),
    codes: () => request('GET', '/api/admin/codes', { admin: true, code: null }),
    flights: () => request('GET', '/api/admin/flights?limit=500', { admin: true, code: null }),
    log: (limit = 200) => request('GET', `/api/admin/log?limit=${limit}`, { admin: true, code: null }),
    block: (code, blocked) => request('POST', `/api/admin/codes/${code}/${blocked ? 'block' : 'unblock'}`, { admin: true, code: null }),
    team: (code, team) => request('POST', `/api/admin/codes/${code}/team`, { body: { team }, admin: true, code: null }),
    deleteCode: (code) => request('DELETE', `/api/admin/codes/${code}`, { admin: true, code: null }),
    deleteFlight: (id) => request('DELETE', `/api/admin/flights/${id}`, { admin: true, code: null }),
    cleanup: () => request('POST', '/api/admin/cleanup', { admin: true, code: null }),
    profiles: () => request('GET', '/api/admin/profiles', { admin: true, code: null }),
    deleteProfile: (id) => request('DELETE', `/api/admin/profiles/${encodeURIComponent(id)}`, { admin: true, code: null }),
  },
};
