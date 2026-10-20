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

/**
 * Geodesic distance on the WGS84 ellipsoid (Vincenty inverse, metres) – the basis for FAI/record
 * distances. Falls back to haversine for the (practically impossible) non-converging antipodal case.
 */
const WGS84 = { a: 6378137, b: 6356752.314245, f: 1 / 298.257223563 };
export function vincenty(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const { a, b, f } = WGS84;
  const L = rad(lon2 - lon1), U1 = Math.atan((1 - f) * Math.tan(rad(lat1))), U2 = Math.atan((1 - f) * Math.tan(rad(lat2)));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1), sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
  let lambda = L, prev, iter = 0, sinSigma, cosSigma, sigma, sinAlpha, cosSqAlpha, cos2SigmaM;
  do {
    const sinL = Math.sin(lambda), cosL = Math.cos(lambda);
    sinSigma = Math.sqrt((cosU2 * sinL) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosL) ** 2);
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosL;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = cosU1 * cosU2 * sinL / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSqAlpha !== 0 ? cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha : 0;
    const C = f / 16 * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
    prev = lambda;
    lambda = L + (1 - C) * f * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  } while (Math.abs(lambda - prev) > 1e-12 && ++iter < 200);
  if (iter >= 200) return haversine(lat1, lon1, lat2, lon2);
  const uSq = cosSqAlpha * (a * a - b * b) / (b * b);
  const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const dSigma = B * sinSigma * (cos2SigmaM + B / 4 * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) - B / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  return b * A * (sigma - dSigma);
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
