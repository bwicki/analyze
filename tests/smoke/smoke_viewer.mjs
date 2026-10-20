// Smoke test (Playwright, headless Chromium). Run all: `npm run smoke` (tests/smoke/run.mjs starts a static server).
import { chromium } from 'playwright';
import { env as ENV } from './env.mjs';
// 0.9.1: viewers – extreme detail (map + profile), numeric record, large views of profile / map / detail maps /
// timeline / report graphics; Esc and × close; map moved into the viewer comes back.
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
await page.route('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: ENV.leafletStub }));
await page.route('**/api/**', async (route) => {
  const u = new URL(route.request().url()); const p = u.pathname; const m = route.request().method();
  const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*' };
  const j = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: H, body: JSON.stringify(o) });
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
  if (p === '/api/me') return j({ code: 'KQZMWB', displayName: 'Balthasar', logo: false, prefs: {}, flights: 0, bytes: 0, team: true });
  if (p === '/api/profiles') return j([]);
  if (p.startsWith('/api/logo/')) return route.fulfill({ status: 404, headers: H, body: '' });
  return j({ error: 'not found' }, 404);
});
for (const h of ['https://nominatim.openstreetmap.org/**', 'https://photon.komoot.io/**', 'https://s3.amazonaws.com/**', 'https://api.open-meteo.com/**', 'https://tiles.openfreemap.org/**']) await page.route(h, (route) => route.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' }));
await page.route('https://unpkg.com/**', (route) => route.fulfill({ status: 503, body: '' }));   // no MapLibre → 2D
await page.goto(`${ENV.base}/#start`, { waitUntil: 'networkidle' }); await page.fill('[data-code]', 'KQZMWB'); await page.click('[data-open]'); await page.waitForTimeout(600);
await page.goto(`${ENV.base}/#import`, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
await page.setInputFiles('input[type=file][multiple]:not([accept*="jpeg"])', [`${fx}/gb26_260828_2049.csv`, `${fx}/gb26_260830_0242.csv`]);
await page.waitForFunction(() => /Segment/.test(document.querySelector('.actionbar .status').textContent) && !/gelesen …/.test(document.querySelector('.actionbar .status').textContent), null, { timeout: 60000 });

// --- Bereinigen: timeline large
await page.click('button[data-phase=clean]'); await page.waitForTimeout(800);
await page.click('[data-gfx=timeline] [data-act=expand]'); await page.waitForTimeout(300);
console.log('timeline viewer:', await page.$$eval('.viewer-bg', (v) => v.length), '| svg.timeline copies:', await page.$$eval('svg.timeline', (s) => s.length), '| title:', await txt('.viewer [data-vtitle]'), '| body overflow:', await page.evaluate(() => getComputedStyle(document.body).overflow));
await page.screenshot({ path: `${shots}/v_timeline.png` });
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
console.log('after Esc:', await page.$$eval('.viewer-bg', (v) => v.length), 'viewers;', await page.$$eval('svg.timeline', (s) => s.length), 'timeline copies');

// --- Auswerten
await page.click('button[data-phase=analyze]'); await page.waitForTimeout(2500);
console.log('view:', await page.$eval('[data-view] button.on', (b) => b.dataset.v), '| symbols in tiles:', await page.$$eval('[data-tiles] [data-act=locate]', (b) => b.map((x) => x.textContent).join(' ')), '| list buttons:', await page.$$eval('[data-stats] [data-act=record]', (b) => b.length));
await page.click('[data-tiles] [data-act=locate][data-kind=alt]'); await page.waitForTimeout(700);
console.log('detail viewer:', await page.$$eval('.viewer-bg', (v) => v.length), '| title:', await txt('.viewer [data-vtitle]'), '| sub:', await txt('.viewer [data-vsub]'));
console.log('detail map:', await page.$$eval('.viewer [data-vmap] .leaflet-top, .viewer [data-vmap] > *', (n) => n.length), 'nodes | profile svg:', await page.$$eval('.viewer [data-vprofile] svg.chart', (s) => s.length), '| symbol on detail profile:', await page.$$eval('.viewer svg.chart text[data-x]', (ts) => ts.map((x) => x.dataset.x + ':' + x.lastChild.textContent).join(' ')));
console.log('detail readout:', (await txt('.viewer [data-vreadout]')).slice(0, 100));
console.log('main pinned after open:', await page.$eval('[data-profile] svg.chart [data-pinned]', (g) => g.innerHTML.length > 0), '| window buttons:', await page.$$eval('.viewer [data-win] button', (b) => b.map((x) => x.textContent + (x.classList.contains('on') ? '*' : '')).join(' ')));
await page.screenshot({ path: `${shots}/v_detail.png` });
await page.click('.viewer [data-win] button[data-m="30"]'); await page.waitForTimeout(400);
console.log('window 30 → on:', await page.$eval('.viewer [data-win] button.on', (b) => b.dataset.m), '| profile markers (1-min dots):', await page.$$eval('.viewer svg.chart circle[r="2.5"]', (c) => c.length));
// numeric record (second viewer on top)
await page.click('.viewer [data-act=record]'); await page.waitForTimeout(600);
console.log('viewers:', await page.$$eval('.viewer-bg', (v) => v.length), '| record title:', await txt('.viewer-bg:last-child [data-vtitle]'), '| rows:', await page.$$eval('.viewer-bg:last-child table.rec tbody tr', (r) => r.length), '| hl row:', await page.$eval('.viewer-bg:last-child tr.hl', (r) => r.textContent.replace(/\s+/g, ' ').slice(0, 80)));
console.log('record head:', await page.$$eval('.viewer-bg:last-child table.rec th', (h) => h.map((x) => x.textContent.trim()).join(' | ')));
console.log('record info:', (await txt('.viewer-bg:last-child [data-tbl] .muted')).slice(0, 120));
await page.screenshot({ path: `${shots}/v_record.png` });
await page.click('.viewer-bg:last-child [data-win] button[data-m="5"]'); await page.waitForTimeout(500);
console.log('record ±5 rows:', await page.$$eval('.viewer-bg:last-child table.rec tbody tr', (r) => r.length));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
console.log('after Esc (record closed):', await page.$$eval('.viewer-bg', (v) => v.length), '| detail title still:', await txt('.viewer [data-vtitle]'));
await page.click('.viewer .vx'); await page.waitForTimeout(300);
console.log('after ×:', await page.$$eval('.viewer-bg', (v) => v.length), '| body overflow:', await page.evaluate(() => getComputedStyle(document.body).overflow));
// list icon in the stats card directly
await page.click('[data-stats] [data-act=record][data-kind=gs]'); await page.waitForTimeout(500);
console.log('record from stats:', await txt('.viewer [data-vtitle]'), '| hl symbol:', await page.$eval('.viewer tr.hl td:nth-child(2)', (td) => td.textContent.trim().slice(0, 12)));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
// profile symbol click → detail viewer
await page.click('[data-profile] svg.chart text[data-x="down"]'); await page.waitForTimeout(500);
console.log('profile symbol → viewer:', await txt('.viewer [data-vtitle]'));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
// profile large
await page.click('[data-gfx=profile] [data-act=expand]'); await page.waitForTimeout(500);
console.log('profile viewer:', await txt('.viewer [data-vtitle]'), '| chart copies:', await page.$$eval('svg.chart', (s) => s.length), '| vfit width:', await page.$eval('.viewer .vfit', (b) => b.style.width));
await page.screenshot({ path: `${shots}/v_profile.png` });
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
console.log('chart copies after close:', await page.$$eval('svg.chart', (s) => s.length));
// map large (moved into the viewer and back)
await page.click('[data-map] .fit-ctrl [data-expand]'); await page.waitForTimeout(400);
console.log('map in viewer:', await page.$$eval('.viewer [data-map]', (m) => m.length), '| in card:', await page.$$eval('section.card [data-map]', (m) => m.length), '| title:', await txt('.viewer [data-vtitle]'));
await page.screenshot({ path: `${shots}/v_map.png` });
await page.click('.viewer .vx'); await page.waitForTimeout(300);
console.log('map back in card:', await page.$$eval('section.card [data-map]', (m) => m.length), '| map hidden:', await page.$eval('[data-map]', (m) => m.hidden), '| viewers:', await page.$$eval('.viewer-bg', (v) => v.length));
// detail map (take-off) via button and via plain click
await page.click('[data-gfx=dstart] [data-act=expand]'); await page.waitForTimeout(400);
console.log('detail start viewer:', await txt('.viewer [data-vtitle]'), '| fill map:', await page.$$eval('.viewer .vbody > .map', (m) => m.length));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.click('[data-gfx=dland] .map', { position: { x: 60, y: 60 } }); await page.waitForTimeout(400);
console.log('detail land viewer by click:', await txt('.viewer [data-vtitle]'));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
// dblclick on the profile
await page.dblclick('[data-profile] svg.chart', { position: { x: 400, y: 100 } }); await page.waitForTimeout(400);
console.log('dblclick profile → viewer:', await txt('.viewer [data-vtitle]'));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);

// --- Bericht: graphics open large
await page.click('button[data-phase=report]'); await page.waitForTimeout(1500);
console.log('report expand buttons:', await page.$$eval('[data-report] [data-act=expand]', (b) => b.map((x) => x.dataset.what).join(' ')));
await page.click('[data-report] [data-gfx=profile] svg.chart', { position: { x: 300, y: 100 } }); await page.waitForTimeout(400);
console.log('report profile viewer:', await txt('.viewer [data-vtitle]'), '| svg in viewer:', await page.$$eval('.viewer svg.chart', (s) => s.length));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.click('[data-report] [data-gfx=map] [data-act=expand]'); await page.waitForTimeout(400);
console.log('report map viewer:', await txt('.viewer [data-vtitle]'), '| map node:', await page.$$eval('.viewer .vbody > .map', (m) => m.length));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.click('[data-report] [data-gfx=start] .map', { position: { x: 50, y: 50 } }); await page.waitForTimeout(400);
console.log('report start viewer:', await txt('.viewer [data-vtitle]'));
await page.click('.viewer .vx'); await page.waitForTimeout(200);
console.log('viewers at end:', await page.$$eval('.viewer-bg', (v) => v.length));
console.log('errors:', errors.join('\n') || 'none');
await browser.close();
