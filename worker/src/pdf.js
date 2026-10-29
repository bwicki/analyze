// Fahrtbericht als PDF vom Server (0.13.0): Cloudflare Browser Rendering (REST, like ops.wicki.aero) opens the viewer
// of a public flight on the report page (?v=<id>&pdf=1#report), waits until the app flags the page as ready and
// prints A4. The PDF is cached in R2 (pdfs/<id>-<updated_at>.pdf) until the flight changes. Needs the Worker
// secrets CF_BR_TOKEN (API token with Browser Rendering) and CF_ACCOUNT_ID.

import { HttpError } from './auth.js';

const PDF_PREFIX = 'pdfs/';
const RENDER_TIMEOUT = 60000;

function cfg(env) {
  if (!env.CF_BR_TOKEN || !env.CF_ACCOUNT_ID) throw new HttpError(503, 'PDF rendering not configured (CF_BR_TOKEN / CF_ACCOUNT_ID missing)');
  return { token: env.CF_BR_TOKEN, account: env.CF_ACCOUNT_ID, app: (env.APP_URL || 'https://analyze.wicki.aero').replace(/\/+$/, '') };
}

const safeName = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'Fahrt';
export const pdfKey = (id, updatedAt) => `${PDF_PREFIX}${id}-${updatedAt || 0}.pdf`;

/** Render (or serve the cached) PDF of a public flight row – the renderer opens the public viewer page, so private flights keep the browser print. */
export async function reportPdf(env, ctx, row) {
  if (!row) throw new HttpError(404, 'flight not found');
  if (!row.public) throw new HttpError(403, 'flight not public – print it from the app instead');
  const c = cfg(env);
  const key = pdfKey(row.id, row.updated_at);
  const date = row.start_ts ? new Date(row.start_ts).toISOString().slice(0, 10) : '';
  const filename = `Fahrtbericht_${safeName(row.title)}${date ? '_' + date : ''}.pdf`;
  const headers = (bytes) => ({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': 'private, max-age=300', 'X-Analyze-Bytes': String(bytes) });
  const cached = await env.FILES.get(key);
  if (cached) return new Response(cached.body, { headers: headers(cached.size) });
  const page = `${c.app}/?v=${row.id}&pdf=1#report`;
  let res;
  try {
    res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${c.account}/browser-rendering/pdf`, {
      method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: page, gotoOptions: { waitUntil: 'networkidle0', timeout: RENDER_TIMEOUT }, waitForSelector: { selector: 'html[data-print-ready]', timeout: 45000 }, waitForTimeout: 1500, viewport: { width: 1100, height: 1500 }, emulateMediaType: 'print', pdfOptions: { format: 'a4', printBackground: true, preferCSSPageSize: true } }),
      signal: AbortSignal.timeout(RENDER_TIMEOUT + 15000),
    });
  } catch (e) { throw new HttpError(504, `Browser Rendering not reachable (${e.name || 'error'})`); }
  const ct = (res.headers.get('Content-Type') || '').split(';')[0];
  if (!res.ok || ct !== 'application/pdf') { let m = `Browser Rendering HTTP ${res.status}`; try { const j = await res.json(); m = (j.errors && j.errors[0] && j.errors[0].message) || m; } catch { /* no JSON */ } throw new HttpError(502, m); }
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 1000) throw new HttpError(502, 'Browser Rendering returned an empty PDF');
  await env.FILES.put(key, buf, { httpMetadata: { contentType: 'application/pdf' }, customMetadata: { flight: row.id } });
  if (ctx) ctx.waitUntil(dropOldPdfs(env, row.id, key));
  return new Response(buf, { headers: headers(buf.byteLength) });
}

/** Remove cached PDFs of a flight (all, or all but keep). */
export async function dropOldPdfs(env, id, keep = null) {
  try {
    const list = await env.FILES.list({ prefix: `${PDF_PREFIX}${id}-` });
    for (const o of list.objects || []) if (o.key !== keep) await env.FILES.delete(o.key);
  } catch (e) { console.warn('pdf cleanup', e); }
}
