import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  activityPricePresentation, summarizeActivityPrices, needsActivityPriceCheck,
  formatActivityMoney, type ActivityPricing,
} from "@workspace/activity-pricing";
import { extractVerifiedPrices, type PriceSearchResponse } from "./activity-prices";
import { clearGeneratedPriceGuesses, manualActivityPricePatch } from "./activity-price-mutations";

const url = "https://www.example.org/visit";
const target = { name: "Example Museum", city: "London" };
function result(overrides: Record<string, unknown> = {}, citationText?: string): PriceSearchResponse {
  const evidence = String(overrides.evidence ?? "Adult admission £25.00");
  return { content: [
    { type: "web_search_tool_result", content: [{ type: "web_search_result", url }] },
    { type: "text", text: "Source evidence.", citations: [{ url, title: "Example Museum | Official admission", cited_text: citationText ?? evidence }] },
    { type: "text", text: JSON.stringify({ prices: [{
      id: 0, amount: 25, currency: "GBP", priceType: "fixed", scope: "admission", sourceUrl: url, evidence, ...overrides,
    }] }) },
  ] };
}
const verified = (overrides: Partial<ActivityPricing> = {}): ActivityPricing => ({
  status: "verified", amount: 25, currency: "GBP", priceType: "fixed",
  sourceUrl: url, sourceTitle: "Official admission", evidence: "Adult admission £25.00",
  checkedAt: new Date().toISOString(), activityName: target.name, ...overrides,
});

