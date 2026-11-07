// Weekly trip report for Packyo.
//
//   pnpm --filter @workspace/scripts trips:week            # last 7 days
//   pnpm --filter @workspace/scripts trips:week -- --days 30
//   pnpm --filter @workspace/scripts trips:week -- --json   # raw numbers
//
// Needs the same Firebase service-account secrets as the API server:
// FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY. Read-only.
import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getAuth, type UserRecord } from "firebase-admin/auth";

type Trip = {
  destination?: string;
  budget?: string;
  vibes?: string[];
  members?: Record<string, unknown>;
  createdAt?: string;
  startDate?: string | null;
  endDate?: string | null;
  aiDestinationDecision?: unknown;
  destinationSuggestions?: unknown[];
  packConfirmed?: boolean;
  accommodationStatus?: string;
  confirmedAccommodation?: unknown;
  itinerary?: { days?: unknown[] };
  review?: unknown;
  memberReviews?: Record<string, unknown>;
  isPack?: boolean;
};
type Unlocks = { group?: { at: string }; members?: Record<string, { at: string }> };

const args = process.argv.slice(2);
const days = Number(args[args.indexOf("--days") + 1]) || 7;
const asJson = args.includes("--json");
const PRICE = { group: 3.99, personal: 2.99 };

const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
if (!clientEmail || !privateKey) {
  console.error("Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (the API server's Firebase secrets) first.");
  process.exit(1);
}
const app = initializeApp({
  credential: cert({ projectId: "gopacknow-83d54", clientEmail, privateKey }),
  databaseURL: "https://gopacknow-83d54-default-rtdb.firebaseio.com",
});
const db = getDatabase(app);

