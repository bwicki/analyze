// Smoke test (Playwright, headless Chromium). Run all: `npm run smoke` (tests/smoke/run.mjs starts a static server).
import { chromium } from 'playwright';
import { env as ENV } from './env.mjs';
// Reproduce: Import → Bereinigen → Auswerten → Bericht → back to Bereinigen → change start/end → Auswerten → Bericht.
import { readFileSync } from 'node:fs';
const shots = ENV.shots;
const fx = ENV.fixtures;
const browser = await chromium.launch(ENV.launch(['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']));
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.addInitScript(() => { try { localStorage.setItem('analyze.welcomed', '1'); } catch {} });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const txt = async (sel) => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
const status = () => txt('.actionbar .status');
await page.route('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: ENV.leafletStub }));
await page.route('**/api/**', async (route) => {
  const u = new URL(route.request().url()); const p = u.pathname; const m = route.request().method();
  const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*' };
  const j = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: H, body: JSON.stringify(o) });
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
  if (p === '/api/me') return j({ code: 'KQZMWB', displayName: 'Balthasar', logo: false, prefs: {}, flights: 0, bytes: 0, team: true });
  if (p === '/api/profiles') return j([]);
  if (p === '/api/flights' && m === 'POST') return j({ id: 'NEWFLJGH', title: 'GB26', url: 'https://analyze.wicki.aero/v/NEWFLJGH', createdAt: Date.UTC(2026, 9, 20, 6, 0), updatedAt: Date.UTC(2026, 9, 20, 6, 30), public: true });
  if (p === '/api/flights/NEWFLJGH' && m === 'PUT') return j({ id: 'NEWFLJGH', title: 'GB26', createdAt: Date.UTC(2026, 9, 20, 6, 0), updatedAt: Date.now(), public: true });
  if (p === '/api/flights/NEWFLJGH/photos') return j([]);
  if (p.startsWith('/api/logo/')) return route.fulfill({ status: 404, headers: H, body: '' });
  return j({ error: 'not found' }, 404);
});
for (const h of ['https://nominatim.openstreetmap.org/**', 'https://photon.komoot.io/**', 'https://s3.amazonaws.com/**', 'https://api.open-meteo.com/**', 'https://tiles.openfreemap.org/**']) await page.route(h, (route) => route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }));
await page.route('https://unpkg.com/**', (route) => route.fulfill({ status: 503, body: '' }));   // no MapLibre here → falls back to 2D
await page.goto(`${ENV.base}/#start`, { waitUntil: 'networkidle' }); await page.fill('[data-code]', 'KQZMWB'); await page.click('[data-open]'); await page.waitForTimeout(600);
await page.goto(`${ENV.base}/#import`, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
await page.setInputFiles('input[type=file][multiple]:not([accept*="jpeg"])', [`${fx}/gb26_260828_2049.csv`, `${fx}/gb26_260830_0242.csv`]);
await page.waitForFunction(() => /Segment/.test(document.querySelector('.actionbar .status').textContent) && !/gelesen …/.test(document.querySelector('.actionbar .status').textContent), null, { timeout: 60000 });
await page.click('button[data-phase=analyze]'); await page.waitForTimeout(2500);
console.log('view after fallback:', await page.$eval('[data-view] button.on', (b) => b.dataset.v), '| map hidden:', await page.$eval('[data-map]', (m) => m.hidden), '| toast:', (await txt('.toast')).slice(0, 60));
console.log('marker select:', await page.inputValue('[data-marker]'), '| exag select:', await page.inputValue('[data-exag]'));
console.log('time markers (41 h → 30 min):', await page.evaluate(() => (window.__markers || []).length), 'divIcon markers;', await page.$$eval('svg.chart circle[r="2.5"]', (c) => c.length), 'profile marker dots');
console.log('extreme symbols on profile:', await page.$$eval('svg.chart text[paint-order]', (ts) => ts.map((x) => x.lastChild && x.lastChild.textContent).filter((x) => /^[◆▶▲▼]$/.test(x || '')).join(' ')));
console.log('locate buttons:', await page.$$eval('[data-act=locate]', (b) => b.map((x) => `${x.dataset.kind}:${x.textContent}`).join(' ')));
await page.click('[data-tiles] [data-act=locate][data-kind=alt]'); await page.waitForTimeout(400); await page.keyboard.press('Escape'); await page.waitForTimeout(200);   // 0.9.1: opens the detail viewer
console.log('readout after locate alt:', (await txt('[data-readout]')).slice(0, 90));
console.log('pinned group on profile:', await page.$eval('svg.chart [data-pinned]', (g) => g.innerHTML.length > 0));
await page.click('[data-stats] [data-act=locate][data-kind=down]'); await page.waitForTimeout(400); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
console.log('readout after locate sink:', (await txt('[data-readout]')).slice(0, 90));
console.log('accent var:', await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), '| active chip bg:', await page.$eval('.ph.active .n', (n) => getComputedStyle(n).backgroundColor));
await page.click('button[data-phase=report]'); await page.waitForTimeout(1200);
console.log('report extremes:', await page.$$eval('[data-report] svg.chart text[paint-order]', (ts) => ts.map((x) => x.lastChild && x.lastChild.textContent).filter((x) => /^[◆▶▲▼]$/.test(x || '')).join(' ')), '| report map symbol markers:', await page.evaluate(() => (window.__markers || []).filter((m) => m.icon && /xmark/.test(m.icon.className)).length));
console.log('errors:', errors.join('\n') || 'none');
await browser.close();
