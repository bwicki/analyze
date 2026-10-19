// Photos of the current (saved) flight: server rows, placed on the track with the flight's camera
// zone/offset (meta.photoTz minutes, meta.photoOffsetSec). Re-placed whenever the track or the
// settings change; the card, map, profile and report read state.photosPlaced.

import { state, bus, saveMeta } from '../state.js';
import { api } from '../api.js';
import { placePhotos } from './place.js';

/** Camera zone in minutes: the flight's setting, else the browser's zone at take-off (home time). */
export function cameraTz() {
  const m = state.meta;
  if (Number.isFinite(m.photoTz)) return m.photoTz;
  const t = state.stats && state.stats.takeoff ? state.stats.takeoff.t : Date.now();
  return -new Date(t).getTimezoneOffset();
}
export const cameraOffsetSec = () => (Number.isFinite(state.meta.photoOffsetSec) ? state.meta.photoOffsetSec : 0);

export function placeAll() {
  state.photosPlaced = placePhotos(state.photos || [], state.track, state.series, state.trim, { tzMinutes: cameraTz(), offsetSec: cameraOffsetSec() });
  bus.emit('photos');
}

export async function loadPhotos() {
  const f = state.flight;
  if (!f || !f.id || !api.enabled()) { state.photos = []; placeAll(); return; }
  try { state.photos = state.viewer ? await api.photos.listPublic(f.id) : await api.photos.list(f.id); }
  catch { state.photos = []; }
  placeAll();
}

export function setPhotos(list) { state.photos = list; placeAll(); }

let metaTimer = null;
/** Change camera zone/offset: re-place now, persist in the flight meta (server) shortly after. */
export function setCameraSettings({ tzMinutes, offsetSec }) {
  if (tzMinutes !== undefined) state.meta.photoTz = tzMinutes;
  if (offsetSec !== undefined) state.meta.photoOffsetSec = offsetSec;
  saveMeta(); placeAll();
  clearTimeout(metaTimer);
  metaTimer = setTimeout(() => { if (state.flight && !state.viewer && api.enabled()) api.flights.update(state.flight.id, { meta: { ...state.meta } }).catch(() => {}); }, 800);
}

bus.on('track', () => { if (state.photos && state.photos.length) placeAll(); });
