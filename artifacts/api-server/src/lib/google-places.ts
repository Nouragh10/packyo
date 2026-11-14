// Google Places (New) — used when GOOGLE_PLACES_API_KEY is set (Replit Secrets).
//
//  • Destination search: Autocomplete limited to regions (countries, states,
//    cities, towns), then Place Details for the one the user picks. Both calls
//    share a session token so Google bills them as one session.
//  • Venue checks: Text Search restricted to the trip's area, which also tells
//    us when a place has permanently closed, and finds real replacements.

import type { PlaceKind, TripPlace } from "./places";

type Fetch = typeof fetch;
const BASE = "https://places.googleapis.com/v1";

export function googleKey(): string | null {
  return process.env.GOOGLE_PLACES_API_KEY?.trim() || null;
}

function headers(key: string, fieldMask?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": key,
    ...(fieldMask ? { "X-Goog-FieldMask": fieldMask } : {}),
  };
}

export function validSession(s: unknown): string | undefined {
  return typeof s === "string" && /^[A-Za-z0-9_-]{8,36}$/.test(s) ? s : undefined;
}

async function call<T>(fetchImpl: Fetch, url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Places ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/* ── Destination search ──────────────────────────────────────────────── */

type Prediction = {
  placeId?: string;
  text?: { text?: string };
  structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
  types?: string[];
};

function kindFromTypes(types: string[] = [], viewportKm?: number): PlaceKind {
  if (types.includes("country")) return "country";
  if (types.some((t) => t === "administrative_area_level_1" || t === "administrative_area_level_2" || t === "archipelago" || t === "colloquial_area")) return "region";
  if (types.some((t) => t === "locality" || t === "postal_town")) return viewportKm !== undefined && viewportKm < 12 ? "town" : "city";
  return "area";
}

/** Suggestions only; coordinates come from googlePlaceDetails when one is picked. */
export function parseAutocomplete(body: unknown): TripPlace[] {
  const suggestions = (body as { suggestions?: Array<{ placePrediction?: Prediction }> })?.suggestions ?? [];
  const out: TripPlace[] = [];
  for (const s of suggestions) {
    const p = s.placePrediction;
    const name = p?.structuredFormat?.mainText?.text ?? p?.text?.text;
    if (!p?.placeId || !name) continue;
    const secondary = p.structuredFormat?.secondaryText?.text ?? "";
    const kind = kindFromTypes(p.types);
    const parts = secondary.split(",").map((x) => x.trim()).filter(Boolean);
    out.push({
      id: `g:${p.placeId}`,
      name,
      kind,
      country: kind === "country" ? name : parts[parts.length - 1] ?? "",
      countryCode: "",
      region: kind === "country" || kind === "region" ? undefined : parts.length > 1 ? parts[0] : undefined,
      // Google's full text can drop commas ("Umluj Saudi Arabia"), so build our own.
      label: secondary ? `${name}, ${secondary}` : name,
      lat: 0,
      lng: 0,
      pending: true,
    });
  }
  return out;
}

export async function googleAutocomplete(query: string, key: string, session?: string, fetchImpl: Fetch = fetch): Promise<TripPlace[]> {
  const body = await call<unknown>(fetchImpl, `${BASE}/places:autocomplete`, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({ input: query, includedPrimaryTypes: ["(regions)"], languageCode: "en", ...(session ? { sessionToken: session } : {}) }),
  }, 5000);
  return parseAutocomplete(body);
}

type Details = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  viewport?: { low?: { latitude?: number; longitude?: number }; high?: { latitude?: number; longitude?: number } };
  types?: string[];
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
};

const num = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function parseDetails(d: Details): TripPlace | null {
  const lat = d.location?.latitude;
  const lng = d.location?.longitude;
  const name = d.displayName?.text;
  if (!d.id || !name || !num(lat) || !num(lng)) return null;
  const comp = (type: string) => d.addressComponents?.find((c) => c.types?.includes(type));
  const country = comp("country");
  const region = comp("administrative_area_level_1");
  const lo = d.viewport?.low;
  const hi = d.viewport?.high;
  let bbox: TripPlace["bbox"];
  let viewportKm: number | undefined;
  // Skip viewports that cross the antimeridian (low lng > high lng).
  if (lo && hi && num(lo.latitude) && num(lo.longitude) && num(hi.latitude) && num(hi.longitude) && lo.longitude <= hi.longitude) {
    bbox = [lo.latitude, lo.longitude, hi.latitude, hi.longitude];
    viewportKm = Math.max((hi.latitude - lo.latitude) * 111, (hi.longitude - lo.longitude) * 111 * Math.cos((lat * Math.PI) / 180));
  }
  const kind = kindFromTypes(d.types, viewportKm);
  const countryName = country?.longText ?? (kind === "country" ? name : "");
  const regionName = kind === "country" || kind === "region" ? undefined : region?.longText;
  const parts = [name];
  if (kind !== "country") {
    if (regionName && regionName !== name) parts.push(regionName);
    if (countryName && countryName !== name) parts.push(countryName);
  }
  return {
    id: `g:${d.id}`,
    name,
    kind,
    country: countryName,
    countryCode: (country?.shortText ?? "").toUpperCase(),
    region: regionName,
    label: parts.join(", "),
    lat, lng, bbox,
  };
}

