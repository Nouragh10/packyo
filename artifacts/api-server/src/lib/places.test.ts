import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findVenue, insideAnyPlace, namesMatch, parseOpenMeteo, parsePhoton, placeContains, placeForCity,
  resolveDestinationPlaces, sanitizePlaces, searchPlaces, type TripPlace,
} from "./places";
import { findOutsideTripActivities, applyReplacements } from "./itinerary-geo";

const photonUmluj = {
  features: [
    { geometry: { coordinates: [37.2685, 25.0213] }, properties: { osm_id: 1, osm_type: "N", osm_key: "place", osm_value: "town", type: "city", name: "Umluj", state: "Tabuk Province", country: "Saudi Arabia", countrycode: "SA", extent: [37.15, 25.15, 37.35, 24.95] } },
    { geometry: { coordinates: [37.3, 25.0] }, properties: { osm_id: 2, osm_type: "W", osm_key: "highway", osm_value: "primary", type: "street", name: "Umluj Road" } },
    { geometry: { coordinates: [45.0, 24.0] }, properties: { osm_id: 3, osm_type: "R", osm_key: "place", osm_value: "country", type: "country", name: "Saudi Arabia", countrycode: "sa", extent: [34.5, 32.2, 55.7, 16.3] } },
  ],
};

const riyadh: TripPlace = { id: "r", name: "Riyadh", kind: "city", country: "Saudi Arabia", countryCode: "SA", label: "Riyadh, Saudi Arabia", lat: 24.7136, lng: 46.6753, bbox: [24.3, 46.3, 25.1, 47.1] };
const umluj: TripPlace = { id: "u", name: "Umluj", kind: "town", country: "Saudi Arabia", countryCode: "SA", label: "Umluj, Saudi Arabia", lat: 25.0213, lng: 37.2685 };

const json = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

test("Photon results keep only real places, with kind, label and box", () => {
  const places = parsePhoton(photonUmluj);
  assert.equal(places.length, 2);
  assert.equal(places[0].name, "Umluj");
  assert.equal(places[0].kind, "town");
  assert.equal(places[0].label, "Umluj, Tabuk Province, Saudi Arabia");
  assert.deepEqual(places[0].bbox, [24.95, 37.15, 25.15, 37.35]);
  assert.equal(places[1].kind, "country");
  assert.equal(places[1].label, "Saudi Arabia");
  assert.equal(places[1].countryCode, "SA");
});

test("Open-Meteo fallback maps GeoNames codes", () => {
  const places = parseOpenMeteo({ results: [
    { id: 1, name: "Umluj", latitude: 25.02, longitude: 37.27, feature_code: "PPLA2", country: "Saudi Arabia", country_code: "SA", admin1: "Tabuk Region", population: 30000 },
    { id: 2, name: "Riyadh", latitude: 24.69, longitude: 46.72, feature_code: "PPLC", country: "Saudi Arabia", country_code: "SA", admin1: "Riyadh Region" },
  ] });
  assert.equal(places[0].kind, "town");
  assert.equal(places[1].kind, "city");
});

test("search falls back when Photon fails", async () => {
  let calls = 0;
  const fake = (async (url: string) => {
    calls++;
    if (url.includes("photon")) return new Response("down", { status: 503 });
    return new Response(JSON.stringify({ results: [{ id: 9, name: "Zzyzx", latitude: 35.14, longitude: -116.1, feature_code: "PPL", country: "United States", country_code: "US" }] }));
  }) as unknown as typeof fetch;
  const places = await searchPlaces("zzyzx-fallback-test", fake);
  assert.equal(calls, 2);
  assert.equal(places[0].name, "Zzyzx");
});

