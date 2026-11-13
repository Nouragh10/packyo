import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  AccommodationResponseError,
  ItineraryResponseError,
  parseAccommodationSuggestionsResponse,
  parseItineraryResponse,
} from "./itinerary-parser";
import { ITINERARY_TOOL, type ItineraryAiResponse } from "./itinerary-output";

function createItinerary(activityCount = 1, wishActivityCount = 0) {
  return {
    title: "A compact city break",
    days: [{
      dayNumber: 1,
      city: "Lisbon",
      theme: "Historic streets",
      activities: Array.from({ length: activityCount }, (_, index) => ({
        name: `Stop ${index + 1}`,
        tag: "culture",
          fromWish: index < wishActivityCount,
      })),
    }],
  };
}

test("parses fenced JSON with surrounding prose and a trailing comma", () => {
  const text = `Here is the itinerary:
\`\`\`json
${JSON.stringify(createItinerary(), null, 2).replace(/\n}/, ",\n}")}
\`\`\`
Enjoy the trip!`;

  const parsed = parseItineraryResponse(text, {
    expectedDays: 1,
    activitiesPerDay: 1,
  });

  assert.equal(parsed.title, "A compact city break");
  assert.equal(parsed.days[0]?.activities[0]?.name, "Stop 1");
});

test("parses a response that begins after an assistant opening-brace prefill", () => {
  const complete = JSON.stringify(createItinerary());
  const parsed = parseItineraryResponse(complete.slice(1), {
    expectedDays: 1,
    activitiesPerDay: 1,
  });

  assert.equal(parsed.days[0]?.city, "Lisbon");
});

test("rejects repaired JSON when required itinerary content is still incomplete", () => {
  assert.throws(
    () => parseItineraryResponse(
      '{"title":"Only a heading","days":[{"dayNumber":1,"city":"Lisbon","theme":"Historic streets","activities":[]',
      { expectedDays: 1, activitiesPerDay: 1 },
    ),
    (error: unknown) => error instanceof ItineraryResponseError && error.code === "INVALID_ITINERARY_RESPONSE",
  );
});

test("rejects duplicate returned activities for distinct guaranteed wish IDs", () => {
  const itinerary = createItinerary(2, 2);
  (itinerary.days[0]!.activities[0]! as { wishId?: string }).wishId = "wish-a";
  (itinerary.days[0]!.activities[1]! as { wishId?: string }).wishId = "wish-a";

  assert.throws(
    () => parseItineraryResponse(JSON.stringify(itinerary), {
      expectedDays: 1,
      activitiesPerDay: 1,
      guaranteedWishes: [
        { id: "wish-a", text: "Stop 1" },
        { id: "wish-b", text: "Stop 2" },
      ],
    }),
    (error: unknown) => error instanceof ItineraryResponseError,
  );
});

test("rejects an itinerary that omits a guaranteed wish", () => {
  const itinerary = createItinerary(2, 2);
  (itinerary.days[0]!.activities[0]! as { wishId?: string }).wishId = "wish-a";
  (itinerary.days[0]!.activities[1]! as { wishId?: string }).wishId = "unrelated-wish";

  assert.throws(
    () => parseItineraryResponse(JSON.stringify(itinerary), {
      expectedDays: 1,
      activitiesPerDay: 1,
      guaranteedWishes: [
        { id: "wish-a", text: "Stop 1" },
        { id: "wish-b", text: "Stop 2" },
      ],
    }),
    (error: unknown) => error instanceof ItineraryResponseError,
  );
});

function createAccommodationSuggestions() {
  return {
    suggestions: Array.from({ length: 3 }, (_, index) => ({
      id: `opt-${index + 1}`,
      name: `Lisbon Stay ${index + 1}`,
      type: "hotel",
      location: "Lisbon",
      totalCost: 600,
      costPerPerson: 300,
      nights: 2,
      rating: 4.2,
      amenities: ["WiFi"],
      rooms: 1,
      beds: 2,
      cancellation: "Free cancellation",
      whyItFits: "A central option for the group.",
      tags: ["Central"],
      distanceNote: "Ten minutes from downtown",
      submittedBy: "AI",
    })),
  };
}

