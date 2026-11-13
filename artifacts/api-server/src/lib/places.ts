// Real-world places for trip destinations.
//
// Users pick destinations from a search list instead of typing free text, so
// every trip carries real coordinates (and, where OpenStreetMap has one, the
// place's bounding box). The itinerary generator then uses those areas as a
// hard fence and checks AI-picked venues against OpenStreetMap.
//
// With GOOGLE_PLACES_API_KEY set, search and venue checks use Google Places.
// Otherwise (or if Google fails) search goes to Photon (OpenStreetMap,
// komoot's public server) with Open-Meteo's GeoNames geocoder as a fallback.

import { haversineKm } from "./itinerary-geo";
import { googleAutocomplete, googleKey, googlePlaceDetails, googleTextSearch, replacementQuery, type GoogleVenue } from "./google-places";

export type PlaceKind = "country" | "region" | "city" | "town" | "area";

export type TripPlace = {
  id: string;
  name: string;
  kind: PlaceKind;
  country: string;
  countryCode: string;
  region?: string;
  label: string;
  lat: number;
  lng: number;
  /** south, west, north, east */
  bbox?: [number, number, number, number];
  /** A Google suggestion: call placeDetails for coordinates before using it. */
  pending?: boolean;
};

type Fetch = typeof fetch;
const UA = "Packyo/1.0 (https://packyo.app; hello@packyo.app)";
export const MAX_TRIP_PLACES = 5;

/* ── Parsing ─────────────────────────────────────────────────────────── */

type PhotonProps = {
  osm_id?: number; osm_type?: string; osm_key?: string; osm_value?: string; type?: string;
  name?: string; country?: string; countrycode?: string; state?: string; county?: string; city?: string;
  extent?: number[];
};
type PhotonFeature = { geometry?: { coordinates?: number[] }; properties?: PhotonProps };

const TOWN_VALUES = new Set(["town", "village", "hamlet", "suburb", "island", "islet"]);

