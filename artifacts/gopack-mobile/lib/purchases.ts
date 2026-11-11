// In-app purchases for itinerary unlocks, through RevenueCat.
//
//   group    $3.99 – one member pays, the itinerary unlocks for the whole trip
//   personal $2.99 – unlocks the itinerary just for the member who paid
//
// Both are consumable App Store / Play products, so they can be bought once per trip.
// The purchase is confirmed by our API (which checks RevenueCat) before anything unlocks.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export type UnlockKind = "group" | "personal";

export const UNLOCK_PRODUCTS: Record<UnlockKind, string> = {
  group: "itinerary_group_unlock_399",
  personal: "itinerary_personal_unlock_299",
};

export const FALLBACK_PRICES: Record<UnlockKind, string> = { group: "$3.99", personal: "$2.99" };

type PurchasesModule = typeof import("react-native-purchases").default;
type StoreProduct = import("react-native-purchases").PurchasesStoreProduct;

let purchases: PurchasesModule | null | undefined;
let configuredFor: string | null = null;

function sdk(): PurchasesModule | null {
  if (purchases !== undefined) return purchases;
  purchases = null;
  if (Platform.OS === "web") return null; // web build has no App Store / Play billing
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    purchases = require("react-native-purchases").default as PurchasesModule;
  } catch {
    purchases = null; // e.g. Expo Go without the native module
  }
  return purchases;
}

function apiKey(): string | undefined {
  if (Platform.OS === "ios") return process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
  if (Platform.OS === "android") return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;
  return undefined;
}

export function purchasesAvailable(): boolean {
  return !!sdk() && !!apiKey();
}

/** Configure once, identified by the Firebase uid so RevenueCat and our server agree on who paid. */
export async function ensurePurchases(uid: string): Promise<PurchasesModule> {
  const P = sdk();
  const key = apiKey();
  if (!P || !key) throw new Error("Payments aren't available on this device.");
  if (configuredFor === uid) return P;
  if (configuredFor === null && !(await P.isConfigured())) {
    P.configure({ apiKey: key, appUserID: uid });
  } else {
    await P.logIn(uid);
  }
  configuredFor = uid;
  return P;
}

export async function loadUnlockProducts(uid: string): Promise<Partial<Record<UnlockKind, StoreProduct>>> {
  const P = await ensurePurchases(uid);
  const list = await P.getProducts(Object.values(UNLOCK_PRODUCTS), P.PRODUCT_CATEGORY.NON_SUBSCRIPTION);
  const out: Partial<Record<UnlockKind, StoreProduct>> = {};
  for (const kind of Object.keys(UNLOCK_PRODUCTS) as UnlockKind[]) {
    const p = list.find((x) => x.identifier === UNLOCK_PRODUCTS[kind]);
    if (p) out[kind] = p;
  }
  return out;
}

export class PurchaseCancelled extends Error {}

/** Runs the store purchase sheet. Returns the store transaction id to send to our API. */
export async function buyUnlock(uid: string, product: StoreProduct): Promise<string> {
  const P = await ensurePurchases(uid);
  try {
    const { transaction } = await P.purchaseStoreProduct(product);
    return transaction.transactionIdentifier;
  } catch (e) {
    const err = e as { userCancelled?: boolean | null; code?: string };
    if (err?.userCancelled || err?.code === P.PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) throw new PurchaseCancelled();
    throw e;
  }
}

// A paid-but-not-yet-recorded purchase is kept on the device so it can be retried
// (e.g. the app closed or the network dropped right after paying).
const pendingKey = (tripId: string) => `packyo:pendingUnlock:${tripId}`;
export type PendingUnlock = { kind: UnlockKind; transactionId: string };

export async function savePendingUnlock(tripId: string, p: PendingUnlock) {
  try { await AsyncStorage.setItem(pendingKey(tripId), JSON.stringify(p)); } catch { /* best effort */ }
}
export async function getPendingUnlock(tripId: string): Promise<PendingUnlock | null> {
  try {
    const raw = await AsyncStorage.getItem(pendingKey(tripId));
    return raw ? (JSON.parse(raw) as PendingUnlock) : null;
  } catch { return null; }
}
export async function clearPendingUnlock(tripId: string) {
  try { await AsyncStorage.removeItem(pendingKey(tripId)); } catch { /* best effort */ }
}