test("parses repaired, fenced accommodation suggestions and validates all options", () => {
  const text = `\`\`\`json\n${JSON.stringify(createAccommodationSuggestions()).replace(/\n?}$/, ",\n}")}\n\`\`\``;
  const parsed = parseAccommodationSuggestionsResponse(text);
  assert.equal(parsed.suggestions.length, 3);
  assert.equal(parsed.suggestions[2]?.id, "opt-3");
});

test("normalizes harmless accommodation model variations", () => {
  const suggestions = createAccommodationSuggestions().suggestions.map((suggestion, index) => ({
    ...suggestion,
    id: "repeated-model-id",
    type: index === 1 ? "vacation rental" : suggestion.type,
    totalCost: String(suggestion.totalCost),
    amenities: index === 2 ? undefined : suggestion.amenities,
    distanceNote: index === 0 ? undefined : suggestion.distanceNote,
  }));
  const parsed = parseAccommodationSuggestionsResponse(JSON.stringify({ suggestions }));

  assert.deepEqual(parsed.suggestions.map((suggestion) => suggestion.id), ["opt-1", "opt-2", "opt-3"]);
  assert.equal(parsed.suggestions[1]?.type, "airbnb");
  assert.equal(parsed.suggestions[0]?.totalCost, 600);
  assert.deepEqual(parsed.suggestions[2]?.amenities, []);
  assert.equal(parsed.suggestions[0]?.distanceNote, "Check the listing for location details.");
});

test("returns a recoverable accommodation error for incomplete suggestions", () => {
  assert.throws(
    () => parseAccommodationSuggestionsResponse('{"suggestions":[{"name":"Only one"}]}'),
    (error: unknown) => error instanceof AccommodationResponseError &&
      error.code === "INVALID_ACCOMMODATION_RESPONSE" &&
      error.recoverable,
  );
});

let server: Server;
let baseUrl: string;
let originalFetch: typeof globalThis.fetch;
let fetchCalls = 0;
let aiResponses: Array<string | ItineraryAiResponse> = [];
let lastAiRequest: Record<string, any> = {};
let aiError: Error | null = null;

before(async () => {
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "https://ai.example.test";
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "test-key";
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "silent";

  originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    // Place lookups (destination fencing) find nothing here, so these tests
    // exercise the AI flow exactly as before.
    if (/photon\.komoot|open-meteo/.test(String(url))) {
      return new Response(JSON.stringify({ features: [], results: [] }), { status: 200 });
    }
    fetchCalls += 1;
    lastAiRequest = JSON.parse(String(init?.body ?? "{}"));
    if (aiError) throw aiError;
    const response = aiResponses.shift() ?? '{"title":"Truncated","days":[{"dayNumber":1';
    return new Response(JSON.stringify(typeof response === "string" ? {
      content: [{
        type: "text",
        text: response,
      }],
    } : response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const app = (await import("../app")).default;
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("returns a recoverable response when both AI itinerary attempts are malformed", async () => {
  fetchCalls = 0;
  aiResponses = [
    '{"title":"Truncated","days":[{"dayNumber":1',
    '{"title":"Truncated","days":[{"dayNumber":1',
  ];
  const response = await originalFetch(`${baseUrl}/api/itinerary`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      destination: "Lisbon",
      days: 1,
      vibes: ["Culture"],
      budget: "midrange",
      pace: "relaxed",
    }),
  });

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "We could not build a complete itinerary right now. Please try again.",
    code: "INVALID_ITINERARY_RESPONSE",
    recoverable: true,
  });
  assert.equal(fetchCalls, 2);
});

test("accepts overflow activities needed to retain guaranteed wishes", async () => {
  fetchCalls = 0;
  aiResponses = [JSON.stringify(createItinerary(4, 4))];
  const response = await originalFetch(`${baseUrl}/api/itinerary`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      destination: "Lisbon",
      days: 1,
      vibes: ["Culture"],
      budget: "midrange",
      pace: "relaxed",
      guaranteed: [
        { text: "Stop 1", author: "Ava", votes: 4 },
        { text: "Stop 2", author: "Ben", votes: 3 },
        { text: "Stop 3", author: "Chen", votes: 2 },
        { text: "Stop 4", author: "Drew", votes: 1 },
      ],
    }),
  });

  assert.equal(response.status, 200);
  const itinerary = await response.json() as ReturnType<typeof createItinerary>;
  assert.equal(itinerary.days[0]?.activities.length, 4);
  assert.equal(fetchCalls, 1);
});

