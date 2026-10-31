export type ActivityPricing = {
  status: "verified" | "unavailable" | "user_entered";
  amount: number | null;
  currency: string | null;
  priceType?: "fixed" | "from" | "range" | "free";
  maxAmount?: number | null;
  scope?: "admission" | "tour" | "menu_item" | "transport" | "other";
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  evidence?: string | null;
  checkedAt: string | null;
  activityName?: string;
  note?: string;
};

type PricedActivity = { name?: string; estimatedCost?: number | null; pricing?: ActivityPricing | null };
export const PRICE_FRESH_MS = 24 * 60 * 60 * 1000;
export const PRICE_RETRY_MS = 30 * 60 * 1000;
const nameKey = (value?: string) => (typeof value === "string" ? value : "").normalize("NFKC").trim().toLocaleLowerCase();

export function safePriceSource(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    if (!url.hostname.includes(".") || /(^|\.)localhost$|\.local$|^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function validPriceCurrency(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) return false;
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  return !supported || supported("currency").includes(value) || value === "CLF" || value === "UYW";
}

export function formatActivityMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "code" }).format(amount);
}

export function isVerifiedActivityPrice(activity: PricedActivity, now = Date.now()): boolean {
  const p = activity.pricing;
  if (!p || p.status !== "verified" || !safePriceSource(p.sourceUrl) ||
      typeof p.evidence !== "string" || !p.evidence || typeof p.checkedAt !== "string") return false;
  const age = now - Date.parse(p.checkedAt);
  if (!Number.isFinite(age) || age < -60_000 || age >= PRICE_FRESH_MS) return false;
  if (p.activityName && nameKey(p.activityName) !== nameKey(activity.name)) return false;
  if (typeof p.amount !== "number" || !Number.isFinite(p.amount) || p.amount < 0) return false;
  if (p.priceType === "free") return p.amount === 0;
  if (!validPriceCurrency(p.currency)) return false;
  return p.priceType !== "range" || (typeof p.maxAmount === "number" && Number.isFinite(p.maxAmount) && p.maxAmount >= p.amount);
}

export function activityPricePresentation(activity: PricedActivity, now = Date.now()) {
  const p = activity.pricing;
  if (isVerifiedActivityPrice(activity, now) && p) {
    const amount = p.amount!;
    const label = p.priceType === "free"
      ? p.scope === "admission" ? "Free admission" : "Free"
      : p.priceType === "range"
        ? `${formatActivityMoney(amount, p.currency!)} – ${formatActivityMoney(p.maxAmount!, p.currency!)}`
        : `${p.priceType === "from" ? "From " : ""}${formatActivityMoney(amount, p.currency!)}`;
    return {
      label, verified: true, sourceUrl: safePriceSource(p.sourceUrl), sourceTitle: p.sourceTitle || "Price source",
      checkedAt: p.checkedAt, note: p.note || (p.scope === "menu_item" ? "Listed menu item, not a full meal." : "Listed per-person price; check the source for dates and fees."),
    };
  }
  if (p?.status === "user_entered" && typeof p.amount === "number" && Number.isFinite(p.amount) && p.amount >= 0 && validPriceCurrency(p.currency)) {
    return { label: `${formatActivityMoney(p.amount, p.currency)} · user-entered`, verified: false, sourceUrl: null, sourceTitle: null, checkedAt: p.checkedAt, note: "Not independently verified." };
  }
  return {
    label: p?.status === "verified" ? "Price needs refresh" : "Price unavailable",
    verified: false, sourceUrl: safePriceSource(p?.sourceUrl), sourceTitle: p?.sourceTitle || null,
    checkedAt: p?.checkedAt || null, note: p?.note || "No current source-backed price is available.",
  };
}

export function needsActivityPriceCheck(activity: PricedActivity, now = Date.now()): boolean {
  if (isVerifiedActivityPrice(activity, now)) return false;
  const p = activity.pricing;
  if (p?.activityName && nameKey(p.activityName) !== nameKey(activity.name)) return true;
  if (p?.status === "unavailable" && p.checkedAt) {
    const age = now - Date.parse(p.checkedAt);
    if (Number.isFinite(age) && age >= 0 && age < PRICE_RETRY_MS) return false;
  }
  return true;
}

/** Never add different currencies, unsourced guesses, or stays to activity totals. */
export function summarizeActivityPrices(activities: PricedActivity[], now = Date.now()) {
  const sums = new Map<string, number>();
  let verifiedCount = 0;
  let hasFromPrices = false;
  for (const activity of activities) {
    if (!isVerifiedActivityPrice(activity, now)) continue;
    verifiedCount++;
    const p = activity.pricing!;
    if (p.priceType === "from" || p.priceType === "range") hasFromPrices = true;
    if (p.currency) sums.set(p.currency, (sums.get(p.currency) ?? 0) + p.amount!);
  }
  return {
    totals: [...sums].map(([currency, amount]) => ({ currency, amount, label: formatActivityMoney(amount, currency) })),
    verifiedCount, unknownCount: activities.length - verifiedCount, hasFromPrices,
  };
}
