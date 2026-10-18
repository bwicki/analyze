// Kennzahlen der Fahrt (concept §7) from the merged track, derived series, events and the trim.
// Everything in SI (m, m/s, s); the UI converts to ICAO units.

import { haversine, bearing, nightIntervals } from '../util/geo.js';
import { movingMean, derivative, indexAt, positionAt } from './series.js';

function maxOf(t, v, i0, i1, sign = 1) {
  let best = NaN, bt = NaN;
  for (let i = i0; i <= i1; i++) { const x = v[i] * sign; if (!Number.isNaN(x) && (Number.isNaN(best) || x > best)) { best = x; bt = t[i]; } }
  return Number.isNaN(best) ? null : { v: best * sign, t: bt };
}
function meanOf(v, i0, i1) { let s = 0, c = 0; for (let i = i0; i <= i1; i++) if (!Number.isNaN(v[i])) { s += v[i]; c++; } return c ? s / c : NaN; }

/**
 * @param track  merged track {points, gap, gaps, segments}
 * @param series deriveSeries() output
 * @param events detectEvents().events
 * @param trim   {from, to} ms
 */
export function computeStats(track, series, events, trim, opts = {}) {
  const ps = track.points, t = ps.t, n = ps.n;
  const i0 = indexAt(t, trim.from), i1 = indexAt(t, trim.to);
  const inRange = (e) => e.t >= trim.from - 1000 && e.t <= trim.to + 1000;
  const evs = events.filter(inRange);
  const takeoffs = evs.filter((e) => e.type === 'takeoff'), landings = evs.filter((e) => e.type === 'landing');
  const takeoff = takeoffs[0] || null, landing = landings.length ? landings[landings.length - 1] : null;
  const intermediate = [];
  for (let k = 0; k < landings.length - (landing ? 1 : 0); k++) {
    const l = landings[k]; const next = takeoffs.find((x) => x.t > l.t);
    intermediate.push({ t: l.t, lat: l.lat, lon: l.lon, alt: l.alt, groundSec: next ? (next.t - l.t) / 1000 : null });
  }
  const durationSec = takeoff && landing ? (landing.t - takeoff.t) / 1000 : (t[i1] - t[i0]) / 1000;
  let airSec = 0; for (let k = 0; k < takeoffs.length; k++) { const l = landings.find((x) => x.t > takeoffs[k].t); airSec += ((l ? l.t : t[i1]) - takeoffs[k].t) / 1000; }
  const a0 = takeoff ? takeoff.idx : i0, a1 = landing ? landing.idx : i1; // airborne index range
  // distance
  const distanceM = series.dist[a1] - series.dist[a0];
  let firstFix = a0; while (firstFix < a1 && !ps.fix[firstFix]) firstFix++;
  let lastFix = a1; while (lastFix > a0 && !ps.fix[lastFix]) lastFix--;
  const straightM = ps.fix[firstFix] && ps.fix[lastFix] ? haversine(ps.lat[firstFix], ps.lon[firstFix], ps.lat[lastFix], ps.lon[lastFix]) : NaN;
  const bearingDeg = ps.fix[firstFix] && ps.fix[lastFix] ? bearing(ps.lat[firstFix], ps.lon[firstFix], ps.lat[lastFix], ps.lon[lastFix]) : NaN;
  // altitude
  const altMax = maxOf(t, series.altClean, a0, a1);
  const altMean = meanOf(series.altClean, a0, a1);
  const baroMax = maxOf(t, ps.balt, a0, a1);
  const hasBaro = baroMax !== null;
  // vertical speed: 30-s mean of the masked series
  const vs30 = movingMean(t, series.vs, 15);
  const vsMax = maxOf(t, vs30, a0, a1, 1), vsMin = maxOf(t, vs30, a0, a1, -1);
  // ground speed
  const gs10 = movingMean(t, series.gs, 5);
  const gsMax = maxOf(t, gs10, a0, a1), gsMean = meanOf(series.gs, a0, a1);
  // accelerations derived over 3 s (concept decision 6)
  const accV = derivative(t, movingMean(t, series.vs, 1), 1.5), accH = derivative(t, movingMean(t, series.gs, 1), 1.5);
  const accVertMax = maxOf(t, accV.map(Math.abs), a0, a1), accHorMax = maxOf(t, accH.map(Math.abs), a0, a1);
  // touchdown vertical speed: mean vs in the 5 s before each landing
  const touchdown = landings.map((l) => { let s = 0, c = 0; for (let i = l.idx; i >= 0 && (l.t - t[i] <= 10000 || c < 3); i--) { if (!Number.isNaN(series.vs[i])) { s += series.vs[i]; c++; } if (l.t - t[i] > 120000) break; } return { t: l.t, vs: c ? s / c : NaN }; });
  // night along the track (civil twilight)
  const nightFrom = takeoff ? takeoff.t : t[i0], nightTo = landing ? landing.t : t[i1];
  const night = nightIntervals(nightFrom, nightTo, (ms) => positionAt(track, ms), opts.nightLimitDeg ?? -6, 60);
  // gaps and restarts within the trim
  const gaps = track.gaps.filter((g) => g.to >= trim.from && g.from <= trim.to);
  // restarts = segment boundaries inside the trim (a restart may leave a gap shorter than gapSec)
  const restartList = [];
  for (let k = 1; k < track.segments.length; k++) { const s = track.segments[k]; const i = s.from; if (t[i] >= trim.from && t[i] <= trim.to) restartList.push({ t: t[i], sec: (t[i] - t[i - 1]) / 1000, segFrom: track.segments[k - 1].id, segTo: s.id }); }
  const restarts = restartList.length;
  let nFix = 0; for (let i = i0; i <= i1; i++) nFix += ps.fix[i];
  // tracker extras
  const battMin = maxOf(t, ps.batt, i0, i1, -1), battMax = maxOf(t, ps.batt, i0, i1, 1);
  return {
    trim: { from: trim.from, to: trim.to, i0, i1 }, takeoff, landing, landings: landings.length, intermediate, takeoffs: takeoffs.length,
    durationSec, airSec, distanceM, straightM, bearingDeg,
    altMax, altMean, altSource: series.altSource, baroMax: hasBaro ? baroMax : null,
    vsMax, vsMin, vsSource: series.vsSource, gsMax, gsMean, gsSource: series.gsSource,
    accVertMax, accHorMax, touchdown,
    night, gaps, restarts, restartList, nPoints: i1 - i0 + 1, nFix, collapsed: track.collapsed,
    batt: battMin ? { min: battMin.v, max: battMax.v } : null,
    altMasked: series.altMask.reduce((s, x) => s + x, 0),
  };
}