describe("source-backed activity prices", () => {
  it("extracts adult admission with actual searched URL, exact citation and currency", () => {
    const [price] = extractVerifiedPrices([target], result());
    assert.equal(price?.status, "verified");
    assert.equal(price?.amount, 25);
    assert.equal(price?.currency, "GBP");
    assert.equal(price?.sourceUrl, url);
  });
  it("never trusts a model URL that was not returned by search", () => {
    assert.equal(extractVerifiedPrices([target], result({ sourceUrl: "https://invented.example/price" }))[0]?.status, "unavailable");
  });
  it("never trusts a model quote absent from the actual source citation", () => {
    assert.equal(extractVerifiedPrices([target], result({}, "We are open daily."))[0]?.status, "unavailable");
  });
  it("rejects a real quote from an unrelated venue", () => {
    assert.equal(extractVerifiedPrices([{ name: "Entirely Different Gallery", city: "London" }], result())[0]?.status, "unavailable");
  });
  it("rejects an amount that does not match source evidence, including decimal prefixes", () => {
    assert.equal(extractVerifiedPrices([target], result({ evidence: "Adult admission £25.99" }))[0]?.status, "unavailable");
  });
  it("does not invent a currency for a bare dollar sign", () => {
    assert.equal(extractVerifiedPrices([target], result({ currency: "USD", evidence: "Adult admission $25.00" }))[0]?.status, "unavailable");
    assert.equal(extractVerifiedPrices([target], result({ currency: "USD", evidence: "Adult admission USD 25.00" }))[0]?.status, "verified");
  });
  it("does not pair one currency with the amount quoted for another", () => {
    assert.equal(extractVerifiedPrices([target], result({
      currency: "EUR", amount: 25, evidence: "Adult admission GBP 25 (EUR 30)",
    }))[0]?.status, "unavailable");
  });
  it("does not present a discounted child price as an adult price", () => {
    assert.equal(extractVerifiedPrices([target], result({ evidence: "Children's admission £25.00" }))[0]?.status, "unavailable");
  });
  it("does not call unknown zero free", () => {
    assert.equal(extractVerifiedPrices([target], result({ amount: 0, evidence: "Opening at 10:00 every day." }))[0]?.status, "unavailable");
    assert.equal(activityPricePresentation({ name: target.name, estimatedCost: 0 }).label, "Price unavailable");
  });
  it("does not turn free museum entry into a free meal or conditional concession", () => {
    const free = result({ amount: 0, currency: null, priceType: "free", evidence: "Admission is free." });
    assert.equal(extractVerifiedPrices([{ ...target, tag: "food" }], free)[0]?.status, "unavailable");
    assert.equal(extractVerifiedPrices([target], result({
      amount: 0, currency: null, priceType: "free", evidence: "Admission is free on Sundays.",
    }))[0]?.status, "unavailable");
  });
  it("verifies actual British Museum official free permanent-collection evidence", () => {
    const response = result({
      amount: 0, currency: null, priceType: "free",
      evidence: "Tickets to the permanent collection are free.",
    }, "... Tickets to the permanent collection are free. ");
    const [price] = extractVerifiedPrices([target], response);
    assert.equal(price?.status, "verified");
    assert.equal(activityPricePresentation({ name: target.name, pricing: price }).label, "Free admission");
  });
  it("keeps starting prices marked from and verifies both endpoints of a range", () => {
    assert.equal(extractVerifiedPrices([target], result({ evidence: "Adult admission from £25.00" }))[0]?.priceType, "from");
    assert.equal(extractVerifiedPrices([target], result({ priceType: "range", maxAmount: 30 }))[0]?.status, "unavailable");
    assert.equal(extractVerifiedPrices([target], result({ priceType: "range", maxAmount: 30, evidence: "Adult admission EUR 25–30", currency: "EUR" }))[0]?.status, "verified");
  });
  it("supports source decimal commas and zero-decimal currency formatting", () => {
    assert.equal(extractVerifiedPrices([target], result({ amount: 24.5, currency: "EUR", evidence: "Adult admission €24,50" }))[0]?.amount, 24.5);
    assert.equal(formatActivityMoney(1200, "JPY"), "JPY\u00a01,200");
  });
  it("does not count stale, unpriced, unsafe, or mismatched-venue values in totals", () => {
    const activities = [
      { ...target, pricing: verified() },
      { ...target, pricing: verified({ checkedAt: "2020-01-01T00:00:00Z" }) },
      { ...target, estimatedCost: 100 },
      { ...target, pricing: verified({ sourceUrl: "javascript:alert(1)" }) },
      { ...target, pricing: verified({ activityName: "Other museum" }) },
    ];
    const summary = summarizeActivityPrices(activities);
    assert.equal(summary.verifiedCount, 1);
    assert.equal(summary.unknownCount, 4);
    assert.deepEqual(summary.totals.map(({ currency, amount }) => ({ currency, amount })), [{ currency: "GBP", amount: 25 }]);
    assert.equal(needsActivityPriceCheck(activities[1]!), true);
  });
  it("groups currencies instead of adding unrelated dollar and pound amounts", () => {
    const summary = summarizeActivityPrices([
      { ...target, pricing: verified() },
      { ...target, pricing: verified({ amount: 10, currency: "EUR", priceType: "from" }) },
    ]);
    assert.deepEqual(summary.totals.map(({ currency, amount }) => ({ currency, amount })), [
      { currency: "GBP", amount: 25 }, { currency: "EUR", amount: 10 },
    ]);
    assert.equal(summary.hasFromPrices, true);
  });
  it("labels manual prices and excludes them from sourced totals", () => {
    const activity = { ...target, pricing: verified({ status: "user_entered" }) };
    assert.match(activityPricePresentation(activity).label, /user-entered/);
    assert.equal(summarizeActivityPrices([activity]).verifiedCount, 0);
  });
  it("strips model guesses before returning a generated plan", () => {
    const plan = clearGeneratedPriceGuesses({ days: [{ activities: [{ name: target.name, estimatedCost: 45 }] }] });
    assert.equal(plan.days[0]?.activities[0]?.estimatedCost, null);
    assert.equal((plan.days[0]?.activities[0] as any).pricing.status, "unavailable");
  });
  it("invalidates sources when editing the venue or accepting a client-supplied new source", () => {
    const existing = { ...target, pricing: verified(), estimatedCost: 25 };
    assert.equal(manualActivityPricePatch({ name: "Other museum" }, existing).pricing.status, "unavailable");
    assert.equal(manualActivityPricePatch({ ...target, pricing: verified() }).pricing.status, "unavailable");
    assert.equal(manualActivityPricePatch({ description: "Updated note" }, existing).pricing.status, "verified");
    assert.equal(manualActivityPricePatch({ estimatedCost: 75 }, existing).pricing.status, "unavailable");
  });
});
