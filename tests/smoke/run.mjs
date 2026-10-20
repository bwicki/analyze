// Runs the Playwright smoke tests against a static server of this repository (no network: tiles, geocoding and
// MapLibre are blocked or stubbed inside the scripts; Leaflet comes from tests/smoke/leaflet_stub.js).
// A script passes when it exits 0, prints «errors: none» and its expected lines appear. Usage: `npm run smoke`
// (needs `npm install --no-save playwright` and `npx playwright install chromium`, or PW_CHROMIUM=<binary>).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.csv': 'text/csv', '.jsonl': 'application/jsonl', '.webmanifest': 'application/manifest+json' };

/** Each smoke with the lines that must appear (regular expressions on the whole stdout). */
const SMOKES = [
  ['smoke_welcome.mjs', [/welcome shown: true/, /auto-closed after 6 s: true/, /shown again on reload: false/]],
  ['smoke_legal.mjs', [/legal modal: 1/, /closed: 0/]],
  ['smoke_back.mjs', [/export: /]],
  ['smoke_extremes.mjs', [/extreme symbols on profile: ◆ ▶ ▲ ▼/, /report extremes: ◆ ▶ ▲ ▼/]],
  ['smoke_viewer.mjs', [/detail viewer: 1/, /record title: Fahrtaufzeichnung/, /map back in card: 1/, /viewers at end: 0/]],
  ['smoke_manual.mjs', [/report photos: /]],
  ['smoke_print.mjs', [/report print button: false/, /printed total \d \| hash #report/]],
  ['smoke_export6.mjs', [/report bar colour: rgb/]],
  ['smoke_raw.mjs', [/repo list: /]],
  ['smoke_logbook.mjs', [/modal: 1 \| rows: 2/, /csv: Logbuch_2025_KQZMWB\.csv/, /print called: \[ 1, 'print-logbook' \]/]],
  ['smoke_ops.mjs', [/special card \(team PIN\): 1/, /toast: An Briefing 2026-004 übergeben \(241 Punkte\)/]],
  ['smoke_mapshare.mjs', [/90 Positionen geladen/, /1 Segment\(e\) verwendet · 90 Punkte/]],
  ['smoke_events.mjs', [/legend: Ereignisse:ATC \d.*Ballast \d/, /tip after hover: true \| .*23:40 UTC · ATC/, /tip after leave: false/, /tap toggles: shown true \| hidden again true/, /map markers in events pane: [1-9]/, /report legend: Ereignisse:/]],
  ['smoke_pdf.mjs', [/pdf link after save: 1 \| .*\/api\/view\/NEWFLJGH\/report\.pdf/, /pdf mode: hash #report \| html\.pdf: true \| print-ready: 1/, /print media hides chrome: true/]],
];

async function serve(port) {
  const srv = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = join(root, p);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      const st = await stat(file).catch(() => null);
      if (!st || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(await readFile(file));
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  await new Promise((r) => srv.listen(port, '127.0.0.1', r));
  return srv;
}

function run(file, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(root, 'tests', 'smoke', file)], { cwd: root, env: { ...process.env, ...env } });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); err += '\n[timeout 240 s]'; }, 240000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

const port = +(process.env.SMOKE_PORT || 8765);
const only = process.argv.slice(2);
const srv = await serve(port);
if (process.env.GITHUB_ACTIONS) console.log(`::notice title=smoke::runner started on port ${port}, ${SMOKES.length} scripts`);
let failed = 0;
for (const [file, expect] of SMOKES) {
  if (only.length && !only.some((o) => file.includes(o))) continue;
  const t0 = Date.now();
  const r = await run(file, { SMOKE_BASE: `http://127.0.0.1:${port}` });
  const problems = [];
  if (r.code !== 0) problems.push(`exit ${r.code}`);
  if (!/errors: none/.test(r.out)) problems.push('errors reported');
  for (const re of expect) if (!re.test(r.out)) problems.push(`missing ${re}`);
  const ok = !problems.length;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${file} (${Math.round((Date.now() - t0) / 1000)} s)${ok ? '' : ' – ' + problems.join('; ')}`);
  if (!ok) { console.log(r.out.split('\n').map((l) => '    ' + l).join('\n')); if (r.err.trim()) console.log(r.err.split('\n').slice(0, 25).map((l) => '    ' + l).join('\n')); }
  // GitHub Actions: an annotation per failed script (readable through the checks API even without the raw log)
  if (!ok && process.env.GITHUB_ACTIONS) {
    const enc = (x) => String(x).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').slice(0, 900);
    console.log(`::error title=${file}::${enc(problems.join('; '))}`);
    console.log(`::warning title=${file} stdout::${enc(r.out.trim().split('\n').slice(-5).join(' | '))}`);
    if (r.err.trim()) console.log(`::warning title=${file} stderr::${enc(r.err.trim().split('\n').slice(0, 6).join(' | '))}`);
  }
}
srv.close();
console.log(failed ? `\n${failed} smoke test(s) failed` : '\nall smoke tests passed');
process.exit(failed ? 1 : 0);
