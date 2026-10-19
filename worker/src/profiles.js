// Shared tracker profiles (concept §5): a Kennung saves a profile from the assistant, everyone's app
// loads the public list at start and the parser recognises the format from then on.

import { HttpError, randomCode } from './auth.js';
import { logAction } from './log.js';

const SPEC_MAX = 20000;
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new HttpError(400, 'spec missing');
  if (!spec.read || !['delimited', 'jsonl', 'json'].includes(spec.read.kind)) throw new HttpError(400, 'spec.read.kind must be delimited, jsonl or json');
  if (!spec.detect || (!spec.detect.headStartsWith && !spec.detect.headContains && !(Array.isArray(spec.detect.ext) && spec.detect.ext.length))) throw new HttpError(400, 'spec.detect needs headStartsWith, headContains or ext');
  const f = spec.fields || {};
  if (!f.time || !(f.time.col || (f.time.date && f.time.time))) throw new HttpError(400, 'time field missing');
  if (!f.lat || !f.lat.col || !f.lon || !f.lon.col) throw new HttpError(400, 'lat/lon missing');
  const text = JSON.stringify(spec);
  if (text.length > SPEC_MAX) throw new HttpError(413, 'spec too large');
  if (/headMatches/.test(text)) throw new HttpError(400, 'regex detection is not allowed in shared profiles');
  return text;
}

export function profileView(row) {
  return { id: row.id, name: row.name, manufacturer: row.manufacturer || '', version: row.version, spec: parse(row.spec), createdBy: row.created_by, public: !!row.public, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function listProfiles(env, { all = false } = {}) {
  const r = await (all ? env.DB.prepare('SELECT * FROM tracker_profiles ORDER BY updated_at DESC') : env.DB.prepare('SELECT * FROM tracker_profiles WHERE public = 1 ORDER BY updated_at DESC')).all();
  return (r.results || []).map(profileView);
}

export async function createProfile(env, user, body, request) {
  const name = String(body.name || '').trim().slice(0, 80);
  if (name.length < 2) throw new HttpError(400, 'name missing');
  const manufacturer = String(body.manufacturer || '').trim().slice(0, 80);
  const spec = { ...(body.spec || {}), name, manufacturer, user: true };
  let id = String(spec.id || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'profile';
  const exists = await env.DB.prepare('SELECT id FROM tracker_profiles WHERE id = ?1').bind(id).first();
  if (exists) id = `${id}-${randomCode(4).toLowerCase()}`;
  spec.id = id;
  const text = validateSpec(spec);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO tracker_profiles (id, name, manufacturer, version, spec, created_by, public, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, ?7)')
    .bind(id, name, manufacturer, text, user.code, body.public === false ? 0 : 1, now).run();
  await logAction(env, user.code, 'profile.create', `${id} ${name}`, request);
  const row = await env.DB.prepare('SELECT * FROM tracker_profiles WHERE id = ?1').bind(id).first();
  return profileView(row);
}

export async function deleteProfile(env, who, id, request) {
  const row = await env.DB.prepare('SELECT * FROM tracker_profiles WHERE id = ?1').bind(id).first();
  if (!row) throw new HttpError(404, 'not found');
  if (!who.admin && row.created_by !== who.code) throw new HttpError(403, 'not your profile');
  await env.DB.prepare('DELETE FROM tracker_profiles WHERE id = ?1').bind(id).run();
  await logAction(env, who.admin ? `admin:${who.name}` : who.code, 'profile.delete', `${id} ${row.name}`, request);
  return { ok: true };
}
