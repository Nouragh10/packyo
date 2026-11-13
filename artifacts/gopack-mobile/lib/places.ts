import { apiFetch } from "@/lib/api-client";

export type PlaceKind = "country" | "region" | "city" | "town" | "area";

/** A real place a trip goes to (from the server's place search). */
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
  /** A suggestion without coordinates yet: call placeDetails before using it. */
  pending?: boolean;
};

export const MAX_TRIP_PLACES = 5;

/** Groups one search's typing and the final pick (Google bills them as one). */
export function newPlaceSession(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function errorText(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({})) as { error?: string };
  return body.error ?? fallback;
}

export async function searchPlaces(query: string, session?: string): Promise<TripPlace[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const qs = `q=${encodeURIComponent(q)}${session ? `&session=${session}` : ""}`;
  const res = await apiFetch(`/api/places/search?${qs}`, undefined, 10_000);
  if (!res.ok) throw new Error(await errorText(res, "Couldn't search places right now."));
  const body = await res.json() as { places?: TripPlace[] };
  return Array.isArray(body.places) ? body.places : [];
}

/** Fills in coordinates for a suggestion; places that already have them pass through. */
export async function resolvePlace(place: TripPlace, session?: string): Promise<TripPlace> {
  if (!place.pending) return place;
  const qs = `id=${encodeURIComponent(place.id)}${session ? `&session=${session}` : ""}`;
  const res = await apiFetch(`/api/places/details?${qs}`, undefined, 10_000);
  if (!res.ok) throw new Error(await errorText(res, "Couldn't load that place. Try again."));
  const body = await res.json() as { place?: TripPlace };
  if (!body.place) throw new Error("Couldn't load that place. Try again.");
  return body.place;
}

/** The trip's display name: "Umluj", "Riyadh & Jeddah", "Riyadh, Jeddah & AlUla". */
export function destinationFromPlaces(places: TripPlace[]): string {
  const names = places.map((p) => p.name);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** Firebase can't store `undefined`, so drop missing optional fields. */
export function placesForStorage(places: TripPlace[]): TripPlace[] {
  return places.map((p) => JSON.parse(JSON.stringify(p)) as TripPlace);
}

const FLAG_BASE = 0x1f1e6 - "A".charCodeAt(0);
export function flagEmoji(countryCode: string): string {
  const cc = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "📍";
  return String.fromCodePoint(FLAG_BASE + cc.charCodeAt(0), FLAG_BASE + cc.charCodeAt(1));
}

export function kindLabel(kind: PlaceKind): string {
  return kind === "country" ? "Country" : kind === "region" ? "Region" : kind === "town" ? "Town" : kind === "area" ? "Area" : "City";
}
