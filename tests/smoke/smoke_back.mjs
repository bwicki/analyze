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
await page.goto(`${ENV.base}/#start`, { waitUntil: 'networkidle' }); await page.fill('[data-code]', 'KQZMWB'); await page.click('[data-open]'); await page.waitForTimeout(600);
await page.goto(`${ENV.base}/#import`, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
await page.setInputFiles('input[type=file][multiple]:not([accept*="jpeg"])', [`${fx}/gb26_260828_2049.csv`, `${fx}/gb26_260830_0242.csv`]);
await page.waitForFunction(() => /Segment/.test(document.querySelector('.actionbar .status').textContent) && !/gelesen …/.test(document.querySelector('.actionbar .status').textContent), null, { timeout: 60000 });
await page.click('button[data-phase=clean]'); await page.waitForTimeout(300);
console.log('clean 1:', await status());
const from0 = await page.inputValue('[data-from]'), to0 = await page.inputValue('[data-to]');
console.log('trim 1:', from0, '→', to0);
await page.click('button[data-phase=analyze]'); await page.waitForTimeout(1500);
console.log('analyze 1:', (await status()).slice(0, 120));
const save = process.argv[2] === 'save';
if (save) { await page.click('button[data-phase=export]'); await page.waitForTimeout(400); await page.click('[data-act=save]'); await page.waitForTimeout(1200); }
await page.click('button[data-phase=report]'); await page.waitForTimeout(1500);
console.log('report 1:', await txt('[data-report] h1'));
// back to Bereinigen, move start 20 min later and end 10 min earlier
await page.click('button[data-phase=clean]'); await page.waitForTimeout(500);
console.log('clean 2:', await status());
const shift = (s, min) => { const m = s.match(/^(\d\d)\.(\d\d)\.(\d{4}) (\d\d):(\d\d):(\d\d)$/); const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]) + min * 60000); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; };
await page.fill('[data-from]', shift(from0, 20)); await page.fill('[data-to]', shift(to0, -10)); await page.click('[data-act=apply]'); await page.waitForTimeout(500);
console.log('trim 2:', await page.inputValue('[data-from]'), '→', await page.inputValue('[data-to]'), '| status:', await status());
console.log('trimstats:', (await txt('[data-trimstats]')).slice(0, 160));
await page.screenshot({ path: `${shots}/back_clean.png`, fullPage: true });
// nudge buttons
await page.click('[data-nudge=from] button[data-s="60"]'); await page.waitForTimeout(300);
console.log('nudge +1 min:', await page.inputValue('[data-from]'));
// keyboard on the handle: Shift+ArrowLeft = −1 min
await page.focus('.timeline .handle[data-h=from]'); await page.keyboard.press('Shift+ArrowLeft'); await page.waitForTimeout(300);
console.log('key −1 min:', await page.inputValue('[data-from]'));
// drag the end handle 100 px to the left (live preview then commit)
const h = await page.$('.timeline .handle[data-h=to] rect[rx]'); const hb = await h.boundingBox();
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(hb.x + hb.width / 2 - 50, hb.y + hb.height / 2, { steps: 5 });
console.log('drag preview label:', await page.$eval('.timeline .handle[data-h=to] [data-hl]', (e) => e.textContent), '| input:', await page.inputValue('[data-to]'));
await page.mouse.move(hb.x + hb.width / 2 - 100, hb.y + hb.height / 2, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(300);
console.log('after drag:', await page.inputValue('[data-to]'), '| status:', (await status()).slice(0, 80));
console.log('profile paths:', await page.$$eval('.timeline path', (p) => p.length), '| nudge buttons:', await page.$$eval('.nudge button', (b) => b.length));
await page.screenshot({ path: `${shots}/back_clean2.png`, fullPage: true });
await page.click('button[data-phase=analyze]'); await page.waitForTimeout(1500);
console.log('analyze 2:', (await status()).slice(0, 160));
console.log('stats card:', (await txt('[data-stats]')).slice(0, 260));
await page.click('button[data-phase=report]'); await page.waitForTimeout(1500);
console.log('report 2:', await txt('[data-report] h1'));
await page.click('button[data-phase=export]'); await page.waitForTimeout(500);
console.log('export:', (await status()).slice(0, 100));
console.log('errors:', errors.join('\n') || 'none');
await browser.close();