const since = new Date(Date.now() - days * 86400000);
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");
const top = (items: (string | undefined)[], n = 5) => {
  const c = new Map<string, number>();
  for (const i of items) if (i) c.set(i, (c.get(i) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
};

async function main() {
  const [tripsSnap, unlocksSnap] = await Promise.all([db.ref("trips").get(), db.ref("itineraryUnlocks").get()]);
  const all = (tripsSnap.val() ?? {}) as Record<string, Trip>;
  const unlocks = (unlocksSnap.val() ?? {}) as Record<string, Unlocks>;

  const trips = Object.entries(all).filter(([, t]) => t.createdAt && new Date(t.createdAt) >= since && !t.isPack);
  const n = trips.length;
  const sizes = trips.map(([, t]) => Object.keys(t.members ?? {}).length);
  const funnel = {
    created: n,
    invitedSomeone: trips.filter(([, t]) => Object.keys(t.members ?? {}).length > 1).length,
    destinationPicked: trips.filter(([, t]) => t.aiDestinationDecision || (t.destination && !t.destinationSuggestions?.length) || t.packConfirmed).length,
    packConfirmed: trips.filter(([, t]) => t.packConfirmed).length,
    stayChosen: trips.filter(([, t]) => t.confirmedAccommodation || ["confirmed", "booked"].includes(t.accommodationStatus ?? "")).length,
    itineraryGenerated: trips.filter(([, t]) => (t.itinerary?.days?.length ?? 0) > 0).length,
    reviewed: trips.filter(([, t]) => t.review || Object.keys(t.memberReviews ?? {}).length).length,
  };

  // Unlocks bought in the window (on any trip, not just new ones)
  let groupUnlocks = 0, personalUnlocks = 0;
  for (const u of Object.values(unlocks)) {
    if (u.group && new Date(u.group.at) >= since) groupUnlocks++;
    for (const m of Object.values(u.members ?? {})) if (new Date(m.at) >= since) personalUnlocks++;
  }
  const unlockedNewTrips = trips.filter(([id]) => unlocks[id]?.group || Object.keys(unlocks[id]?.members ?? {}).length).length;
  const revenue = groupUnlocks * PRICE.group + personalUnlocks * PRICE.personal;

  // Sign-ups in the window, and how far each new user got
  const newUsers: UserRecord[] = [];
  let pageToken: string | undefined;
  do {
    const page = await getAuth(app).listUsers(1000, pageToken);
    for (const u of page.users) if (new Date(u.metadata.creationTime) >= since) newUsers.push(u);
    pageToken = page.pageToken;
  } while (pageToken);
  const memberOf = new Map<string, number>();
  for (const t of Object.values(all)) for (const uid of Object.keys(t.members ?? {})) memberOf.set(uid, (memberOf.get(uid) ?? 0) + 1);
  const hostOf = new Set(Object.values(all).map((t) => (t as { hostMemberId?: string }).hostMemberId));
  const provider = (u: UserRecord) => u.providerData[0]?.providerId ?? (u.email ? "password" : "anonymous");
  const emailUnverified = newUsers.filter((u) => provider(u) === "password" && !u.emailVerified);
  const signups = {
    total: newUsers.length,
    byMethod: top(newUsers.map(provider), 10),
    stuckOnEmailVerification: emailUnverified.length,
    createdATrip: newUsers.filter((u) => hostOf.has(u.uid)).length,
    joinedSomeoneElsesTrip: newUsers.filter((u) => !hostOf.has(u.uid) && memberOf.has(u.uid)).length,
    noTripAtAll: newUsers.filter((u) => !memberOf.has(u.uid)).length,
  };

  const report = {
    signups,
    window: { days, since: since.toISOString().slice(0, 10), totalTripsAllTime: Object.keys(all).length },
    groups: {
      avgSize: n ? +(sizes.reduce((a, b) => a + b, 0) / n).toFixed(1) : 0,
      solo: sizes.filter((s) => s === 1).length,
      largest: Math.max(0, ...sizes),
    },
    funnel,
    money: { groupUnlocks, personalUnlocks, newTripsUnlocked: unlockedNewTrips, grossRevenueUSD: +revenue.toFixed(2), afterAppleCutUSD: +(revenue * 0.85).toFixed(2) },
    topDestinations: top(trips.map(([, t]) => t.destination)),
    topVibes: top(trips.flatMap(([, t]) => t.vibes ?? [])),
    budgets: top(trips.map(([, t]) => t.budget)),
  };

  if (asJson) { console.log(JSON.stringify(report, null, 2)); return; }

  const f = report.funnel;
  console.log(`\nPackyo trips — last ${days} days (since ${report.window.since})`);
  console.log(`${n} new trips (${report.window.totalTripsAllTime} all time)\n`);
  const su = report.signups;
  console.log("Sign-ups");
  console.log(`  New accounts             ${su.total}   (${su.byMethod.map(([k, v]) => `${k.replace(".com", "")} ${v}`).join(", ") || "–"})`);
  console.log(`  Stuck on email verify    ${su.stuckOnEmailVerification}  ${pct(su.stuckOnEmailVerification, su.total)}`);
  console.log(`  Created a trip           ${su.createdATrip}  ${pct(su.createdATrip, su.total)}`);
  console.log(`  Joined a friend's trip   ${su.joinedSomeoneElsesTrip}  ${pct(su.joinedSomeoneElsesTrip, su.total)}`);
  console.log(`  No trip at all           ${su.noTripAtAll}  ${pct(su.noTripAtAll, su.total)}\n`);
  console.log(`Groups      avg ${report.groups.avgSize} people · ${report.groups.solo} solo · largest ${report.groups.largest}`);
  console.log("\nFunnel");
  for (const [label, v] of [
    ["Created", f.created], ["Invited someone", f.invitedSomeone], ["Destination picked", f.destinationPicked],
    ["Pack confirmed", f.packConfirmed], ["Stay chosen", f.stayChosen], ["Itinerary generated", f.itineraryGenerated],
    ["Reviewed after trip", f.reviewed],
  ] as const) console.log(`  ${label.padEnd(22)} ${String(v).padStart(4)}  ${pct(v, n)}`);
  console.log("\nMoney");
  console.log(`  Group unlocks ($3.99)    ${groupUnlocks}`);
  console.log(`  Personal unlocks ($2.99) ${personalUnlocks}`);
  console.log(`  New trips unlocked       ${unlockedNewTrips} of ${f.itineraryGenerated} with an itinerary (${pct(unlockedNewTrips, f.itineraryGenerated)})`);
  console.log(`  Revenue                  $${report.money.grossRevenueUSD} gross · ~$${report.money.afterAppleCutUSD} after Apple's 15%`);
  const list = (title: string, rows: [string, number][]) =>
    console.log(`\n${title}\n` + (rows.length ? rows.map(([k, v]) => `  ${k.padEnd(24)} ${v}`).join("\n") : "  –"));
  list("Top destinations", report.topDestinations);
  list("Top vibes", report.topVibes);
  list("Budgets", report.budgets);
  console.log("");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
