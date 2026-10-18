// Geodesy: haversine distance, initial bearing, solar elevation (NOAA approximation) for the
// night computation. Pure functions, no DOM.

const R = 6371000;
const rad = (d) => d * Math.PI / 180;
const deg = (r) => r * 180 / Math.PI;

export function haversine(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2);
  const dp = p2 - p1, dl = rad(lon2 - lon1);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial (true) bearing from 1 to 2 in degrees 0..360. */
export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Solar elevation (degrees) at UTC time ms for a position – NOAA low-precision algorithm,
 * good to ~0.1°, which is plenty for civil twilight (−6°) along a balloon track.
 */
export function sunElevation(ms, lat, lon) {
  const jd = ms / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = rad((357.528 + 0.9856003 * n) % 360);
  const lam = rad(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
  const eps = rad(23.439 - 0.0000004 * n);
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const ha = rad(((gmst * 15 + lon) % 360 + 360) % 360) - ra;
  const phi = rad(lat);
  return deg(Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha)));
}

/**
 * Night intervals along a track: night = sun elevation below `limitDeg` (−6° = end/beginning of civil
 * twilight, EASA night) at the balloon's own position. Sampled every `stepSec`; the crossing time is
 * refined by bisection to ±10 s. Returns [{from, to}] in ms and the total seconds.
 * pos(ms) → {lat, lon} (interpolated track position); from/to = the time range to evaluate.
 */
export function nightIntervals(from, to, pos, limitDeg = -6, stepSec = 60) {
  const out = [];
  const isNight = (t) => { const p = pos(t); return p ? sunElevation(t, p.lat, p.lon) < limitDeg : false; };
  const refine = (a, b) => { // a and b differ in state; return crossing time
    let lo = a, hi = b, sa = isNight(a);
    while (hi - lo > 10000) { const mid = (lo + hi) / 2; if (isNight(mid) === sa) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  let state = isNight(from), start = state ? from : null, prev = from;
  for (let t = from + stepSec * 1000; t < to + stepSec * 1000; t += stepSec * 1000) {
    const tt = Math.min(t, to);
    const s = isNight(tt);
    if (s !== state) {
      const x = refine(prev, tt);
      if (s) start = x; else { out.push({ from: start, to: x }); start = null; }
      state = s;
    }
    prev = tt;
    if (tt >= to) break;
  }
  if (state && start !== null) out.push({ from: start, to });
  const total = out.reduce((s, iv) => s + (iv.to - iv.from) / 1000, 0);
  return { intervals: out, totalSec: total };
}

/** Sunrise/sunset-type crossing of a limit at a fixed position between two times (null if none). */
export function crossingAt(lat, lon, from, to, limitDeg = -6) {
  const f = (t) => sunElevation(t, lat, lon) - limitDeg;
  let a = from, b = to, fa = f(a);
  if (Math.sign(fa) === Math.sign(f(b))) return null;
  while (b - a > 10000) { const m = (a + b) / 2; if (Math.sign(f(m)) === Math.sign(fa)) { a = m; fa = f(m); } else b = m; }
  return (a + b) / 2;
}
