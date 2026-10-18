// Unit presentation driven by settings.units: 'icao' (ft, kt, m/s vario) or 'metric' (m, km/h, m/s).
// Every function returns a display string with the unit attached (non-breaking space).

import { fmtInt, fmtNum, fmtSigned, withUnit, mToFt, msToKt, msToKmh } from './format.js';

export function makeUnits(mode) {
  const icao = mode !== 'metric';
  return {
    mode: icao ? 'icao' : 'metric',
    /** altitude in m → "3'097 ft" or "944 m"; withBoth adds the other unit in brackets */
    alt: (m, withBoth = false) => {
      if (m === null || m === undefined || Number.isNaN(m)) return '–';
      const main = icao ? withUnit(fmtInt(mToFt(m)), 'ft') : withUnit(fmtInt(m), 'm');
      if (!withBoth) return main;
      return `${main} (${icao ? withUnit(fmtInt(m), 'm') : withUnit(fmtInt(mToFt(m)), 'ft')})`;
    },
    altUnit: icao ? 'ft' : 'm',
    altValue: (m) => (icao ? mToFt(m) : m),
    /** speed in m/s → "37 kt" or "69 km/h" */
    speed: (ms, digits = 0) => (ms === null || ms === undefined || Number.isNaN(ms) ? '–' : icao ? withUnit(fmtNum(msToKt(ms), digits), 'kt') : withUnit(fmtNum(msToKmh(ms), digits), 'km/h')),
    speedUnit: icao ? 'kt' : 'km/h',
    speedValue: (ms) => (icao ? msToKt(ms) : msToKmh(ms)),
    /** vertical speed in m/s → "+3.0 m/s" */
    vs: (v, digits = 1) => (v === null || v === undefined || Number.isNaN(v) ? '–' : withUnit(fmtSigned(v, digits), 'm/s')),
    vsUnit: 'm/s',
    dist: (m) => (m === null || m === undefined || Number.isNaN(m) ? '–' : withUnit(m >= 100000 ? fmtInt(m / 1000) : fmtNum(m / 1000, 1), 'km')),
    acc: (a) => (a === null || a === undefined || Number.isNaN(a) ? '–' : `${withUnit(fmtNum(a, 2), 'm/s²')} (${fmtNum(a / 9.81, 2)}${' '}g)`),
  };
}
