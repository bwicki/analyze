// Übergabe an ops.wicki.aero (0.10.0): thinning of the saved GeoJSON, the package, and the handover call with a stubbed
// ops Worker (fetch) and tiny D1/R2 stand-ins – the browser never sees the service token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { thinTrajectory, buildPackage, opsBriefings, opsHandover, opsDiag } from '../worker/src/ops.js';

const t0 = Date.UTC(2026, 7, 29, 6, 0);
const iso = (ms) => new Date(ms).toISOString();
function geo(nSec = 7200, stepSec = 5) {
  const times = [], co = [], vs = [], gs = [];
  for (let s = 0; s <= nSec; s += stepSec) { times.push(iso(t0 + s * 1000)); co.push([8 + s / 100000, 47 + s / 200000, 500 + s / 10]); vs.push(0.1); gs.push(8); }
  return { type: 'FeatureCollection', name: 'Test', features: [
    { type: 'Feature', properties: { kind: 'track', segment: 1, times, vs_ms: vs, gs_ms: gs, hdg_deg: times.map(() => 90) }, geometry: { type: 'LineString', coordinates: co } },
    { type: 'Feature', properties: { kind: 'takeoff', name: 'Start', time: iso(t0) }, geometry: { type: 'Point', coordinates: [8, 47, 500] } },
    { type: 'Feature', properties: { kind: 'marker', name: '07:00', time: iso(t0 + 3600000) }, geometry: { type: 'Point', coordinates: [8.03, 47.01, 800] } },
    { type: 'Feature', properties: { kind: 'landing', name: 'Landung', time: iso(t0 + nSec * 1000) }, geometry: { type: 'Point', coordinates: [8.07, 47.04, 1200] } },
  ] };
}

test('thinTrajectory: one point per 30 s, first and last kept, waypoints without markers, cap on points', () => {
  const g = geo(7200, 5);   // 1441 points at 5 s
  const th = thinTrajectory(g);
  const line = th.features.find((f) => f.geometry.type === 'LineString');
  assert.equal(line.geometry.coordinates.length, 241);   // 0, 30, … 7200 s
  assert.equal(line.properties.times[0], iso(t0)); assert.equal(line.properties.times.at(-1), iso(t0 + 7200000));
  assert.equal(line.properties.vs_ms.length, 241); assert.equal(line.properties.hdg_deg, undefined);
  assert.deepEqual(th.features.filter((f) => f.geometry.type === 'Point').map((f) => f.properties.kind), ['takeoff', 'landing']);
  assert.equal(th.properties.thinnedToSec, 30); assert.equal(th.properties.sourcePoints, 1441);
  // long flight: the step widens until the result stays below the cap
  const th2 = thinTrajectory(geo(40 * 3600, 10), 30000, 2000);
  const n2 = th2.features.find((f) => f.geometry.type === 'LineString').geometry.coordinates.length;
  assert.ok(n2 <= 2000 && n2 > 1000, `points ${n2}`); assert.equal(th2.properties.thinnedToSec, 120);
});

test('buildPackage: flight, stats, meta, events reference, no photos', () => {
  const row = { id: 'ABCD1234', title: 'GB26', start_ts: t0, end_ts: t0 + 7200000, points: 1441, public: 1, updated_at: 5, stats: JSON.stringify({ durationSec: 7200, events: { n: 12, source: 'gb_flight_data/GB26', counts: { Ballast: 4 } } }), meta: JSON.stringify({ balloon: 'HB-QWV', pic: 'B. Wicki' }) };
  const p = buildPackage(row, geo(), { app: 'https://analyze.wicki.aero' });
  assert.equal(p.source, 'analyze.wicki.aero'); assert.equal(p.format, 1);
  assert.deepEqual(p.flight, { id: 'ABCD1234', title: 'GB26', url: 'https://analyze.wicki.aero/v/ABCD1234', startTs: t0, endTs: t0 + 7200000, points: 1441, public: true, updatedAt: 5 });
  assert.equal(p.stats.durationSec, 7200); assert.equal(p.meta.balloon, 'HB-QWV');
  assert.deepEqual(p.events, { source: 'gb_flight_data/GB26', n: 12, counts: { Ballast: 4 } });
  assert.equal(p.photos, undefined); assert.equal(p.trajectory.type, 'FeatureCollection');
});

