import { validPriceCurrency, type ActivityPricing } from "@workspace/activity-pricing";
import { unavailablePrice } from "./activity-prices";

/** A client edit cannot invent a source-verified price or retain a source for a different venue. */
export function manualActivityPricePatch(
  source: Record<string, unknown>,
  existing?: Record<string, unknown>,
): { estimatedCost: number | null; pricing: ActivityPricing } {
  const name = typeof source.name === "string" ? source.name.trim() : String(existing?.name ?? "New activity");
  const supplied = source.pricing as ActivityPricing | null | undefined;
  const previous = existing?.pricing as ActivityPricing | null | undefined;
  const sameName = name === existing?.name;
  const explicitPrice = Object.hasOwn(source, "pricing");
  if (sameName && previous && (
    !explicitPrice && (!Object.hasOwn(source, "estimatedCost") || source.estimatedCost === existing?.estimatedCost)
    || supplied?.status === "verified" && JSON.stringify(supplied) === JSON.stringify(previous)
  )) {
    return { estimatedCost: previous.status === "verified" ? previous.amount : null, pricing: previous };
  }
  if (supplied?.status === "user_entered" && typeof supplied.amount === "number" &&
      Number.isFinite(supplied.amount) && supplied.amount >= 0 && validPriceCurrency(supplied.currency)) {
    return {
      estimatedCost: null,
      pricing: { status: "user_entered", amount: supplied.amount, currency: supplied.currency,
        activityName: name, checkedAt: new Date().toISOString(), note: "Entered by a trip member; not independently verified." },
    };
  }
  return { estimatedCost: null, pricing: unavailablePrice(name, null) };
}

export function clearGeneratedPriceGuesses<T>(itinerary: T): T {
  const plan = itinerary as { days?: Array<{ activities?: Array<Record<string, unknown>> }> };
  for (const day of plan.days ?? []) {
    for (const activity of day.activities ?? []) {
      activity.estimatedCost = null;
      activity.pricing = unavailablePrice(String(activity.name ?? ""), null);
    }
  }
  return itinerary;
}
