// Smoke test (Playwright, headless Chromium). Run all: `npm run smoke` (tests/smoke/run.mjs starts a static server).
// Garmin LiveTrack card (0.15.0): list the sessions of a personal link (Worker stubbed), load one as GPX → import.
import { chromium } from 'playwright';
import { env as ENV } from './env.mjs';
const shots = ENV.shots;
const browser = await chromium.launch(ENV.launch(['--no-sandbox', '--disable-gpu']));
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.addInitScript(() => { try { localStorage.setItem('analyze.welcomed', '1'); } catch {} });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const t0 = Date.UTC(2026, 9, 15, 13, 31, 45);
const pts = Array.from({ length: 120 }, (_, k) => `<trkpt lat="${(44.9141 - k * 0.012).toFixed(6)}" lon="${(9.7159 + k * 0.009).toFixed(6)}"><ele>${(150 + k * 30).toFixed(1)}</ele><time>${new Date(t0 + k * 120000).toISOString()}</time><extensions><speed>${(8 + (k % 5)).toFixed(2)}</speed></extensions></trkpt>`).join('\n');
const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="analyze.wicki.aero (Garmin LiveTrack)" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Test</name><trkseg>${pts}</trkseg></trk></gpx>`;
let seen = [];
await page.route('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: ENV.leafletStub }));   // Leaflet stand-in records polylines
await page.route('**/api/**', async (route) => {
  const u = new URL(route.request().url()); const p = u.pathname, m = route.request().method();
  const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*' };
  const j = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: H, body: JSON.stringify(o) });
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
  if (p === '/api/me') return j({ code: 'KQZMWB', displayName: 'Balthasar', logo: false, prefs: {}, flights: 0, bytes: 0, team: false });
  if (p === '/api/profiles') return j([]);
  if (p === '/api/livetrack/sessions') { seen.push(u.search); if (/nixda/.test(u.search)) return j({ error: 'LiveTrack page not found' }, 404); return j({ name: 'bwi', passcode: false, sessions: [{ id: 'cb6e1cf7-1a0e-85b5-8fa7-9b9e8687f401', token: 'TOKEN1234567', name: 'San Giorgio Piacentino Oct 15, 2026', start: '2026-10-15T13:31:45Z', durationSec: 164669, distanceM: 905266, maxElevM: 4315, active: false, public: true }, { id: '83f0ea4a-efb0-8279-925a-08bf6b952501', token: 'TOKEN7654321', name: 'Flims Oct 3, 2026', start: '2026-10-03T05:19:15Z', durationSec: 6600, distanceM: 1411, maxElevM: 1424, active: false, public: true }] }); }
  if (p === '/api/livetrack/track') { seen.push(u.search); return route.fulfill({ status: 200, headers: { ...H, 'Content-Type': 'application/gpx+xml', 'X-Analyze-Name': 'livetrack_bwi_2026-10-15.gpx', 'X-Analyze-Points': '120' }, body: gpx }); }
  if (p.startsWith('/api/logo/')) return route.fulfill({ status: 404, headers: H, body: '' });
  return j({ error: 'not found' }, 404);
});
await page.goto(`${ENV.base}/#start`, { waitUntil: 'networkidle' }); await page.fill('[data-code]', 'KQZMWB'); await page.click('[data-open]'); await page.waitForTimeout(600);
await page.goto(`${ENV.base}/#import`, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
console.log('card:', await page.$$eval('[data-garmin]', (c) => c.length), '| button enabled:', await page.$eval('[data-act=ltList]', (b) => !b.disabled), '| sections hidden at start:', await page.$eval('[data-glive]', (e) => e.hidden), await page.$eval('[data-gshare]', (e) => e.hidden));
await page.fill('[data-g=link]', 'https://share.garmin.com/bwi'); await page.waitForTimeout(100);
console.log('share link → kind:', await page.textContent('[data-gkind]'), '| live hidden:', await page.$eval('[data-glive]', (e) => e.hidden), '| share hidden:', await page.$eval('[data-gshare]', (e) => e.hidden));
await page.fill('[data-g=link]', 'https://live.garmin.com/nixda'); await page.waitForTimeout(100);
console.log('live link → kind:', await page.textContent('[data-gkind]'), '| live hidden:', await page.$eval('[data-glive]', (e) => e.hidden), '| share hidden:', await page.$eval('[data-gshare]', (e) => e.hidden)); await page.click('[data-act=ltList]'); await page.waitForTimeout(500);
console.log('unknown →', await page.textContent('[data-ltstate]'));
await page.fill('[data-g=link]', 'https://live.garmin.com/bwi'); await page.click('[data-act=ltList]'); await page.waitForTimeout(600);
console.log('state:', await page.textContent('[data-ltstate]'), '| rows:', await page.$$eval('[data-ltsessions] .row', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join(' || ')));
await page.click('[data-ltsessions] [data-act=ltLoad][data-i="0"]'); await page.waitForTimeout(3000);
console.log('queries:', seen.map((s) => decodeURIComponent(s)).join(' ; '));
await page.waitForFunction(() => /livetrack_bwi/.test(document.querySelector('[data-table]')?.textContent || ''), null, { timeout: 20000 }).catch(() => null);
console.log('state after load:', await page.textContent('[data-ltstate]'));
console.log('files table:', (await page.textContent('[data-table]')).replace(/\s+/g, ' ').slice(0, 160));
console.log('status:', (await page.textContent('.actionbar .status')).replace(/\s+/g, ' ').slice(0, 120));
console.log('remembered:', await page.evaluate(() => JSON.parse(localStorage.getItem('analyze.settings')).garmin));
// sparse 2-min data (0.15.2): the gap threshold adapts, so Auswerten shows distance, vario and the track on the map
await page.evaluate(() => { window.__polys = []; });
await page.click('button[data-phase=analyze]'); await page.waitForTimeout(2500);
await page.click('[data-view] button[data-v="2d"]'); await page.waitForTimeout(1500);   // MapLibre is blocked here → 2D for the polyline check
console.log('analyze status:', (await page.textContent('.actionbar .status')).replace(/\s+/g, ' ').trim());
console.log('vario tile:', (await page.$$eval('.tile, .kpi, [data-kpi]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()).find((x) => /Steigen/.test(x)) || '')).slice(0, 60), '| polylines drawn:', await page.evaluate(() => (window.__polys || []).length));
await page.click('button[data-phase=clean]'); await page.waitForTimeout(800);
console.log('gaps line:', (await page.$$eval('.row', (r) => r.map((x) => x.textContent.replace(/\s+/g, ' ').trim()).find((x) => /Lücken/.test(x)) || '')).slice(0, 120));
await page.screenshot({ path: `${shots}/livetrack.png`, fullPage: true });
console.log('errors:', errors.join('; ') || 'none');
await browser.close();
