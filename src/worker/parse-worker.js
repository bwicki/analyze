// Parser worker: receives File objects (or ZIPs), detects the tracker profile, parses, and hands the
// PointSets back as transferable typed arrays. Keeps the page responsive for 80-MB logs.

import { detectProfile, PROFILES } from '../parse/profiles.js';
import { readWithProfile } from '../parse/readers.js';
import { transferables } from '../parse/points.js';
import { unzip } from '../parse/zip.js';

const td = new TextDecoder('utf-8');

function decode(bytes) {
  // UTF-8 first; fall back to latin-1 when the text has replacement characters (old loggers)
  const s = td.decode(bytes);
  return s.includes('�') ? new TextDecoder('latin1').decode(bytes) : s;
}

async function parseOne(name, bytes, size, profiles, post) {
  const text = decode(bytes);
  const head = text.slice(0, 4000);
  const det = detectProfile(name, head, profiles);
  if (det.unknown) return { name, size, unknown: true, analysis: det.analysis, head: text.slice(0, 1500) };
  post({ type: 'progress', name, stage: 'parse', profile: det.profile.name });
  const t0 = Date.now();
  const r = readWithProfile(text, det.profile);
  return { name, size, profile: det.profile, points: r.points, bad: r.bad, columns: r.columns, ms: Date.now() - t0, timeless: r.timeless || (det.profile.read.kind === 'kml' && r.points.n > 0 && r.points.t[0] < 1e9) };
}

self.onmessage = async (e) => {
  const { id, cmd, files, profiles } = e.data;
  if (cmd !== 'parse') return;
  const post = (m) => self.postMessage({ id, ...m });
  const allProfiles = [...(profiles || []), ...PROFILES];
  const results = [], transfer = [];
  try {
    for (const f of files) {
      post({ type: 'progress', name: f.name, stage: 'read' });
      const buf = await f.arrayBuffer();
      const isZip = /\.zip$/i.test(f.name) || (buf.byteLength > 4 && new DataView(buf).getUint32(0, true) === 0x04034b50);
      if (isZip) {
        let entries;
        try { entries = await unzip(buf); } catch (err) { results.push({ name: f.name, size: f.size, error: String(err.message || err) }); continue; }
        for (const en of entries) {
          if (/\.(csv|jsonl|json|geojson|txt|gpx|kml|igc|log|nmea)$/i.test(en.name) === false) continue;
          const r = await parseOne(en.name, en.data, en.data.length, allProfiles, post);
          r.container = f.name; results.push(r);
        }
      } else {
        results.push(await parseOne(f.name, new Uint8Array(buf), f.size, allProfiles, post));
      }
    }
    for (const r of results) if (r.points) transfer.push(...transferables(r.points));
    self.postMessage({ id, type: 'done', results }, transfer);
  } catch (err) {
    post({ type: 'error', message: String(err && err.message || err) });
  }
};
