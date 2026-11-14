import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { parseAutocomplete, parseDetails, parseTextSearch, replacementQuery, validSession } from "./google-places";
import { findReplacementVenue, findVenue, placeDetails, resolveDestinationPlaces, searchPlaces, type TripPlace } from "./places";

const umluj: TripPlace = { id: "g:u", name: "Umluj", kind: "town", country: "Saudi Arabia", countryCode: "SA", label: "Umluj, Saudi Arabia", lat: 25.0213, lng: 37.2685, bbox: [24.98, 37.22, 25.07, 37.32] };

afterEach(() => { delete process.env.GOOGLE_PLACES_API_KEY; });

test("autocomplete suggestions become pending places", () => {
  const places = parseAutocomplete({ suggestions: [
    { placePrediction: { placeId: "ChIJumluj123", text: { text: "Umluj, Saudi Arabia" }, structuredFormat: { mainText: { text: "Umluj" }, secondaryText: { text: "Saudi Arabia" } }, types: ["locality", "political"] } },
    { placePrediction: { placeId: "ChIJsaudi123", text: { text: "Saudi Arabia" }, structuredFormat: { mainText: { text: "Saudi Arabia" } }, types: ["country", "political"] } },
    { queryPrediction: { text: { text: "umluj hotels" } } },
  ] });
  assert.equal(places.length, 2);
  assert.equal(places[0].id, "g:ChIJumluj123");
  assert.equal(places[0].pending, true);
  assert.equal(places[0].country, "Saudi Arabia");
  assert.equal(places[0].label, "Umluj, Saudi Arabia");
  assert.equal(places[1].kind, "country");
});

test("details give coordinates, area, country code and town/city", () => {
  const p = parseDetails({
    id: "ChIJumluj123", displayName: { text: "Umluj" }, location: { latitude: 25.02, longitude: 37.27 },
    viewport: { low: { latitude: 24.98, longitude: 37.22 }, high: { latitude: 25.07, longitude: 37.32 } },
    types: ["locality", "political"],
    addressComponents: [{ longText: "Saudi Arabia", shortText: "SA", types: ["country"] }, { longText: "Tabuk Province", types: ["administrative_area_level_1"] }],
  })!;
  assert.equal(p.kind, "town");
  assert.equal(p.countryCode, "SA");
  assert.equal(p.label, "Umluj, Tabuk Province, Saudi Arabia");
  assert.deepEqual(p.bbox, [24.98, 37.22, 25.07, 37.32]);
  assert.equal(p.pending, undefined);
});

test("text search marks permanently closed places", () => {
  const v = parseTextSearch({ places: [
    { displayName: { text: "Old Grill" }, location: { latitude: 25.02, longitude: 37.27 }, businessStatus: "CLOSED_PERMANENTLY" },
    { displayName: { text: "Fish Market" }, location: { latitude: 25.03, longitude: 37.26 }, businessStatus: "OPERATIONAL", rating: 4.4, primaryTypeDisplayName: { text: "Seafood restaurant" } },
  ] });
  assert.equal(v[0].closed, true);
  assert.equal(v[1].closed, false);
  assert.equal(v[1].rating, 4.4);
});

test("replacement searches follow the activity", () => {
  assert.equal(replacementQuery("food", "Fresh seafood lunch on the Umluj corniche"), "seafood restaurant");
  assert.equal(replacementQuery("foodie", "Dinner at Al Bahr"), "restaurant");
  assert.equal(replacementQuery("culture", "Umluj Heritage Village"), "historical landmark");
  assert.equal(validSession("a1b2c3d4-e5f6"), "a1b2c3d4-e5f6");
  assert.equal(validSession("bad token!"), undefined);
});

test("with a key, search, details, venue checks and replacements use Google", async () => {
  process.env.GOOGLE_PLACES_API_KEY = "k";
  const calls: string[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    assert.equal((init?.headers as Record<string, string>)["X-Goog-Api-Key"], "k");
    if (url.endsWith(":autocomplete")) {
      return new Response(JSON.stringify({ suggestions: [{ placePrediction: { placeId: "ChIJumluj123", text: { text: "Umluj, Saudi Arabia" }, structuredFormat: { mainText: { text: "Umluj" }, secondaryText: { text: "Saudi Arabia" } }, types: ["locality"] } }] }));
    }
    if (url.includes("/places/ChIJumluj123")) {
      return new Response(JSON.stringify({ id: "ChIJumluj123", displayName: { text: "Umluj" }, location: { latitude: 25.02, longitude: 37.27 }, types: ["locality"], addressComponents: [{ longText: "Saudi Arabia", shortText: "SA", types: ["country"] }] }));
    }
    const q = JSON.parse(String(init?.body)).textQuery as string;
    if (q === "Al Bahr Grill") return new Response(JSON.stringify({ places: [{ displayName: { text: "Al Bahr Grill" }, location: { latitude: 25.02, longitude: 37.27 }, businessStatus: "CLOSED_PERMANENTLY" }] }));
    if (q.startsWith("seafood restaurant in")) return new Response(JSON.stringify({ places: [
      { displayName: { text: "Used Already" }, location: { latitude: 25.02, longitude: 37.27 }, businessStatus: "OPERATIONAL" },
      { displayName: { text: "Far Away Fish" }, location: { latitude: 24.0, longitude: 38.0 }, businessStatus: "OPERATIONAL" },
      { displayName: { text: "Umluj Fish House" }, location: { latitude: 25.03, longitude: 37.26 }, businessStatus: "OPERATIONAL", rating: 4.5 },
    ] }));
    return new Response(JSON.stringify({ places: [] }));
  }) as unknown as typeof fetch;

  const suggestions = await searchPlaces("Umluj google", fake, 8, "sess-12345678");
  assert.equal(suggestions[0].pending, true);
  assert.match(calls[0], /:autocomplete$/);
  const picked = await placeDetails(suggestions[0].id, "sess-12345678", fake);
  assert.equal(picked?.countryCode, "SA");
  assert.match(calls[1], /sessionToken=sess-12345678/);

  // Old apps send text; it resolves through autocomplete + details.
  const resolved = await resolveDestinationPlaces("Umluj", fake);
  assert.equal(resolved[0]?.lat, 25.02);

  assert.deepEqual(await findVenue("Al Bahr Grill", umluj, fake), { name: "Al Bahr Grill", lat: 25.02, lng: 37.27, closed: true });
  const replacement = await findReplacementVenue("food", "Seafood dinner", umluj, new Set(["used already"]), fake);
  assert.equal(replacement?.name, "Umluj Fish House");
});

test("without a key nothing calls Google", async () => {
  assert.equal(await findReplacementVenue("food", "x", umluj, new Set()), null);
  assert.equal(await placeDetails("g:ChIJx", undefined), null);
});
