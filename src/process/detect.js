// Take-off / landing detection and the trim proposal (concept §6 steps 4–5).
// A point is "airborne" when, over the following window, the mean ground speed exceeds gsAir or the
// mean |vertical speed| exceeds vsAir; "on ground" when both fall below gsGround / vsGround.
// Every ground→air change is a take-off, air→ground a landing (intermediate landings are counted).

import { movingMean } from './series.js';

export const DETECT_DEFAULTS = {
  windowSec: 120,
  gsAir: 1.29,     // 2.5 kt in m/s
  vsAir: 0.4,      // m/s
  gsGround: 0.51,  // 1 kt
  vsGround: 0.25,  // m/s
  minAirSec: 120,  // shorter "flights" are ignored (a towed basket, a hop)
  minGroundSec: 60, // shorter ground contacts are not landings
  trimReserveSec: 120,
};

/** Forward-window mean (window starts at the point). */
function forwardMean(t, v, winSec) {
  const n = v.length, out = new Float32Array(n), w = winSec * 1000; let hi = 0, sum = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0 && !Number.isNaN(v[i - 1])) { sum -= v[i - 1]; cnt--; }
    if (hi < i) { hi = i; sum = 0; cnt = 0; }
    while (hi < n && t[hi] <= t[i] + w) { if (!Number.isNaN(v[hi])) { sum += v[hi]; cnt++; } hi++; }
    out[i] = cnt ? sum / cnt : NaN;
  }
  return out;
}

/**
 * Detect events on a track with derived series. Returns {events: [{type, t, idx, lat, lon, alt}], states}
 * states: Uint8Array per point (1 = airborne) for colouring the timeline.
 */
export function detectEvents(track, series, opts = {}) {
  const o = { ...DETECT_DEFAULTS, ...opts };
  const ps = track.points, t = ps.t, n = ps.n;
  const absVs = new Float32Array(n); for (let i = 0; i < n; i++) absVs[i] = Math.abs(series.vs[i]);
  const mGs = forwardMean(t, series.gs, o.windowSec), mVs = forwardMean(t, absVs, o.windowSec);
  const states = new Uint8Array(n);
  let air = false; const raw = [];
  for (let i = 0; i < n; i++) {
    const g = mGs[i], v = mVs[i];
    if (!air && ((g > o.gsAir) || (v > o.vsAir))) { air = true; raw.push({ type: 'takeoff', idx: i }); }
    else if (air && (Number.isNaN(g) || g < o.gsGround) && (Number.isNaN(v) || v < o.vsGround) && !(Number.isNaN(g) && Number.isNaN(v))) { air = false; raw.push({ type: 'landing', idx: i }); }
    states[i] = air ? 1 : 0;
  }
  if (air) raw.push({ type: 'end', idx: n - 1 }); // still airborne at the end of the recording
  // Remove short hops and short ground contacts
  const ev = [];
  for (const e of raw) {
    const last = ev[ev.length - 1];
    if (e.type === 'landing' && last && last.type === 'takeoff' && (t[e.idx] - t[last.idx]) / 1000 < o.minAirSec) { ev.pop(); continue; }
    if (e.type === 'takeoff' && last && last.type === 'landing' && (t[e.idx] - t[last.idx]) / 1000 < o.minGroundSec) { ev.pop(); continue; }
    ev.push(e);
  }
  // Snap each event to the exact moment. The forward window fires up to windowSec early, so:
  // take-off: go forward to the first point that itself moves (5-s means above the air thresholds),
  //           then back to the last quiet point (below the ground thresholds);
  // landing:  go back from the detection to the last point that still moves.
  const gs5 = movingMean(t, series.gs, 2.5), vs5 = movingMean(t, absVs, 2.5);
  const moving = (i) => gs5[i] > o.gsAir || vs5[i] > o.vsAir;
  const quiet = (i) => !(gs5[i] > o.gsGround) && !(vs5[i] > o.vsGround);
  const snap = (e) => {
    if (e.type === 'takeoff') {
      let j = e.idx; while (j < n - 1 && !moving(j) && (t[j] - t[e.idx]) < o.windowSec * 1500) j++;
      let k = j; while (k > 0 && !quiet(k) && (t[j] - t[k]) < 180000) k--;
      return k;
    }
    if (e.type === 'landing') {
      let k = e.idx; while (k > 0 && quiet(k) && (t[e.idx] - t[k]) < 180000) k--;
      return Math.min(n - 1, k + 1);
    }
    return e.idx;
  };
  const events = ev.map((e) => {
    const i = snap(e);
    let p = i; while (p > 0 && !ps.fix[p]) p--;
    return { type: e.type, idx: i, t: t[i], lat: ps.fix[p] ? ps.lat[p] : NaN, lon: ps.fix[p] ? ps.lon[p] : NaN, alt: series.alt[i] };
  });
  return { events, states: statesFromEvents(events, n), mGs, mVs };
}

/** Airborne flags per point from the event list (1 = between a take-off and the next landing). */
export function statesFromEvents(events, n) {
  const states = new Uint8Array(n);
  let on = false, from = 0;
  for (const e of events) { if (e.type === 'takeoff') { on = true; from = e.idx; } else if (on) { states.fill(1, from, e.idx + 1); on = false; } }
  if (on) states.fill(1, from, n);
  return states;
}

/**
 * Drop intermediate landings the user marked as false (a direction reversal or a zero-speed phase
 * looks like a touchdown): the landing and the take-off that follows it are removed, so the two
 * legs merge. ignored: landing times (ms); matches within 1 s.
 */
export function dropIgnoredLandings(events, ignored = []) {
  if (!ignored.length) return events;
  const out = []; let skipNextTakeoff = false;
  for (const e of events) {
    if (e.type === 'landing' && ignored.some((x) => Math.abs(x - e.t) < 1000)) { skipNextTakeoff = true; continue; }
    if (e.type === 'takeoff' && skipNextTakeoff) { skipNextTakeoff = false; continue; }
    skipNextTakeoff = false;
    out.push(e);
  }
  return out;
}

/** Trim proposal: reserve before the first take-off and after the last landing (ms). */
export function proposeTrim(track, events, opts = {}) {
  const o = { ...DETECT_DEFAULTS, ...opts };
  const t = track.points.t, n = track.points.n;
  const tko = events.find((e) => e.type === 'takeoff');
  const ldgs = events.filter((e) => e.type === 'landing');
  const ldg = ldgs.length ? ldgs[ldgs.length - 1] : null;
  const from = tko ? Math.max(t[0], tko.t - o.trimReserveSec * 1000) : t[0];
  const to = ldg ? Math.min(t[n - 1], ldg.t + o.trimReserveSec * 1000) : t[n - 1];
  return { from, to, auto: true };
}
