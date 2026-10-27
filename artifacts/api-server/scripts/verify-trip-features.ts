/**
 * Isolated Firebase/API smoke fixtures. Never reads or changes real trips.
 * pnpm exec tsx scripts/verify-trip-features.ts setup|verify|cleanup
 * Credentials are written mode 0600 under /tmp, never to source or stdout.
 */
import { getAuth } from "firebase-admin/auth";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, rm } from "node:fs/promises";
import assert from "node:assert/strict";
import { getAdminApp, getAdminDb } from "../src/lib/firebase-admin";

const file = "/tmp/packyo-trip-feature-qa.json";
const admin = getAuth(getAdminApp()), db = getAdminDb();
const mode = process.argv[2];
if (mode === "setup") {
  const suffix = randomUUID().slice(0, 8);
  const accounts: Array<{ uid: string; email: string; password: string; token: string }> = [];
  const config = await readFile("../gopack-mobile/lib/firebase.ts", "utf8");
  const apiKey = config.match(/apiKey: "([^"]+)"/)?.[1];
  assert.ok(apiKey);
  for (const role of ["Host", "Member", "Outsider"]) {
    const email = `packyo-qa-${role.toLowerCase()}-${suffix}@example.invalid`;
    const password = `QAx!${randomUUID()}`;
    const user = await admin.createUser({ email, password, emailVerified: true, displayName: `QA ${role}` });
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    const result = await response.json() as { idToken?: string };
    assert.ok(result.idToken, "Test account could not sign in");
    accounts.push({ uid: user.uid, email, password, token: result.idToken });
  }
  const tripId = `qa-trip-${suffix}`, tieTripId = `qa-tie-${suffix}`, apiTripId = `qa-api-${suffix}`, reviewId = `qa-review-${suffix}`;
  const members = Object.fromEntries(accounts.slice(0, 2).map((a, i) => [a.uid, { name: i ? "QA Member" : "QA Host", joinedAt: new Date().toISOString(), isHost: !i }]));
  const startDate = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
  const stay = { id: "qa-stay", name: "QA London House", type: "hotel", location: "Central London",
    totalCost: 400, costPerPerson: 200, nights: 2, rating: 4.5, amenities: ["Wi-Fi"], rooms: 1, beds: 2,
    cancellation: "Flexible", whyItFits: "Test stay", tags: ["Central"], distanceNote: "Near the museum", submittedBy: "QA Host" };
  const activities = [
    { id: "qa-act1", time: "10:00", name: "British Museum", description: "Discover the collections.", tag: "Relaxing", fromWish: true, suggester: "QA Host", estimatedCost: 0, labels: [], nearPrevious: true },
    { id: "qa-act2", time: "14:00", name: "National Gallery", description: "Explore art.", tag: "Culture", fromWish: false, suggester: "AI pick", estimatedCost: 0, labels: [], nearPrevious: true },
  ];
  const base = { destination: "London, United Kingdom", days: 2, budget: "midrange", currency: "GBP", vibes: ["Culture", "Relaxing"],
    startDate, members, hostMemberId: accounts[0].uid, createdAt: new Date().toISOString(),
    itinerary: { title: "QA London escape", days: [{ dayNumber: 1, city: "London", theme: "Explore", activities }] },
    wishes: { initial: { text: "British Museum", authorId: accounts[0].uid, authorName: "QA Host", createdAt: Date.now() } },
  };
  const review = { destination: base.destination, days: 2, rating: 5, highlight: "Museums", text: "QA temporary trip", photos: [],
    memberNames: ["QA Host", "QA Member"], reviewedAt: new Date().toISOString(), vibes: base.vibes,
    itineraryDays: [{ day: 1, city: "London", theme: "Explore", activities: activities.map(a => ({ name: a.name, time: a.time, category: a.tag, description: a.description, estimatedCost: a.estimatedCost })) }],
    confirmedAccommodation: stay, isPublic: true };
  const votes = Object.fromEntries(Object.keys(members).map(uid => [uid, "up"]));
  const changes: Record<string, unknown> = {
    [`trips/${tripId}`]: { ...base, accommodationStatus: "collecting_prefs" },
    [`trips/${apiTripId}`]: base,
    [`trips/${tieTripId}`]: { ...base, accommodationStatus: "voting",
      accommodationSuggestions: [stay, { ...stay, id: "qa-stay2", name: "QA Museum Hotel", costPerPerson: 180, totalCost: 360 }],
      accommodationVotes: { 0: votes, 1: votes }, accommodationLockedBy: Object.fromEntries(Object.keys(members).map(uid => [uid, true])) },
    [`reviews/${reviewId}`]: review,
  };
  for (const account of accounts.slice(0, 2)) for (const id of [tripId, tieTripId, apiTripId]) changes[`userTrips/${account.uid}/${id}`] = true;
  await db.ref().update(changes);
  await writeFile(file, JSON.stringify({ accounts, tripId, tieTripId, apiTripId, reviewId, apiKey,
    previewUrl: `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`, apiUrl: `https://${process.env.REPLIT_DEV_DOMAIN}/api` }), { mode: 0o600 });
  console.log("Temporary QA fixtures ready. Credentials stored privately under /tmp.");
} else if (mode === "verify") {
  const qa = JSON.parse(await readFile(file, "utf8"));
  const [host, member, outsider] = qa.accounts;
  assert.match(qa.apiTripId, /^qa-api-/);
  await db.ref(`privateTripExpenseLedgers/${qa.apiTripId}`).remove();
  await db.ref(`trips/${qa.apiTripId}/members/${member.uid}`).set({ name: "QA Member", isHost: false, joinedAt: new Date().toISOString() });
  const path = `/trips/${qa.apiTripId}/expenses`;
  async function request(route: string, token?: string, method = "GET", body?: unknown, key?: string) {
    const response = await fetch(`${qa.apiUrl}${route}`, { method, headers: {
      "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { "Idempotency-Key": key } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, "forged")).status, 401);
  assert.equal((await request(path, outsider.token)).status, 403);
  const body = { title: "QA meal", amountMinor: 1001, currency: "GBP", category: "Food", date: "2026-10-27",
    payerId: host.uid, participantIds: [host.uid, member.uid], splitMethod: "equal" };
  const key = randomUUID();
  const first = await request(path, host.token, "POST", body, key);
  assert.equal(first.status, 201);
  assert.equal(first.data.totalMinor, 1001);
  const repeated = await request(path, host.token, "POST", body, key);
  assert.equal(repeated.data.expenses.length, 1, "Idempotent repeat duplicated an expense");
  assert.equal((await request(path, member.token)).status, 200);
  const e = first.data.expenses[0];
  const epath = `${path}/${e.id}`;
  assert.equal((await request(epath, member.token, "PUT", { ...body, revision: e.revision })).status, 403);
  assert.equal((await request(epath, host.token, "PUT", { ...body, revision: 0 })).status, 409);
  assert.equal((await request(path, host.token, "POST", { ...body, currency: "EUR" })).status, 400);
  assert.equal((await request(path, host.token, "POST", { ...body, splitMethod: "custom", shares: { [host.uid]: 1, [member.uid]: 1 } })).status, 400);
  const edited = await request(epath, host.token, "PUT", { ...body, title: "QA updated meal", revision: e.revision });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.expenses[0].revision, 2);
  const repayment = edited.data.repayments[0];
  const settlement = await request(`/trips/${qa.apiTripId}/settlements`, member.token, "POST", {
    ...repayment, currency: "GBP", date: "2026-10-27",
  }, randomUUID());
  assert.equal(settlement.status, 201);
  assert.ok(settlement.data.members.every((m: { balanceMinor: number }) => m.balanceMinor === 0));
  await db.ref(`trips/${qa.apiTripId}/members/${member.uid}`).remove();
  assert.equal((await request(path, member.token)).status, 403, "Departed member retained financial access");
  const retained = await request(path, host.token);
  assert.equal(retained.data.members.find((m: { id: string }) => m.id === member.uid).isCurrentMember, false);
  const removed = await request(epath, host.token, "DELETE", { revision: 2 });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.expenses.length, 0);
  const raw = (await db.ref(`privateTripExpenseLedgers/${qa.apiTripId}`).get()).val();
  assert.ok(raw.expenses[e.id].deletedAt);
  assert.equal(Object.keys(raw.history).length, 4, "Immutable financial history missing");
  const direct = await fetch(`${getAdminApp().options.databaseURL}/privateTripExpenseLedgers/${qa.apiTripId}.json?auth=${encodeURIComponent(outsider.token)}`);
  assert.equal(direct.status, 401, "Private ledger leaked via direct Firebase access");
  console.log("PASS: authenticated/member-only API, direct database denial, exact balances, idempotency, custom split validation, currency lock, edit permissions/conflicts, settlements, former-member obligations, soft deletion and audit history.");
} else if (mode === "cleanup") {
  const qa = JSON.parse(await readFile(file, "utf8"));
  const changes: Record<string, null> = { [`reviews/${qa.reviewId}`]: null };
  for (const id of [qa.tripId, qa.tieTripId, qa.apiTripId]) {
    changes[`trips/${id}`] = null;
    changes[`privateTripExpenseLedgers/${id}`] = null;
  }
  for (const account of qa.accounts) changes[`userTrips/${account.uid}`] = null;
  await db.ref().update(changes);
  await Promise.all(qa.accounts.map((a: { uid: string }) => admin.deleteUser(a.uid)));
  await rm(file);
  console.log("Temporary QA users, trips, public review and private ledgers removed.");
} else throw new Error("Choose setup, verify or cleanup.");
process.exit(0);
