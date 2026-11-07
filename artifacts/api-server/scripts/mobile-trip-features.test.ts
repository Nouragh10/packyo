import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { accommodationRanking } from "../src/lib/accommodation-votes";

// Expo's package is CommonJS; tsx registers its TS loader for require too.
const require = createRequire(import.meta.url);
const { classifyActivity, sameCity, keySegment } = require("../../gopack-mobile/lib/activity-classifier");
const { currencyDigits, parseMoneyInput, minorToInput, isValidISODate } = require("../../gopack-mobile/lib/expense-money");
const { accommodationBallot } = require("../../gopack-mobile/lib/accommodation-ballot");
const { fetchWithTimeout } = require("../../gopack-mobile/lib/timed-fetch");
const { activityTimeLabel, parseActivityTime } = require("../../gopack-mobile/lib/activity-time");

test("legacy numeric activity times cannot crash Overview", () => {
  for (const value of [3, 7, 2, 12.3, "3", "7", "12.3", null, undefined, {}, [], true]) {
    assert.equal(parseActivityTime(value), null);
    assert.equal(activityTimeLabel(value), "Flexible time");
  }
});

test("Overview interprets clock times without guessing ambiguous numeric hours", () => {
  assert.deepEqual(parseActivityTime("9:15 AM"), { h: 9, m: 15 });
  assert.deepEqual(parseActivityTime("12:00 AM"), { h: 0, m: 0 });
  assert.deepEqual(parseActivityTime("12:30 PM"), { h: 12, m: 30 });
  assert.deepEqual(parseActivityTime(" 19:45 "), { h: 19, m: 45 });
  for (const value of ["25:00", "12:70", "0:30 PM", "9:00–10:00", "Flexible"]) {
    assert.equal(parseActivityTime(value), null);
  }
  assert.equal(activityTimeLabel("9:15 AM"), "9:15 AM");
});

function fakeRequest(status = 200, responseText = '{"days":[]}') {
  return {
    status, responseText, timeout: 0, withCredentials: false,
    open() {}, setRequestHeader() {},
    send(_body: unknown) {}, abort() {},
    getAllResponseHeaders: () => "content-type: application/json\r\n",
    onload: () => {}, onerror: () => {}, ontimeout: () => {}, onabort: () => {},
  };
}

test("itinerary transport sets the native iOS timeout explicitly and preserves JSON", async () => {
  const xhr = fakeRequest();
  const result = fetchWithTimeout("https://example.test/api/itinerary",
    { method: "POST", body: "{}" }, 180_000, () => xhr);
  assert.equal(xhr.timeout, 180_000);
  xhr.onload();
  const response = await result;
  assert.equal(response.ok, true);
  assert.deepEqual(await response.json(), { days: [] });
});

test("itinerary transport preserves HTTP errors for the generation screen", async () => {
  const xhr = fakeRequest(502, '{"error":"Incomplete plan"}');
  const result = fetchWithTimeout("https://example.test/api/itinerary", {}, 180_000, () => xhr);
  xhr.onload();
  const response = await result;
  assert.equal(response.ok, false);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "Incomplete plan");
});

test("itinerary transport distinguishes a timeout from a network failure", async () => {
  for (const [event, message] of [["ontimeout", /longer than expected/], ["onerror", /Connection to Packyo was interrupted/]] as const) {
    const xhr = fakeRequest();
    const result = fetchWithTimeout("https://example.test/api/itinerary", {}, 180_000, () => xhr);
    const assertion = assert.rejects(result, message);
    xhr[event]();
    await assertion;
  }
});

test("cancelled itinerary transport does not send a request", async () => {
  const controller = new AbortController();
  controller.abort();
  const xhr = fakeRequest();
  let sent = false;
  xhr.send = () => { sent = true; };
  await assert.rejects(fetchWithTimeout("https://example.test/api/itinerary",
    { signal: controller.signal }, 180_000, () => xhr), /cancelled/);
  assert.equal(sent, false);
});

test("venue identity beats general relaxing trip classification", () => {
  assert.equal(classifyActivity({ name: "British Museum", description: "A relaxing afternoon", fallback: "Relaxing" }), "Culture");
  assert.equal(classifyActivity({ name: "National Gallery", fallback: "Adventure" }), "Culture");
  assert.equal(classifyActivity({ name: "Unknown venue", fallback: "Food" }), "Food");
});
test("saved destination matching is exact, Unicode-aware and region-safe", () => {
  assert.equal(sameCity("Paris, France", "Paris, Texas"), false);
  assert.equal(sameCity("London, United Kingdom", "London, UK"), true);
  assert.equal(sameCity("Paris", "Paris, France"), true);
  assert.equal(sameCity("東京", "東京"), true);
  assert.equal(sameCity("York", "New York"), false);
  assert.notEqual(keySegment("東京タワー"), keySegment("大阪城"));
});
test("currency input converts decimal strings to exact integers", () => {
  assert.deepEqual(parseMoneyInput("10.01", "GBP"), { ok: true, minor: 1001 });
  assert.deepEqual(parseMoneyInput("0.1", "USD"), { ok: true, minor: 10 });
  assert.deepEqual(parseMoneyInput("1000", "JPY"), { ok: true, minor: 1000 });
  assert.deepEqual(parseMoneyInput("1.234", "KWD"), { ok: true, minor: 1234 });
  assert.deepEqual(parseMoneyInput("1.2345", "CLF"), { ok: true, minor: 12345 });
  assert.equal(parseMoneyInput("0.01", "JPY").ok, false);
  assert.equal(parseMoneyInput("1.234", "USD").ok, false);
  assert.equal(parseMoneyInput("-1", "USD").ok, false);
  assert.equal(currencyDigits("JPY"), 0);
  assert.equal(currencyDigits("KWD"), 3);
  assert.equal(minorToInput(1001, "GBP"), "10.01");
});
test("calendar dates reject nonexistent days", () => {
  assert.equal(isValidISODate("2026-02-30"), false);
  assert.equal(isValidISODate("2026-02-29"), false);
  assert.equal(isValidISODate("2028-02-29"), true);
});
test("mobile and API use the same shared ballot identity and invalidate stale decisions", () => {
  const trip = { members: { a: { name: "A" }, b: { name: "B" } },
    accommodationSuggestions: [{ id: "s1", name: "Stay One" }, { id: "s2", name: "Stay Two" }],
    accommodationVotes: { 0: { a: "up", b: "up" }, 1: { a: "up", b: "up" } },
    accommodationLockedBy: { a: true, b: true } };
  const server = accommodationRanking(trip);
  const decided = { ...trip, aiAccommodationDecision: { ballotKey: server.ballotKey, suggestionIndex: 1, reason: "Better fit", decidedAt: "2026-10-27" } };
  assert.equal(accommodationBallot(decided as never).validDecision?.suggestionIndex, 1);
  assert.equal(accommodationBallot({ ...decided, accommodationLockedBy: { a: true } } as never).validDecision, null);
});
