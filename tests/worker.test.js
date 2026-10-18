// Worker API smoke tests with tiny in-memory stand-ins for D1 and R2 (only the statements the
// handlers use). They check routing, CORS, code auth, save/list/view/delete and the admin flow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { corsHeaders } from '../worker/src/index.js';
import { normalizeCode, isCode, isFlightId, randomCode, hashPin, verifyPin } from '../worker/src/auth.js';

// ---- fake D1: a handful of SQL shapes mapped onto JS arrays ------------------------------------------
function fakeD1() {
  const T = { codes: [], flights: [], admins: [], tokens: [], usage_log: [] };
  const run = (sql, args) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    const a = (i) => args[i - 1];
    let m;
    if (/^SELECT COUNT\(\*\) AS n FROM admins/.test(s)) return [{ n: T.admins.length }];
    if (/^SELECT COUNT\(\*\) AS n FROM codes/.test(s)) return [{ n: T.codes.length }];
    if (/^SELECT COUNT\(\*\) AS n FROM usage_log/.test(s)) return [{ n: T.usage_log.length }];
    if (/^SELECT COUNT\(\*\) AS n, COALESCE\(SUM\(track_bytes\), 0\) AS bytes, COALESCE\(SUM\(points\)/.test(s)) return [{ n: T.flights.length, bytes: T.flights.reduce((x, f) => x + f.track_bytes, 0), points: T.flights.reduce((x, f) => x + f.points, 0) }];
    if (/^SELECT COUNT\(\*\) AS n, COALESCE\(SUM\(track_bytes\), 0\) AS bytes FROM flights WHERE code/.test(s)) { const fs = T.flights.filter((f) => f.code === a(1)); return [{ n: fs.length, bytes: fs.reduce((x, f) => x + f.track_bytes, 0) }]; }
    if (/^SELECT code FROM codes WHERE code/.test(s)) return T.codes.filter((c) => c.code === a(1)).map((c) => ({ code: c.code }));
    if (/^SELECT (\*|code, display_name[^F]*|logo_key, logo_type, blocked|logo_key) FROM codes WHERE code/.test(s)) return T.codes.filter((c) => c.code === a(1));
    if (/^INSERT INTO codes/.test(s)) { T.codes.push({ code: a(1), display_name: a(2), lang: a(3), units: a(4), prefs: a(5), created_at: a(6), last_seen: a(6), logo_key: null, logo_type: null, blocked: 0 }); return []; }
    if (/^UPDATE codes SET last_seen/.test(s)) { const c = T.codes.find((x) => x.code === a(1)); if (c) c.last_seen = a(2); return []; }
    if (/^UPDATE codes SET display_name/.test(s)) { const c = T.codes.find((x) => x.code === a(1)); Object.assign(c, { display_name: a(2), lang: a(3), units: a(4), prefs: a(5) }); return []; }
    if (/^UPDATE codes SET logo_key = \?2/.test(s)) { const c = T.codes.find((x) => x.code === a(1)); Object.assign(c, { logo_key: a(2), logo_type: a(3) }); return []; }
    if (/^UPDATE codes SET logo_key = NULL/.test(s)) { const c = T.codes.find((x) => x.code === a(1)); Object.assign(c, { logo_key: null, logo_type: null }); return []; }
    if (/^UPDATE codes SET blocked/.test(s)) { const c = T.codes.find((x) => x.code === a(1)); c.blocked = a(2); return []; }
    if (/^DELETE FROM codes/.test(s)) { T.codes = T.codes.filter((c) => c.code !== a(1)); return []; }
    if (/^SELECT c\.\*, \(SELECT COUNT/.test(s)) return T.codes.map((c) => ({ ...c, n: T.flights.filter((f) => f.code === c.code).length, bytes: 0 }));
    if (/^SELECT \* FROM flights WHERE code/.test(s)) return T.flights.filter((f) => f.code === a(1));
    if (/^SELECT (\*|id|track_bytes) FROM flights WHERE id/.test(s)) return T.flights.filter((f) => f.id === a(1));
    if (/^SELECT \* FROM flights WHERE updated_at </.test(s)) return T.flights.filter((f) => f.updated_at < a(1));
    if (/^SELECT \* FROM flights ORDER BY/.test(s)) return T.flights.slice();
    if (/^SELECT f\.\*, c\.display_name/.test(s)) return T.flights.filter((f) => f.id === a(1)).map((f) => { const c = T.codes.find((x) => x.code === f.code); return { ...f, display_name: c.display_name, logo_key: c.logo_key, blocked: c.blocked }; });
    if (/^INSERT INTO flights/.test(s)) { T.flights.push({ id: a(1), code: a(2), title: a(3), start_ts: a(4), end_ts: a(5), stats: a(6), meta: a(7), track_key: a(8), track_bytes: a(9), points: a(10), events_key: a(11), public: a(12), created_at: a(13), updated_at: a(13) }); return []; }
    if (/^UPDATE flights SET title/.test(s)) { const f = T.flights.find((x) => x.id === a(1)); Object.assign(f, { title: a(2), start_ts: a(3), end_ts: a(4), stats: a(5), meta: a(6), track_bytes: a(7), points: a(8), public: a(9), updated_at: a(10), events_key: a(11) }); return []; }
    if (/^DELETE FROM flights/.test(s)) { T.flights = T.flights.filter((f) => f.id !== a(1)); return []; }
    if (/^INSERT INTO admins/.test(s)) { T.admins.push({ name: a(1), pin_hash: a(2), created_at: a(3), last_login: null }); return []; }
    if (/^SELECT name, pin_hash FROM admins/.test(s)) return T.admins.filter((x) => x.name === a(1));
    if (/^SELECT pin_hash FROM admins/.test(s)) return T.admins.filter((x) => x.name === a(1));
    if (/^UPDATE admins SET last_login/.test(s)) return [];
    if (/^UPDATE admins SET pin_hash/.test(s)) { const x = T.admins.find((y) => y.name === a(1)); x.pin_hash = a(2); return []; }
    if (/^INSERT INTO tokens/.test(s)) { T.tokens.push({ token: a(1), name: a(2), created_at: a(3), expires_at: a(4) }); return []; }
    if (/^SELECT token, name, expires_at FROM tokens/.test(s)) return T.tokens.filter((x) => x.token === a(1));
    if (/^DELETE FROM tokens WHERE token/.test(s)) { T.tokens = T.tokens.filter((x) => x.token !== a(1)); return []; }
    if (/^DELETE FROM tokens WHERE expires_at/.test(s)) { T.tokens = T.tokens.filter((x) => x.expires_at >= a(1)); return []; }
    if (/^INSERT INTO usage_log/.test(s)) { T.usage_log.push({ t: a(1), who: a(2), action: a(3), detail: a(4), ip: a(5) }); return []; }
    if (/^SELECT t, who, action, detail, ip FROM usage_log/.test(s)) return T.usage_log.slice().reverse().slice(0, a(1));
    if (/^DELETE FROM usage_log/.test(s)) { T.usage_log = T.usage_log.filter((x) => x.t >= a(1)); return []; }
    throw new Error('fake D1: unsupported SQL: ' + s);
  };
  return {
    T,
    prepare: (sql) => ({ bind: (...args) => ({ first: async () => run(sql, args)[0] || null, all: async () => ({ results: run(sql, args) }), run: async () => { run(sql, args); return { success: true }; } }), first: async () => run(sql, [])[0] || null, all: async () => ({ results: run(sql, []) }), run: async () => { run(sql, []); return { success: true }; } }),
  };
}
function fakeR2() {
  const objs = new Map();
  return {
    objs,
    put: async (key, data, opts) => { objs.set(key, { data: data instanceof Uint8Array ? data : typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data), opts }); },
    get: async (key) => { const o = objs.get(key); return o ? { body: o.data, size: o.data.byteLength } : null; },
    delete: async (key) => { objs.delete(key); },
  };
}

