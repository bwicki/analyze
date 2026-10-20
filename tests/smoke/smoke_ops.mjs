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
  if (p === '/api/flights/NEWFLJGH/ops/briefings') return j({ briefings: [{ id: 'abc123def456', no: '2026-004', startMs: Date.UTC(2026, 7, 29, 6), tz: 'Europe/Zurich', site: 'Hochdorf', reg: 'HB-QWV', balloon: 'HB-QWV', kind: 'private', status: 'final', trajectory: null }, { id: 'zzz999', no: '2026-003', startMs: Date.UTC(2026, 7, 20, 6), site: 'Sins', reg: 'HB-QWZ', status: 'draft', trajectory: { receivedAt: '2026-10-20T12:00:00Z', points: 200 } }], ops: 'https://ops.wicki.aero' });
  if (p === '/api/flights/NEWFLJGH/ops' && m === 'POST') { const b = route.request().postDataJSON(); globalThis.__opsBody = b; return j({ ok: true, briefingId: b.briefingId, url: `https://ops.wicki.aero/#/v/${b.briefingId}?traj=1`, receivedAt: new Date().toISOString(), points: 241 }); }
  if (p === '/api/flights/NEWFLJGH/raw' && m === 'POST') return j({ ok: true, files: [] });
  if (p === '/api/flights/NEWFLJGH/preview' && m === 'PUT') return j({ ok: true });
  return j({ error: 'not found' }, 404);
});
for (const h of ['https://nominatim.openstreetmap.org/**', 'https://photon.komoot.io/**', 'https://s3.amazonaws.com/**', 'https://api.open-meteo.com/**', 'https://tiles.openfreemap.org/**']) await page.route(h, (route) => route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }));
await page.route('https://unpkg.com/**', (route) => route.fulfill({ status: 503, body: '' }));   // no MapLibre here → falls back to 2D
await page.goto(`${ENV.base}/#start`, { waitUntil: 'networkidle' }); await page.fill('[data-code]', 'KQZMWB'); await page.click('[data-open]'); await page.waitForTimeout(600);
await page.goto(`${ENV.base}/#import`, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
await page.setInputFiles('input[type=file][multiple]:not([accept*="jpeg"])', [`${fx}/gb26_260828_2049.csv`, `${fx}/gb26_260830_0242.csv`]);
await page.waitForFunction(() => /Segment/.test(document.querySelector('.actionbar .status').textContent) && !/gelesen …/.test(document.querySelector('.actionbar .status').textContent), null, { timeout: 60000 });

await page.click('button[data-phase=report]'); await page.waitForTimeout(1200);
console.log('special card (team PIN):', await page.$$eval('[data-special]', (c) => c.length), '| title:', await txt('[data-special] h2'), '| ops state:', await txt('[data-opsstate]'));
await page.click('[data-special] [data-act=ops]'); await page.waitForTimeout(400);
console.log('toast without saved flight:', (await txt('.toast')).slice(0, 60));
await page.click('button[data-phase=export]'); await page.waitForTimeout(800);
await page.click('[data-act=save]'); await page.waitForTimeout(2500);
console.log('saved:', await page.evaluate(() => !!(window.__state && window.__state.flight) || document.body.textContent.includes('NEWFLJGH')));
await page.click('button[data-phase=report]'); await page.waitForTimeout(1200);
console.log('ops state after save:', (await txt('[data-opsstate]')).slice(0, 80));
await page.click('[data-special] [data-act=ops]'); await page.waitForTimeout(600);
console.log('dialog:', await page.$$eval('.modal-bg .modal', (m) => m.length), '| title:', await txt('.modal .head h1'), '| options:', await page.$$eval('.modal input[name=opsb]', (i) => i.map((x) => x.value).join(',')), '| has traj mark:', await page.$$eval('.modal .dl .ok', (o) => o.length));
await page.screenshot({ path: `${shots}/ops_dialog.png` });
await page.click('.modal [data-act=send]'); await page.waitForTimeout(800);
console.log('toast:', (await txt('.toast')).slice(0, 80), '| sent body:', JSON.stringify(globalThis.__opsBody), '| state line:', (await txt('[data-opsstate]')).slice(0, 100), '| link:', await page.$$eval('[data-opsstate] a', (a) => a.map((x) => x.href).join(' ')));
console.log('errors:', errors.join('\n') || 'none');
await browser.close();
