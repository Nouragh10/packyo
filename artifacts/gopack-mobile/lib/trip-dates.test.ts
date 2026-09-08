import assert from "node:assert/strict";
import test from "node:test";

import { getInclusiveDateRangeDays, resolveTripDays } from "./trip-dates";

test("counts an inclusive two-day trip without timezone drift", () => {
  assert.equal(getInclusiveDateRangeDays("2026-09-08", "2026-09-09"), 2);
});

test("uses the selected date range instead of preference duration", () => {
  assert.equal(resolveTripDays("2026-09-08", "2026-09-09", 5, 5), 2);
});

test("handles a date range that crosses daylight-saving time", () => {
  assert.equal(getInclusiveDateRangeDays("2026-10-31", "2026-11-02"), 3);
});

test("falls back to stored duration when no valid date range exists", () => {
  assert.equal(resolveTripDays(null, null, 4, 5), 4);
});