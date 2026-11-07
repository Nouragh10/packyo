// Development-only integration check. Creates and removes its own Firebase fixtures.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { getAuth } from "firebase-admin/auth";
import { deleteApp } from "firebase-admin/app";
import { getAdminApp, getAdminDb } from "../src/lib/firebase-admin";

const domain = process.env.REPLIT_DEV_DOMAIN;
if (!domain?.endsWith(".replit.dev")) throw new Error("Run only against the development preview.");
const uid = `price-qa-${randomUUID()}`;
const tripId = `price-qa-${randomUUID()}`;
const reviewId = `${tripId}_${uid}`;
const db = getAdminDb();
const auth = getAuth(getAdminApp());
const base = `https://${domain}/api`;
let userCreated = false;
try {
  await auth.createUser({ uid, displayName: "Pricing QA fixture" });
  userCreated = true;
  const config = readFileSync(new URL("../../gopack-web/src/lib/firebase.ts", import.meta.url), "utf8");
  const apiKey = config.match(/apiKey:\s*['"]([^'"]+)/)?.[1];
  assert.ok(apiKey, "Public Firebase client configuration is available");
  const login = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: await auth.createCustomToken(uid), returnSecureToken: true }),
  });
  assert.equal(login.status, 200, "Fixture custom-token sign-in");
  const { idToken } = await login.json() as { idToken: string };
  assert.ok(idToken);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` };
  await db.ref(`trips/${tripId}`).set({
    destination: "London", days: 1, qaFixture: true,
    members: { [uid]: { name: "Pricing QA fixture" } },
    itinerary: { title: "Pricing QA", days: [{
      dayNumber: 1, city: "London", activities: [{
        name: "British Museum", time: "10:00 AM", tag: "culture",
        description: "Visit the permanent collection.", estimatedCost: 999, sentinel: "preserve",
      }],
    }] },
  });
  const noAuth = await fetch(`${base}/trips/${tripId}/activity-prices`, { method: "POST" });
  assert.equal(noAuth.status, 401);
  const checked = await fetch(`${base}/trips/${tripId}/activity-prices`, {
    method: "POST", headers, body: "{}", signal: AbortSignal.timeout(180_000),
  });
  assert.equal(checked.status, 200, "Authenticated member can check prices");
  const counts = await checked.json() as { checked: number; verified: number; remaining: number };
  assert.equal(counts.checked, 1);
  assert.equal(counts.verified, 1, "British Museum permanent-collection admission is source-backed");
  const trip = (await db.ref(`trips/${tripId}`).get()).val();
  const activity = trip.itinerary.days[0].activities[0];
  assert.equal(activity.pricing.status, "verified");
  assert.equal(activity.pricing.amount, 0);
  assert.match(activity.pricing.sourceUrl, /^https:\/\/(?:www\.)?britishmuseum\.org\//);
  assert.equal(activity.sentinel, "preserve");
  assert.equal(activity.name, "British Museum");
  assert.equal(activity.description, "Visit the permanent collection.");
  assert.equal(trip.qaFixture, true);
  const cached = await fetch(`${base}/trips/${tripId}/activity-prices`, { method: "POST", headers, body: "{}" });
  const cachedResult = await cached.json() as { checked: number; remaining: number };
  assert.equal(cached.status, 200);
  assert.equal(cachedResult.checked, 0, "Fresh sources do not trigger another lookup");
  await db.ref(`trips/${tripId}/members/${uid}`).remove();
  assert.equal((await fetch(`${base}/trips/${tripId}/activity-prices`, { method: "POST", headers, body: "{}" })).status, 403);
  await db.ref(`reviews/${reviewId}`).set({ isPublic: false, destination: "London" });
  assert.equal((await fetch(`${base}/reviews/${reviewId}/activity-prices`, { method: "POST", headers, body: "{}" })).status, 404);
  process.stdout.write("PASS: member authorization, live official free-admission source, isolated persistence, cache reuse, removed-member denial and private-review protection.\n");
} finally {
  await Promise.all([
    db.ref(`trips/${tripId}`).remove(),
    db.ref(`reviews/${reviewId}`).remove(),
    db.ref(`privateActivityPriceUsage/${uid}`).remove(),
    db.ref(`privateActivityPriceLocks/${createHash("sha256").update(`trips/${tripId}`).digest("hex")}`).remove(),
  ]);
  if (userCreated) await auth.deleteUser(uid);
  await deleteApp(getAdminApp());
}
