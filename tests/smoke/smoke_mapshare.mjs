// Smoke test (Playwright, headless Chromium). Run all: `npm run smoke` (tests/smoke/run.mjs starts a static server).
import { chromium } from 'playwright';
import { env as ENV } from './env.mjs';
const shots = ENV.shots;
const browser = await chromium.launch(ENV.launch(['--no-sandbox', '--disable-gpu']));
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.addInitScript(() => { try { localStorage.setItem('analyze.welcomed', '1'); } catch {} });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const t0 = Date.UTC(2026, 9, 4, 6, 0);
const pm = (k) => `<Placemark><TimeStamp><when>${new Date(t0 + k * 60000).toISOString()}</when></TimeStamp><ExtendedData><Data name="Elevation"><value>${500 + k * 20} m</value></Data></ExtendedData><Point><coordinates>${(8.4 + k * 0.004).toFixed(5)},${(47.3 + k * 0.002).toFixed(5)},${500 + k * 20}</coordinates></Point></Placemark>`;
const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${Array.from({ length: 90 }, (_, k) => pm(k)).join('')}</Document></kml>`;
let seenQuery = '';
await page.route('**/api/**', async (route) => {
  const u = new URL(route.request().url()); const p = u.pathname, m = route.request().method();
  const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*' };
  const j = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: H, body: JSON.stringify(o) });
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: H });
  if (p === '/api/me') return j({ code: 'KQZMWB', displayName: 'Balthasar', logo: false, prefs: {}, flights: 0, bytes: 0, team: false });
  if (p === '/api/profiles') return j([]);
  if (p === '/api/mapshare') { seenQuery = u.search; if (u.searchParams.get('pw') === 'falsch') return j({ error: 'MapShare password missing or wrong' }, 401); return route.fulfill({ status: 200, headers: { ...H, 'Content-Type': 'application/vnd.google-earth.kml+xml', 'X-Analyze-Name': 'mapshare_bwi_2026-10-04.kml', 'X-Analyze-Points': '90' }, body: kml }); }
  if (p.startsWith('/api/logo/')) return route.fulfill({ status: 404, headers: H, body: '' });
  return j({ error: 'not found' }, 404);
});
await page.goto(`${ENV.base}/#start`, { waitUntil: 'networkidle' }); await page.fill('[data-code]', 'KQZMWB'); await page.click('[data-open]'); await page.waitForTimeout(600);
await page.goto(`${ENV.base}/#import`, { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
await page.fill('[data-g=link]', 'https://share.garmin.com/bwi'); await page.waitForTimeout(100);
console.log('card:', await page.$$eval('[data-garmin]', (c) => c.length), '| kind:', await page.textContent('[data-gkind]'), '| button enabled:', await page.$eval('[data-act=mapshare]', (b) => !b.disabled), '| from/to prefilled:', await page.$eval('[data-ms=from]', (i) => !!i.value), await page.$eval('[data-ms=to]', (i) => !!i.value)); await page.fill('[data-ms=from]', '2026-10-04T06:00'); await page.fill('[data-ms=to]', '2026-10-04T09:00'); await page.fill('[data-ms=pw]', 'falsch');
await page.click('[data-act=mapshare]'); await page.waitForTimeout(600);
console.log('wrong pw →', await page.textContent('[data-msstate]'), '| pw kept in field:', await page.$eval('[data-ms=pw]', (i) => i.value === 'falsch'), '| not remembered:', await page.evaluate(() => !((JSON.parse(localStorage.getItem('analyze.settings') || '{}').garmin || {}).pw)));
await page.fill('[data-ms=pw]', 'richtig'); await page.click('[data-act=mapshare]'); await page.waitForTimeout(3000);
console.log('query:', decodeURIComponent(seenQuery), '| state:', await page.textContent('[data-msstate]'));
await page.waitForFunction(() => /mapshare_bwi/.test(document.querySelector('[data-table]')?.textContent || ''), null, { timeout: 20000 }).catch(() => null);
console.log('files table:', (await page.textContent('[data-table]')).replace(/\s+/g, ' ').slice(0, 160));
console.log('status:', (await page.textContent('.actionbar .status')).replace(/\s+/g, ' ').slice(0, 120));
console.log('remembered:', await page.evaluate(() => JSON.parse(localStorage.getItem('analyze.settings')).garmin));
await page.screenshot({ path: `${shots}/mapshare.png`, fullPage: true });
console.log('errors:', errors.join('; ') || 'none');
await browser.close();
