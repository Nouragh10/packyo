import { getAdminDb } from "../src/lib/firebase-admin";

/**
 * Read-only unless --apply is supplied. Repair only numeric time leaves, keeping
 * their exact values as text so old clients can safely call string methods.
 * Never rewrite an itinerary or infer a clock time, timezone, or AM/PM.
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const db = getAdminDb();
  const trips = (await db.ref("trips").get()).val() ?? {};
  const paths: string[] = [];
  for (const [tripId, trip] of Object.entries(trips) as Array<[string, any]>) {
    // Temporary regression fixtures must remain untouched by the repair.
    if (tripId.startsWith("qa-")) continue;
    for (const [dayKey, day] of Object.entries(trip?.itinerary?.days ?? {}) as Array<[string, any]>) {
      for (const [activityKey, activity] of Object.entries(day?.activities ?? {}) as Array<[string, any]>) {
        if (typeof activity?.time === "number" && Number.isFinite(activity.time)) {
          paths.push(`trips/${tripId}/itinerary/days/${dayKey}/activities/${activityKey}/time`);
        }
      }
    }
  }
  if (paths.length > 100) throw new Error("Unexpected repair size; inspect before applying.");
  let repaired = 0;
  if (apply) {
    for (const path of paths) {
      const result = await db.ref(path).transaction((current) => {
        // Returning null on an uncached first callback permits the server CAS
        // retry; aborting here could skip an existing numeric value.
        if (current === null) return null;
        if (typeof current === "number" && Number.isFinite(current)) return String(current);
        // Preserve concurrent text edits without writing anything.
        return undefined;
      });
      if (result.committed && typeof result.snapshot.val() === "string") repaired++;
    }
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", eligible: paths.length, repaired }));
}

void main().then(() => process.exit(0), (error: Error) => {
  console.error(error.message);
  process.exit(1);
});
