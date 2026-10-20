// Smoke test (Playwright, headless Chromium). Run all: `npm run smoke` (tests/smoke/run.mjs starts a static server).
import { chromium } from 'playwright';
import { env as ENV } from './env.mjs';
import { readFileSync } from 'node:fs';
const shots = ENV.shots;
const fx = ENV.fixtures;
const browser = await chromium.launch(ENV.launch(['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']));
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.addInitScript(() => { try { localStorage.setItem('analyze.welcomed', '1'); } catch {} });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const txt = async (sel) => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
const jpg = readFileSync(`${fx}/photo_exif.jpg`);
const photos = []; const puts = [];
await page.route('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: ENV.leafletStub }));
await page.route('**/api/**', async (route) => {
  const u = new URL(route.request().url()); const p = u.pathname; const m = route.request().method();
  const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*' };
  const j = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: H, body: JSON.stringify(o) });
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
  if (p === '/api/me') return j({ code: 'KQZMWB', displayName: 'Balthasar', logo: false, prefs: {}, flights: 0, bytes: 0, team: true });
  if (p === '/api/profiles') return j([]);
  if (p === '/api/flights' && m === 'POST') return j({ id: 'NEWFLJGH', title: 'GB26', url: 'https://analyze.wicki.aero/v/NEWFLJGH', updatedAt: Date.now(), public: true });
  if (p === '/api/flights/NEWFLJGH' && m === 'PUT') return j({ id: 'NEWFLJGH', title: 'GB26', updatedAt: Date.now(), public: true });
  if (p === '/api/flights/NEWFLJGH/photos' && m === 'GET') return j(photos);
  if (p === '/api/flights/NEWFLJGH/photos' && m === 'POST') { const body = route.request().postDataBuffer(); const meta = JSON.parse(/name="meta"\r\n\r\n([\s\S]*?)\r\n--/.exec(body.toString('latin1'))[1]); const rec = { id: 'PHOTO' + String(photos.length + 1).padStart(5, 'A'), flightId: 'NEWFLJGH', name: meta.name, cameraTime: meta.cameraTime, exifTz: meta.exifTz, manual: false, manualTime: null, exifLat: meta.exifLat, exifLon: meta.exifLon, exifAlt: meta.exifAlt, caption: '', bytes: body.length, width: meta.width, height: meta.height, createdAt: Date.now() }; photos.push(rec); return j(rec); }
  const pm = /^\/api\/flights\/NEWFLJGH\/photos\/([^/]+)$/.exec(p);
  if (pm && m === 'PUT') { const r = photos.find((x) => x.id === pm[1]); const b = JSON.parse(route.request().postData()); puts.push(b); if (b.manualTime !== undefined) { r.manualTime = b.manualTime; r.manual = b.manualTime !== null; } if (b.caption !== undefined) r.caption = b.caption; return j(r); }
  if (pm && m === 'DELETE') { const i = photos.findIndex((x) => x.id === pm[1]); photos.splice(i, 1); return j({ ok: true }); }
  if (/^\/api\/photos\//.test(p)) return route.fulfill({ status: 200, contentType: 'image/jpeg', headers: H, body: jpg });
  if (p.startsWith('/api/logo/')) return route.fulfill({ status: 404, headers: H, body: '' });
  return j({ error: 'not found' }, 404);
});
await page.goto(`${ENV.base}/#start`, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
await page.fill('[data-code]', 'KQZMWB'); await page.click('[data-open]'); await page.waitForTimeout(800);
await page.goto(`${ENV.base}/#import`, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
await page.setInputFiles('input[type=file][multiple]:not([accept*="jpeg"])', [`${fx}/gb26_260828_2049.csv`, `${fx}/gb26_260830_0242.csv`]);
await page.waitForFunction(() => /Segment/.test(document.querySelector('.actionbar .status').textContent) && !/gelesen …/.test(document.querySelector('.actionbar .status').textContent), null, { timeout: 60000 });
await page.click('button[data-phase=analyze]'); await page.waitForTimeout(1200);
await page.click('button[data-phase=export]'); await page.waitForTimeout(400); await page.click('[data-act=save]'); await page.waitForTimeout(1500);
await page.click('button[data-phase=analyze]'); await page.waitForTimeout(1200);
await page.setInputFiles('[data-photos] input[type=file]', [`${fx}/photo_exif.jpg`, `${fx}/photo_noexif.jpg`]); await page.waitForTimeout(2500);
const figs = async () => page.$$eval('[data-photos] figure', (f) => f.map((x) => x.dataset.id + ': ' + x.querySelector('figcaption').textContent.replace(/\s+/g, ' ').trim().slice(0, 90)).join(' || '));
console.log('after upload:', await figs());
console.log('manual inputs:', await page.$$eval('[data-photos] [data-man]', (i) => i.map((x) => x.dataset.man + '=' + JSON.stringify(x.value) + ' min=' + x.min)));
console.log('toast after upload:', (await txt('.toast').catch(() => '')).slice(0, 160));
await page.screenshot({ path: `${shots}/pm_01_notime.png`, fullPage: true });
// 1) fromPin without a pin → hint
await page.click('[data-photos] [data-act=fromPin]'); await page.waitForTimeout(300);
console.log('fromPin w/o pin toast:', (await txt('.toast:last-of-type').catch(() => '')).slice(0, 100));
// 2) type a UTC time (29.08.2026 10:00:00 UTC, inside the flight)
const man = page.locator('[data-photos] [data-man]');
await man.evaluate((el) => { el.value = '2026-08-29T10:00:00'; el.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(800);
console.log('after manual time:', await figs());
console.log('PUT bodies:', JSON.stringify(puts));
console.log('profile photo marks:', await page.$$eval('svg.chart circle[stroke="#0f766e"]', (c) => c.length), '| manual tag present:', /von Hand/.test(await txt('[data-photos] [data-grid]')));
await page.screenshot({ path: `${shots}/pm_02_manual.png`, fullPage: true });
// 3) pin a point on the profile, then "Pin übernehmen"
const svgEl = await page.$('svg.chart'); await svgEl.scrollIntoViewIfNeeded(); const bb = await svgEl.boundingBox();
await page.mouse.click(bb.x + bb.width * 0.6, bb.y + bb.height * 0.4); await page.waitForTimeout(400);
console.log('readout after pin:', (await txt('[data-readout]')).slice(0, 80));
await page.click('[data-photos] [data-act=fromPin]'); await page.waitForTimeout(800);
console.log('after fromPin:', await figs());
console.log('last PUT:', JSON.stringify(puts[puts.length - 1]));
// 4) clear the time again
await page.click('[data-photos] [data-act=clearTime]'); await page.waitForTimeout(800);
console.log('after clear:', await figs());
console.log('last PUT:', JSON.stringify(puts[puts.length - 1]));
// 5) EXIF photo: field is folded behind a link; set a hand time, EXIF kept; clear restores EXIF
console.log('links:', await page.$$eval('[data-photos] [data-act=editTime]', (a) => a.map((x) => x.dataset.id + ':' + x.textContent).join(' ')));
await page.click('[data-photos] figure[data-id=PHOTOAAAA1] [data-act=editTime]'); await page.waitForTimeout(300);
console.log('unfolded inputs:', await page.$$eval('[data-photos] [data-man]', (i) => i.map((x) => x.dataset.man).join(' ')));
await page.click('[data-photos] figure[data-id=PHOTOAAAA1] [data-act=fromPin]'); await page.waitForTimeout(800);
console.log('after override:', await figs());
console.log('server rec 1:', JSON.stringify({ cameraTime: photos[0].cameraTime, manualTime: photos[0].manualTime, manual: photos[0].manual }));
console.log('exif-kept title:', await page.$eval('[data-photos] figure[data-id=PHOTOAAAA1] .mono .muted', (e) => e.title));
await page.click('[data-photos] figure[data-id=PHOTOAAAA1] [data-act=clearTime]'); await page.waitForTimeout(800);
console.log('after clear (EXIF again):', await figs());
console.log('links again:', await page.$$eval('[data-photos] [data-act=editTime]', (a) => a.map((x) => x.dataset.id).join(' ')));
// 6) viewer never shows the inputs
console.log('report photos:', (await (async () => { await page.click('button[data-phase=report]'); await page.waitForTimeout(1200); return txt('[data-report] .rep-photos'); })()).slice(0, 120));
console.log('errors:', errors.join('\n') || 'none');
await browser.close();
