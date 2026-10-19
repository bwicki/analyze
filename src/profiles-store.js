// User-made tracker profiles: shared ones from the Worker (everyone), private ones in this browser.
// The parser gets them ahead of the built-in list, so a saved format is recognised from then on.

import { api } from './api.js';
import { hasServer } from './session.js';
import { state, bus } from './state.js';

const LS_KEY = 'analyze.profiles';
const loadLocal = () => { try { const v = JSON.parse(localStorage.getItem(LS_KEY)); return Array.isArray(v) ? v : []; } catch { return []; } };
const saveLocal = (list) => { try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* private mode */ } };

let shared = [], local = loadLocal();

/** Profiles for the parser: shared first, then local; each a plain JSON spec. */
export function userProfiles() { return [...shared.map((p) => ({ ...p.spec, id: p.id, name: p.name, manufacturer: p.manufacturer, shared: true })), ...local]; }
function publish() { state.userProfiles = userProfiles(); bus.emit('profiles'); }

export async function refreshSharedProfiles() {
  if (!hasServer()) { publish(); return; }
  try { shared = await api.profiles.list(); } catch { /* offline – keep what we have */ }
  publish();
}

/** Save: shared (server, with Kennung) when wanted and possible, otherwise locally in this browser. */
export async function saveProfile(spec, { share = true, code = null } = {}) {
  if (share && hasServer() && code) {
    const rec = await api.profiles.create(spec.name, spec.manufacturer, spec, true);
    shared = [rec, ...shared.filter((p) => p.id !== rec.id)];
    publish();
    return { ...rec, where: 'shared' };
  }
  local = [spec, ...local.filter((p) => p.id !== spec.id)];
  saveLocal(local); publish();
  return { id: spec.id, where: 'local' };
}

export async function removeProfile(id, { code = null } = {}) {
  if (shared.some((p) => p.id === id)) { await api.profiles.remove(id); shared = shared.filter((p) => p.id !== id); }
  local = local.filter((p) => p.id !== id); saveLocal(local);
  publish();
}
export const sharedProfiles = () => shared;
export const localProfiles = () => local;
