// Reverse geocoding for take-off / landing places as 'CH-Willisau' (country code first, then the
// municipality). Two free providers without keys: OpenStreetMap Nominatim, then komoot Photon as
// fallback. Results are cached per position for the session; failures are NOT cached (retry possible).
// Returns '' when the position has no named place, null when both providers failed.

const cache = new Map();
const key = (lat, lon) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

async function nominatim(lat, lon, lang) {
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&accept-language=${encodeURIComponent(lang)}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const j = await res.json(); const a = j.address || {};
  const town = a.city || a.town || a.village || a.municipality || a.county || j.name || '';
  return town ? `${a.country_code ? a.country_code.toUpperCase() + '-' : ''}${town}` : '';
}
async function photon(lat, lon, lang) {
  const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&lang=${/^(de|en|fr|it)$/.test(lang) ? lang : 'en'}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const j = await res.json(); const f = (j.features || [])[0]; const p = f ? f.properties || {} : {};
  const town = p.city || p.town || p.village || p.locality || p.county || p.name || '';
  return town ? `${p.countrycode ? String(p.countrycode).toUpperCase() + '-' : ''}${town}` : '';
}

/** @returns {Promise<string|null>} 'CC-Ort', '' (nothing named there) or null (lookup failed) */
export async function reverseGeocode(lat, lon, lang = 'de') {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  const k = key(lat, lon);
  if (cache.has(k)) return cache.get(k);
  for (const provider of [nominatim, photon]) {
    try { const name = await provider(lat, lon, lang); cache.set(k, name); return name; }
    catch (e) { console.warn('reverse geocoding failed:', e && e.message); }
  }
  return null;
}