function fakeEnv(row, calls) {
  const gz = gzipSync(Buffer.from(JSON.stringify(geo())));
  return {
    OPS_HANDOVER_TOKEN: 'secret-token', OPS_API_URL: 'https://ops-api.test', APP_URL: 'https://analyze.wicki.aero', OPS_APP_URL: 'https://ops.wicki.aero',
    DB: { prepare: (sql) => ({ bind: (...a) => ({ first: async () => (/FROM flights WHERE id = \?1 AND code = \?2/.test(sql) ? (row && row.code === a[1] ? row : null) : /FROM flights WHERE id = \?1/.test(sql) ? row : null), run: async () => { calls.push({ sql: sql.slice(0, 60), args: a }); return {}; } }) }) },
    FILES: { get: async (key) => (row && key === row.track_key ? { body: new Blob([gz]).stream() } : null) },
  };
}

test('opsHandover: team or Supermaster only, saved track required, package goes to ops with the token', async () => {
  const calls = [];
  const row = { id: 'ABCD1234', code: 'KQZMWB', title: 'GB26', start_ts: t0, end_ts: t0 + 7200000, points: 1441, public: 1, updated_at: 5, track_key: 'tracks/ABCD1234.geojson.gz', stats: '{}', meta: '{}' };
  const env = fakeEnv(row, calls);
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url, method: init.method || 'GET', token: init.headers['X-Handover-Token'], body: init.body ? JSON.parse(init.body) : null });
    if (/\/api\/handover\/briefings\?limit=20$/.test(url)) return new Response(JSON.stringify({ briefings: [{ id: 'abc123', no: '2026-004', trajectory: null }], canCreate: true }), { status: 200 });
    if (/\/api\/handover\/briefings$/.test(url) && init.method === 'POST') return new Response(JSON.stringify({ ok: true, id: 'neu987', no: '2026-014', url: 'https://ops.wicki.aero/#/v/neu987?traj=1', receivedAt: '2026-10-30T10:00:00Z', points: 241 }), { status: 200 });
    if (/\/api\/handover\/briefings\/weg\/trajectory$/.test(url)) return new Response('', { status: 404 });
    if (/\/api\/handover\/briefings\/abc123\/trajectory$/.test(url)) return new Response(JSON.stringify({ ok: true, briefingId: 'abc123', url: 'https://ops.wicki.aero/#/v/abc123?traj=1', receivedAt: '2026-10-20T14:00:00Z', points: 241 }), { status: 200 });
    if (/\/api\/handover\/briefings\/nixda\/trajectory$/.test(url)) return new Response(JSON.stringify({ error: 'briefing not found' }), { status: 404 });
    return new Response('{}', { status: 500 });
  };
  try {
    await assert.rejects(opsBriefings(env, { code: 'KQZMWB', team: false }), /Ballonteam/);
    const list = await opsBriefings(env, { code: 'KQZMWB', team: true });
    assert.equal(list.briefings[0].no, '2026-004'); assert.equal(seen[0].token, 'b64u:' + Buffer.from('secret-token').toString('base64url'));
    await assert.rejects(opsHandover(env, { code: 'KQZMWB', team: true }, 'ABCD1234', {}), /briefingId/);
    await assert.rejects(opsHandover(env, { code: 'OTHER1', team: true }, 'ABCD1234', { briefingId: 'abc123' }), /not found/);   // not the owner
    const r = await opsHandover(env, { code: 'KQZMWB', team: true }, 'ABCD1234', { briefingId: 'abc123' }, null, null);
    assert.equal(r.ok, true); assert.equal(r.url, 'https://ops.wicki.aero/#/v/abc123?traj=1'); assert.equal(r.points, 241);
    const put = seen.find((s) => s.method === 'PUT');
    assert.equal(put.token, 'b64u:' + Buffer.from('secret-token').toString('base64url')); assert.equal(put.body.flight.url, 'https://analyze.wicki.aero/v/ABCD1234'); assert.equal(put.body.trajectory.features[0].geometry.coordinates.length, 241);
    // the Supermaster may hand over any flight
    const r2 = await opsHandover(env, { code: 'admin:bwicki', admin: true, team: true }, 'ABCD1234', { briefingId: 'abc123' });
    assert.equal(r2.ok, true);
    // 0.15.7: ops's error text travels with the 404; a failed handover is logged (status + text, never the token)
    await assert.rejects(opsHandover(env, { code: 'KQZMWB', team: true }, 'ABCD1234', { briefingId: 'nixda' }), /ops\.wicki\.aero: briefing not found \(PUT \/api\/handover\/briefings\/nixda\/trajectory\)/);
    await assert.rejects(opsHandover(env, { code: 'KQZMWB', team: true }, 'ABCD1234', { briefingId: 'weg' }), /ops\.wicki\.aero: not found/);
    const failed = calls.filter((c) => c.sql && /usage_log/.test(c.sql) && c.args && c.args[2] === 'ops_handover_failed');
    assert.equal(failed.length, 2); assert.match(failed[0].args[3], /ABCD1234 → nixda: 404 ops\.wicki\.aero: briefing not found/); assert.ok(!/secret-token/.test(failed[0].args[3]));
    // 0.15.7: «new» → POST /api/handover/briefings with the package (ops creates the flight; canCreate announced in the list)
    assert.equal(list.canCreate, true);
    const r3 = await opsHandover(env, { code: 'KQZMWB', team: true }, 'ABCD1234', { briefingId: 'new' });
    assert.equal(r3.created, true); assert.equal(r3.briefingId, 'neu987'); assert.equal(r3.no, '2026-014'); assert.equal(r3.url, 'https://ops.wicki.aero/#/v/neu987?traj=1');
    const post = seen.find((s) => s.method === 'POST');
    assert.equal(post.body.create.by, 'KQZMWB'); assert.equal(post.body.flight.id, 'ABCD1234'); assert.equal(post.body.trajectory.type, 'FeatureCollection');
    // no saved track → 409
    const env2 = fakeEnv({ ...row, track_key: null }, calls);
    await assert.rejects(opsHandover(env2, { code: 'KQZMWB', team: true }, 'ABCD1234', { briefingId: 'abc123' }), /no saved track/);
    // not configured → 503
    await assert.rejects(opsBriefings({ ...env, OPS_HANDOVER_TOKEN: '' }, { code: 'KQZMWB', team: true }), /not configured/);
  } finally { globalThis.fetch = realFetch; }
});

