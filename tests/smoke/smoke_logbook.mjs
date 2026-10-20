// Smoke test (Playwright, headless Chromium). Run all: `npm run smoke` (tests/smoke/run.mjs starts a static server).
import { chromium } from 'playwright';
import { env as ENV } from './env.mjs';
const shots = ENV.shots;
const browser = await chromium.launch(ENV.launch(['--no-sandbox', '--disable-gpu']));
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => { try { localStorage.setItem('analyze.welcomed', '1'); } catch {} window.__printed = 0; window.print = () => { window.__printed++; window.__printClass = document.body.className; }; });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const iso = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo - 1, d, h, mi)).toISOString();
const flights = [
  { id: 'A1', title: 'GB26', startTs: Date.UTC(2026, 7, 28, 23, 31), points: 9196, public: true, url: 'https://analyze.wicki.aero/v/A1', stats: { takeoff: { time: iso(2026, 8, 28, 23, 31), lat: 51.55, lon: 6.97 }, landing: { time: iso(2026, 8, 30, 16, 34), lat: 60.47, lon: 26.4 }, durationSec: 147780, nightSec: 44940, distanceM: 1590000, straightM: 1555000, altMaxM: 947, landings: 1, startPlace: 'DE-Gladbeck', landPlace: 'FI-Loviisa', trackers: ['GB-Instrument CSV'] }, meta: { balloon: 'HB-QWV', pic: 'B. Wicki', purpose: 'competition', event: 'GB26' } },
  { id: 'B2', title: 'Hochdorf', startTs: Date.UTC(2025, 5, 3, 5, 10), points: 5400, public: true, url: 'https://analyze.wicki.aero/v/B2', stats: { takeoff: { time: iso(2025, 6, 3, 5, 10), lat: 47.1, lon: 8.3 }, landing: { time: iso(2025, 6, 3, 6, 40), lat: 47.2, lon: 8.5 }, durationSec: 5400, nightSec: 0, distanceM: 18500, straightM: 17000, altMaxM: 1200, landings: 1, startPlace: 'CH-Hochdorf', landPlace: 'CH-Sins' }, meta: { balloon: 'HB-QWZ', pic: 'B. Wicki', pax: 'A, B, C', purpose: 'commercial' } },
];
await page.route('**/api/**', async (route) => {
  const p = new URL(route.request().url()).pathname, m = route.request().method();
  const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  const j = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: H, body: JSON.stringify(o) });
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
  if (p === '/api/me') return j({ code: 'KQZMWB', displayName: 'Balthasar', logo: false, prefs: { org: 'Ballonteam Test' }, flights: 2, bytes: 1000, team: true });
  if (p === '/api/flights' && m === 'GET') return j(flights);
  if (p === '/api/profiles') return j([]);
  if (p.startsWith('/api/logo/')) return route.fulfill({ status: 404, headers: H, body: '' });
  return j({ error: 'not found' }, 404);
});
await page.goto(`${ENV.base}/#start`, { waitUntil: 'networkidle' }); await page.fill('[data-code]', 'KQZMWB'); await page.click('[data-open]'); await page.waitForTimeout(800);
console.log('hash:', await page.evaluate(() => location.hash), '| logbook button:', await page.$$eval('[data-act=logbook]', (b) => b.map((x) => x.textContent).join()));
await page.click('[data-act=logbook]'); await page.waitForTimeout(400);
console.log('modal:', await page.$$eval('.modal.logbook', (m) => m.length), '| rows:', await page.$$eval('table.tbl.lb tbody tr', (r) => r.length), '| years:', await page.$$eval('[data-year] option', (o) => o.map((x) => x.value).join(',')), '| total:', (await page.textContent('table.tbl.lb tfoot')).replace(/\s+/g, ' ').trim().slice(0, 80));
console.log('first row:', (await page.textContent('table.tbl.lb tbody tr')).replace(/\s+/g, ' ').trim().slice(0, 160));
await page.screenshot({ path: `${shots}/logbook.png` });
await page.selectOption('[data-year]', '2025'); await page.waitForTimeout(200);
console.log('2025 rows:', await page.$$eval('table.tbl.lb tbody tr', (r) => r.length), '| label:', await page.textContent('[data-year-label]'));
const dl = page.waitForEvent('download'); await page.click('.modal.logbook [data-act=csv]'); const d = await dl; console.log('csv:', d.suggestedFilename());
await page.click('.modal.logbook [data-act=print]'); await page.waitForTimeout(300);
console.log('print called:', await page.evaluate(() => [window.__printed, window.__printClass]));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
console.log('closed:', await page.$$eval('.modal.logbook', (m) => m.length), '| errors:', errors.join('; ') || 'none');
await browser.close();
