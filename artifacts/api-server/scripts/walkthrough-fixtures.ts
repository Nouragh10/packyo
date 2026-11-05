// Isolated recording fixtures. Never export authentication material or real user data.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getAuth } from "firebase-admin/auth";
import { deleteApp } from "firebase-admin/app";
import { getAdminApp, getAdminDb } from "../src/lib/firebase-admin";
// @ts-ignore Development-only CDP helper.
import { connectBrowser, pause } from "../../../scripts/walkthrough/cdp.mjs";

const output = new URL("../../../generated-artifacts/walkthrough/", import.meta.url);
mkdirSync(output, { recursive: true });
const manifestPath = new URL("fixtures.json", output);
if (!process.env.REPLIT_DEV_DOMAIN?.endsWith(".replit.dev")) throw new Error("Development preview only.");
const db = getAdminDb(), auth = getAuth(getAdminApp());
const cleanup = process.argv.includes("--cleanup");
try {
  if (cleanup) {
    const fixture = JSON.parse(readFileSync(manifestPath, "utf8"));
    await Promise.all([
      ...fixture.tripIds.map((id: string) => db.ref(`trips/${id}`).remove()),
      db.ref(`reviews/${fixture.reviewId}`).remove(),
      db.ref(`userTrips/${fixture.uid}`).remove(),
      ...[fixture.friend, fixture.third].map((uid: string) => db.ref(`userTrips/${uid}`).remove()),
      ...[fixture.uid, fixture.friend, fixture.third].map((uid: string) => db.ref(`notifications/${uid}`).remove()),
      db.ref(`privateActivityPriceUsage/${fixture.uid}`).remove(),
      ...fixture.tripIds.map((id: string) => db.ref(`privateTripExpenseLedgers/${id}`).remove()),
      ...[...fixture.tripIds.map((id: string) => `trips/${id}`), `reviews/${fixture.reviewId}`]
        .map((root: string) => db.ref(`privateActivityPriceLocks/${createHash("sha256").update(root).digest("hex")}`).remove()),
    ]);
    await auth.deleteUser(fixture.uid);
    console.log("Temporary recording account and fixtures removed.");
  } else if (process.argv.includes("--prepare-extras")) {
    const fixture = JSON.parse(readFileSync(manifestPath, "utf8"));
    const original = (await db.ref(`trips/${fixture.tripId}`).get()).val();
    const reuseId = `walkthrough-reuse-${randomUUID().slice(0, 8)}`;
    await db.ref(`trips/${reuseId}`).set({
      destination: "London", days: 1, startDate: original.startDate,
      vibes: ["culture", "food"], budget: "midrange", currency: "GBP",
      members: original.members, hostMemberId: fixture.uid, createdAt: new Date().toISOString(),
      packConfirmed: true, accommodationStatus: "collecting_prefs", walkthroughFixture: true,
    });
    await db.ref(`userTrips/${fixture.uid}/${reuseId}`).set(true);
    fixture.reuseId = reuseId;
    fixture.tripIds.push(reuseId);
    writeFileSync(manifestPath, JSON.stringify(fixture, null, 2));
    console.log("An empty London demo trip is ready for saved-item reuse and live generation.");
  } else {
    const suffix = randomUUID().slice(0, 8);
    const uid = `walkthrough-${suffix}`, friend = `walkthrough-friend-${suffix}`, third = `walkthrough-third-${suffix}`;
    const tripId = `walkthrough-london-${suffix}`, planningId = `walkthrough-planning-${suffix}`, pastId = `walkthrough-past-${suffix}`;
    const reviewId = `walkthrough-review-${suffix}`;
    const now = new Date(), date = now.toISOString(), future = new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10);
    await auth.createUser({ uid, displayName: "Alex Demo", email: `${uid}@example.invalid`, emailVerified: true });
    const members = {
      [uid]: { name: "Alex Demo", joinedAt: date, isHost: true },
      [friend]: { name: "Maya Demo", joinedAt: date, isHost: false },
      [third]: { name: "Sam Demo", joinedAt: date, isHost: false },
    };
    const unavailable = (name: string) => ({ status: "unavailable", amount: null, currency: null, checkedAt: date, activityName: name, note: "Price unavailable. Check the venue before booking." });
    const activity = (name: string, time: string, tag: string, description: string, suggester: string, lat: number, lng: number) => ({
      id: name.toLowerCase().replace(/\W+/g, "-"), name, time, tag, description, suggester,
      fromWish: true, labels: [tag], nearPrevious: false, estimatedCost: null,
      pricing: unavailable(name), lat, lng, photoQuery: `${name} London`,
    });
    const days = [{
      dayNumber: 1, city: "London", theme: "Culture, markets and the South Bank",
      activities: [
        activity("British Museum", "10:00 AM", "culture", "Explore the permanent collection. Special exhibitions and guided tours may require separate tickets.", "Maya Demo", 51.5194, -0.1270),
        activity("Borough Market", "1:00 PM", "food", "Browse the market and choose lunch together. Menu prices vary by stall.", "Alex Demo", 51.5055, -0.0910),
        activity("South Bank riverside walk", "4:00 PM", "relaxing", "Walk beside the Thames and enjoy views of the city.", "Sam Demo", 51.5070, -0.1150),
      ],
    }, {
      dayNumber: 2, city: "London", theme: "Royal London and neighbourhood discoveries",
      activities: [
        activity("Tower of London", "10:00 AM", "culture", "Explore the historic fortress. Check current admission and availability.", "Sam Demo", 51.5081, -0.0759),
        activity("Covent Garden", "2:00 PM", "shopping", "Explore independent shops, street performances and cafes.", "Maya Demo", 51.5117, -0.1240),
      ],
    }];
    const wishes = Object.fromEntries(days.flatMap(d => d.activities).map((a, i) => [`wish${i}`, {
      text: a.name, authorId: i % 2 ? uid : friend, authorName: a.suggester,
      upvoters: { [uid]: "Alex Demo", [friend]: "Maya Demo", [third]: "Sam Demo" }, downvoters: {}, score: 3, createdAt: now.getTime() + i,
    }]));
    const stay = {
      id: "demo-stay-one", name: "The Resident Covent Garden", type: "hotel", location: "Covent Garden, London",
      totalCost: 900, costPerPerson: 300, nights: 2, rating: 4.5, amenities: ["Wi-Fi", "Central location"],
      rooms: 2, beds: 3, cancellation: "Check the property's current terms",
      whyItFits: "Central location for the pack's cultural and food wishes. Demo option; prices are illustrative, not a booking quote.",
      tags: ["Central", "Culture"], distanceNote: "Near Covent Garden", submittedBy: uid,
      link: "https://www.residenthotels.com/the-resident-covent-garden/",
    };
    const stay2 = { ...stay, id: "demo-stay-two", name: "The Hoxton, Holborn", location: "Holborn, London", link: "https://thehoxton.com/holborn/" };
    const trip = {
      destination: "London", days: 2, startDate: future, vibes: ["Culture", "Food", "Relaxing"], budget: "midrange", currency: "GBP",
      members, hostMemberId: uid, createdAt: date, packConfirmed: true, inviteCode: `DEMO${suffix.toUpperCase()}`,
      wishes, votesLockedBy: { [uid]: true, [friend]: true, [third]: true },
      itinerary: { title: "London with the pack", days }, accommodationStatus: "confirmed", confirmedAccommodation: stay,
      accommodationSuggestions: [stay, stay2],
      packingItems: {
        Essentials: [{ text: "Passport or ID", checked: true }, { text: "Phone charger", checked: false }, { text: "Travel adapter", checked: false }],
        Clothing: [{ text: "Comfortable walking shoes", checked: false }, { text: "Rain jacket", checked: false }],
      },
      chat: {
        welcome: { text: "Welcome, pack! Let's plan our London weekend.", authorId: uid, authorName: "Alex Demo", timestamp: now.getTime() - 60000 },
        reply: { text: "British Museum is on my wishlist. Can't wait!", authorId: friend, authorName: "Maya Demo", timestamp: now.getTime() - 30000 },
      },
      walkthroughFixture: true,
    };
    const planning = { ...trip, itinerary: null, confirmedAccommodation: null, packingItems: null,
      votesLockedBy: null, accommodationStatus: "voting",
      accommodationVotes: { 0: { [uid]: "up", [friend]: "up" }, 1: { [uid]: "up", [third]: "up" } },
      accommodationLockedBy: { [uid]: true, [friend]: true, [third]: true },
      memberPreferences: Object.fromEntries(Object.keys(members).map(id => [id, { vibes: ["culture", "food"], distance: "any", budget: "midrange", days: 2, startDate: future, pace: "balanced", submittedAt: date }])),
      destinationSuggestions: [
        { name: "London", pitch: "Museums, markets and neighbourhood walks for the whole pack.", tags: ["Culture", "Food"], flightHint: "Compare flights from your departure city", bestTime: "Spring and autumn" },
        { name: "Paris", pitch: "Art, cafes and riverside walks.", tags: ["Culture", "Food"], flightHint: "Compare current fares", bestTime: "Spring" },
      ],
      destinationVotes: { 0: { [uid]: "up", [friend]: "up" }, 1: { [third]: "up" } },
    };
    const past = { ...trip, startDate: "2026-09-01", createdAt: "2026-08-01T10:00:00.000Z" };
    const review = {
      destination: "London", days: 2, rating: 5, highlight: "A weekend of museums, markets and riverside walks.",
      text: "Our demo pack's two-day culture and food itinerary. Recording fixture with illustrative accommodation amounts.",
      photos: [], memberNames: ["Alex Demo", "Maya Demo", "Sam Demo"], reviewedAt: date,
      vibes: ["Culture", "Food", "Relaxing"], isPublic: true, confirmedAccommodation: stay,
      itineraryDays: days.map(d => ({ day: d.dayNumber, city: d.city, theme: d.theme, activities: d.activities.map(a => ({ ...a, category: a.tag })) })),
    };
    await Promise.all([
      db.ref(`trips/${tripId}`).set(trip), db.ref(`trips/${planningId}`).set(planning), db.ref(`trips/${pastId}`).set(past),
      db.ref(`reviews/${reviewId}`).set(review),
      db.ref(`userTrips/${uid}`).set({ [tripId]: true, [planningId]: true, [pastId]: true,
        profile: { username: "alex_demo", bio: "Exploring with my pack · Demo account", travelPreferences: { pace: "balanced", focus: "culture" } } }),
    ]);
    const manifest = { uid, friend, third, tripId, planningId, pastId, reviewId, tripIds: [tripId, planningId, pastId] };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const clientFile = readFileSync(new URL("../../gopack-mobile/lib/firebase.ts", import.meta.url), "utf8");
    const config = Object.fromEntries(["apiKey", "authDomain", "databaseURL", "projectId", "storageBucket", "messagingSenderId", "appId"]
      .map(key => [key, clientFile.match(new RegExp(`${key}:\\s*"([^"]+)"`))?.[1]]));
    const browser = await connectBrowser();
    await browser.go(`https://${process.env.REPLIT_EXPO_DEV_DOMAIN}/sign-in`);
    await pause(2000);
    // Sign in through the supported Firebase SDK and its existing local persistence.
    // The custom token stays in process/browser memory; it is never written to a file.
    const token = await auth.createCustomToken(uid);
    await browser.evaluate(`(async () => {
      const {initializeApp}=await import('https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js');
      const {getAuth,signInWithCustomToken,setPersistence,browserLocalPersistence}=await import('https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js');
      const a=getAuth(initializeApp(${JSON.stringify(config)}));
      await setPersistence(a,browserLocalPersistence);
      await signInWithCustomToken(a,${JSON.stringify(token)});
      return true;
    })()`);
    await browser.go(`https://${process.env.REPLIT_EXPO_DEV_DOMAIN}/`);
    await pause(4000);
    browser.close();
    const signed = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${config.apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: await auth.createCustomToken(uid), returnSecureToken: true }),
    })).json() as { idToken: string };
    for (const expense of [
      { title: "Market lunch", amountMinor: 7200, category: "Food", payerId: uid },
      { title: "Airport transfer", amountMinor: 4500, category: "Transportation", payerId: friend },
      { title: "Museum exhibition tickets", amountMinor: 6000, category: "Activities", payerId: third },
    ]) {
      const result = await fetch(`https://${process.env.REPLIT_DEV_DOMAIN}/api/trips/${tripId}/expenses`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${signed.idToken}` },
        body: JSON.stringify({ ...expense, currency: "GBP", date: now.toISOString().slice(0, 10), participantIds: Object.keys(members), splitMethod: "equal", notes: "Demo expense for the walkthrough." }),
      });
      if (!result.ok) throw new Error(`Demo expense setup failed (${result.status})`);
    }
    console.log("Isolated demo account, planning trip, itinerary, public review and expenses ready.");
  }
} finally {
  await deleteApp(getAdminApp());
}