// ---- Garmin MapShare feed (0.12.0): address parsing and the Worker fetch with a stubbed Garmin
test('mapshare: feed URL from address, feed URL or name; Garmin hosts only; window bounded', async () => {
  const { feedUrl, fetchMapShare } = await import('../worker/src/mapshare.js');
  assert.equal(feedUrl('https://share.garmin.com/bwi').url, 'https://share.garmin.com/Feed/Share/bwi');
  assert.equal(feedUrl('https://share.garmin.com/Feed/Share/bwi/', { from: '2026-10-04T06:00:00Z', to: '2026-10-04T18:30:00Z' }).url, 'https://share.garmin.com/Feed/Share/bwi?d1=2026-10-04T06%3A00Z&d2=2026-10-04T18%3A30Z');
  assert.equal(feedUrl('bwi').name, 'bwi');
  assert.throws(() => feedUrl('https://example.com/bwi'), /Garmin/);
  assert.throws(() => feedUrl('https://share.garmin.com/'), /name/);
  assert.throws(() => feedUrl('bwi', { from: '2026-01-01T00:00:00Z', to: '2026-03-01T00:00:00Z' }), /31 days/);
  assert.throws(() => feedUrl('bwi', { from: 'gestern' }), /bad time/);
  const realFetch = globalThis.fetch; const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url, auth: init.headers.Authorization || null }); if (/pwonly/.test(url) && !init.headers.Authorization) return new Response('', { status: 401 }); if (/nix/.test(url)) return new Response('', { status: 404 }); return new Response('<?xml version="1.0"?><kml><Document><Placemark><TimeStamp><when>2026-10-04T06:00:00Z</when></TimeStamp><Point><coordinates>8.4,47.3,500</coordinates></Point></Placemark><Placemark><TimeStamp><when>2026-10-04T06:10:00Z</when></TimeStamp><Point><coordinates>8.41,47.31,520</coordinates></Point></Placemark></Document></kml>', { status: 200, headers: { 'Content-Type': 'application/vnd.google-earth.kml+xml' } }); };
  try {
    const res = await fetchMapShare({}, { code: 'KQZMWB' }, { share: 'https://share.garmin.com/bwi', from: '2026-10-04T06:00:00Z', to: '2026-10-04T18:00:00Z', pw: '' });
    assert.equal(res.headers.get('X-Analyze-Name'), 'mapshare_bwi_2026-10-04.kml'); assert.equal(res.headers.get('X-Analyze-Points'), '2'); assert.match(await res.text(), /<kml>/);
    assert.equal(seen[0].auth, null);
    await assert.rejects(fetchMapShare({}, { code: 'K' }, { share: 'pwonly' }), /password/);
    const ok = await fetchMapShare({}, { code: 'K' }, { share: 'pwonly', pw: 'geheim' }); assert.equal(ok.status, 200); assert.match(seen.at(-1).auth, /^Basic /);
    await assert.rejects(fetchMapShare({}, { code: 'K' }, { share: 'nix' }), /not found/);
  } finally { globalThis.fetch = realFetch; }
});

