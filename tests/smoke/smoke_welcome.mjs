// Smoke test (Playwright, headless Chromium). Run all: `npm run smoke` (tests/smoke/run.mjs starts a static server).
import { chromium } from 'playwright';
import { env as ENV } from './env.mjs';
import { readFileSync } from 'node:fs';
const shots = ENV.shots;
const browser = await chromium.launch(ENV.launch(['--no-sandbox', '--disable-gpu']));
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.route('https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: ENV.leafletStub }));
await page.route('**/api/**', (route) => route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: '{}' }));
const txt = async (sel) => ((await page.textContent(sel)) || '').replace(/\s+/g, ' ').trim();
await page.goto(`${ENV.base}/`, { waitUntil: 'networkidle' }); await page.waitForTimeout(400);
console.log('welcome shown:', !!(await page.$('.welcome')), '|', (await txt('.welcome h1')), '|', (await txt('.welcome p')).slice(0, 70));
await page.screenshot({ path: `${shots}/welcome_de.png` });
await page.click('.welcome [data-lang=en]'); await page.waitForTimeout(300);
console.log('after EN:', (await txt('.welcome h1')), '|', (await txt('.welcome p')).slice(0, 60), '| header lang:', await page.$eval('html', (h) => h.lang));
await page.screenshot({ path: `${shots}/welcome_en.png` });
await page.mouse.move(5, 5);   // pointer outside → countdown runs
await page.waitForTimeout(6500);
console.log('auto-closed after 6 s:', !(await page.$('.welcome')));
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500);
console.log('shown again on reload:', !!(await page.$('.welcome')));
console.log('errors:', errors.join('\n') || 'none');
await browser.close();
