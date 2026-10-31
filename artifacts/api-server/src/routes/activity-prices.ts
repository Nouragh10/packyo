import { Router, type IRouter } from "express";
import { createHash, randomUUID } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { needsActivityPriceCheck, type ActivityPricing } from "@workspace/activity-pricing";
import { VerifyTripActivityPricesBody } from "@workspace/api-zod";
import { getAdminApp, getAdminDb } from "../lib/firebase-admin";
import { validId } from "../lib/expenses";
import { verifyActivityPrices, type PriceTarget } from "../lib/activity-prices";

const router: IRouter = Router();
type StoredActivity = Record<string, unknown> & { name: string; pricing?: ActivityPricing; estimatedCost?: number | null };
type Entry = { path: string; index: number; activity: StoredActivity; target: PriceTarget };
const signature = (activity: StoredActivity) => JSON.stringify([
  activity.name, activity.description ?? null, activity.tag ?? null, activity.time ?? null,
  activity.estimatedCost ?? null,
  activity.pricing?.status ?? null, activity.pricing?.amount ?? null, activity.pricing?.currency ?? null,
  activity.pricing?.sourceUrl ?? null, activity.pricing?.checkedAt ?? null,
]);
class PriceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

router.post(["/trips/:tripId/activity-prices", "/reviews/:reviewId/activity-prices"], async (req, res) => {
  let release: (() => Promise<void>) | undefined;
  try {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new PriceError("Sign in to verify activity prices.", 401);
    let uid: string;
    try { uid = (await getAuth(getAdminApp()).verifyIdToken(token, true)).uid; }
    catch { throw new PriceError("Your sign-in expired. Please sign in again.", 401); }
    const parsed = VerifyTripActivityPricesBody.safeParse(req.body ?? {});
    if (!parsed.success) throw new PriceError("Invalid price-check request.", 400);
    const cursor = parsed.data.cursor ?? 0;
    const force = parsed.data.force === true;
    const isReview = Boolean(req.params.reviewId);
    const id = String(isReview ? req.params.reviewId : req.params.tripId);
    if (!validId(id)) throw new PriceError("Invalid itinerary.", 400);
    const db = getAdminDb();
    const root = `${isReview ? "reviews" : "trips"}/${id}`;
    const recordRef = db.ref(root);
    const record = (await recordRef.get()).val();
    if (!record || (isReview && record.isPublic === false)) throw new PriceError("Public itinerary not found.", 404);
    if (!isReview && !record.members?.[uid]) throw new PriceError("Only current trip members can verify these activity prices.", 403);
    const daysPath = isReview && Object.keys(record.itineraryDays ?? {}).length > 0 ? "itineraryDays" : "itinerary/days";
    const days = daysPath === "itineraryDays" ? record.itineraryDays : record.itinerary?.days;
    const entries: Entry[] = [];
    for (const [dayKey, day] of Object.entries(days ?? {}) as Array<[string, any]>) {
      for (const [activityKey, raw] of Object.entries(day?.activities ?? {})) {
        if (!raw || typeof raw !== "object" || typeof (raw as StoredActivity).name !== "string") continue;
        const activity = raw as StoredActivity;
        entries.push({
          path: `${root}/${daysPath}/${dayKey}/activities/${activityKey}`,
          index: entries.length, activity,
          target: { name: activity.name, city: typeof day.city === "string" ? day.city : record.destination ?? "", tag: String(activity.tag ?? activity.category ?? "") },
        });
      }
    }
    const pending = entries.slice(cursor).filter((entry) => force || needsActivityPriceCheck(entry.activity));
    const selected = pending.slice(0, 10);
    if (selected.length === 0) {
      res.json({ checked: 0, verified: 0, unavailable: 0, remaining: 0, nextCursor: null });
      return;
    }
    const lockKey = createHash("sha256").update(root).digest("hex");
    const leaseRef = db.ref(`privateActivityPriceLocks/${lockKey}`);
    const owner = randomUUID();
    const now = Date.now();
    const lease = await leaseRef.transaction((current) => {
      if (current?.expiresAt > now) return undefined;
      return { owner, expiresAt: now + 125_000 };
    });
    if (!lease.committed || lease.snapshot.val()?.owner !== owner) {
      res.json({ checked: 0, verified: 0, unavailable: 0, remaining: pending.length, nextCursor: cursor, busy: true });
      return;
    }
    release = async () => {
      await leaseRef.transaction((current) => {
        if (current === null) return null;
        return current.owner === owner ? null : undefined;
      });
    };
    const usageRef = db.ref(`privateActivityPriceUsage/${uid}`);
    const window = Math.floor(now / 60_000);
    const usage = await usageRef.transaction((current) => {
      if (current?.window === window && current.count >= 10) return undefined;
      return { window, count: current?.window === window ? Number(current.count) + 1 : 1 };
    });
    if (!usage.committed) throw new PriceError("Too many price checks. Please wait a minute and try again.", 429);
    const prices = await verifyActivityPrices(
      selected.map((entry) => entry.target), String(record.destination ?? ""),
      typeof record.startDate === "string" ? record.startDate : undefined,
    );
    const currentRecord = (await recordRef.get()).val();
    if (!currentRecord || (isReview && currentRecord.isPublic === false)) throw new PriceError("Itinerary is no longer public.", 404);
    if (!isReview && !currentRecord.members?.[uid]) throw new PriceError("You are no longer a member of this trip.", 403);
    let checked = 0, verified = 0;
    for (const [index, entry] of selected.entries()) {
      const price = prices[index]!;
      const activityRef = db.ref(entry.path);
      await activityRef.get();
      const result = await activityRef.transaction((current) => {
        if (current === null) return null;
        if (signature(current) !== signature(entry.activity)) return undefined;
        return { ...current, pricing: price, estimatedCost: price.status === "verified" ? price.amount : null };
      });
      if (result.committed && result.snapshot.exists()) {
        checked++;
        if (price.status === "verified") verified++;
      }
    }
    const remaining = pending.length - selected.length;
    res.json({
      checked, verified, unavailable: checked - verified, remaining,
      nextCursor: remaining > 0 ? selected[selected.length - 1]!.index + 1 : null,
    });
  } catch (error) {
    const status = error instanceof PriceError ? error.status : 503;
    if (status === 503) req.log.warn({ error: error instanceof Error ? error.message : "unknown" }, "Activity price verification unavailable");
    res.status(status).json({ error: error instanceof PriceError ? error.message : "Price sources are temporarily unavailable. Please try again." });
  } finally {
    if (release) await release().catch(() => req.log.warn({}, "Activity pricing lease cleanup failed; it will expire"));
  }
});

export default router;