function photonKind(p: PhotonProps): PlaceKind | null {
  const t = p.type ?? "";
  const v = p.osm_value ?? "";
  if (t === "country" || v === "country") return "country";
  if (t === "state" || t === "county" || v === "state" || v === "region" || v === "province") return "region";
  if (t === "city") return TOWN_VALUES.has(v) ? "town" : "city";
  if (t === "district" || t === "locality") return "area";
  if (p.osm_key === "place") {
    if (v === "city") return "city";
    if (TOWN_VALUES.has(v)) return "town";
    if (v === "archipelago" || v === "municipality") return "region";
    if (v === "neighbourhood" || v === "quarter" || v === "locality") return "area";
  }
  return null;
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function toBbox(extent?: number[]): TripPlace["bbox"] {
  if (!Array.isArray(extent) || extent.length !== 4 || !extent.every(finite)) return undefined;
  // Photon gives [lon, lat, lon, lat] corners; normalise whatever the order.
  const [a, b, c, d] = extent;
  return [Math.min(b, d), Math.min(a, c), Math.max(b, d), Math.max(a, c)];
}

function makeLabel(name: string, kind: PlaceKind, region?: string, country?: string) {
  if (kind === "country") return name;
  const parts = [name];
  if (region && region !== name && kind !== "region") parts.push(region);
  if (country && country !== name) parts.push(country);
  return parts.join(", ");
}

export function parsePhoton(body: unknown): TripPlace[] {
  const features = (body as { features?: PhotonFeature[] })?.features ?? [];
  const out: TripPlace[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    const kind = photonKind(p);
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (!kind || !p.name || !finite(lat) || !finite(lng)) continue;
    const region = p.state ?? p.county;
    out.push({
      id: `osm:${p.osm_type ?? "X"}${p.osm_id ?? `${lat},${lng}`}`,
      name: p.name,
      kind,
      country: p.country ?? (kind === "country" ? p.name : ""),
      countryCode: (p.countrycode ?? "").toUpperCase(),
      region: kind === "region" || kind === "country" ? undefined : region,
      label: makeLabel(p.name, kind, region, p.country),
      lat, lng,
      bbox: toBbox(p.extent),
    });
  }
  return out;
}

type OpenMeteoResult = {
  id?: number; name?: string; latitude?: number; longitude?: number; feature_code?: string;
  country?: string; country_code?: string; admin1?: string; population?: number;
};

export function parseOpenMeteo(body: unknown): TripPlace[] {
  const results = (body as { results?: OpenMeteoResult[] })?.results ?? [];
  const out: TripPlace[] = [];
  for (const r of results) {
    if (!r.name || !finite(r.latitude) || !finite(r.longitude)) continue;
    const code = r.feature_code ?? "";
    const kind: PlaceKind = code.startsWith("PCL") ? "country"
      : code.startsWith("ADM") ? "region"
      : code.startsWith("PPL") ? ((r.population ?? 0) >= 100_000 || code === "PPLC" ? "city" : "town")
      : "area";
    out.push({
      id: `gn:${r.id ?? `${r.latitude},${r.longitude}`}`,
      name: r.name,
      kind,
      country: r.country ?? "",
      countryCode: (r.country_code ?? "").toUpperCase(),
      region: kind === "country" || kind === "region" ? undefined : r.admin1,
      label: makeLabel(r.name, kind, r.admin1, r.country),
      lat: r.latitude, lng: r.longitude,
    });
  }
  return out;
}

function dedupe(places: TripPlace[]): TripPlace[] {
  const seen = new Set<string>();
  return places.filter((p) => {
    const key = p.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ── Search ──────────────────────────────────────────────────────────── */

const cache = new Map<string, { at: number; places: TripPlace[] }>();
const CACHE_MS = 24 * 60 * 60 * 1000;

async function getJson(url: string, fetchImpl: Fetch, timeoutMs: number): Promise<unknown> {
  const res = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function searchPlaces(query: string, fetchImpl: Fetch = fetch, limit = 8, session?: string): Promise<TripPlace[]> {
  const q = query.trim().replace(/\s+/g, " ").slice(0, 100);
  if (q.length < 2) return [];
  const gKey = googleKey();
  const key = `${gKey ? "g" : "o"}:${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.places.slice(0, limit);

  let places: TripPlace[] = [];
  if (gKey) {
    try {
      places = await googleAutocomplete(q, gKey, session, fetchImpl);
    } catch { /* fall back to OpenStreetMap */ }
  }
  if (places.length === 0) {
    try {
      places = parsePhoton(await getJson(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=20&lang=en`, fetchImpl, 5000));
    } catch { /* fall through to the fallback */ }
  }
  if (places.length === 0) {
    try {
      places = parseOpenMeteo(await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=en&format=json`, fetchImpl, 5000));
    } catch { /* nothing found */ }
  }
  places = dedupe(places).slice(0, 8);
  if (places.length > 0) {
    if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), places });
  }
  return places.slice(0, limit);
}

/** Coordinates and area for a Google suggestion the user picked. */
export async function placeDetails(id: string, session?: string, fetchImpl: Fetch = fetch): Promise<TripPlace | null> {
  const gKey = googleKey();
  if (!gKey || !id.startsWith("g:")) return null;
  return googlePlaceDetails(id, gKey, session, fetchImpl);
}

/**
 * Best-effort places for a free-text destination (older app versions and
 * trips whose destination came from a vote). "Riyadh & Jeddah" → two places.
 * (Not split on "and": "Trinidad and Tobago" is one country.)
 */
export async function resolveDestinationPlaces(destination: string, fetchImpl: Fetch = fetch): Promise<TripPlace[]> {
  const parts = destination.split(/\s*(?:&|\+|·|;)\s*/).map((s) => s.trim()).filter(Boolean).slice(0, MAX_TRIP_PLACES);
  // Only trust a lookup whose name matches what was typed, so an odd match
  // can't fence the trip into the wrong place.
  const found = await Promise.all(parts.map((part) =>
    searchPlaces(part, fetchImpl, 3)
      .then((r) => r.find((p) => namesMatch(part.split(",")[0], p.name)))
      .then((p) => (p?.pending ? placeDetails(p.id, undefined, fetchImpl) : p) ?? undefined)
      .catch(() => undefined)));
  return found.filter((p): p is TripPlace => !!p);
}

/** Validates places sent by the app. */
export function sanitizePlaces(raw: unknown): TripPlace[] {
  if (!Array.isArray(raw)) return [];
  const kinds = new Set<PlaceKind>(["country", "region", "city", "town", "area"]);
  const out: TripPlace[] = [];
  for (const r of raw.slice(0, MAX_TRIP_PLACES)) {
    const p = r as Partial<TripPlace>;
    if (typeof p?.name !== "string" || !p.name.trim() || !finite(p.lat) || !finite(p.lng)) continue;
    if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) continue;
    const kind = kinds.has(p.kind as PlaceKind) ? (p.kind as PlaceKind) : "city";
    const bbox = Array.isArray(p.bbox) && p.bbox.length === 4 && p.bbox.every(finite) ? (p.bbox as TripPlace["bbox"]) : undefined;
    const name = p.name.trim().slice(0, 100);
    const country = typeof p.country === "string" ? p.country.slice(0, 100) : "";
    const region = typeof p.region === "string" ? p.region.slice(0, 100) : undefined;
    out.push({
      id: typeof p.id === "string" ? p.id.slice(0, 100) : `${p.lat},${p.lng}`,
      name, kind, country,
      countryCode: typeof p.countryCode === "string" ? p.countryCode.slice(0, 3).toUpperCase() : "",
      region,
      label: typeof p.label === "string" && p.label.trim() ? p.label.slice(0, 200) : makeLabel(name, kind, region, country),
      lat: p.lat, lng: p.lng, bbox,
    });
  }
  return out;
}

/* ── Areas ───────────────────────────────────────────────────────────── */

// How far past a place's boundary box a venue may sit (airports, beaches just
// outside the admin line), and the radius used when there's no box.
const BUFFER_KM: Record<PlaceKind, number> = { country: 30, region: 20, city: 12, town: 12, area: 8 };
const RADIUS_KM: Record<PlaceKind, number> = { country: 0, region: 150, city: 40, town: 25, area: 15 };

export function placeContains(place: TripPlace, pt: { lat: number; lng: number }): boolean {
  if (place.bbox) {
    const [s, w, n, e] = place.bbox;
    const padLat = BUFFER_KM[place.kind] / 111;
    const padLng = BUFFER_KM[place.kind] / (111 * Math.max(0.2, Math.cos((pt.lat * Math.PI) / 180)));
    return pt.lat >= s - padLat && pt.lat <= n + padLat && pt.lng >= w - padLng && pt.lng <= e + padLng;
  }
  // A country without a box can't be fenced by distance; trust the prompt.
  if (place.kind === "country") return true;
  return haversineKm(place, pt) <= RADIUS_KM[place.kind];
}

export function insideAnyPlace(places: TripPlace[], pt: { lat: number; lng: number }): boolean {
  return places.some((p) => placeContains(p, pt));
}

export function nearestPlace(places: TripPlace[], pt: { lat: number; lng: number }): TripPlace | undefined {
  let best: TripPlace | undefined;
  let bestKm = Infinity;
  for (const p of places) {
    const km = haversineKm(p, pt);
    if (km < bestKm) { best = p; bestKm = km; }
  }
  return best;
}

/** The chosen place a day belongs to, by its declared city name. */
export function placeForCity(places: TripPlace[], city: string): TripPlace | undefined {
  const c = normalizeName(city);
  if (!c) return undefined;
  return places.find((p) => {
    const n = normalizeName(p.name);
    return n === c || c.includes(n) || n.includes(c);
  });
}

/** Search box around a place for venue lookups. */
export function searchBox(place: TripPlace): [number, number, number, number] {
  if (place.bbox) {
    const [s, w, n, e] = place.bbox;
    const pad = BUFFER_KM[place.kind] / 111;
    return [s - pad, w - pad, n + pad, e + pad];
  }
  const r = (RADIUS_KM[place.kind] || 40) / 111;
  const rLng = r / Math.max(0.2, Math.cos((place.lat * Math.PI) / 180));
  return [place.lat - r, place.lng - rLng, place.lat + r, place.lng + rLng];
}

/* ── Venue lookup ────────────────────────────────────────────────────── */

const FILLER = new Set(["the", "a", "an", "of", "at", "in", "and", "al", "el", "restaurant", "cafe", "café", "coffee", "museum", "park", "beach", "market", "souq", "souk", "mall", "tour", "visit"]);

export function normalizeName(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, " ").trim();
}

function tokens(s: string): string[] {
  return normalizeName(s).split(" ").filter((t) => t.length > 1 && !FILLER.has(t));
}

/** Loose match between an AI venue name and a map result name. */
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb || (nb.length >= 4 && na.includes(nb)) || (na.length >= 4 && nb.includes(na))) return true;
  const ta = tokens(a);
  const tb = new Set(tokens(b));
  if (ta.length === 0 || tb.size === 0) return false;
  const shared = ta.filter((t) => tb.has(t)).length;
  return shared / Math.min(ta.length, tb.size) >= 0.6;
}

/**
 * Finds a venue by name inside a place: Google when configured (which also
 * says whether it has permanently closed), otherwise OpenStreetMap.
 */
export async function findVenue(
  name: string,
  place: TripPlace,
  fetchImpl: Fetch = fetch,
  timeoutMs = 6000,
): Promise<{ name: string; lat: number; lng: number; closed?: boolean } | null> {
  const gKey = googleKey();
  if (gKey) {
    const results = await googleTextSearch(name, searchBox(place), gKey, fetchImpl, timeoutMs, 5);
    const match = results.find((r) => placeContains(place, r) && namesMatch(name, r.name));
    return match ? { name: match.name, lat: match.lat, lng: match.lng, closed: match.closed } : null;
  }
  const [s, w, n, e] = searchBox(place);
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(name.slice(0, 120))}&limit=5&lang=en&bbox=${w},${s},${e},${n}`;
  const body = await getJson(url, fetchImpl, timeoutMs) as { features?: PhotonFeature[] };
  for (const f of body.features ?? []) {
    const [lng, lat] = f.geometry?.coordinates ?? [];
    const fname = f.properties?.name;
    if (!fname || !finite(lat) || !finite(lng)) continue;
    if (!placeContains(place, { lat, lng })) continue;
    if (namesMatch(name, fname)) return { name: fname, lat, lng };
  }
  return null;
}

/**
 * A real, open venue of the same kind inside the place, from Google, that
 * isn't already in the trip. Null without a Google key or when none is found.
 */
export async function findReplacementVenue(
  tag: string,
  name: string,
  place: TripPlace,
  usedNames: Set<string>,
  fetchImpl: Fetch = fetch,
  timeoutMs = 6000,
): Promise<GoogleVenue | null> {
  const gKey = googleKey();
  if (!gKey) return null;
  const results = await googleTextSearch(`${replacementQuery(tag, name)} in ${place.name}`, searchBox(place), gKey, fetchImpl, timeoutMs, 10);
  return results.find((r) => !r.closed && placeContains(place, r) && !usedNames.has(normalizeName(r.name))) ?? null;
}
