import { test } from "node:test";
import assert from "node:assert/strict";
import { applyReplacements, findOffAreaActivities, haversineKm } from "./itinerary-geo";

// Riyadh venues and one Dammam venue (~390 km away).
const riyadhDay = () => ({
  dayNumber: 1,
  city: "Riyadh",
  activities: [
    { time: "9:00 AM", name: "Masmak Fortress", tag: "culture", lat: 24.6312, lng: 46.7133, fromWish: false },
    { time: "11:00 AM", name: "National Museum", tag: "culture", lat: 24.6478, lng: 46.7106, fromWish: false },
    { time: "1:00 PM", name: "Dammam Corniche Cafe", tag: "foodie", lat: 26.4473, lng: 50.1035, fromWish: false },
    { time: "4:00 PM", name: "Kingdom Centre Sky Bridge", tag: "relaxing", lat: 24.7114, lng: 46.6744, fromWish: false },
    { time: "7:00 PM", name: "Diriyah At-Turaif", tag: "culture", lat: 24.7336, lng: 46.5753, fromWish: false },
  ],
});

test("haversine is roughly right for Riyadh–Dammam", () => {
  const km = haversineKm({ lat: 24.7136, lng: 46.6753 }, { lat: 26.4207, lng: 50.0888 });
  assert.ok(km > 350 && km < 420, String(km));
});

test("flags only the venue from another city", () => {
  const off = findOffAreaActivities({ days: [riyadhDay()] });
  assert.equal(off.length, 1);
  assert.equal(off[0].name, "Dammam Corniche Cafe");
  assert.equal(off[0].city, "Riyadh");
  assert.ok(off[0].distanceKm > 300);
});

test("leaves group wishes alone and ignores days without enough coordinates", () => {
  const d = riyadhDay();
  d.activities[2].fromWish = true;
  assert.equal(findOffAreaActivities({ days: [d] }).length, 0);
  const sparse = { dayNumber: 2, city: "Riyadh", activities: [{ name: "A", lat: 24.6, lng: 46.7 }, { name: "B", lat: 26.4, lng: 50.1 }] };
  assert.equal(findOffAreaActivities({ days: [sparse] }).length, 0);
});

test("applies an in-area replacement and rejects one that is still far away", () => {
  const it = { days: [riyadhDay()] };
  const slots = findOffAreaActivities(it);
  assert.equal(applyReplacements(it, slots, [{ name: "Still Dammam", lat: 26.43, lng: 50.1 }]), 0);
  assert.equal(it.days[0].activities[2].name, "Dammam Corniche Cafe");
  const n = applyReplacements(it, slots, [{ name: "Najd Village", description: "Classic Najdi dishes.", lat: 24.7, lng: 46.68, estimatedCost: 20 }]);
  assert.equal(n, 1);
  assert.equal(it.days[0].activities[2].name, "Najd Village");
  assert.equal(it.days[0].activities[2].lat, 24.7);
  assert.equal(findOffAreaActivities(it).length, 0);
});
