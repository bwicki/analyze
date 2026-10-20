// Download of the raw tracker files stored with a flight (0.8.7/0.8.8): fetch each gzip, inflate, hand the
// originals back – one file directly, several as one ZIP. Used by «Meine Fahrten» (own flights) and the
// Supermaster (any flight); the list and fetch functions come from the caller (different endpoints).

import { gunzipToBytes } from '../api.js';
import { zip } from '../parse/zip.js';
import { saveBlob } from './download.js';

const safeName = (s) => String(s || 'Fahrt').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 60);

/** list: [{n, name}], fetchFile(n) → Response (gzip body). Returns the number of files saved. */
export async function downloadRawSet({ list, fetchFile, title, id }) {
  const entries = [];
  for (const f of list) { const res = await fetchFile(f.n); entries.push({ name: f.name, data: await gunzipToBytes(await res.blob()) }); }
  if (!entries.length) return 0;
  if (entries.length === 1) saveBlob(new Blob([entries[0].data]), entries[0].name);
  else saveBlob(new Blob([await zip(entries)], { type: 'application/zip' }), `${safeName(title)}_${id}_rohdaten.zip`);
  return entries.length;
}