test("areas: box with buffer, radius when there's no box", () => {
  assert.equal(placeContains(riyadh, { lat: 24.65, lng: 46.71 }), true);
  assert.equal(placeContains(riyadh, { lat: 26.43, lng: 50.1 }), false); // Dammam
  assert.equal(placeContains(umluj, { lat: 25.05, lng: 37.3 }), true);
  assert.equal(placeContains(umluj, { lat: 24.09, lng: 38.06 }), false); // Yanbu, ~130 km
  assert.equal(insideAnyPlace([riyadh, umluj], { lat: 25.05, lng: 37.3 }), true);
});

test("venue names match loosely but not wrongly", () => {
  assert.equal(namesMatch("Masmak Fortress", "Al Masmak Fortress"), true);
  assert.equal(namesMatch("The National Museum of Saudi Arabia", "National Museum"), true);
  assert.equal(namesMatch("Café Nuance", "Cafe Nuance"), true);
  assert.equal(namesMatch("Umluj Seafood House", "Umluj Corniche"), false);
});

test("findVenue only accepts a matching result inside the place", async () => {
  const fake = json({ features: [
    { geometry: { coordinates: [50.1, 26.43] }, properties: { name: "Masmak Fortress" } }, // wrong city
    { geometry: { coordinates: [46.7133, 24.6312] }, properties: { name: "Al Masmak Fortress" } },
  ] });
  assert.deepEqual(await findVenue("Masmak Fortress", riyadh, fake), { name: "Al Masmak Fortress", lat: 24.6312, lng: 46.7133 });
  assert.equal(await findVenue("Invented Grill", riyadh, json({ features: [] })), null);
});

test("typed destinations resolve only to matching places", async () => {
  const fake = (async (url: string) => {
    const q = decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
    if (q === "Umluj") return new Response(JSON.stringify(photonUmluj));
    return new Response(JSON.stringify({ features: [photonUmluj.features[2]] })); // unrelated match
  }) as unknown as typeof fetch;
  const places = await resolveDestinationPlaces("Umluj & Nowhereville", fake);
  assert.deepEqual(places.map((p) => p.name), ["Umluj"]);
});

test("places from the app are validated", () => {
  const out = sanitizePlaces([{ name: "Riyadh", lat: 24.7, lng: 46.7, kind: "city", bbox: [1, 2, 3, 4] }, { name: "", lat: 1, lng: 1 }, { name: "X", lat: 999, lng: 1 }, "junk"]);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "Riyadh");
  assert.equal(sanitizePlaces(Array.from({ length: 9 }, () => ({ name: "A", lat: 1, lng: 1 }))).length, 5);
});

test("whole-trip fence catches a day that drifted to another city", () => {
  // Every venue on this "Riyadh" day is in Dammam, so the day-median check
  // alone would miss it.
  const it = { days: [{ dayNumber: 1, city: "Riyadh", activities: [
    { name: "Dammam Corniche", lat: 26.44, lng: 50.1, tag: "relaxing" },
    { name: "Half Moon Bay", lat: 26.2, lng: 50.2, tag: "beach" },
    { name: "Group wish spot", lat: 26.4, lng: 50.1, fromWish: true },
  ] }] };
  const places = [riyadh];
  const slots = findOutsideTripActivities(it, (p) => insideAnyPlace(places, p), (day) => {
    const pl = placeForCity(places, String(day.city));
    return pl && { lat: pl.lat, lng: pl.lng, name: pl.name };
  });
  assert.deepEqual(slots.map((s) => s.name), ["Dammam Corniche", "Half Moon Bay"]);
  assert.equal(slots[0].reason, "trip");
  const accept = (p: { lat: number; lng: number }) => insideAnyPlace(places, p);
  assert.equal(applyReplacements(it, slots, [{ name: "Still Dammam", lat: 26.4, lng: 50.1 }, { name: "Wadi Hanifa", lat: 24.65, lng: 46.6 }], 50, accept), 1);
  assert.equal(it.days[0].activities[1].name, "Wadi Hanifa");
  assert.equal(it.days[0].activities[0].name, "Dammam Corniche");
});
