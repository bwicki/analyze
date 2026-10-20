// Smoke test (Playwright, headless Chromium). Run all: `npm run smoke` (tests/smoke/run.mjs starts a static server).
// Bericht-PDF vom Server (0.13.0): the viewer page opened with ?v=<id>&pdf=1#report lands on the report, flags
// html[data-print-ready] once drawn (what Cloudflare Browser Rendering waits for) and shows the «PDF laden» link;
// the export step offers the server PDF for a public saved flight. The saved GeoJSON comes from the app itself.
import { chromium } from 'playwright';
import { env as ENV } from './env.mjs';
const shots = ENV.shots;
const fx = ENV.fixtures;
const browser = await chromium.launch(ENV.launch(['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']));
const page = await browser.newPage({ viewport: { width: 1100, height: 1500 } });
await page.addInitScript(() => { try { localStorage.setItem('analyze.welcomed', '1'); } catch {} });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const txt = async (sel) => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
let geojson = null;   // filled from the app once the CSV is analysed
const rec = { id: 'NEWFLJGH', title: 'GB26', url: 'https://analyze.wicki.aero/v/NEWFLJGH', createdAt: Date.UTC(2026, 9, 20, 6, 0), updatedAt: Date.UTC(2026, 9, 20, 6, 30), public: true, hasEvents: false, owner: { code: 'KQZMWB', displayName: 'Balthasar', org: 'Ballonteam Test', logo: false } };
await page.route('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: ENV.leafletStub }));
await page.route('**/api/**', async (route) => {
  const u = new URL(route.request().url()); const p = u.pathname; const m = route.request().method();
  const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*' };
  const j = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: H, body: JSON.stringify(o) });
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
  if (p === '/api/me') return j({ code: 'KQZMWB', displayName: 'Balthasar', logo: false, prefs: {}, flights: 0, bytes: 0, team: false });
  if (p === '/api/profiles') return j([]);
  if (p === '/api/flights' && m === 'POST') return j(rec);
  if (p === '/api/flights/NEWFLJGH/photos' || p === '/api/view/NEWFLJGH/photos') return j([]);
  if (p === '/api/view/NEWFLJGH' && m === 'GET') return j(rec);
  if (p === '/api/view/NEWFLJGH/track') return route.fulfill({ status: 200, contentType: 'application/geo+json', headers: H, body: geojson || '{}' });
  if (p === '/api/view/NEWFLJGH/report.pdf') return route.fulfill({ status: 200, contentType: 'application/pdf', headers: H, body: '%PDF-1.4 stub' });
  if (p.startsWith('/api/logo/')) return route.fulfill({ status: 404, headers: H, body: '' });
  return j({ error: 'not found' }, 404);
});
for (const h of ['https://nominatim.openstreetmap.org/**', 'https://photon.komoot.io/**', 'https://s3.amazonaws.com/**', 'https://api.open-meteo.com/**', 'https://tiles.openfreemap.org/**']) await page.route(h, (route) => route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }));
await page.route('https://unpkg.com/**', (route) => route.fulfill({ status: 503, body: '' }));
// 1) analyse a CSV, save → the export step shows the server PDF link next to the viewer link
await page.goto(`${ENV.base}/#start`, { waitUntil: 'networkidle' }); await page.fill('[data-code]', 'KQZMWB'); await page.click('[data-open]'); await page.waitForTimeout(600);
await page.goto(`${ENV.base}/#import`, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
await page.setInputFiles('input[type=file][multiple]:not([accept*="jpeg"])', [`${fx}/gb26_260828_2049.csv`]);
await page.waitForFunction(() => /Segment/.test(document.querySelector('.actionbar .status').textContent) && !/gelesen …/.test(document.querySelector('.actionbar .status').textContent), null, { timeout: 60000 });
geojson = await page.evaluate(async () => (await import('/src/flightio.js')).buildFlightPayload().geojson);
console.log('geojson from app:', geojson.length, 'chars');
await page.click('button[data-phase=export]'); await page.waitForTimeout(500);
console.log('pdf link before save:', await page.$$eval('[data-share] a[href$="/report.pdf"]', (a) => a.length));
await page.click('[data-act=save]'); await page.waitForTimeout(1500);
const links = await page.$$eval('[data-share] a[href$="/report.pdf"]', (a) => a.map((x) => x.getAttribute('href')));
console.log('pdf link after save:', links.length, '|', links[0]);
// 2) the renderer's view: ?v=<id>&pdf=1#report → report phase, readiness flag after the maps drew
await page.goto(`${ENV.base}/?v=NEWFLJGH&pdf=1#report`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.documentElement.hasAttribute('data-print-ready'), null, { timeout: 30000 });
console.log('pdf mode: hash', await page.evaluate(() => location.hash), '| html.pdf:', await page.evaluate(() => document.documentElement.classList.contains('pdf')), '| print-ready:', await page.evaluate(() => document.documentElement.getAttribute('data-print-ready')));
console.log('report title:', (await txt('[data-report] h1, [data-report] .title')).slice(0, 60), '| qr head:', !!(await page.$('[data-report] .qrhead svg')));
console.log('viewer buttons:', await page.$$eval('.noprint a[href$="/report.pdf"], .noprint [data-act=print]', (b) => b.map((x) => x.textContent.trim()).join(' | ')));
await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(200);
console.log('print media hides chrome:', await page.$$eval('header.top, .actionbar, footer.app, .noprint', (els) => els.every((e) => getComputedStyle(e).display === 'none')));
await page.screenshot({ path: `${shots}/pdf_mode.png`, fullPage: true });
await page.emulateMedia({ media: 'screen' });
console.log('errors:', errors.join('; ') || 'none');
await browser.close();
