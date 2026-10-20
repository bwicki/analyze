// Übergabe an ops.wicki.aero (0.10.0): thinning of the saved GeoJSON, the package, and the handover call with a stubbed
// ops Worker (fetch) and tiny D1/R2 stand-ins – the browser never sees the service token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { thinTrajectory, buildPackage, opsBriefings, opsHandover } from '../worker/src/ops.js';

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
    DB: { prepare: (sql) => ({ bind: (...a) => ({ first: async () => (/FROM flights WHERE id = \?1 AND code = \?2/.test(sql) ? (row && row.code === a[1] ? row : null) : /FROM flights WHERE id = \?1/.test(sql) ? row : null), run: async () => { calls.push(['sql', sql.slice(0, 30)]); return {}; } }) }) },
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
    if (/\/api\/handover\/briefings\?limit=20$/.test(url)) return new Response(JSON.stringify({ briefings: [{ id: 'abc123', no: '2026-004', trajectory: null }] }), { status: 200 });
    if (/\/api\/handover\/briefings\/abc123\/trajectory$/.test(url)) return new Response(JSON.stringify({ ok: true, briefingId: 'abc123', url: 'https://ops.wicki.aero/#/v/abc123?traj=1', receivedAt: '2026-10-20T14:00:00Z', points: 241 }), { status: 200 });
    if (/\/api\/handover\/briefings\/nixda\/trajectory$/.test(url)) return new Response(JSON.stringify({ error: 'briefing not found' }), { status: 404 });
    return new Response('{}', { status: 500 });
  };
  try {
    await assert.rejects(opsBriefings(env, { code: 'KQZMWB', team: false }), /Ballonteam/);
    const list = await opsBriefings(env, { code: 'KQZMWB', team: true });
    assert.equal(list.briefings[0].no, '2026-004'); assert.equal(seen[0].token, 'secret-token');
    await assert.rejects(opsHandover(env, { code: 'KQZMWB', team: true }, 'ABCD1234', {}), /briefingId/);
    await assert.rejects(opsHandover(env, { code: 'OTHER1', team: true }, 'ABCD1234', { briefingId: 'abc123' }), /not found/);   // not the owner
    const r = await opsHandover(env, { code: 'KQZMWB', team: true }, 'ABCD1234', { briefingId: 'abc123' }, null, null);
    assert.equal(r.ok, true); assert.equal(r.url, 'https://ops.wicki.aero/#/v/abc123?traj=1'); assert.equal(r.points, 241);
    const put = seen.find((s) => s.method === 'PUT');
    assert.equal(put.token, 'secret-token'); assert.equal(put.body.flight.url, 'https://analyze.wicki.aero/v/ABCD1234'); assert.equal(put.body.trajectory.features[0].geometry.coordinates.length, 241);
    // the Supermaster may hand over any flight
    const r2 = await opsHandover(env, { code: 'admin:bwicki', admin: true, team: true }, 'ABCD1234', { briefingId: 'abc123' });
    assert.equal(r2.ok, true);
    await assert.rejects(opsHandover(env, { code: 'KQZMWB', team: true }, 'ABCD1234', { briefingId: 'nixda' }), /not found on ops/);
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
