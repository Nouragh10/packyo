import { Router, type IRouter, type Request } from "express";
import { getAuth } from "firebase-admin/auth";
import { getAdminApp, getAdminDb } from "../lib/firebase-admin";
import { logger } from "../lib/logger";
import {
  CLAIM_ROOT, UNLOCK_ROOT, UnlockError, accessFor, claimKey, isUnlockKind, validTransactionId, verifyWithRevenueCat,
  type TripUnlocks,
} from "../lib/itinerary-unlock";

const router: IRouter = Router();

type TripMembers = Record<string, { name?: string }>;

async function memberContext(req: Request) {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new UnlockError("Sign in to unlock the itinerary.", 401);
  let uid: string;
  try {
    uid = (await getAuth(getAdminApp()).verifyIdToken(token, true)).uid;
  } catch {
    throw new UnlockError("Your sign-in expired. Please sign in again.", 401);
  }
  const tripId = String(req.params.tripId);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(tripId)) throw new UnlockError("Invalid trip.");
  const db = getAdminDb();
  const members = (await db.ref(`trips/${tripId}/members`).get()).val() as TripMembers | null;
  if (!members?.[uid]) throw new UnlockError("Only members of this trip can unlock its itinerary.", 403);
  return { uid, tripId, db, members };
}

function sendError(res: import("express").Response, err: unknown) {
  if (err instanceof UnlockError) { res.status(err.status).json({ error: err.message }); return; }
  logger.error({ err }, "itinerary unlock error");
  res.status(500).json({ error: "Something went wrong. Please try again." });
}

// Who can see the full itinerary?
router.get("/trips/:tripId/itinerary-access", async (req, res) => {
  try {
    const { uid, tripId, db } = await memberContext(req);
    const unlocks = (await db.ref(`${UNLOCK_ROOT}/${tripId}`).get()).val() as TripUnlocks | null;
    res.json(accessFor(unlocks, uid));
  } catch (err) { sendError(res, err); }
});

// Record a purchase made in the app. Body: { kind: "group" | "personal", transactionId }
router.post("/trips/:tripId/itinerary-unlock", async (req, res) => {
  try {
    const { uid, tripId, db, members } = await memberContext(req);
    const { kind, transactionId } = (req.body ?? {}) as { kind?: unknown; transactionId?: unknown };
    if (!isUnlockKind(kind)) throw new UnlockError("Choose the group or personal unlock.");
    if (!validTransactionId(transactionId)) throw new UnlockError("Missing purchase details.");

    if (!(await verifyWithRevenueCat(uid, kind, transactionId))) {
      throw new UnlockError("We couldn't find that purchase yet. Give it a moment and tap Restore.", 402);
    }

    // One transaction unlocks one trip, once. Retrying the same claim for the same trip is fine.
    const claimRef = db.ref(`${CLAIM_ROOT}/${claimKey(transactionId)}`);
    const claim = await claimRef.transaction((cur: { uid: string; tripId: string; kind: string } | null) => {
      if (cur) return cur.uid === uid && cur.tripId === tripId && cur.kind === kind ? cur : undefined;
      return { uid, tripId, kind, at: new Date().toISOString() };
    });
    if (!claim.committed) throw new UnlockError("This purchase was already used to unlock another trip.", 409);

    const at = new Date().toISOString();
    if (kind === "group") {
      await db.ref(`${UNLOCK_ROOT}/${tripId}/group`).transaction((cur) => cur ?? { uid, name: members[uid]?.name ?? null, at });
    } else {
      await db.ref(`${UNLOCK_ROOT}/${tripId}/members/${uid}`).transaction((cur) => cur ?? { at });
    }
    const unlocks = (await db.ref(`${UNLOCK_ROOT}/${tripId}`).get()).val() as TripUnlocks | null;
    res.json(accessFor(unlocks, uid));
  } catch (err) { sendError(res, err); }
});

export default router;
