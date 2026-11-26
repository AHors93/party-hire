// UK postcode -> coordinates via postcodes.io (free, no key), then driving distance via the
// public OSRM router. If routing is unavailable we fall back to straight-line x 1.3.
const cache = new Map();

function normalisePostcode(pc) {
  return String(pc || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function lookupPostcode(pc) {
  const key = normalisePostcode(pc);
  if (!key || key.length < 5 || key.length > 7) return null;
  if (cache.has('pc:' + key)) return cache.get('pc:' + key);
  const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(key)}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Postcode lookup failed: ' + res.status);
  const json = await res.json();
  const r = json.result;
  const out = { postcode: r.postcode, lat: r.latitude, lng: r.longitude, area: r.admin_district || '' };
  cache.set('pc:' + key, out);
  return out;
}

function haversineMiles(a, b) {
  const R = 3958.8;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function drivingMiles(a, b) {
  const key = `rt:${a.postcode}:${b.postcode}`;
  if (cache.has(key)) return cache.get(key);
  let result;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    if (!res.ok || json.code !== 'Ok') throw new Error('route failed');
    result = { miles: json.routes[0].distance / 1609.344, method: 'road' };
  } catch {
    result = { miles: haversineMiles(a, b) * 1.3, method: 'estimate' };
  }
  cache.set(key, result);
  return result;
}

module.exports = { lookupPostcode, drivingMiles, normalisePostcode };
