// UK postcode -> coordinates via postcodes.io (free, no key), then driving distance via the
// public OSRM router. If routing is unavailable we fall back to straight-line x 1.3.
import type { RouteMethod } from '../shared/types';

export interface Place {
  postcode: string;
  lat: number;
  lng: number;
  area: string;
}

export interface Route {
  miles: number;
  method: RouteMethod;
}

const postcodeCache = new Map<string, Place>();
const routeCache = new Map<string, Route>();

export function normalisePostcode(pc: unknown): string {
  return String(pc || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

interface PostcodesIoResponse {
  result: { postcode: string; latitude: number; longitude: number; admin_district: string | null };
}

export async function lookupPostcode(pc: unknown): Promise<Place | null> {
  const key = normalisePostcode(pc);
  if (!key || key.length < 5 || key.length > 7) return null;
  const cached = postcodeCache.get(key);
  if (cached) return cached;
  const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(key)}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Postcode lookup failed: ' + res.status);
  const json = (await res.json()) as PostcodesIoResponse;
  const r = json.result;
  const out: Place = { postcode: r.postcode, lat: r.latitude, lng: r.longitude, area: r.admin_district || '' };
  postcodeCache.set(key, out);
  return out;
}

function haversineMiles(a: Place, b: Place): number {
  const R = 3958.8;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

interface OsrmResponse {
  code: string;
  routes: { distance: number }[];
}

export async function drivingMiles(a: Place, b: Place): Promise<Route> {
  const key = `${a.postcode}:${b.postcode}`;
  const cached = routeCache.get(key);
  if (cached) return cached;
  let result: Route;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const json = (await res.json()) as OsrmResponse;
    if (!res.ok || json.code !== 'Ok') throw new Error('route failed');
    result = { miles: json.routes[0].distance / 1609.344, method: 'road' };
  } catch {
    result = { miles: haversineMiles(a, b) * 1.3, method: 'estimate' };
  }
  routeCache.set(key, result);
  return result;
}
