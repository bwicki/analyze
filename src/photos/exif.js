// Minimal EXIF reader for JPEG photos (APP1 "Exif" segment, TIFF IFD0 → ExifIFD / GPS IFD):
// DateTimeOriginal (+ SubSec, + OffsetTimeOriginal when the camera writes its time zone), GPS position
// and altitude, orientation, camera model. No dependencies; works in the browser and in node tests.

const ASCII = (bytes, off, len) => { let s = ''; for (let i = 0; i < len; i++) { const c = bytes[off + i]; if (c === 0) break; s += String.fromCharCode(c); } return s; };

/** @param {ArrayBuffer|Uint8Array} buf  @returns {{dateTimeOriginal, subSec, offsetTime, lat, lon, alt, orientation, model, make} | null} */
export function readExif(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;            // not a JPEG
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    const marker = b[p + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { p += 2; continue; }
    if (marker === 0xda || marker === 0xd9) break;                                // image data / end
    const len = (b[p + 2] << 8) | b[p + 3];
    if (marker === 0xe1 && ASCII(b, p + 4, 4) === 'Exif') return parseTiff(b, p + 10, len - 8);
    p += 2 + len;
  }
  return null;
}

function parseTiff(b, start, len) {
  const dv = new DataView(b.buffer, b.byteOffset + start, Math.min(len, b.length - start));
  const le = dv.getUint16(0) === 0x4949;
  if (dv.getUint16(2, le) !== 0x2a) return null;
  const out = { dateTimeOriginal: null, subSec: null, offsetTime: null, lat: NaN, lon: NaN, alt: NaN, orientation: 1, model: '', make: '' };
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
  const rational = (o) => { const n = u32(o), d = u32(o + 4); return d ? n / d : NaN; };
  const str = (o, n) => ASCII(b, start + o, n);
  const readIfd = (off, handler) => {
    if (off <= 0 || off + 2 > dv.byteLength) return;
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12; if (e + 12 > dv.byteLength) break;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const size = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][type] || 1;
      const valOff = size * count > 4 ? u32(e + 8) : e + 8;
      if (valOff + size * count > dv.byteLength) continue;
      handler(tag, type, count, valOff);
    }
  };
  let exifOff = 0, gpsOff = 0;
  readIfd(u32(4), (tag, type, count, o) => {
    if (tag === 0x8769) exifOff = u32(o); else if (tag === 0x8825) gpsOff = u32(o);
    else if (tag === 0x0112) out.orientation = u16(o);
    else if (tag === 0x0110) out.model = str(o, count).trim();
    else if (tag === 0x010f) out.make = str(o, count).trim();
    else if (tag === 0x0132 && !out.dateTimeOriginal) out.dateTimeOriginal = str(o, count).trim();   // DateTime (fallback)
  });
  readIfd(exifOff, (tag, type, count, o) => {
    if (tag === 0x9003) out.dateTimeOriginal = str(o, count).trim();
    else if (tag === 0x9291) out.subSec = str(o, count).trim();
    else if (tag === 0x9011) out.offsetTime = str(o, count).trim();                                  // "+02:00"
  });
  if (gpsOff) {
    let latRef = 'N', lonRef = 'E', altRef = 0, lat = NaN, lon = NaN;
    readIfd(gpsOff, (tag, type, count, o) => {
      if (tag === 1) latRef = str(o, 2); else if (tag === 3) lonRef = str(o, 2); else if (tag === 5) altRef = b[start + o];
      else if (tag === 2 && count === 3) lat = rational(o) + rational(o + 8) / 60 + rational(o + 16) / 3600;
      else if (tag === 4 && count === 3) lon = rational(o) + rational(o + 8) / 60 + rational(o + 16) / 3600;
      else if (tag === 6) out.alt = rational(o);
    });
    if (!Number.isNaN(lat) && !Number.isNaN(lon) && (lat !== 0 || lon !== 0)) { out.lat = latRef === 'S' ? -lat : lat; out.lon = lonRef === 'W' ? -lon : lon; }
    if (altRef === 1 && !Number.isNaN(out.alt)) out.alt = -out.alt;
  }
  return out;
}

/**
 * EXIF "YYYY:MM:DD HH:MM:SS" (camera local time) → ms UTC.
 * tzMinutes: the camera's zone (east positive) when the EXIF carries no OffsetTime; offsetSec: fine correction.
 */
export function exifToUtc(exif, { tzMinutes = 0, offsetSec = 0 } = {}) {
  if (!exif || !exif.dateTimeOriginal) return NaN;
  const m = exif.dateTimeOriginal.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return NaN;
  let tz = tzMinutes;
  if (exif.offsetTime) { const z = exif.offsetTime.match(/^([+-])(\d{2}):?(\d{2})$/); if (z) tz = (z[1] === '-' ? -1 : 1) * (+z[2] * 60 + +z[3]); }
  const sub = exif.subSec ? Math.round(parseFloat('0.' + exif.subSec.replace(/\D/g, '')) * 1000) || 0 : 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + sub - tz * 60000 + offsetSec * 1000;
}
