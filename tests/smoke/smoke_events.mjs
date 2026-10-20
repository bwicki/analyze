// Smoke test (Playwright, headless Chromium). Run all: `npm run smoke` (tests/smoke/run.mjs starts a static server).
// Event markers (0.14.0): legend under the profile, hover window with the messages (grouped when close together),
// tap toggles it, dots on the 2D map in their own pane (Leaflet stub records marker options), legend in the report.
import { chromium } from 'playwright';
import { env as ENV } from './env.mjs';
const shots = ENV.shots;
const fx = ENV.fixtures;
const browser = await chromium.launch(ENV.launch(['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']));
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.addInitScript(() => { try { localStorage.setItem('analyze.welcomed', '1'); } catch {} });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const txt = async (sel) => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
await page.route('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: ENV.leafletStub }));
await page.route('**/api/**', async (route) => {
  const p = new URL(route.request().url()).pathname; const m = route.request().method();
  const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*' };
  const j = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: H, body: JSON.stringify(o) });
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
  if (p === '/api/me') return j({ code: 'KQZMWB', displayName: 'Balthasar', logo: false, prefs: {}, flights: 0, bytes: 0, team: false });
  if (p === '/api/profiles') return j([]);
  if (p.startsWith('/api/logo/')) return route.fulfill({ status: 404, headers: H, body: '' });
  return j({ error: 'not found' }, 404);
});
for (const h of ['https://nominatim.openstreetmap.org/**', 'https://photon.komoot.io/**', 'https://s3.amazonaws.com/**', 'https://api.open-meteo.com/**', 'https://tiles.openfreemap.org/**', 'https://unpkg.com/**']) await page.route(h, (route) => route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }));
await page.goto(`${ENV.base}/#start`, { waitUntil: 'networkidle' }); await page.fill('[data-code]', 'KQZMWB'); await page.click('[data-open]'); await page.waitForTimeout(600);
await page.goto(`${ENV.base}/#import`, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
await page.setInputFiles('input[type=file][multiple]:not([accept*="jpeg"])', [`${fx}/gb26_260828_2049.csv`, `${fx}/gb26_260830_0242.csv`]);
await page.waitForFunction(() => /Segment/.test(document.querySelector('.actionbar .status').textContent) && !/gelesen …/.test(document.querySelector('.actionbar .status').textContent), null, { timeout: 60000 });
await page.click('button[data-phase=analyze]'); await page.waitForTimeout(1200);
await page.evaluate(() => { window.__markers = []; });
await page.setInputFiles('[data-events] input[type=file]', [`${fx}/eventlog_sample.json`]); await page.waitForTimeout(1200);
console.log('events card count:', await txt('[data-events] [data-count]'), '| legend:', await txt('[data-profile] .evlegend'));
console.log('profile dots (hit areas):', await page.$$eval('[data-profile] svg circle[data-ev]', (c) => c.length), '| map markers in events pane:', await page.evaluate(() => (window.__markers || []).filter((m) => m.pane === 'events').length));
// hover → window with the message (ATC 23:40 is the first event on the track)
const first = await page.$('[data-profile] svg circle[data-ev]');
await first.hover({ force: true }); await page.waitForTimeout(200);   // force: a neighbouring hit area overlaps (same group → same window)
console.log('tip after hover:', !(await page.$eval('[data-profile] .evtip', (e) => e.hidden)), '|', (await txt('[data-profile] .evtip')).slice(0, 110));
await page.screenshot({ path: `${shots}/events_tip.png` });
await page.mouse.move(5, 5); await page.waitForTimeout(150);
console.log('tip after leave:', !(await page.$eval('[data-profile] .evtip', (e) => e.hidden)));
// tap (click) toggles
await first.click({ force: true }); await page.waitForTimeout(150); const shown = !(await page.$eval('[data-profile] .evtip', (e) => e.hidden));
await first.click({ force: true }); await page.waitForTimeout(150); const hidden = await page.$eval('[data-profile] .evtip', (e) => e.hidden);
console.log('tap toggles: shown', shown, '| hidden again', hidden);
// hiding a type in the card hides its dots and its legend chip
await page.click('[data-events] .fchip[data-type=ATC]'); await page.waitForTimeout(500);
console.log('legend without ATC:', await txt('[data-profile] .evlegend'));
await page.click('[data-events] .fchip[data-type=ATC]'); await page.waitForTimeout(300);
// report carries the legend too
await page.click('button[data-phase=report]'); await page.waitForTimeout(1000);
console.log('report legend:', await txt('[data-repprofile] .evlegend'));
console.log('errors:', errors.join('; ') || 'none');
await browser.close();
