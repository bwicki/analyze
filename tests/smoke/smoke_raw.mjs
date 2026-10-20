// Smoke test (Playwright, headless Chromium). Run all: `npm run smoke` (tests/smoke/run.mjs starts a static server).
import { chromium } from 'playwright';
import { env as ENV } from './env.mjs';
// Cut inside the flight → save → reopen from «Meine Fahrten»: the cut landing must be restored (saved track ends airborne).
import { readFileSync } from 'node:fs';
const fx = ENV.fixtures; const shots = ENV.shots;
const browser = await chromium.launch(ENV.launch(['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']));
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.addInitScript(() => { try { localStorage.setItem('analyze.welcomed', '1'); } catch {} });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const txt = async (sel) => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
const status = () => txt('.actionbar .status');
await page.route('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: ENV.leafletStub }));
function parseRaw(buf, ct) {
  const b = '--' + /boundary=(.+)$/.exec(ct)[1]; const B = Buffer.from(b); const out = { meta: [], files: [] }; let pos = 0;
  while (true) { const i = buf.indexOf(B, pos); if (i < 0) break; const j = buf.indexOf(B, i + B.length); if (j < 0) break;
    const part = buf.subarray(i + B.length + 2, j - 2); const hdrEnd = part.indexOf('\r\n\r\n'); const hdr = part.subarray(0, hdrEnd).toString(); const body = part.subarray(hdrEnd + 4);
    if (/name="meta"/.test(hdr)) out.meta = JSON.parse(body.toString()); else if (/name="files"/.test(hdr)) out.files.push({ gz: Buffer.from(body) }); pos = j; }
  out.files.forEach((f, k) => { f.name = out.meta[k].name; f.bytes = out.meta[k].bytes; }); out.n = out.files.length; return out;
}
// minimal multipart parser: returns {meta, track(Buffer|null)}
function parseMultipart(buf, ct) {
  const b = '--' + /boundary=(.+)$/.exec(ct)[1]; const out = { meta: null, track: null };
  let pos = 0; const B = Buffer.from(b);
  while (true) { const i = buf.indexOf(B, pos); if (i < 0) break; const j = buf.indexOf(B, i + B.length); if (j < 0) break;
    const part = buf.subarray(i + B.length + 2, j - 2); const hdrEnd = part.indexOf('\r\n\r\n'); const hdr = part.subarray(0, hdrEnd).toString(); const body = part.subarray(hdrEnd + 4);
    if (/name="meta"/.test(hdr)) out.meta = JSON.parse(body.toString()); else if (/name="track"/.test(hdr)) out.track = Buffer.from(body); pos = j; }
  return out;
}
let saved = null, rawUpload = null; const downloads = []; const rec = (id) => ({ id, title: saved.meta.title, stats: saved.meta.stats, meta: saved.meta.meta, points: saved.meta.points, public: true, createdAt: Date.UTC(2026, 9, 20, 6, 0), updatedAt: Date.UTC(2026, 9, 20, 6, 30), hasEvents: false, bytes: 1000 });
await page.route('**/api/**', async (route) => {
  const u = new URL(route.request().url()); const p = u.pathname; const m = route.request().method();
  const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*' };
  const j = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: H, body: JSON.stringify(o) });
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
  if (p === '/api/me') return j({ code: 'KQZMWB', displayName: 'Balthasar', logo: false, prefs: {}, flights: saved ? 1 : 0, bytes: 0, team: true });
  if (p === '/api/profiles') return j([]);
  if (p === '/api/flights' && m === 'POST') { saved = parseMultipart(route.request().postDataBuffer(), route.request().headers()['content-type']); return j({ ...rec('NEWFLJGH'), url: 'https://analyze.wicki.aero/v/NEWFLJGH' }); }
  if (p === '/api/flights' && m === 'GET') return j(saved ? [{ ...rec('NEWFLJGH'), rawFiles: rawUpload ? rawUpload.n : 0 }] : []);
  if (p === '/api/flights/NEWFLJGH/raw' && m === 'POST') { const buf = route.request().postDataBuffer(); const ct = route.request().headers()['content-type']; rawUpload = parseRaw(buf, ct); return j({ ok: true, files: rawUpload.files.map((f, n) => ({ n, name: f.name, bytes: f.bytes, gzBytes: f.gz.length })) }); }
  if ((p === '/api/admin/flights/NEWFLJGH/raw' || p === '/api/flights/NEWFLJGH/raw') && m === 'GET') return j(rawUpload ? rawUpload.files.map((f, n) => ({ n, name: f.name, bytes: f.bytes, gzBytes: f.gz.length })) : []);
  const rawOne = /^\/api\/(?:admin\/)?flights\/NEWFLJGH\/raw\/(\d+)$/.exec(p);
  if (rawOne && m === 'GET') return route.fulfill({ status: 200, headers: { ...H, 'Content-Type': 'application/gzip', 'X-Analyze-Encoding': 'gzip' }, body: rawUpload.files[+rawOne[1]].gz });
  if (p === '/api/admin/stats') return j({ codes: 1, flights: 1, bytes: 1, points: 1, actions30d: 1, retentionDays: 730, secrets: { dataToken: true, pagesToken: true }, apiUrl: 'x' });
  if (p === '/api/admin/me') return j({ name: 'bwicki' });
  if (p === '/api/admin/login' && m === 'POST') return j({ token: 'T', name: 'bwicki' });
  if (p === '/api/admin/setup' && m === 'GET') return j({ needed: false });
  if (p === '/api/admin/flights') return j(saved ? [{ ...rec('NEWFLJGH'), code: 'KQZMWB', rawFiles: rawUpload ? rawUpload.n : 0 }] : []);
  if (p === '/api/events/flights') return j([{ flight: 'GB26_HB-QPJ', callsign: 'HB-QPJ', first: '2026-08-28T20:00:00Z', last: '2026-08-30T17:00:00Z', rows: 12 }]);
  if (p === '/api/flights/NEWFLJGH' && m === 'GET') return j(rec('NEWFLJGH'));
  if (p === '/api/flights/NEWFLJGH/track') return route.fulfill({ status: 200, headers: { ...H, 'Content-Type': 'application/gzip', 'X-Analyze-Encoding': 'gzip' }, body: saved.track });
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
await page.click('button[data-phase=export]'); await page.waitForTimeout(400);
console.log('raw line before save:', (await txt('[data-save]')).match(/Rohdaten[^.]*\./)?.[0]);
await page.click('[data-act=save]'); await page.waitForTimeout(4000);
console.log('raw upload:', rawUpload ? `${rawUpload.n} files: ${rawUpload.files.map((f) => `${f.name} ${f.bytes}→${f.gz.length}`).join(', ')}` : 'none');
console.log('raw line after save:', (await txt('[data-save]')).match(/Rohdaten[^.]*\./)?.[0]);
// owner: «Meine Fahrten» → Rohdaten (n)
await page.goto(`${ENV.base}/#flights`, { waitUntil: 'networkidle' }); await page.waitForTimeout(600);
console.log('owner raw button:', await page.$eval('[data-act=raw]', (b) => b.textContent).catch(() => 'none'));
await page.click('[data-act=raw]'); await page.waitForTimeout(2500);
console.log('owner downloads:', downloads.join(', '));
await page.click('button[data-phase=analyze]').catch(() => {}); await page.waitForTimeout(300);
// special panel: not for this PIN
await page.click('button[data-phase=report]'); await page.waitForTimeout(500);
console.log('special panel for KQZMWB:', !!(await page.$('[data-special]')));
// Supermaster login → panel visible, pick JSON list
await page.goto(`${ENV.base}/#admin`, { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
await page.fill('[data-name]', 'bwicki'); await page.fill('[data-pin]', '123456'); await page.click('[data-form] button[type=submit]'); await page.waitForTimeout(800);
await page.click('[data-tab=flights]'); await page.waitForTimeout(500);
console.log('admin flights raw button:', (await txt('[data-content]')).match(/Rohdaten \(\d\)/)?.[0]);
await page.click('[data-act=dlRaw]'); await page.waitForTimeout(2500);
console.log('downloads:', downloads.join(', '));
await page.click('button[data-phase=report]'); await page.waitForTimeout(600);
console.log('special panel as admin:', !!(await page.$('[data-special]')), '|', (await txt('[data-special]')).slice(0, 80));
await page.click('[data-act=pickRepo]'); await page.waitForTimeout(800);
console.log('repo list:', (await txt('.modal tbody')).slice(0, 60));
await page.screenshot({ path: `${shots}/special_panel.png`, fullPage: true });
console.log('errors:', errors.join('\n') || 'none');
await browser.close();
