// Link previews (WhatsApp, Signal, Slack …) for the short link analyze.wicki.aero/v/<id>: messengers read
// Open-Graph tags without running JavaScript, and the app is a static GitHub Pages site. So for every public
// flight a tiny page v/<id>/index.html with the tags (and a redirect into the app) is committed to the Pages
// repository through the GitHub Contents API – needs the Worker secret GITHUB_PAGES_TOKEN (fine-grained token,
// Contents: read & write on PAGES_REPO). Without the token nothing is written; the Worker still serves the same
// page itself under /v/<id> (workers.dev) for testing. Private or deleted flights get their page removed.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDate = (ms) => { const d = new Date(ms); return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`; };
const fmtTime = (ms) => { const d = new Date(ms); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; };
const fmtDur = (sec) => `${Math.floor(sec / 3600)} h ${pad2(Math.round((sec % 3600) / 60))} min`;
const parse = (s, d = {}) => { try { return JSON.parse(s) || d; } catch { return d; } };

/** Title and description of a flight row (the master data the pilot entered + key figures). */
export function previewText(row, lang = 'de') {
  const meta = parse(row.meta), stats = parse(row.stats);
  const app = lang === 'en' ? 'Flight analysis/report' : 'Fahrtanalyse/Fahrtbericht';
  const start = row.start_ts || (stats.takeoff && Date.parse(stats.takeoff.time)) || row.created_at;
  const parts = [app];
  if (meta.balloon) parts.push(meta.balloon);
  if (meta.event) parts.push(meta.event); else if (meta.title) parts.push(meta.title); else if (stats.startPlace || stats.landPlace) parts.push(`${stats.startPlace || '?'} → ${stats.landPlace || '?'}`);
  const title = `${parts.join(' – ')} (${lang === 'en' ? 'Launch' : 'Start'} ${start ? fmtDate(start) : '–'})`;
  const d = [];
  if (start) d.push(`${lang === 'en' ? 'Launch' : 'Start'} ${fmtDate(start)} ${fmtTime(start)} UTC${stats.startPlace ? ' ' + stats.startPlace : ''}`);
  const land = row.end_ts || (stats.landing && Date.parse(stats.landing.time));
  if (land) d.push(`${lang === 'en' ? 'Landing' : 'Landung'} ${fmtDate(land)} ${fmtTime(land)} UTC${stats.landPlace ? ' ' + stats.landPlace : ''}`);
  if (Number.isFinite(stats.durationSec)) d.push(fmtDur(stats.durationSec));
  if (Number.isFinite(stats.distanceM)) d.push(`${Math.round(stats.distanceM / 1000)} km`);
  d.push(lang === 'en' ? 'Map, altitude profile and key figures' : 'Karte, Höhenprofil und Kennzahlen');
  return { title, description: d.join(' · ') };
}

/** The static page: Open-Graph tags + redirect into the app (meta refresh for browsers without JS). */
export function previewHtml(row, appUrl, lang = 'de') {
  const { title, description } = previewText(row, lang);
  const base = (appUrl || 'https://analyze.wicki.aero').replace(/\/$/, '');
  const target = `${base}/?v=${row.id}#analyze`, canonical = `${base}/v/${row.id}`;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(lang === 'en' ? 'Flight analysis/report · Wickipartners Ballonteam' : 'Fahrtanalyse/Fahrtbericht · Wickipartners Ballonteam')}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${base}/img/logo.png">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<script>location.replace(${JSON.stringify(target)});</script>
</head>
<body style="font-family:system-ui,sans-serif;padding:24px"><p>${esc(title)}<br><a href="${esc(target)}">${esc(lang === 'en' ? 'Open the flight' : 'Fahrt öffnen')}</a></p></body>
</html>
`;
}

const GH = 'https://api.github.com';
function ghHeaders(env) {
  return { Authorization: `Bearer ${env.GITHUB_PAGES_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'analyze-api', 'X-GitHub-Api-Version': '2022-11-28' };
}
const pagePath = (id) => `v/${id}/index.html`;

async function currentSha(env, repo, path, branch) {
  const res = await fetch(`${GH}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, { headers: ghHeaders(env) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`github ${res.status}`);
  const j = await res.json(); return j.sha || null;
}

/** Create/update the page of a public flight, remove it for a private one. Silent without token. */
export async function syncPreview(env, row) {
  if (!env.GITHUB_PAGES_TOKEN || !row) return { skipped: true };
  const repo = env.PAGES_REPO || 'bwicki/analyze', branch = env.PAGES_BRANCH || 'main', path = pagePath(row.id);
  try {
    const sha = await currentSha(env, repo, path, branch);
    if (!row.public) return sha ? removePreview(env, row.id, sha) : { ok: true, none: true };
    const html = previewHtml(row, env.APP_URL || 'https://analyze.wicki.aero', 'de');
    const content = btoa(String.fromCharCode(...new TextEncoder().encode(html)));
    const body = { message: `Vorschau Fahrt ${row.id}`, content, branch, ...(sha ? { sha } : {}) };
    const res = await fetch(`${GH}/repos/${repo}/contents/${path}`, { method: 'PUT', headers: { ...ghHeaders(env), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`github put ${res.status}`);
    return { ok: true };
  } catch (e) { console.warn('preview sync failed', row.id, e && e.message); return { ok: false, error: e && e.message }; }
}

export async function removePreview(env, id, sha = null) {
  if (!env.GITHUB_PAGES_TOKEN) return { skipped: true };
  const repo = env.PAGES_REPO || 'bwicki/analyze', branch = env.PAGES_BRANCH || 'main', path = pagePath(id);
  try {
    const s = sha || await currentSha(env, repo, path, branch);
    if (!s) return { ok: true, none: true };
    const res = await fetch(`${GH}/repos/${repo}/contents/${path}`, { method: 'DELETE', headers: { ...ghHeaders(env), 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Vorschau Fahrt ${id} entfernt`, sha: s, branch }) });
    if (!res.ok && res.status !== 404) throw new Error(`github delete ${res.status}`);
    return { ok: true };
  } catch (e) { console.warn('preview remove failed', id, e && e.message); return { ok: false, error: e && e.message }; }
}
