// Pay-per-itinerary unlocks.
//
// Two one-time (consumable) App Store / Play products, bought through RevenueCat:
//   group    – one member pays and the whole trip's itinerary unlocks for everyone
//   personal – unlocks the itinerary only for the member who paid
//
// The app never writes the unlock itself. After a purchase it sends us the store
// transaction id; we confirm with RevenueCat that this user really bought that
// product, make sure the transaction hasn't been used for another trip, and only
// then record the unlock under a root that has no client read/write grant.

export const UNLOCK_ROOT = "itineraryUnlocks";
export const CLAIM_ROOT = "itineraryUnlockClaims";

export const UNLOCK_PRODUCTS = {
  group: "itinerary_group_unlock_399",
  personal: "itinerary_personal_unlock_299",
} as const;

export type UnlockKind = keyof typeof UNLOCK_PRODUCTS;

export type TripUnlocks = {
  group?: { uid: string; name?: string; at: string };
  members?: Record<string, { at: string }>;
};

export type ItineraryAccess = {
  unlocked: boolean;
  via: "group" | "personal" | null;
  groupUnlockedBy: string | null;
};

export class UnlockError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function isUnlockKind(v: unknown): v is UnlockKind {
  return v === "group" || v === "personal";
}

export function accessFor(unlocks: TripUnlocks | null | undefined, uid: string): ItineraryAccess {
  if (unlocks?.group) return { unlocked: true, via: "group", groupUnlockedBy: unlocks.group.name ?? null };
  if (unlocks?.members?.[uid]) return { unlocked: true, via: "personal", groupUnlockedBy: null };
  return { unlocked: false, via: null, groupUnlockedBy: null };
}

/** Firebase keys can't contain . # $ [ ] / */
export function claimKey(transactionId: string): string {
  return transactionId.replace(/[.#$[\]/]/g, "_");
}

export function validTransactionId(v: unknown): v is string {
  return typeof v === "string" && v.length >= 1 && v.length <= 200 && /^[A-Za-z0-9._:\-]+$/.test(v);
}

type RcNonSubscription = { id?: string; store_transaction_id?: string };
type RcSubscriberResponse = { subscriber?: { non_subscriptions?: Record<string, RcNonSubscription[]> } };

/** True when RevenueCat's record for this user lists the transaction under the product. */
export function purchaseListed(body: RcSubscriberResponse, productId: string, transactionId: string): boolean {
  const list = body.subscriber?.non_subscriptions?.[productId] ?? [];
  return list.some((p) => p.store_transaction_id === transactionId || p.id === transactionId);
}

export async function verifyWithRevenueCat(
  uid: string,
  kind: UnlockKind,
  transactionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  // The v1 subscriber endpoint needs a v1 secret key (Project settings → API keys → Secret).
  const key = process.env.REVENUECAT_V1_SECRET_KEY ?? process.env.REVENUECAT_SECRET_KEY;
  if (!key) throw new UnlockError("Payments aren't configured on the server yet.", 503);
  const res = await fetchImpl(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) throw new UnlockError("Couldn't confirm the purchase right now. Please try again.", 502);
  return purchaseListed((await res.json()) as RcSubscriberResponse, UNLOCK_PRODUCTS[kind], transactionId);
}