export async function googlePlaceDetails(placeId: string, key: string, session?: string, fetchImpl: Fetch = fetch): Promise<TripPlace | null> {
  const id = placeId.replace(/^g:/, "");
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(id)) return null;
  const qs = new URLSearchParams({ languageCode: "en", ...(session ? { sessionToken: session } : {}) });
  const d = await call<Details>(fetchImpl, `${BASE}/places/${id}?${qs}`, {
    headers: headers(key, "id,displayName,formattedAddress,location,viewport,types,addressComponents"),
  }, 5000);
  return parseDetails(d);
}

/* ── Venues ──────────────────────────────────────────────────────────── */

export type GoogleVenue = {
  name: string;
  lat: number;
  lng: number;
  closed: boolean;
  type?: string;
  rating?: number;
  address?: string;
};

type SearchPlace = {
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  businessStatus?: string;
  primaryTypeDisplayName?: { text?: string };
  rating?: number;
  shortFormattedAddress?: string;
};

export function parseTextSearch(body: unknown): GoogleVenue[] {
  const places = (body as { places?: SearchPlace[] })?.places ?? [];
  const out: GoogleVenue[] = [];
  for (const p of places) {
    const name = p.displayName?.text;
    const lat = p.location?.latitude;
    const lng = p.location?.longitude;
    if (!name || !num(lat) || !num(lng)) continue;
    out.push({
      name, lat, lng,
      closed: p.businessStatus === "CLOSED_PERMANENTLY",
      type: p.primaryTypeDisplayName?.text,
      rating: num(p.rating) ? p.rating : undefined,
      address: p.shortFormattedAddress,
    });
  }
  return out;
}

/** Text Search restricted to a box (south, west, north, east). */
export async function googleTextSearch(
  textQuery: string,
  box: [number, number, number, number],
  key: string,
  fetchImpl: Fetch = fetch,
  timeoutMs = 6000,
  pageSize = 5,
): Promise<GoogleVenue[]> {
  const [s, w, n, e] = box;
  const body = await call<unknown>(fetchImpl, `${BASE}/places:searchText`, {
    method: "POST",
    headers: headers(key, "places.displayName,places.location,places.businessStatus,places.primaryTypeDisplayName,places.rating,places.shortFormattedAddress"),
    body: JSON.stringify({
      textQuery: textQuery.slice(0, 200),
      languageCode: "en",
      pageSize,
      locationRestriction: { rectangle: { low: { latitude: s, longitude: w }, high: { latitude: n, longitude: e } } },
    }),
  }, timeoutMs);
  return parseTextSearch(body);
}

/** What to search for when replacing an activity that doesn't exist. */
export function replacementQuery(tag: string, name: string): string {
  const n = name.toLowerCase();
  const keywords: Array<[RegExp, string]> = [
    [/seafood|fish/, "seafood restaurant"],
    [/coffee|caf[eé]|espresso/, "cafe"],
    [/bakery|dessert|sweets|kunafa|ice cream/, "dessert shop"],
    [/breakfast|brunch/, "breakfast restaurant"],
    [/museum|gallery/, "museum"],
    [/beach|bay|corniche|coast/, "beach"],
    [/island|snorkel|div(e|ing)|boat/, "boat tour"],
    [/park|garden/, "park"],
    [/mall|shopping/, "shopping mall"],
    [/souq|souk|market|bazaar/, "market"],
    [/fort|castle|palace|heritage|old town|historic|ruins/, "historical landmark"],
    [/spa|hammam|massage/, "spa"],
    [/hike|trail|canyon|desert|dune|mountain|wadi/, "hiking area"],
  ];
  for (const [re, q] of keywords) if (re.test(n)) return q;
  const t = tag.toLowerCase();
  if (/food|dining|restaurant/.test(t)) return "restaurant";
  if (/night/.test(t)) return "cafe";
  if (/culture|history/.test(t)) return "tourist attraction";
  if (/beach/.test(t)) return "beach";
  if (/relax|wellness/.test(t)) return "park";
  if (/shop/.test(t)) return "market";
  if (/adventure|nature/.test(t)) return "outdoor activity";
  return "tourist attraction";
}
