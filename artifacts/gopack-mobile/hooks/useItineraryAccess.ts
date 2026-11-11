import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { track } from "@/lib/analytics";
import {
  buyUnlock, clearPendingUnlock, getPendingUnlock, loadUnlockProducts, savePendingUnlock, purchasesAvailable,
  FALLBACK_PRICES, PurchaseCancelled, type UnlockKind,
} from "@/lib/purchases";

export type ItineraryAccess = { unlocked: boolean; via: "group" | "personal" | null; groupUnlockedBy: string | null };
type TokenUser = { uid: string; getIdToken: () => Promise<string> };

async function call(user: TokenUser, path: string, init?: RequestInit): Promise<ItineraryAccess> {
  const res = await apiFetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json", Accept: "application/json" },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && typeof body.error === "string" && body.error) || `Request failed (${res.status}).`);
  return body as ItineraryAccess;
}

/** Itinerary paywall state: who can see the full itinerary, store prices, and the buy flow. */
export function useItineraryAccess(tripId: string | undefined, user: TokenUser | null) {
  const [access, setAccess] = useState<ItineraryAccess | null>(null);
  const [prices, setPrices] = useState<Record<UnlockKind, string>>(FALLBACK_PRICES);
  const [busy, setBusy] = useState<UnlockKind | "restore" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const claim = useCallback(async (kind: UnlockKind, transactionId: string) => {
    if (!user || !tripId) return;
    const next = await call(user, `/api/trips/${tripId}/itinerary-unlock`, { method: "POST", body: JSON.stringify({ kind, transactionId }) });
    await clearPendingUnlock(tripId);
    setAccess(next);
  }, [user, tripId]);

  const refresh = useCallback(async () => {
    if (!user || !tripId) return;
    try {
      const current = await call(user, `/api/trips/${tripId}/itinerary-access`);
      setAccess(current);
      // Paid earlier but the unlock never got recorded? Finish it now.
      const pending = current.unlocked ? null : await getPendingUnlock(tripId);
      if (pending) await claim(pending.kind, pending.transactionId);
    } catch (e) {
      // Fail closed: keep the teaser if we can't confirm access.
      setAccess((a) => a ?? { unlocked: false, via: null, groupUnlockedBy: null });
      setError((e as Error).message);
    }
  }, [user, tripId, claim]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!user || !purchasesAvailable()) return;
    loadUnlockProducts(user.uid)
      .then((p) => setPrices({ group: p.group?.priceString ?? FALLBACK_PRICES.group, personal: p.personal?.priceString ?? FALLBACK_PRICES.personal }))
      .catch(() => { /* keep fallback prices */ });
  }, [user]);

  const unlock = useCallback(async (kind: UnlockKind) => {
    if (!user || !tripId || busy) return;
    setError(null);
    if (!purchasesAvailable()) { setError("Purchases work in the Packyo app from the App Store."); return; }
    setBusy(kind);
    try {
      const products = await loadUnlockProducts(user.uid);
      const product = products[kind];
      if (!product) throw new Error("This option isn't available right now. Please try again later.");
      const transactionId = await buyUnlock(user.uid, product);
      await savePendingUnlock(tripId, { kind, transactionId });
      await claim(kind, transactionId);
      track("itinerary_unlocked", { kind, price: prices[kind] });
    } catch (e) {
      track(e instanceof PurchaseCancelled ? "unlock_cancelled" : "unlock_failed", { kind });
      if (!(e instanceof PurchaseCancelled)) setError((e as Error).message || "Purchase failed. Please try again.");
    } finally {
      setBusy(null);
    }
  }, [user, tripId, busy, claim, prices]);

  const restore = useCallback(async () => {
    setBusy("restore"); setError(null);
    try { await refresh(); } finally { setBusy(null); }
  }, [refresh]);

  return { access, loading: access === null, prices, busy, error, unlock, restore };
}
