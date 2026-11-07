// READ-ONLY. Counts only. No review text, names or full IDs.
import { getAdminDb } from "../src/lib/firebase-admin";

const isObj = (v: any) => v && typeof v === "object" && !Array.isArray(v);

async function main() {
  const db: any = await getAdminDb();
  const trips: Record<string, any> = (await db.ref("trips").once("value")).val() ?? {};
  const people = new Map<string, Set<string>>(); // reviewer -> sources
  const add = (id: any, src: string) => {
    if (typeof id !== "string" || !id) return;
    if (!people.has(id)) people.set(id, new Set());
    people.get(id)!.add(src);
  };
  const stars: Record<string, number> = {};
  const rows: string[] = [];
  let reviewedByNotId = 0;

  for (const [tid, t] of Object.entries(trips)) {
    const parts: string[] = [];
    if (isObj(t.ratings)) {
      for (const [uid, r] of Object.entries<any>(t.ratings)) {
        add(uid, "ratings");
        if (typeof r?.rating === "number") stars[`ratings:${r.rating}`] = (stars[`ratings:${r.rating}`] ?? 0) + 1;
        parts.push(`rating=${r?.rating}`);
      }
    }
    if (isObj(t.review)) {
      const by = t.review.reviewedBy;
      if (typeof by === "string" && by.length < 20) reviewedByNotId++;
      add(by, "review");
      stars[`review:${t.review.rating}`] = (stars[`review:${t.review.rating}`] ?? 0) + 1;
      parts.push(`review(rating=${t.review.rating}, public=${t.review.isPublic}, photos=${(t.review.photos ?? []).length}, at=${String(t.review.reviewedAt).slice(0, 10)})`);
    }
    if (isObj(t.memberReviews)) {
      for (const [uid, r] of Object.entries<any>(t.memberReviews)) {
        add(uid, "memberReviews");
        add(r?.reviewedBy, "memberReviews");
        parts.push(`memberReview(rating=${r?.rating})`);
      }
    }
    if (parts.length) rows.push(`${tid.slice(0, 6)} | people=${Object.keys(t.members ?? {}).length} | ${parts.join("; ")}`);
  }

  console.log(`\nTrips with any review/rating: ${rows.length} of ${Object.keys(trips).length}`);
  rows.forEach((r) => console.log("  " + r));
  console.log("\nStar values by source:", JSON.stringify(stars));
  console.log(`\nDistinct reviewers across all sources: ${people.size}`);
  console.log(`  of which appear in 2+ sources: ${[...people.values()].filter((s) => s.size > 1).length}`);
  console.log(`reviewedBy values that don't look like IDs (e.g. names): ${reviewedByNotId}`);
  process.exit(0);
}
main().catch((e) => { console.error("Report failed:", e?.message ?? e); process.exit(1); });