const env = () => ({ DB: fakeD1(), FILES: fakeR2(), APP_ORIGINS: 'https://analyze.wicki.aero', APP_URL: 'https://analyze.wicki.aero', TOKEN_HOURS: '12', RETENTION_DAYS: '730' });
const call = (e, method, path, { body, headers = {}, origin = 'https://analyze.wicki.aero' } = {}) => {
  const h = { Origin: origin, ...headers };
  let b = body;
  if (body && !(body instanceof FormData) && !(body instanceof Uint8Array) && typeof body !== 'string') { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  return worker.fetch(new Request('https://analyze-api.example.workers.dev' + path, { method, headers: h, body: b }), e, { waitUntil() {} });
};
const gz = async (text) => new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());

test('auth helpers', async () => {
  assert.equal(normalizeCode(' kq-zm wb '), 'KQZMWB');
  assert.ok(isCode(randomCode(6))); assert.ok(isFlightId(randomCode(8))); assert.ok(!isCode('KQZMW0'));
  const h = await hashPin('123456');
  assert.ok(await verifyPin('123456', h)); assert.ok(!(await verifyPin('654321', h)));
});

test('health, CORS, unknown route', async () => {
  const e = env();
  const r = await call(e, 'GET', '/api/health');
  assert.equal(r.status, 200); assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://analyze.wicki.aero');
  assert.deepEqual(Object.keys(corsHeaders(e, new Request('https://x/', { headers: { Origin: 'https://evil.example' } }))), []);
  const o = await call(e, 'OPTIONS', '/api/flights');
  assert.equal(o.status, 204); assert.match(o.headers.get('Access-Control-Allow-Headers'), /X-Code/);
  assert.equal((await call(e, 'GET', '/api/nothing')).status, 404);
  assert.equal((await call(e, 'GET', '/')).status, 404);
});

