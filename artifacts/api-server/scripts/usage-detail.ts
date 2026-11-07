// READ-ONLY detailed trip analysis. No emails/names; IDs are shortened.
import { writeFileSync } from "fs";
import { getAdminDb } from "../src/lib/firebase-admin";

const toMs = (v: any): number | null => {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string") {
    const n = Number(v);
    if (!isNaN(n)) return toMs(n);
    const p = Date.parse(v);
    return isNaN(p) ? null : p;
  }
  if (v && typeof v === "object" && typeof v._seconds === "number") return v._seconds * 1000;
  return null;
};
const count = (x: any) => (Array.isArray(x) ? x.length : x && typeof x === "object" ? Object.keys(x).length : 0);
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const weekOf = (ms: number) => {
  const d = new Date(ms);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
};
const inc = (m: Record<string, number>, k: string, n = 1) => (m[k] = (m[k] ?? 0) + n);
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : "-");
const short = (v: any) => {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return s.length > 30 ? s.slice(0, 30) + "…" : s;
};
const table = (m: Record<string, number>, top = 15) =>
  Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, top).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

async function main() {
  const db: any = await getAdminDb();
  const all: Record<string, any> = (await db.ref("trips").once("value")).val() ?? {};
  const ids = Object.keys(all);
  const packs = ids.filter((i) => all[i]?.isPack);
  const tripIds = ids.filter((i) => !all[i]?.isPack);
  console.log(`\nEntries under trips: ${ids.length}  (group packs: ${packs.length}, real trips: ${tripIds.length})`);

  // ---- data quality ----
  const fmt: Record<string, number> = {};
  let hostInMembers = 0, hostNotInMembers = 0;
  type Row = any;
  const rows: Row[] = [];
  for (const id of tripIds) {
    const t = all[id] ?? {};
    const raw = t.createdAt;
    const ms = toMs(raw);
    inc(fmt, raw == null ? "missing" : ms == null ? "unparseable" : typeof raw === "object" ? "object" : typeof raw);
    const memberKeys = t.members ? Object.keys(t.members) : [];
    const host = t.hostMemberId;
    if (host) (memberKeys.includes(host) ? hostInMembers++ : hostNotInMembers++);
    const people = new Set(memberKeys);
    if (host) people.add(host);
    rows.push({
      id: id.slice(0, 6),
      ms,
      created: ms ? day(ms) : "",
      week: ms ? weekOf(ms) : "unknown",
      host: host ? String(host).slice(0, 6) : "",
      listed: memberKeys.length,
      people: people.size,
      destination: short(t.destination),
      days: typeof t.days === "number" ? t.days : short(t.days),
      budget: short(t.budget),
      itinerary: t.itinerary ? 1 : 0,
      wishes: count(t.wishes),
      votes: count(t.destinationVotes) + count(t.accommodationVotes),
      chat: count(t.chat),
      invite: t.inviteCode ? 1 : 0,
      locked: t.password ? 1 : 0,
      visibility: short(t.visibility),
    });
  }
  console.log("\n== Data quality ==");
  console.log("createdAt formats:", JSON.stringify(fmt));
  console.log(`Host listed in members: ${hostInMembers}, host NOT in members: ${hostNotInMembers}`);
  console.log("(If host is often missing from members, 'people' below is the safer member count.)");

  // ---- per week ----
  console.log("\n== Trips per week ==");
  console.log("week | trips | w/ itinerary | 2+ people | w/ votes | w/ invite code");
  const weeks = [...new Set(rows.map((r) => r.week))].sort();
  for (const w of weeks) {
    const r = rows.filter((x) => x.week === w);
    console.log(
      `${w} | ${r.length} | ${r.filter((x) => x.itinerary).length} (${pct(r.filter((x) => x.itinerary).length, r.length)}) | ` +
        `${r.filter((x) => x.people > 1).length} (${pct(r.filter((x) => x.people > 1).length, r.length)}) | ` +
        `${r.filter((x) => x.votes).length} | ${r.filter((x) => x.invite).length}`,
    );
  }

  // ---- per month / day ----
  const byMonth: Record<string, number> = {}, byDay: Record<string, number> = {};
  rows.forEach((r) => { if (r.ms) { inc(byMonth, r.created.slice(0, 7)); inc(byDay, r.created); } });
  console.log("\n== Trips per month ==");
  Object.entries(byMonth).sort().forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  console.log("\n== 10 busiest days ==");
  table(byDay, 10);

  // ---- hosts ----
  const perHost: Record<string, number> = {};
  rows.forEach((r) => r.host && inc(perHost, r.host));
  const hostCounts = Object.values(perHost).sort((a, b) => b - a);
  console.log(`\n== Hosts ==\nDistinct hosts: ${hostCounts.length}`);
  console.log("Trips per host, top 8 (anonymized):", hostCounts.slice(0, 8).join(", "));
  const topShare = hostCounts.slice(0, 3).reduce((a, b) => a + b, 0);
  console.log(`Top 3 hosts created ${topShare} of ${tripIds.length} trips (${pct(topShare, tripIds.length)})`);
  const once = hostCounts.filter((c) => c === 1).length;
  console.log(`Hosts who made exactly 1 trip: ${once} of ${hostCounts.length}; made 2+: ${hostCounts.length - once}`);

  // ---- content ----
  const dest: Record<string, number> = {}, len: Record<string, number> = {}, bud: Record<string, number> = {};
  rows.forEach((r) => { inc(dest, String(r.destination)); inc(len, String(r.days)); inc(bud, String(r.budget)); });
  console.log("\n== Top destinations =="); table(dest, 15);
  console.log("\n== Trip length (days) =="); table(len, 10);
  console.log("\n== Budget values =="); table(bud, 8);

  // ---- adoption ----
  const n = rows.length;
  const c = (f: (r: Row) => any) => rows.filter(f).length;
  console.log("\n== Feature adoption (real trips) ==");
  console.log(`  itinerary generated: ${c((r) => r.itinerary)} (${pct(c((r) => r.itinerary), n)})`);
  console.log(`  has wishes: ${c((r) => r.wishes)} (${pct(c((r) => r.wishes), n)})`);
  console.log(`  has any votes: ${c((r) => r.votes)} (${pct(c((r) => r.votes), n)})`);
  console.log(`  has chat: ${c((r) => r.chat)} (${pct(c((r) => r.chat), n)})`);
  console.log(`  invite code created: ${c((r) => r.invite)} (${pct(c((r) => r.invite), n)})`);
  console.log(`  password-protected: ${c((r) => r.locked)} (${pct(c((r) => r.locked), n)})`);
  const sizeDist: Record<string, number> = {};
  rows.forEach((r) => inc(sizeDist, r.people >= 5 ? "5+" : String(r.people)));
  console.log("\n== Trips by number of people (host + members) =="); Object.entries(sizeDist).sort().forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  console.log("\n== Itinerary rate by group size ==");
  for (const k of Object.keys(sizeDist).sort()) {
    const g = rows.filter((r) => (r.people >= 5 ? "5+" : String(r.people)) === k);
    console.log(`  ${k} people: ${pct(g.filter((r) => r.itinerary).length, g.length)} have an itinerary (${g.length} trips)`);
  }

  // ---- per-trip CSV ----
  const cols = ["id","created","week","host","listed","people","destination","days","budget","itinerary","wishes","votes","chat","invite","locked","visibility"];
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const sorted = [...rows].sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0));
  writeFileSync("trips-detail.csv", [cols.join(","), ...sorted.map((r) => cols.map((k) => esc(r[k])).join(","))].join("\n"));
  console.log("\nWrote per-trip table to trips-detail.csv (delete it when done; do not commit it).");
  console.log("\n== 15 most recent trips ==");
  console.log("created | people | destination | days | itinerary | wishes | votes");
  sorted.slice(0, 15).forEach((r) => console.log(`${r.created || "?"} | ${r.people} | ${r.destination} | ${r.days} | ${r.itinerary} | ${r.wishes} | ${r.votes}`));
  process.exit(0);
}
main().catch((e) => { console.error("Report failed:", e?.message ?? e); process.exit(1); });
