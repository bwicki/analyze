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
await page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; setTimeout(() => window.dispatchEvent(new Event('afterprint')), 50); }; });
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
await page.goto(`${ENV.base}/#start`, { waitUntil: 'networkidle' }); await page.fill('[data-code]', 'KQZMWB'); await page.click('[data-open]'); await page.waitForTimeout(600);
await page.goto(`${ENV.base}/#import`, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
await page.setInputFiles('input[type=file][multiple]:not([accept*="jpeg"])', [`${fx}/gb26_260828_2049.csv`, `${fx}/gb26_260830_0242.csv`]);
await page.waitForFunction(() => /Segment/.test(document.querySelector('.actionbar .status').textContent) && !/gelesen …/.test(document.querySelector('.actionbar .status').textContent), null, { timeout: 60000 });
console.log('phase chips:', await page.$$eval('nav.phases .ph', (b) => b.map((x) => x.textContent.trim()).join(' | ')));
await page.click('button[data-phase=report]'); await page.waitForTimeout(800);
console.log('report print button:', !!(await page.$('[data-act=print]')), '| note:', (await txt('.noprint .muted.small')).slice(0, 80), '| placeholder:', (await txt('[data-report] .qrhead.placeholder')).slice(0, 80));
console.log('next label:', (await txt('.actionbar .btn.primary')).slice(0, 60));
await page.click('button[data-phase=export]'); await page.waitForTimeout(400);
console.log('export cards order:', await page.$$eval('main.page .col:first-child section.card h2', (h) => h.map((x) => x.textContent.trim()).join(' | ')));
// 1) print without saving → dialog; cancel
await page.click('[data-act=print]'); await page.waitForTimeout(300);
console.log('dialog:', (await txt('.modal h1')), '|', await page.$$eval('.modal .foot button', (b) => b.map((x) => x.textContent.trim()).join(' / ')));
await page.click('.modal button[data-id=cancel]'); await page.waitForTimeout(200);
console.log('after cancel: printed', await page.evaluate(() => window.__printed), '| hash', await page.evaluate(() => location.hash));
// 2) print without link
await page.click('[data-act=print]'); await page.waitForTimeout(300); await page.click('.modal button[data-id=print]');
await page.waitForTimeout(600); console.log('during: hash', await page.evaluate(() => location.hash));
await page.waitForTimeout(1500); console.log('after print w/o link: printed', await page.evaluate(() => window.__printed), '| hash', await page.evaluate(() => location.hash), '(stays on report)');
await page.click('button[data-phase=export]'); await page.waitForTimeout(300);
// 3) save first, then print → report has QR head
await page.click('[data-act=print]'); await page.waitForTimeout(300); await page.click('.modal button[data-id=save]');
await page.waitForTimeout(2600);
console.log('after save+print: printed', await page.evaluate(() => window.__printed), '| hash', await page.evaluate(() => location.hash));
console.log('qr head now:', !!(await page.$('[data-report] .qrhead svg')), '| placeholder gone:', !(await page.$('[data-report] .qrhead.placeholder')));
// 4) saved → print directly (no dialog)
await page.click('button[data-phase=export]'); await page.waitForTimeout(300); await page.click('[data-act=print]'); await page.waitForTimeout(300);
console.log('dialog when saved:', !!(await page.$('.modal')));
await page.waitForTimeout(2000); console.log('printed total', await page.evaluate(() => window.__printed), '| hash', await page.evaluate(() => location.hash));
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
await page.screenshot({ path: `${shots}/print_mobile.png`, fullPage: false });
console.log('errors:', errors.join('\n') || 'none');
await browser.close();
