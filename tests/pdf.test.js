// Bericht-PDF vom Server (0.13.0): Browser Rendering is stubbed (fetch); the PDF is cached in R2 per updated_at and
// old copies are removed; private flights and a missing configuration are refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportPdf, dropOldPdfs, pdfKey } from '../worker/src/pdf.js';

function fakeR2() {
  const objs = new Map();
  return { objs,
    put: async (key, data) => { objs.set(key, new Uint8Array(data)); },
    get: async (key) => (objs.has(key) ? { body: objs.get(key), size: objs.get(key).byteLength } : null),
    delete: async (key) => { objs.delete(key); },
    list: async ({ prefix }) => ({ objects: [...objs.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }) };
}
const pdfBytes = () => new Uint8Array(1200).fill(37);   // > 1000 bytes
const ctx = () => { const jobs = []; return { jobs, waitUntil: (p) => jobs.push(p), done: () => Promise.all(jobs) }; };

test('reportPdf: renders the public viewer page through Browser Rendering, caches per updated_at, drops stale copies', async () => {
  const env = { CF_BR_TOKEN: 'br-token', CF_ACCOUNT_ID: 'acc1', APP_URL: 'https://analyze.wicki.aero/', FILES: fakeR2() };
  const row = { id: 'ABCD1234', title: 'GB26 Fahrt 3 – Müller', start_ts: Date.UTC(2026, 7, 29, 6), public: 1, updated_at: 5 };
  const seen = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) }); return new Response(pdfBytes(), { status: 200, headers: { 'Content-Type': 'application/pdf' } }); };
  try {
    await env.FILES.put(pdfKey('ABCD1234', 4), pdfBytes());   // stale copy from before the last update
    const c = ctx();
    const res = await reportPdf(env, c, row); await c.done();
    assert.equal(res.headers.get('Content-Type'), 'application/pdf');
    assert.equal(res.headers.get('Content-Disposition'), 'inline; filename="Fahrtbericht_GB26_Fahrt_3_Muller_2026-08-29.pdf"');
    assert.equal(res.headers.get('X-Analyze-Bytes'), '1200');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, 'https://api.cloudflare.com/client/v4/accounts/acc1/browser-rendering/pdf'); assert.equal(seen[0].auth, 'Bearer br-token');
    assert.equal(seen[0].body.url, 'https://analyze.wicki.aero/?v=ABCD1234&pdf=1#report'); assert.equal(seen[0].body.waitForSelector.selector, 'html[data-print-ready]'); assert.equal(seen[0].body.emulateMediaType, 'print');
    assert.deepEqual([...env.FILES.objs.keys()], ['pdfs/ABCD1234-5.pdf']);   // stale copy gone, new one cached
    const res2 = await reportPdf(env, ctx(), row);
    assert.equal(res2.status, 200); assert.equal(seen.length, 1);   // served from R2, no second render
    // a changed flight renders again
    await reportPdf(env, ctx(), { ...row, updated_at: 6 }); assert.equal(seen.length, 2);
  } finally { globalThis.fetch = realFetch; }
});

test('reportPdf: refusals – private flight 403, not configured 503, renderer error 502, empty PDF 502', async () => {
  const files = fakeR2();
  await assert.rejects(reportPdf({ CF_BR_TOKEN: 'x', CF_ACCOUNT_ID: 'y', FILES: files }, null, { id: 'ABCD1234', public: 0, updated_at: 1 }), (e) => e.status === 403);
  await assert.rejects(reportPdf({ FILES: files }, null, { id: 'ABCD1234', public: 1, updated_at: 1 }), (e) => e.status === 503 && /CF_BR_TOKEN/.test(e.message));
  await assert.rejects(reportPdf({ CF_BR_TOKEN: 'x', CF_ACCOUNT_ID: 'y', FILES: files }, null, null), (e) => e.status === 404);
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ success: false, errors: [{ message: 'Unable to render: timeout' }] }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(reportPdf({ CF_BR_TOKEN: 'x', CF_ACCOUNT_ID: 'y', FILES: files }, null, { id: 'ABCD1234', public: 1, updated_at: 1 }), (e) => e.status === 502 && /timeout/.test(e.message));
    globalThis.fetch = async () => new Response(new Uint8Array(10), { status: 200, headers: { 'Content-Type': 'application/pdf' } });
    await assert.rejects(reportPdf({ CF_BR_TOKEN: 'x', CF_ACCOUNT_ID: 'y', FILES: files }, null, { id: 'ABCD1234', public: 1, updated_at: 1 }), (e) => e.status === 502 && /empty/.test(e.message));
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    await assert.rejects(reportPdf({ CF_BR_TOKEN: 'x', CF_ACCOUNT_ID: 'y', FILES: files }, null, { id: 'ABCD1234', public: 1, updated_at: 1 }), (e) => e.status === 504);
    assert.equal(files.objs.size, 0);   // nothing cached on failure
  } finally { globalThis.fetch = realFetch; }
});

test('dropOldPdfs: removes all cached PDFs of a flight (or all but the one to keep), other flights untouched', async () => {
  const files = fakeR2();
  for (const k of ['pdfs/ABCD1234-1.pdf', 'pdfs/ABCD1234-2.pdf', 'pdfs/ABCD1234-3.pdf', 'pdfs/ABCD1235-1.pdf']) await files.put(k, pdfBytes());
  await dropOldPdfs({ FILES: files }, 'ABCD1234', 'pdfs/ABCD1234-3.pdf');
  assert.deepEqual([...files.objs.keys()].sort(), ['pdfs/ABCD1234-3.pdf', 'pdfs/ABCD1235-1.pdf']);
  await dropOldPdfs({ FILES: files }, 'ABCD1234');
  assert.deepEqual([...files.objs.keys()], ['pdfs/ABCD1235-1.pdf']);
  await dropOldPdfs({ FILES: { list: async () => { throw new Error('r2 down'); } } }, 'ABCD1234');   // never throws
});
