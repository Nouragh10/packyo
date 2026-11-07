// READ-ONLY usage report. Prints aggregate counts only, no user data.
import { getAuth } from "firebase-admin/auth";
import { getAdminApp, getAdminDb } from "../src/lib/firebase-admin";

async function main() {
  const db: any = await getAdminDb();

  // ---- Trips ----
  const snap = await db.ref("trips").once("value");
  const trips: Record<string, any> = snap.val() ?? {};
  const ids = Object.keys(trips);
  console.log(`\nTotal trips: ${ids.length}`);

  const buckets: Record<string, number> = {};
  const distinctMembers = new Set<string>();
  const fieldCounts: Record<string, number> = {};
  const byWeek: Record<string, number> = {};

  for (const id of ids) {
    const t = trips[id] ?? {};
    const members = t.members ? Object.keys(t.members) : [];
    members.forEach((m) => distinctMembers.add(m));
    const n = members.length;
    const label = n >= 5 ? "5+" : String(n);
    buckets[label] = (buckets[label] ?? 0) + 1;
    Object.keys(t).forEach((k) => (fieldCounts[k] = (fieldCounts[k] ?? 0) + 1));

    const created = typeof t.createdAt === "number" ? t.createdAt : null;
    if (created) {
      const d = new Date(created);
      d.setUTCDate(d.getUTCDate() - d.getUTCDay());
      const wk = d.toISOString().slice(0, 10);
      byWeek[wk] = (byWeek[wk] ?? 0) + 1;
    }
  }

  console.log("\nTrips by number of members:");
  Object.entries(buckets)
    .sort()
    .forEach(([k, v]) => console.log(`  ${k} member(s): ${v}`));
  const multi = ids.filter((id) => Object.keys(trips[id]?.members ?? {}).length > 1).length;
  console.log(
    `\nTrips with 2+ members: ${multi} of ${ids.length}` +
      (ids.length ? ` (${((multi / ids.length) * 100).toFixed(1)}%)` : ""),
  );
  console.log(`Distinct people who are members of a trip: ${distinctMembers.size}`);

  console.log("\nField names found on trips (how many trips have each):");
  Object.entries(fieldCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  if (Object.keys(byWeek).length) {
    console.log("\nTrips created per week (needs a numeric createdAt):");
    Object.entries(byWeek)
      .sort()
      .forEach(([k, v]) => console.log(`  week of ${k}: ${v}`));
  }

  // ---- Sign-ups from Firebase Auth ----
  const auth = getAuth(getAdminApp());
  let total = 0;
  const signupsByWeek: Record<string, number> = {};
  let pageToken: string | undefined;
  do {
    const res = await auth.listUsers(1000, pageToken);
    for (const u of res.users) {
      total++;
      const d = new Date(u.metadata.creationTime);
      d.setUTCDate(d.getUTCDate() - d.getUTCDay());
      const wk = d.toISOString().slice(0, 10);
      signupsByWeek[wk] = (signupsByWeek[wk] ?? 0) + 1;
    }
    pageToken = res.pageToken;
  } while (pageToken);

  console.log(`\nTotal signed-up users: ${total}`);
  console.log("Sign-ups per week (most recent 10):");
  Object.entries(signupsByWeek)
    .sort()
    .slice(-10)
    .forEach(([k, v]) => console.log(`  week of ${k}: ${v}`));

  process.exit(0);
}

main().catch((e) => {
  console.error("Report failed:", e?.message ?? e);
  process.exit(1);
});
