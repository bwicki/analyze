// Formatting and unit helpers. Pure functions, no DOM – shared by the UI, exports and the node tests.
// Swiss conventions: thousands separator ' (de-CH), typographic minus, units never wrap.

const NBSP = ' ';
export const pad2 = (n) => String(n).padStart(2, '0');

export function fmtInt(n, sep = "'") {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const v = Math.round(n);
  const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return (v < 0 ? '−' : '') + s;
}

export function fmtNum(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const s = Math.abs(n).toFixed(digits);
  return (n < 0 && Number(s) !== 0 ? '−' : '') + s;
}

/** Signed number with explicit plus: +3.0 / −2.2 */
export function fmtSigned(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const s = fmtNum(n, digits);
  return n > 0 ? `+${s}` : s;
}

export function withUnit(valueStr, unit) { return `${valueStr}${NBSP}${unit}`; }

export const M_PER_FT = 0.3048;
export const MS_PER_KT = 0.514444;
export const mToFt = (m) => m / M_PER_FT;
export const ftToM = (ft) => ft * M_PER_FT;
export const msToKt = (ms) => ms / MS_PER_KT;
export const ktToMs = (kt) => kt * MS_PER_KT;
export const msToKmh = (ms) => ms * 3.6;
export const msToFpm = (ms) => ms / M_PER_FT * 60;

/** "41 h 03 min" from seconds; below one hour "37 min". */
export function fmtDurationHM(sec) {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '–';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}${NBSP}h${NBSP}${pad2(m)}${NBSP}min` : `${m}${NBSP}min`;
}
/** "41:03" (h:mm) */
export function fmtDurationClock(sec) {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '–';
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 3600)}:${pad2(Math.round((s % 3600) / 60) % 60)}`;
}

export function fmtTimeUTC(ms, withSeconds = false) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '–';
  const d = new Date(ms);
  const base = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  return withSeconds ? `${base}:${pad2(d.getUTCSeconds())}` : base;
}
/** "28.08.2026" in UTC. */
export function fmtDateUTC(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '–';
  const d = new Date(ms);
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}
/** "28.08.2026 23:31 UTC" */
export function fmtDateTimeUTC(ms, withSeconds = false) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '–';
  return `${fmtDateUTC(ms)} ${fmtTimeUTC(ms, withSeconds)}${NBSP}UTC`;
}
/** "28.08." short date in UTC */
export function fmtDayUTC(ms) {
  const d = new Date(ms);
  return `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.`;
}
/** ISO 8601 with Z, seconds precision. */
export function isoUTC(ms) { return new Date(Math.round(ms)).toISOString().replace(/\.\d{3}Z$/, 'Z'); }

/** Local time of a position: the browser cannot know the zone of a landing place, so we use the
 *  solar-mean offset (round(lon/15) h) and label it "LMT" when it differs from the browser zone. */
export function fmtLocalByLon(ms, lon) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '–';
  const off = Math.round((lon || 0) / 15);
  const d = new Date(ms + off * 3600000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} (UTC${off >= 0 ? '+' : '−'}${Math.abs(off)})`;
}

/** Compass bearing "043°" with three digits. */
export function fmtBearing(deg) {
  if (deg === null || deg === undefined || Number.isNaN(deg)) return '–';
  return String(Math.round(((deg % 360) + 360) % 360) % 360).padStart(3, '0') + '°';
}

// ---- ICAO coordinate formats --------------------------------------------------------------
/** 47.4433, 8.5617 → "4727N00834E" (degrees + rounded minutes). */
export function icaoShort(lat, lon) {
  if (lat === null || lon === null || lat === undefined || lon === undefined || Number.isNaN(lat) || Number.isNaN(lon)) return '–';
  const f = (v, degDigits) => {
    const a = Math.abs(v);
    let deg = Math.floor(a), min = Math.round((a - deg) * 60);
    if (min === 60) { deg += 1; min = 0; }
    return String(deg).padStart(degDigits, '0') + pad2(min);
  };
  return `${f(lat, 2)}${lat >= 0 ? 'N' : 'S'}${f(lon, 3)}${lon >= 0 ? 'E' : 'W'}`;
}
/** 47.4433, 8.5617 → "47°26.6'N 008°33.7'E" */
export function dmCoord(lat, lon) {
  if (lat === null || lon === null || lat === undefined || lon === undefined || Number.isNaN(lat) || Number.isNaN(lon)) return '–';
  const f = (v, degDigits) => { const a = Math.abs(v); const deg = Math.floor(a); const min = (a - deg) * 60; return `${String(deg).padStart(degDigits, '0')}°${min.toFixed(1).padStart(4, '0')}'`; };
  return `${f(lat, 2)}${lat >= 0 ? 'N' : 'S'} ${f(lon, 3)}${lon >= 0 ? 'E' : 'W'}`;
}

/** Human file size. */
export function fmtBytes(b) {
  if (b < 1024) return `${b}${NBSP}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)}${NBSP}KB`;
  return `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)}${NBSP}MB`;
}
