// Shared settings of the smoke tests: base URL of the static server, fixtures, screenshot folder, browser launch.
import { readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const shots = process.env.SMOKE_SHOTS || join(tmpdir(), 'analyze-smoke');
try { mkdirSync(shots, { recursive: true }); } catch { /* exists */ }
export const env = {
  base: (process.env.SMOKE_BASE || 'http://127.0.0.1:8765').replace(/\/$/, ''),
  fixtures: join(here, '..', 'fixtures'),
  shots,
  leafletStub: readFileSync(join(here, 'leaflet_stub.js'), 'utf8'),
  /** Launch options: PW_CHROMIUM may point at a Chromium binary (sandboxes), otherwise Playwright's own build. */
  launch: (args = []) => ({ ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}), args: [...new Set(['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', ...args])] }),
};
