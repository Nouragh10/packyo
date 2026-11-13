// Geographic sanity checks for AI itineraries.
//
// The model sometimes drops a venue from another city into a day (e.g. a Dammam
// restaurant on a Riyadh day). Every activity carries lat/lng, so we can find
// those deterministically: take the median position of the day's activities as
// the day's centre and flag anything far from it.

export const OFF_AREA_KM = 50;

type Activity = Record<string, unknown> & { name?: unknown; time?: unknown; lat?: unknown; lng?: unknown; fromWish?: unknown };
type Day = Record<string, unknown> & { dayNumber?: unknown; city?: unknown; activities: Activity[] };
export type ItineraryLike = { days: Day[] };

export type OffAreaSlot = {
  dayIndex: number;
  activityIndex: number;
  dayNumber: number;
  city: string;
  time: string;
  name: string;
  tag: string;
  distanceKm: number;
  center: { lat: number; lng: number };
  otherNames: string[];
  /** "day" = far from the rest of its day; "trip" = outside every place the group chose. */
  reason?: "day" | "trip";
};

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function coordsOf(a: { lat?: unknown; lng?: unknown }): { lat: number; lng: number } | null {
  const lat = Number(a.lat);
  const lng = Number(a.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Centre of a day: median lat/lng of activities with usable coordinates (needs 3+). */
export function dayCenter(day: Day): { lat: number; lng: number } | null {
  const pts = day.activities.map(coordsOf).filter((p): p is { lat: number; lng: number } => p !== null);
  if (pts.length < 3) return null;
  return { lat: median(pts.map((p) => p.lat)), lng: median(pts.map((p) => p.lng)) };
}

/**
 * AI-picked activities that are more than `maxKm` from their day's centre.
 * Group wishes are left alone: the group chose those places on purpose.
 */
export function findOffAreaActivities(itinerary: ItineraryLike, maxKm = OFF_AREA_KM): OffAreaSlot[] {
  const out: OffAreaSlot[] = [];
  itinerary.days.forEach((day, dayIndex) => {
    const center = dayCenter(day);
    if (!center) return;
    day.activities.forEach((act, activityIndex) => {
      if (act.fromWish === true) return;
      const p = coordsOf(act);
      if (!p) return;
      const distanceKm = haversineKm(center, p);
      if (distanceKm <= maxKm) return;
      out.push({
        dayIndex,
        activityIndex,
        dayNumber: Number(day.dayNumber ?? dayIndex + 1),
        city: String(day.city ?? ""),
        time: String(act.time ?? ""),
        name: String(act.name ?? ""),
        tag: String(act.tag ?? ""),
        distanceKm: Math.round(distanceKm),
        center,
        otherNames: day.activities.filter((_, i) => i !== activityIndex).map((a) => String(a.name ?? "")),
        reason: "day",
      });
    });
  });
  return out;
}

/**
 * AI-picked activities outside every place the group chose (e.g. a Dammam
 * venue on a Riyadh-only trip, even when the whole day drifted there).
 * `isInside` decides membership; `centerFor` gives the place the day should be in.
 */
export function findOutsideTripActivities(
  itinerary: ItineraryLike,
  isInside: (p: { lat: number; lng: number }) => boolean,
  centerFor: (day: Day, p: { lat: number; lng: number }) => { lat: number; lng: number; name: string } | undefined,
): OffAreaSlot[] {
  const out: OffAreaSlot[] = [];
  itinerary.days.forEach((day, dayIndex) => {
    day.activities.forEach((act, activityIndex) => {
      if (act.fromWish === true) return;
      const p = coordsOf(act);
      if (!p || isInside(p)) return;
      const target = centerFor(day, p);
      if (!target) return;
      out.push({
        dayIndex,
        activityIndex,
        dayNumber: Number(day.dayNumber ?? dayIndex + 1),
        city: target.name,
        time: String(act.time ?? ""),
        name: String(act.name ?? ""),
        tag: String(act.tag ?? ""),
        distanceKm: Math.round(haversineKm(target, p)),
        center: { lat: target.lat, lng: target.lng },
        otherNames: day.activities.filter((_, i) => i !== activityIndex).map((a) => String(a.name ?? "")),
        reason: "trip",
      });
    });
  });
  return out;
}

/** Merges slot lists, keeping the first slot found for each activity. */
export function mergeSlots(...lists: OffAreaSlot[][]): OffAreaSlot[] {
  const seen = new Set<string>();
  const out: OffAreaSlot[] = [];
  for (const s of lists.flat()) {
    const k = `${s.dayIndex}:${s.activityIndex}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export type Replacement = {
  name?: unknown; description?: unknown; photoQuery?: unknown; lat?: unknown; lng?: unknown; estimatedCost?: unknown;
};

/**
 * Applies replacements in slot order, but only those whose own coordinates are
 * acceptable: by default within `maxKm` of the slot's centre. Returns how many
 * were applied.
 */
export function applyReplacements(
  itinerary: ItineraryLike,
  slots: OffAreaSlot[],
  replacements: Replacement[],
  maxKm = OFF_AREA_KM,
  accept?: (p: { lat: number; lng: number }, slot: OffAreaSlot) => boolean,
): number {
  let applied = 0;
  slots.forEach((slot, i) => {
    const r = replacements[i];
    if (!r || typeof r.name !== "string" || !r.name.trim()) return;
    const p = coordsOf(r);
    if (!p) return;
    if (accept ? !accept(p, slot) : haversineKm(slot.center, p) > maxKm) return;
    const act = itinerary.days[slot.dayIndex]?.activities[slot.activityIndex];
    if (!act) return;
    act.name = r.name.trim();
    act.lat = p.lat;
    act.lng = p.lng;
    if (typeof r.description === "string" && r.description.trim()) act.description = r.description.trim();
    if (typeof r.photoQuery === "string" && r.photoQuery.trim()) act.photoQuery = r.photoQuery.trim();
    const cost = Number(r.estimatedCost);
    if (Number.isFinite(cost) && cost >= 0) act.estimatedCost = cost;
    applied++;
  });
  return applied;
}
