// READ-ONLY. Prints shapes, counts and numeric ratings only. No review text, no names.
import { getAdminDb } from "../src/lib/firebase-admin";

const FIELDS = ["ratings", "review", "memberReviews"];
const uidLike = (k: string) => k.length >= 20;
const UID_FIELDS = ["uid", "userId", "reviewerId", "authorId", "memberId", "by", "reviewer"];

const shape = (v: any, d = 0): string => {
  if (v == null) return "null";
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (typeof v !== "object") return typeof v;
  if (d >= 2) return "object";
  const seen: Record<string, string> = {};
  for (const k of Object.keys(v)) {
    const label = uidLike(k) ? "<id>" : k;
    if (!seen[label]) seen[label] = shape(v[k], d + 1);
  }
  return "{" + Object.entries(seen).map(([k, s]) => `${k}:${s}`).join(", ") + "}";
};

const numbers = (v: any, out: number[] = []): number[] => {
  if (typeof v === "number") out.push(v);
  else if (v && typeof v === "object") Object.values(v).forEach((x) => numbers(x, out));
  return out;
};

async function main() {
  const db: any = await getAdminDb();
  const trips: Record<string, any> = (await db.ref("trips").once("value")).val() ?? {};
  const ids = Object.keys(trips);
  console.log(`\nTrips scanned: ${ids.length}`);

  const reviewers = new Set<string>();

  for (const f of FIELDS) {
    const withF = ids.filter((i) => trips[i]?.[f] != null);
    console.log(`\n== ${f} ==\nTrips with this field: ${withF.length}`);
    const shapes: Record<string, number> = {};
    let entries = 0;
    const nums: number[] = [];
    const fieldReviewers = new Set<string>();
    for (const i of withF) {
      const v = trips[i][f];
      const s = shape(v);
      shapes[s] = (shapes[s] ?? 0) + 1;
      if (v && typeof v === "object") {
        const keys = Object.keys(v);
        entries += keys.length;
        keys.filter(uidLike).forEach((k) => { fieldReviewers.add(k); reviewers.add(k); });
        for (const k of keys) {
          const child = v[k];
          if (child && typeof child === "object") {
            for (const uf of UID_FIELDS) {
              if (typeof child[uf] === "string") { fieldReviewers.add(child[uf]); reviewers.add(child[uf]); }
            }
          }
        }
      } else entries += 1;
      numbers(v, nums);
    }
    console.log(`Entries under this field (across trips): ${entries}`);
    console.log(`Distinct reviewer IDs detected: ${fieldReviewers.size}`);
    console.log("Shapes found:");
    Object.entries(shapes).forEach(([s, n]) => console.log(`  ${n} x ${s}`));
    if (nums.length) {
      const dist: Record<string, number> = {};
      nums.forEach((x) => (dist[String(x)] = (dist[String(x)] ?? 0) + 1));
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      console.log(`Numeric values: ${nums.length}, average ${avg.toFixed(2)}`);
      console.log("Distribution:", JSON.stringify(dist));
    }
  }

  console.log(`\nDistinct reviewer IDs across all three fields: ${reviewers.size}`);
  console.log("(Only counts reviewers whose ID is a key or a uid/userId/reviewerId field. If it says 0 but reviews exist, paste the 'Shapes found' lines.)");
  process.exit(0);
}
main().catch((e) => { console.error("Report failed:", e?.message ?? e); process.exit(1); });
