import { test } from "node:test";
import assert from "node:assert/strict";
import { paywallEnabled, OPEN_ACCESS, accessFor, claimKey, purchaseListed, validTransactionId, verifyWithRevenueCat, UNLOCK_PRODUCTS } from "./itinerary-unlock";

test("group unlock opens the itinerary for every member", () => {
  const u = { group: { uid: "a", name: "Norah", at: "x" } };
  assert.deepEqual(accessFor(u, "b"), { unlocked: true, via: "group", groupUnlockedBy: "Norah" });
});

test("personal unlock only opens it for the payer", () => {
  const u = { members: { a: { at: "x" } } };
  assert.equal(accessFor(u, "a").unlocked, true);
  assert.equal(accessFor(u, "a").via, "personal");
  assert.equal(accessFor(u, "b").unlocked, false);
  assert.equal(accessFor(null, "b").unlocked, false);
});

test("purchase must be listed under the matching product", () => {
  const body = { subscriber: { non_subscriptions: { [UNLOCK_PRODUCTS.personal]: [{ id: "rc1", store_transaction_id: "2000001" }] } } };
  assert.equal(purchaseListed(body, UNLOCK_PRODUCTS.personal, "2000001"), true);
  assert.equal(purchaseListed(body, UNLOCK_PRODUCTS.personal, "rc1"), true);
  assert.equal(purchaseListed(body, UNLOCK_PRODUCTS.group, "2000001"), false);
  assert.equal(purchaseListed({}, UNLOCK_PRODUCTS.group, "2000001"), false);
});

test("transaction ids are validated and made safe as keys", () => {
  assert.equal(validTransactionId("GPA.1234-5678"), true);
  assert.equal(validTransactionId("a/b"), false);
  assert.equal(validTransactionId(""), false);
  assert.equal(claimKey("GPA.12.34"), "GPA_12_34");
});

test("verification asks RevenueCat about the signed-in user", async () => {
  process.env.REVENUECAT_V1_SECRET_KEY = "sk_test";
  let url = "";
  const fake = (async (u: string) => {
    url = u;
    return new Response(JSON.stringify({ subscriber: { non_subscriptions: { [UNLOCK_PRODUCTS.group]: [{ store_transaction_id: "t1" }] } } }));
  }) as unknown as typeof fetch;
  assert.equal(await verifyWithRevenueCat("uid 1", "group", "t1", fake), true);
  assert.equal(url, "https://api.revenuecat.com/v1/subscribers/uid%201");
  assert.equal(await verifyWithRevenueCat("uid 1", "personal", "t1", fake), false);
});

test("paywall is off unless PAYWALL_ENABLED is exactly 'true'", () => {
  assert.equal(paywallEnabled({}), false);
  assert.equal(paywallEnabled({ PAYWALL_ENABLED: "false" }), false);
  assert.equal(paywallEnabled({ PAYWALL_ENABLED: "true" }), true);
  assert.equal(OPEN_ACCESS.unlocked, true);
});
