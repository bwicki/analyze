// Put photos onto the track: camera time → UTC (camera zone or EXIF zone, fine offset) → track index,
// position and altitude; Δ to the EXIF GPS position when the photo carries one. Pure, tested.

import { indexAt } from '../process/series.js';
import { haversine } from '../util/geo.js';

/**
 * UTC ms of a photo: cameraTime is the camera clock read as UTC; exifTz wins over the flight's zone.
 * A manually entered time (p.manual, photos without EXIF) is UTC already – no zone, no fine offset.
 */
export function photoUtc(p, { tzMinutes = 0, offsetSec = 0 } = {}) {
  if (!Number.isFinite(p.cameraTime)) return NaN;
  if (p.manual) return p.cameraTime;
  const tz = Number.isFinite(p.exifTz) ? p.exifTz : tzMinutes;
  return p.cameraTime - tz * 60000 + offsetSec * 1000;
}

export function placePhotos(photos, track, series, trim, opts = {}) {
  const out = [];
  for (const p of photos) {
    const t = photoUtc(p, opts);
    const base = { ...p, t, idx: -1, onTrack: false, inTrim: false, lat: Number.isFinite(p.exifLat) ? p.exifLat : NaN, lon: Number.isFinite(p.exifLon) ? p.exifLon : NaN, alt: Number.isFinite(p.exifAlt) ? p.exifAlt : NaN, distM: NaN, dist: NaN };
    if (Number.isNaN(t) || !track || !track.points.n) { out.push(base); continue; }
    const ps = track.points, ts = ps.t, n = ps.n;
    const i = indexAt(ts, t);
    const inside = t >= ts[0] - 60000 && t <= ts[n - 1] + 60000;
    let q = i; while (q > 0 && !ps.fix[q]) q--;
    const onTrack = inside && ps.fix[q] === 1 && Math.abs(ts[i] - t) < 10 * 60000;
    const inTrim = !trim || (t >= trim.from && t <= trim.to);
    if (!onTrack) { out.push({ ...base, idx: inside ? i : -1, inTrim }); continue; }
    const lat = ps.lat[q], lon = ps.lon[q];
    out.push({ ...base, idx: i, onTrack, inTrim, lat, lon, alt: series.alt[i], dist: series.dist[i], trackLat: lat, trackLon: lon, distM: Number.isFinite(p.exifLat) ? haversine(p.exifLat, p.exifLon, lat, lon) : NaN });
  }
  return out.sort((a, b) => (Number.isNaN(a.t) ? 1 : Number.isNaN(b.t) ? -1 : a.t - b.t));
}

/**
 * Suggest a camera zone/offset from photos that carry GPS: the zone (in 30-min steps) for which the
 * photos' positions best agree with the track. Returns {tzMinutes, offsetSec, meanDistM} or null.
 */
export function suggestCameraZone(photos, track, series) {
  const withGps = photos.filter((p) => Number.isFinite(p.exifLat) && Number.isFinite(p.cameraTime) && !Number.isFinite(p.exifTz) && !p.manual);
  if (withGps.length < 2 || !track) return null;
  let best = null;
  for (let tz = -12 * 60; tz <= 14 * 60; tz += 30) {
    const placed = placePhotos(withGps, track, series, null, { tzMinutes: tz });
    const ds = placed.filter((p) => p.onTrack && !Number.isNaN(p.distM)).map((p) => p.distM);
    if (ds.length < withGps.length / 2) continue;
    const mean = ds.reduce((s, d) => s + d, 0) / ds.length;
    if (!best || mean < best.meanDistM) best = { tzMinutes: tz, offsetSec: 0, meanDistM: mean, n: ds.length };
  }
  return best;
}
