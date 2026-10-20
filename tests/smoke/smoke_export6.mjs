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
const errors = []; let orgName = '', accent = ''; const downloads = [];
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
  if (p === '/api/me' && m === 'GET') return j({ code: 'KQZMWB', displayName: 'Balthasar', logo: false, prefs: { org: orgName, accent }, flights: 0, bytes: 0, team: true });
  if (p === '/api/me' && m === 'PUT') { const b = route.request().postDataJSON(); orgName = (b.prefs && b.prefs.org) || ''; accent = (b.prefs && b.prefs.accent !== undefined) ? b.prefs.accent : accent; return j({ code: 'KQZMWB', displayName: b.displayName || 'Balthasar', logo: false, prefs: { org: orgName, accent }, flights: 0, bytes: 0, team: true }); }
  if (p === '/api/flights' && m === 'GET') return j([]);
  if (p === '/api/profiles') return j([]);
  if (p === '/api/flights' && m === 'POST') return j({ id: 'NEWFLJGH', title: 'GB26', url: 'https://analyze.wicki.aero/v/NEWFLJGH', createdAt: Date.UTC(2026, 9, 20, 6, 0), updatedAt: Date.UTC(2026, 9, 20, 6, 30), public: true });
  if (p === '/api/flights/NEWFLJGH' && m === 'PUT') return j({ id: 'NEWFLJGH', title: 'GB26', createdAt: Date.UTC(2026, 9, 20, 6, 0), updatedAt: Date.now(), public: true });
  if (p === '/api/flights/NEWFLJGH/photos') return j([]);
  if (p.startsWith('/api/logo/')) return route.fulfill({ status: 404, headers: H, body: '' });
  return j({ error: 'not found' }, 404);
});
for (const h of ['https://nominatim.openstreetmap.org/**', 'https://photon.komoot.io/**', 'https://s3.amazonaws.com/**', 'https://api.open-meteo.com/**', 'https://tiles.openfreemap.org/**']) await page.route(h, (route) => route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }));
page.on('download', (d) => downloads.push(d.suggestedFilename()));
await page.goto(`${ENV.base}/#start`, { waitUntil: 'networkidle' }); await page.fill('[data-code]', 'KQZMWB'); await page.click('[data-open]'); await page.waitForTimeout(600);
await page.goto(`${ENV.base}/#import`, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
await page.setInputFiles('input[type=file][multiple]:not([accept*="jpeg"])', [`${fx}/gb26_260828_2049.csv`, `${fx}/gb26_260830_0242.csv`]);
await page.waitForFunction(() => /Segment/.test(document.querySelector('.actionbar .status').textContent) && !/gelesen …/.test(document.querySelector('.actionbar .status').textContent), null, { timeout: 60000 });
await page.click('button[data-phase=export]'); await page.waitForTimeout(500);
console.log('steps:', await page.$$eval('.card.step h2', (h) => h.map((x) => x.textContent.trim()).join(' | ')));
console.log('ops option (PIN KQZMWB):', !!(await page.$('text=ops.wicki.aero')));
console.log('checkboxes:', await page.$$eval('[data-fmt]', (c) => c.map((x) => `${x.dataset.fmt}:${x.checked ? 'on' : 'off'}${x.disabled ? '(dis)' : ''}`).join(' ')), '| button:', await txt('[data-act=downloadSelected]'), '| disabled:', await page.$eval('[data-act=downloadSelected]', (b) => b.disabled));
await page.check('[data-fmt=csv]'); await page.waitForTimeout(100);
console.log('gpx+csv → button:', await txt('[data-act=downloadSelected]'), '| hint:', await txt('[data-dlhint]'));
await page.check('[data-fmt=zip]'); await page.waitForTimeout(100);
console.log('zip → :', await page.$$eval('[data-fmt]', (c) => c.map((x) => `${x.dataset.fmt}:${x.checked ? 'on' : 'off'}${x.disabled ? '(dis)' : ''}`).join(' ')), '| button:', await txt('[data-act=downloadSelected]'), '| dimmed rows:', await page.$$eval('.dl.dim', (d) => d.length));
await page.uncheck('[data-fmt=zip]'); await page.waitForTimeout(100);
console.log('zip off → dimmed rows:', await page.$$eval('.dl.dim', (d) => d.length), '| button:', await txt('[data-act=downloadSelected]'));
await page.click('[data-act=downloadSelected]'); await page.waitForTimeout(2500);
console.log('downloads:', downloads.join(', '));
await page.screenshot({ path: `${shots}/export_steps.png`, fullPage: true });
// team / organisation name: profile → header subtitle → report
await page.goto(`${ENV.base}/#flights`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
await page.fill('[data-pref=org]', 'Ballonclub Testhausen'); await page.waitForTimeout(1500);   // autosave (debounced)
console.log('accent default:', await page.inputValue('[data-pref=accent]'));
await page.fill('[data-pref=accent]', '#1f5fbf'); await page.waitForTimeout(1200);
console.log('accent saved on server:', accent, '| picker:', await page.inputValue('[data-accent-pick]'));
console.log('header subtitle:', await txt('header.top .brand span'));
await page.click('button[data-phase=report]'); await page.waitForTimeout(800);
console.log('report org line:', await page.$$eval('[data-report] .rep-right .pk', (e) => e.map((x) => x.textContent).join(' | ')));
console.log('report bar colour:', await page.$eval('[data-report] .bar', (b) => getComputedStyle(b).backgroundColor));
console.log('errors:', errors.join('\n') || 'none');
await browser.close();