test('code: create, me, save flight, list, view, update, delete', async () => {
  const e = env();
  assert.equal((await call(e, 'GET', '/api/me', { headers: { 'X-Code': 'ABCDEF' } })).status, 401);
  const c = await (await call(e, 'POST', '/api/codes', { body: { displayName: 'Balthasar' } })).json();
  assert.ok(isCode(c.code));
  const H = { 'X-Code': c.code.toLowerCase() };
  const me = await (await call(e, 'GET', '/api/me', { headers: H })).json();
  assert.equal(me.displayName, 'Balthasar'); assert.equal(me.flights, 0); assert.equal(me.logo, false);
  // save
  const geo = JSON.stringify({ type: 'FeatureCollection', features: [] });
  const fd = new FormData();
  fd.set('meta', JSON.stringify({ title: 'GB26', stats: { takeoff: { time: '2026-08-28T23:31:31Z' }, landing: { time: '2026-08-30T16:34:12Z' } }, meta: { balloon: 'HB-QWV' }, points: 151584 }));
  fd.set('track', new Blob([await gz(geo)], { type: 'application/gzip' }), 'track.geojson.gz');
  const saved = await (await call(e, 'POST', '/api/flights', { body: fd, headers: H })).json();
  assert.ok(isFlightId(saved.id)); assert.equal(saved.url, `https://analyze.wicki.aero/v/${saved.id}`); assert.equal(saved.startTs, Date.UTC(2026, 7, 28, 23, 31, 31));
  // a non-gzip track is refused
  const bad = new FormData(); bad.set('meta', '{}'); bad.set('track', new Blob(['not gzip at all, really not'], { type: 'text/plain' }), 't');
  assert.equal((await call(e, 'POST', '/api/flights', { body: bad, headers: H })).status, 400);
  const list = await (await call(e, 'GET', '/api/flights', { headers: H })).json();
  assert.equal(list.length, 1); assert.equal(list[0].title, 'GB26'); assert.equal(list[0].meta.balloon, 'HB-QWV');
  // event log stored with the flight, readable by owner and viewer, removable with an empty part
  const fe = new FormData(); fe.set('meta', '{}'); fe.set('events', JSON.stringify([{ id: 'e1', ts_utc: '2026-08-29T00:11:00Z', type: 'ATC', atc_msg: 'Contact Langen' }]));
  const withEv = await (await call(e, 'PUT', `/api/flights/${saved.id}`, { body: fe, headers: H })).json();
  assert.equal(withEv.hasEvents, true);
  assert.equal((await (await call(e, 'GET', `/api/flights/${saved.id}/events`, { headers: H })).json())[0].atc_msg, 'Contact Langen');
  assert.equal((await (await call(e, 'GET', `/api/view/${saved.id}/events`)).json()).length, 1);
  const bad2 = new FormData(); bad2.set('meta', '{}'); bad2.set('events', '{"not":"array"}');
  assert.equal((await call(e, 'PUT', `/api/flights/${saved.id}`, { body: bad2, headers: H })).status, 400);
  const none = new FormData(); none.set('meta', '{}'); none.set('events', '');
  assert.equal((await (await call(e, 'PUT', `/api/flights/${saved.id}`, { body: none, headers: H })).json()).hasEvents, false);
  assert.deepEqual(await (await call(e, 'GET', `/api/flights/${saved.id}/events`, { headers: H })).json(), []);
  // repo event log needs the token
  assert.equal((await call(e, 'GET', '/api/events/flights', { headers: H })).status, 503);
  // own track + public viewer
  const tr = await call(e, 'GET', `/api/flights/${saved.id}/track`, { headers: H });
  assert.equal(tr.headers.get('X-Analyze-Encoding'), 'gzip');
  const inflated = await new Response(new Blob([await tr.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  assert.equal(inflated, geo);
  const view = await (await call(e, 'GET', `/api/view/${saved.id}`, { origin: 'https://other.example' })).json();
  assert.equal(view.owner.displayName, 'Balthasar'); assert.equal(view.title, 'GB26');
  assert.equal((await call(e, 'GET', `/api/view/${saved.id}/track`)).status, 200);
  // another code cannot see it
  const c2 = await (await call(e, 'POST', '/api/codes', { body: {} })).json();
  assert.equal((await call(e, 'GET', `/api/flights/${saved.id}`, { headers: { 'X-Code': c2.code } })).status, 404);
  // update title + private → viewer 404
  const up = await (await call(e, 'PUT', `/api/flights/${saved.id}`, { body: { title: 'GB26 · Gordon Bennett', public: false }, headers: H })).json();
  assert.equal(up.title, 'GB26 · Gordon Bennett'); assert.equal(up.public, false); assert.equal(up.meta.balloon, 'HB-QWV');
  assert.equal((await call(e, 'GET', `/api/view/${saved.id}`)).status, 404);
  // logo
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  assert.equal((await call(e, 'PUT', '/api/me/logo', { body: png, headers: { ...H, 'Content-Type': 'image/png' } })).status, 200);
  const lg = await call(e, 'GET', `/api/logo/${c.code}`);
  assert.equal(lg.status, 200); assert.equal(lg.headers.get('Content-Type'), 'image/png');
  assert.equal((await call(e, 'GET', `/api/logo/${c2.code}`)).status, 404);
  assert.equal((await call(e, 'PUT', '/api/me/logo', { body: 'x', headers: { ...H, 'Content-Type': 'text/html' } })).status, 415);
  // delete
  assert.equal((await call(e, 'DELETE', `/api/flights/${saved.id}`, { headers: H })).status, 200);
  assert.equal((await (await call(e, 'GET', '/api/flights', { headers: H })).json()).length, 0);
  assert.equal(e.FILES.objs.size, 1);                       // only the logo is left
});

test('admin: setup once, login, lists, block, delete', async () => {
  const e = env();
  assert.deepEqual(await (await call(e, 'GET', '/api/admin/setup')).json(), { needed: true });
  assert.equal((await call(e, 'POST', '/api/admin/setup', { body: { name: 'bwicki', pin: '123' } })).status, 400);
  assert.equal((await call(e, 'POST', '/api/admin/setup', { body: { name: 'bwicki', pin: '123456' } })).status, 200);
  assert.equal((await call(e, 'POST', '/api/admin/setup', { body: { name: 'x', pin: '123456' } })).status, 409);
  assert.equal((await call(e, 'POST', '/api/admin/login', { body: { name: 'bwicki', pin: 'wrong1' } })).status, 401);
  const { token } = await (await call(e, 'POST', '/api/admin/login', { body: { name: 'BWicki', pin: '123456' } })).json();
  assert.ok(token);
  assert.equal((await call(e, 'GET', '/api/admin/codes')).status, 401);
  const A = { Authorization: `Bearer ${token}` };
  const c = await (await call(e, 'POST', '/api/codes', { body: { displayName: 'Crew' } })).json();
  const codes = await (await call(e, 'GET', '/api/admin/codes', { headers: A })).json();
  assert.equal(codes.length, 1); assert.equal(codes[0].displayName, 'Crew');
  assert.equal((await call(e, 'POST', `/api/admin/codes/${c.code}/block`, { headers: A })).status, 200);
  assert.equal((await call(e, 'GET', '/api/me', { headers: { 'X-Code': c.code } })).status, 403);
  assert.equal((await call(e, 'POST', `/api/admin/codes/${c.code}/unblock`, { headers: A })).status, 200);
  assert.equal((await call(e, 'GET', '/api/me', { headers: { 'X-Code': c.code } })).status, 200);
  const stats = await (await call(e, 'GET', '/api/admin/stats', { headers: A })).json();
  assert.equal(stats.codes, 1); assert.equal(stats.retentionDays, 730);
  const log = await (await call(e, 'GET', '/api/admin/log?limit=50', { headers: A })).json();
  assert.ok(log.some((l) => l.action === 'admin.login') && log.some((l) => l.action === 'code.block'));
  assert.equal((await call(e, 'DELETE', `/api/admin/codes/${c.code}`, { headers: A })).status, 200);
  assert.equal((await call(e, 'GET', '/api/me', { headers: { 'X-Code': c.code } })).status, 401);
  assert.equal((await call(e, 'POST', '/api/admin/logout', { headers: A })).status, 200);
  assert.equal((await call(e, 'GET', '/api/admin/codes', { headers: A })).status, 401);
});