test("four-day tool output returns every day at the requested pace in one call", async () => {
  fetchCalls = 0;
  const plan = {
    title: "Four complete days",
    days: Array.from({ length: 4 }, (_, day) => ({
      ...createItinerary(5).days[0],
      dayNumber: day + 1,
      activities: createItinerary(5).days[0]!.activities.map((activity, slot) => ({
        ...activity,
        name: `Day ${day + 1} unique venue ${slot + 1}`,
      })),
    })),
  };
  aiResponses = [{ content: [{ type: "tool_use", name: ITINERARY_TOOL, input: plan }] }];
  const response = await originalFetch(`${baseUrl}/api/itinerary`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ destination: "Lisbon", days: 4, vibes: ["Culture"], budget: "midrange", wishes: [] }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), plan);
  assert.equal(fetchCalls, 1);
  assert.equal(lastAiRequest.tool_choice.name, ITINERARY_TOOL);
  assert.equal(lastAiRequest.tools[0].input_schema.properties.days.minItems, 4);
  assert.equal(lastAiRequest.tools[0].input_schema.properties.days.maxItems, 4);
  assert.equal(lastAiRequest.tools[0].input_schema.properties.days.items.properties.activities.minItems, 5);
  assert.equal(lastAiRequest.messages.length, 1, "forced tool calls must not use assistant prefill");
});

test("upstream timeout returns a recoverable response instead of an unhandled connection error", async () => {
  aiError = new DOMException("AI deadline reached", "TimeoutError");
  try {
    const response = await originalFetch(`${baseUrl}/api/itinerary`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destination: "Lisbon", days: 1, vibes: ["Culture"], budget: "midrange", wishes: [] }),
    });
    assert.equal(response.status, 504);
    const result = await response.json() as { code: string; recoverable: boolean };
    assert.equal(result.code, "ITINERARY_TIMEOUT");
    assert.equal(result.recoverable, true);
  } finally {
    aiError = null;
  }
});

test("chosen places fence the itinerary: an out-of-area venue is replaced and invented ones are web-checked", async () => {
  fetchCalls = 0;
  const lisbon = { id: "l", name: "Lisbon", kind: "city", country: "Portugal", countryCode: "PT", label: "Lisbon, Portugal", lat: 38.7223, lng: -9.1393, bbox: [38.69, -9.23, 38.8, -9.09] };
  const plan = {
    title: "Lisbon",
    days: [{ dayNumber: 1, city: "Lisbon", theme: "Old town", activities: [
      { name: "Belem Tower", tag: "culture", lat: 38.6916, lng: -9.216 },
      { name: "Porto Wine Cellar", tag: "culture", lat: 41.137, lng: -8.613 },
      { name: "Casa Inventada", tag: "culture", lat: 38.712, lng: -9.14 },
    ] }],
  };
  aiResponses = [
    JSON.stringify(plan),
    // relocation pass: Porto venue swapped for one inside Lisbon
    JSON.stringify([{ name: "Alfama Viewpoint", lat: 38.711, lng: -9.13, description: "Go at sunset." }]),
    // web check of venues the map didn't know: the third was invented
    JSON.stringify([{ exists: true }, { exists: true }, { exists: false, name: "Time Out Market", lat: 38.707, lng: -9.146 }]),
  ];
  const response = await originalFetch(`${baseUrl}/api/itinerary`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ destination: "Lisbon", places: [lisbon], days: 1, vibes: ["Culture"], budget: "midrange", pace: "relaxed" }),
  });
  assert.equal(response.status, 200);
  const itinerary = await response.json() as { days: Array<{ activities: Array<{ name: string }> }> };
  assert.deepEqual(itinerary.days[0].activities.map((a) => a.name), ["Belem Tower", "Alfama Viewpoint", "Time Out Market"]);
  assert.equal(fetchCalls, 3);
  const prompt = JSON.stringify(lastAiRequest);
  assert.match(prompt, /web_search/);
});