// ---- Garmin LiveTrack (0.15.0): address parsing, the page → API cookie/CSRF flow with a stubbed Garmin, GPX output
test('livetrack: addresses, sessions through the CSRF flow, one session as GPX without the artificial END point', async () => {
  const { parseLiveTrack, liveTrackSessions, liveTrackTrack, toPoints, toGpx } = await import('../worker/src/livetrack.js');
  assert.deepEqual(parseLiveTrack('https://live.garmin.com/bwi'), { kind: 'profile', name: 'bwi' });
  assert.deepEqual(parseLiveTrack('livetrack.garmin.com/bwi/'), { kind: 'profile', name: 'bwi' });
  assert.deepEqual(parseLiveTrack(' bwi '), { kind: 'profile', name: 'bwi' });
  assert.deepEqual(parseLiveTrack('https://livetrack.garmin.com/session/cb6e1cf7-1a0e-85b5-8fa7-9b9e8687f401/token/D7C33539C297952631463B463BD2BFC'), { kind: 'session', sessionId: 'cb6e1cf7-1a0e-85b5-8fa7-9b9e8687f401', token: 'D7C33539C297952631463B463BD2BFC' });
  assert.throws(() => parseLiveTrack('https://share.garmin.com/bwi'), /LiveTrack/);
  assert.throws(() => parseLiveTrack('https://live.garmin.com/'), /name/);
  assert.throws(() => parseLiveTrack(''), /missing/);
  const realFetch = globalThis.fetch; const seen = [];
  const page = '<html><head><meta name="csrf-token" content="CSRF123" data-sentry-element="meta"/></head><body>{"garminGuid":"g-1"}</body></html>';
  globalThis.fetch = async (url, init) => {
    seen.push({ url, h: init.headers });
    if (/livetrack\.garmin\.com\/(bwi|session\/[^/]+\/token\/[^/]+)$/.test(url)) { const h = new Headers({ 'Content-Type': 'text/html' }); h.append('Set-Cookie', 'livetrack_csrf=COOKIE1; Path=/; Secure'); h.append('Set-Cookie', '__cflb=LB; Path=/'); return new Response(page, { status: 200, headers: h }); }
    if (/\/nixda$/.test(url)) return new Response('', { status: 404 });
    if (init.headers['Livetrack-Csrf-Token'] !== 'CSRF123' || !/livetrack_csrf=COOKIE1/.test(init.headers.Cookie)) return new Response('{}', { status: 403 });
    if (/\/api\/personal-url\/bwi\/user$/.test(url)) return new Response(JSON.stringify({ garminGuid: 'g-1', userProfilePk: 1, isPasscodeRequired: false }), { status: 200 });
    if (/\/api\/v2\/user\/g-1\/profile-sessions$/.test(url)) return new Response(JSON.stringify({ activeSessions: [], completedSessions: [
      { sessionId: 'cb6e1cf7-1a0e-85b5-8fa7-9b9e8687f401', sessionToken: 'TOKEN1234567', sessionName: 'San Giorgio Piacentino Oct 15, 2026', startDate: '2026-10-15T13:31:45Z', duration: 'PT45H44M29.384S', distance: 905266, maxElevation: 4315.32, privacyLevels: ['EVERYONE'] },
      { sessionId: '83f0ea4a-efb0-8279-925a-08bf6b952501', sessionToken: 'TOKEN7654321', sessionName: 'Flims Oct 3, 2026', startDate: '2026-10-03T05:19:15Z', duration: 'PT1H50M', distance: 1411, maxElevation: 1423.66, privacyLevels: ['EVERYONE'] },
      { sessionId: '00000000-0000-0000-0000-000000000001', sessionToken: 'TOKENPRIVATE', sessionName: 'privat', startDate: '2026-10-01T05:00:00Z', duration: 'PT1H', distance: 10, maxElevation: 1, privacyLevels: ['FRIENDS'] }] }), { status: 200 });
    if (/\/api\/sessions\/cb6e1cf7-1a0e-85b5-8fa7-9b9e8687f401\/track-points\/common\?token=TOKEN1234567$/.test(url)) return new Response(JSON.stringify({ trackPoints: [
      { dateTime: '2026-10-15T13:31:45.000Z', position: { lat: 44.914137, lon: 9.715905 }, altitude: 132.6, speed: 0, eventTypes: ['BEGIN'] },
      { dateTime: '2026-10-15T14:53:45.000Z', position: { lat: 44.912946, lon: 9.712493 }, altitude: 347, speed: 2.52, eventTypes: [] },
      { dateTime: '2026-10-16T11:15:45.000Z', position: { lat: 37.839478, lon: 14.826093 }, altitude: 1236.6, speed: 5.77, eventTypes: [] },
      { dateTime: '2026-10-17T11:16:14.384Z', position: { lat: 37.839478, lon: 14.826093 }, altitude: 1236.6, speed: 5.77, eventTypes: ['END'] }] }), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  try {
    const s = await liveTrackSessions({}, { code: 'K' }, { share: 'https://live.garmin.com/bwi' });
    assert.equal(s.name, 'bwi'); assert.equal(s.sessions.length, 2);   // the FRIENDS-only session is left out
    assert.deepEqual(s.sessions[0], { id: 'cb6e1cf7-1a0e-85b5-8fa7-9b9e8687f401', token: 'TOKEN1234567', name: 'San Giorgio Piacentino Oct 15, 2026', start: '2026-10-15T13:31:45Z', durationSec: 164669, distanceM: 905266, maxElevM: 4315, active: false, public: true });
    assert.equal(seen[0].url, 'https://livetrack.garmin.com/bwi'); assert.match(seen[1].h.Cookie, /__cflb=LB/);
    const res = await liveTrackTrack({}, { code: 'K' }, { share: 'live.garmin.com/bwi', session: s.sessions[0].id, token: s.sessions[0].token, name: s.sessions[0].name });
    assert.equal(res.headers.get('X-Analyze-Name'), 'livetrack_bwi_2026-10-15.gpx'); assert.equal(res.headers.get('X-Analyze-Points'), '3');   // END point dropped
    const gpx = await res.text();
    assert.match(gpx, /<trkpt lat="44\.914137" lon="9\.715905"><ele>132\.6<\/ele><time>2026-10-15T13:31:45\.000Z<\/time><extensions><speed>0\.00<\/speed>/);
    assert.ok(!gpx.includes('2026-10-17T11:16:14')); assert.match(gpx, /<name>San Giorgio Piacentino Oct 15, 2026 2026-10-15 13:31 UTC<\/name>/);
    // a session link works without the profile
    const res2 = await liveTrackTrack({}, { code: 'K' }, { share: 'https://livetrack.garmin.com/session/cb6e1cf7-1a0e-85b5-8fa7-9b9e8687f401/token/TOKEN1234567' });
    assert.equal(res2.headers.get('X-Analyze-Name'), 'livetrack_session_2026-10-15.gpx');
    await assert.rejects(liveTrackSessions({}, { code: 'K' }, { share: 'nixda' }), /not found/);
    await assert.rejects(liveTrackTrack({}, { code: 'K' }, { share: 'bwi', session: 'x', token: 'y' }), /session and token/);
  } finally { globalThis.fetch = realFetch; }
  // toPoints: bad rows skipped, sorted, END kept when it is a real move
  const pts = toPoints([{ dateTime: 'x' }, { dateTime: '2026-01-01T00:10:00Z', position: { lat: 1, lon: 2 }, altitude: 5 }, { dateTime: '2026-01-01T00:00:00Z', position: { lat: 0, lon: 0 } }, { dateTime: '2026-01-01T00:00:00Z', position: { lat: 1, lon: 1 } }, { dateTime: '2026-01-01T01:00:00Z', position: { lat: 3, lon: 3 }, eventTypes: ['END'] }]);
  assert.deepEqual(pts.map((p) => [p.lat, p.lon]), [[1, 1], [1, 2], [3, 3]]);
  assert.match(toGpx(pts.slice(0, 1), { name: 'A & B' }), /<name>A &amp; B<\/name>/);
});

// 0.15.8: with the service binding OPS the Worker talks to ops through env.OPS.fetch (no public hop); the diag reports status codes only
test('ops service binding: opsFetch uses env.OPS.fetch when bound; opsDiag reports base, binding and statuses without the token', async () => {
  const calls = [];
  const row = { id: 'ABCD1234', code: 'KQZMWB', title: 'GB26', start_ts: t0, end_ts: t0 + 7200000, points: 1441, public: 1, updated_at: 5, track_key: 'tracks/ABCD1234.geojson.gz', stats: '{}', meta: '{}' };
  const bound = [];
  const env = { ...fakeEnv(row, calls), OPS: { fetch: async (url, init) => { bound.push({ url, token: (init && init.headers || {})['X-Handover-Token'] }); return new Response(JSON.stringify(/diag$/.test(url) ? { configured: true } : { briefings: [{ id: 'abc123' }], canCreate: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } } };
  const realFetch = globalThis.fetch; let direct = 0;
  globalThis.fetch = async () => { direct++; return new Response('<html>404</html>', { status: 404, headers: { 'Content-Type': 'text/html' } }); };
  try {
    const list = await opsBriefings(env, { code: 'KQZMWB', team: true });
    assert.equal(list.briefings[0].id, 'abc123'); assert.equal(bound.length, 1); assert.equal(direct, 0);
    const d = await opsDiag(env);
    assert.equal(d.base, 'https://ops-api.test'); assert.equal(d.binding, true); assert.equal(d.tokenSet, true);
    assert.equal(d.direct.status, 404); assert.equal(d.viaBinding.status, 200); assert.deepEqual(d.list, { ok: true, n: 1, canCreate: false });
    assert.ok(!JSON.stringify(d).includes('secret-token'));
    // without the binding the public address is used
    const env2 = fakeEnv(row, calls); const d2 = await opsDiag(env2);
    assert.equal(d2.binding, false); assert.equal(d2.viaBinding, undefined); assert.equal(d2.list.ok, false); assert.match(d2.list.error, /not found/);
  } finally { globalThis.fetch = realFetch; }
});
