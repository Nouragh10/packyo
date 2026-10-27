import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { auth, db, equalTo, get, onValue, orderByChild, push, query, ref, set, update } from "@/lib/firebase";
import { runTransaction } from "firebase/database";
import { apiFetch } from "@/lib/api-client";
import { classifyActivity, keySegment, normalizeCity } from "@/lib/activity-classifier";

/* ── Interfaces ───────────────────────────────────────────────────── */

export interface TripMember {
  name: string;
  joinedAt: string;
  isHost: boolean;
}

export interface DestinationSuggestion {
  name: string;
  pitch: string;
  tags: string[];
  flightHint: string;
  bestTime: string;
}

export interface MemberPreference {
  vibes: string[];
  distance: string;
  budget: string;
  days: number;
  startDate: string | null;
  startLocation?: string;
  pace?: "relaxed" | "balanced" | "packed";
  submittedAt: string;
}

export interface AccommodationPreference {
  maxCostPerPerson: number;
  type: "hotel" | "airbnb" | "hostel" | "no_preference";
  rooms: number;
  location: string;
  amenities: string[];
  priority: "luxury" | "balanced" | "affordability";
  cancellation: "flexible" | "any";
  submittedAt: string;
}

export interface AccommodationSuggestion {
  id: string;
  name: string;
  type: "hotel" | "airbnb" | "hostel" | "other";
  location: string;
  totalCost: number;
  costPerPerson: number;
  nights: number;
  rating: number;
  amenities: string[];
  rooms: number;
  beds: number;
  cancellation: string;
  whyItFits: string;
  tags: string[];
  distanceNote: string;
  link?: string;
  photos?: string[];
  submittedBy: string;
}

export interface Trip {
  id: string;
  destination: string;
  days: number;
  vibes: string[];
  budget: string;
  showEstimatedCosts?: boolean;
  planningDefaults?: {
    pace: string;
    focus: string;
  };
  startDate: string | null;
  endDate?: string | null;
  members: Record<string, TripMember>;
  hostMemberId: string;
  createdAt: string;
  inviteCode?: string;
  itinerary?: { title: string; days: ItineraryDay[] };
  votesLockedBy?: Record<string, boolean>;
  collectingPreferences?: boolean;
  memberPreferences?: Record<string, MemberPreference>;
  destinationSuggestions?: DestinationSuggestion[];
  destinationVotes?: Record<string, Record<string, "up" | "down">>;
  destinationLockedBy?: Record<string, boolean>;
  aiDestinationDecision?: {
    suggestionIndex: number;
    name: string;
    reason: string;
    decidedAt: string;
  };
  accommodationStatus?: "collecting_prefs" | "voting" | "confirmed" | "booked" | "skipped";
  accommodationPreferences?: Record<string, AccommodationPreference>;
  accommodationSuggestions?: AccommodationSuggestion[];
  accommodationVotes?: Record<string, Record<string, "up" | "down">>;
  accommodationLockedBy?: Record<string, boolean>;
  confirmedAccommodation?: AccommodationSuggestion;
  packConfirmed?: boolean;
  isPremium?: boolean;
  unlockedDays?: Record<string, boolean>;
  aiUsage?: Record<string, number>;
  review?: unknown;
  memberReviews?: Record<string, unknown>;
  memoryGuide?: {
    title: string;
    opening: string;
    highlights: Array<{ title: string; story: string }>;
    byTheNumbers: Array<{ label: string; value: string }>;
    closing: string;
    generatedAt: string;
  };
  memoryGuides?: Record<string, {
    title: string;
    opening: string;
    highlights: Array<{ title: string; story: string }>;
    byTheNumbers: Array<{ label: string; value: string }>;
    closing: string;
    generatedAt: string;
  }>;
  isPack?: boolean;
  pendingInvites?: Record<string, { fromUid: string; fromName: string; packName: string; destination: string; createdAt: number }>;
}

export interface Wish {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  upvoters: Record<string, string>;   // uid → displayName
  downvoters: Record<string, string>; // uid → displayName
  score: number;                      // computed: upvotes - downvotes
  createdAt: number;
}

export interface ProfileWish extends Wish {
  tripId: string;
  tripDestination: string;
}

export interface PackyoProfile {
  username: string;
  bio: string;
  travelPreferences?: {
    pace?: string;
    focus?: string;
  };
}

export interface ProfileStay {
  id: string;
  tripId: string;
  destination: string;
  startDate: string | null;
  accommodation: AccommodationSuggestion;
}

export interface ProfileActivity {
  id: string;
  tripId: string;
  destination: string;
  dayNumber: number;
  activity: Activity;
}

export interface ProfileMemory {
  id: string;
  tripId: string;
  destination: string;
  generatedAt: string;
  title: string;
  photo?: string;
}

export interface ChatMessage {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  timestamp: number;
}

export interface ItineraryDay {
  dayNumber: number;
  city: string;
  theme: string;
  activities: Activity[];
}

export interface Activity {
  id?: string;
  time: string;
  name: string;
  description: string;
  tag: string;
  fromWish: boolean;
  suggester: string;
  matchedVibe?: string | null;
  estimatedCost: number;
  labels: string[];
  nearPrevious: boolean;
  lastRedoBy?: string;
  photoQuery?: string;
  lat?: number;
  lng?: number;
}

export interface PublicItineraryActivity {
  time: string;
  name: string;
  category?: string;
  description?: string;
  estimatedCost?: number;
}

export interface PublicItineraryDay {
  day: number;
  city?: string;
  theme: string;
  activities: PublicItineraryActivity[];
}

export interface PublicReview {
  id: string;
  text: string;
  destination: string;
  days: number;
  rating: number;
  highlight: string;
  photos: string[];
  memberNames: string[];
  reviewedAt: string;
  vibes: string[];
  itineraryDays: PublicItineraryDay[] | null;
  confirmedAccommodation: AccommodationSuggestion | null;
}

export interface SavedActivity {
  id: string;
  reviewId: string;
  destination: string;
  cityKey: string;
  day: number;
  time: string;
  name: string;
  description: string;
  category: string;
  estimatedCost?: number;
  savedAt: number;
}

export interface SavedStay {
  id: string;
  reviewId: string;
  destination: string;
  cityKey: string;
  accommodation: AccommodationSuggestion;
  savedAt: number;
}

export interface SavedDestination {
  id: string;
  destination: string;
  days: number;
  rating: number;
  highlight: string;
  photos: string[];
  memberNames: string[];
  vibes: string[];
  savedAt: number;
}

export interface PackItem {
  text: string;
  checked: boolean;
}

export type PackingList = Record<string, PackItem[]>;

/* ── Public review serialization ───────────────────────────────────── */

function serializePublicActivity(a: any) {
  return {
    time: a?.time || "",
    name: a?.name || "",
    category: classifyActivity({ name: a?.name, description: a?.description, fallback: a?.category || a?.tag }),
    description: a?.description || "",
    ...(typeof a?.estimatedCost === "number" ? { estimatedCost: a.estimatedCost } : {}),
  };
}

function serializePublicItineraryDays(trip: any, maxActivities: number) {
  if (!Array.isArray(trip?.itinerary?.days)) return null;
  return (trip.itinerary.days as any[]).map((d: any, di: number) => ({
    day: d.day ?? d.dayNumber ?? di + 1,
    city: d.city || trip.destination || "",
    theme: d.theme || d.title || `Day ${d.day ?? d.dayNumber ?? di + 1}`,
    activities: (d.activities || []).slice(0, maxActivities).map(serializePublicActivity),
  }));
}

/** Firebase-safe public copy of a confirmed stay (no undefined values). */
export function serializePublicAccommodation(a: any): AccommodationSuggestion | null {
  if (!a || typeof a !== "object" || !a.name) return null;
  const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const strs = (v: any) => (Array.isArray(v) ? v.filter((x: any) => typeof x === "string") : []);
  const type = ["hotel", "airbnb", "hostel", "other"].includes(a.type) ? a.type : "other";
  return {
    id: String(a.id || "stay"),
    name: String(a.name),
    type,
    location: String(a.location || ""),
    totalCost: num(a.totalCost),
    costPerPerson: num(a.costPerPerson),
    nights: num(a.nights),
    rating: num(a.rating),
    amenities: strs(a.amenities),
    rooms: num(a.rooms),
    beds: num(a.beds),
    cancellation: String(a.cancellation || ""),
    whyItFits: String(a.whyItFits || ""),
    tags: strs(a.tags),
    distanceNote: String(a.distanceNote || ""),
    ...(typeof a.link === "string" && a.link ? { link: a.link } : {}),
    photos: strs(a.photos).filter((u: string) => !u.startsWith("data:")).slice(0, 3),
    submittedBy: String(a.submittedBy || ""),
  };
}

/* ── AsyncStorage helpers ─────────────────────────────────────────── */

function storageKey(uid: string) {
  return `gopack:trips:${uid}`;
}

async function getLocalTripIds(uid: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(uid));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

async function addLocalTripId(uid: string, tripId: string): Promise<void> {
  try {
    const ids = await getLocalTripIds(uid);
    if (!ids.includes(tripId)) {
      await AsyncStorage.setItem(
        storageKey(uid),
        JSON.stringify([...ids, tripId]),
      );
    }
  } catch {}
}

async function removeLocalTripId(uid: string, tripId: string): Promise<void> {
  try {
    const ids = await getLocalTripIds(uid);
    await AsyncStorage.setItem(
      storageKey(uid),
      JSON.stringify(ids.filter((id) => id !== tripId)),
    );
  } catch {}
}

/* ── useTrips ─────────────────────────────────────────────────────── */

export function useTrips(uid: string | undefined) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const refetch = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!uid) {
      setTrips([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    async function load() {
      const localIds = await getLocalTripIds(uid!);

      let firebaseIds: string[] = [];
      try {
        const snap = await get(ref(db, `userTrips/${uid}`));
        if (snap.exists()) {
          const val = snap.val() as Record<string, boolean | string>;
          // only include genuinely joined trips (value === true), not packs or pending invites
          firebaseIds = Object.entries(val)
            .filter(([, v]) => v === true)
            .map(([k]) => k);
        }
      } catch {}

      const allIds = [...new Set([...localIds, ...firebaseIds])];

      if (allIds.length === 0) {
        if (!cancelled) { setTrips([]); setLoading(false); }
        return;
      }

      try {
        const snaps = await Promise.all(
          allIds.map((id) => get(ref(db, `trips/${id}`))),
        );
        const data: Trip[] = snaps
          .map((s, i) =>
            s.exists() ? ({ id: allIds[i], ...s.val() } as Trip) : null,
          )
          .filter((t): t is Trip => t !== null && !t.isPack)
          .sort(
            (a, b) =>
              new Date(b.createdAt ?? 0).getTime() -
              new Date(a.createdAt ?? 0).getTime(),
          );
        if (!cancelled) setTrips(data);
      } catch {}

      if (!cancelled) setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [uid, version]);

  return { trips, loading, refetch };
}

/* ── useTrip ──────────────────────────────────────────────────────── */

export function useTrip(tripId: string | undefined) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tripId) { setLoading(false); return; }
    const tripRef = ref(db, `trips/${tripId}`);
    return onValue(tripRef, (snap) => {
      const data = snap.val();
      setTrip(data ? ({ id: tripId, ...data } as Trip) : null);
      setLoading(false);

      // Auto-patch: if a review exists without itinerary snapshot but the trip
      // has itinerary data, write it to both /trips/{id}/review and /reviews/{id}.
      // Fires when any trip member opens the trip page — ensures the Discover page
      // always has itinerary data without needing Firebase Storage read access.
      if (
        data?.review &&
        !data.review.itineraryDays?.length &&
        Array.isArray(data.itinerary?.days) &&
        data.itinerary.days.length > 0
      ) {
        const itineraryDays = serializePublicItineraryDays(data, 5);
        const patched = { ...data.review, itineraryDays };
        update(ref(db, `trips/${tripId}`), { review: patched }).catch(() => {});
        if (data.review.isPublic !== false) {
          set(ref(db, `reviews/${tripId}`), patched).catch(() => {});
        }
      }

      // Backfill: publish the confirmed stay on the signed-in member's own
      // public review if it was submitted before stays were included.
      const myUid = auth.currentUser?.uid;
      const myReview = myUid ? data?.memberReviews?.[myUid] : undefined;
      const publicStay = serializePublicAccommodation(data?.confirmedAccommodation);
      if (myUid && myReview && publicStay && !myReview.confirmedAccommodation) {
        update(ref(db, `trips/${tripId}/memberReviews/${myUid}`), { confirmedAccommodation: publicStay }).catch(() => {});
        if (myReview.isPublic !== false) {
          get(ref(db, `reviews/${tripId}_${myUid}`))
            .then((snap) => {
              if (snap.exists() && !snap.val()?.confirmedAccommodation) {
                return update(ref(db, `reviews/${tripId}_${myUid}`), { confirmedAccommodation: publicStay });
              }
            })
            .catch(() => {});
        }
      }
    });
  }, [tripId]);

  return { trip, loading };
}

/* ── useWishes ────────────────────────────────────────────────────── */

export function useWishes(tripId: string | undefined) {
  const [wishes, setWishes] = useState<Wish[]>([]);

  useEffect(() => {
    if (!tripId) return;
    return onValue(ref(db, `trips/${tripId}/wishes`), (snap) => {
      const data = snap.val() as Record<string, any> | null;
      if (!data) { setWishes([]); return; }
      const list = Object.entries(data).map(([id, w]) => {
        const upvoters: Record<string, string> = w.upvoters ?? {};
        const downvoters: Record<string, string> = w.downvoters ?? {};
        const score = Object.keys(upvoters).length - Object.keys(downvoters).length;
        return { id, ...w, upvoters, downvoters, score } as Wish;
      });
      setWishes(list.sort((a, b) => b.score - a.score));
    });
  }, [tripId]);

  return wishes;
}

export function useRecentWishes(uid: string | undefined, tripIds: string[]) {
  const [wishes, setWishes] = useState<ProfileWish[]>([]);
  const [loading, setLoading] = useState(true);
  const tripKey = tripIds.join("|");

  useEffect(() => {
    if (!uid || tripIds.length === 0) {
      setWishes([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all(
      tripIds.map(async (tripId) => {
        const snap = await get(ref(db, `trips/${tripId}`));
        if (!snap.exists()) return [];
        const trip = snap.val() as { destination?: string; wishes?: Record<string, any> };
        return Object.entries(trip.wishes ?? {})
          .filter(([, wish]) => wish?.authorId === uid)
          .map(([id, wish]) => ({
            id,
            tripId,
            text: wish.text ?? "",
            authorId: wish.authorId ?? uid,
            authorName: wish.authorName ?? "",
            upvoters: wish.upvoters ?? {},
            downvoters: wish.downvoters ?? {},
            score: Object.keys(wish.upvoters ?? {}).length - Object.keys(wish.downvoters ?? {}).length,
            createdAt: wish.createdAt ?? 0,
            tripDestination: trip.destination ?? "Trip",
          }) as ProfileWish);
      }),
    )
      .then((groups) => {
        if (cancelled) return;
        setWishes(groups.flat().sort((a, b) => b.createdAt - a.createdAt));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setWishes([]);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [uid, tripKey]);

  return { wishes, loading };
}

/* ── Account-scoped profile metadata ───────────────────────────────── */

function profilePath(uid: string) {
  // This remains inside the established user-owned branch; Firebase rules do
  // not allow Packyo to introduce a separate global profiles collection.
  return `userTrips/${uid}/profile`;
}

export function usePackyoProfile(uid: string | undefined) {
  const [profile, setProfile] = useState<PackyoProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    return onValue(
      ref(db, profilePath(uid)),
      (snap) => {
        const value = snap.val();
        setProfile(value && typeof value === "object" ? value as PackyoProfile : null);
        setLoading(false);
      },
      () => {
        setProfile(null);
        setLoading(false);
      },
    );
  }, [uid]);

  return { profile, loading };
}

export async function updatePackyoProfile(
  uid: string,
  patch: Partial<PackyoProfile>,
): Promise<void> {
  const cleanPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(cleanPatch).length > 0) {
    await update(ref(db, profilePath(uid)), cleanPatch);
  }
}

/** Derives profile history from permitted trip records; it does not duplicate trip data. */
export function useProfileTripCollections(
  trips: Trip[],
  displayName?: string | null,
  uid?: string,
) {
  const stays: ProfileStay[] = [];
  const activities: ProfileActivity[] = [];
  const memories: ProfileMemory[] = [];
  void displayName;

  for (const trip of trips) {
    // Stays and activities are now explicit saves (userTrips/{uid}/savedStays,
    // savedActivities). They are no longer derived automatically from trips.
    const memberGuide = uid ? trip.memoryGuides?.[uid] : undefined;
    const legacyReview = trip.review as { reviewedBy?: string; photos?: string[] } | undefined;
    const memberReview = uid
      ? trip.memberReviews?.[uid] as { photos?: string[] } | undefined
      : undefined;
    const guide = memberGuide ?? (uid && legacyReview?.reviewedBy === uid ? trip.memoryGuide : undefined);
    if (guide) {
      memories.push({
        id: `${trip.id}:memory`,
        tripId: trip.id,
        destination: trip.destination,
        generatedAt: guide.generatedAt,
        title: guide.title,
        photo: memberReview?.photos?.[0] ?? legacyReview?.photos?.[0],
      });
    }

  }

  return {
    stays: stays.sort((a, b) => String(b.startDate ?? "").localeCompare(String(a.startDate ?? ""))),
    activities,
    memories: memories.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)),
  };
}

/* ── useChat ──────────────────────────────────────────────────────── */

export function useChat(tripId: string | undefined) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    if (!tripId) return;
    return onValue(ref(db, `trips/${tripId}/chat`), (snap) => {
      const data = snap.val() as Record<string, Omit<ChatMessage, "id">> | null;
      if (!data) { setMessages([]); return; }
      const list = Object.entries(data).map(([id, m]) => ({ id, ...m } as ChatMessage));
      setMessages(list.sort((a, b) => a.timestamp - b.timestamp));
    });
  }, [tripId]);

  return messages;
}

/* ── usePackingList ───────────────────────────────────────────────── */

export function usePackingList(tripId: string | undefined) {
  const [packingList, setPackingList] = useState<PackingList | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tripId) { setLoading(false); return; }
    return onValue(ref(db, `trips/${tripId}/packingItems`), (snap) => {
      setPackingList(snap.exists() ? (snap.val() as PackingList) : null);
      setLoading(false);
    });
  }, [tripId]);

  return { packingList, loading };
}

/* ── usePublicReviews ─────────────────────────────────────────────── */

function normalizePublicItineraryDays(days: any): PublicItineraryDay[] | null {
  if (!Array.isArray(days)) return null;
  return days.map((day: any, dayIndex: number) => ({
    day: Number(day?.day ?? day?.dayNumber ?? dayIndex + 1),
    city: day?.city ?? "",
    theme: day?.theme ?? day?.title ?? `Day ${dayIndex + 1}`,
    activities: Array.isArray(day?.activities)
      ? day.activities.map((activity: any) => ({
          time: activity?.time ?? "",
          name: activity?.name ?? "",
          category: classifyActivity({
            name: activity?.name,
            description: activity?.description,
            fallback: activity?.category ?? activity?.tag ?? "",
          }),
          description: activity?.description ?? "",
          estimatedCost: typeof activity?.estimatedCost === "number" ? activity.estimatedCost : undefined,
        }))
      : [],
  }));
}

function normalizePublicReview(id: string, review: any): PublicReview {
  return {
    id,
    text: review?.text ?? review?.review ?? "",
    destination: review?.destination ?? "",
    days: review?.days ?? 0,
    rating: review?.rating ?? 0,
    highlight: review?.highlight ?? "",
    photos: review?.photos ?? [],
    memberNames: review?.memberNames ?? (review?.authorName ? [review.authorName] : []),
    reviewedAt: review?.reviewedAt ?? "",
    // Normalize vibes: stored as lowercase keys, display as capitalized labels.
    vibes: (review?.vibes ?? (review?.vibeLabel ? review.vibeLabel.split(" & ") : []))
      .map((v: string) => v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()),
    itineraryDays: normalizePublicItineraryDays(review?.itineraryDays),
    confirmedAccommodation: serializePublicAccommodation(review?.confirmedAccommodation),
  };
}

export function usePublicReviews(limit = 6): PublicReview[] {
  const [reviews, setReviews] = useState<PublicReview[]>([]);

  useEffect(() => {
    return onValue(ref(db, "reviews"), (snap) => {
      const data = snap.val();
      if (!data) return;
      const list = Object.entries(data).map(([id, review]) => normalizePublicReview(id, review));
      setReviews(list.slice(0, limit));
    });
  }, [limit]);

  return reviews;
}

export function usePublicReview(reviewId: string | undefined) {
  const [review, setReview] = useState<PublicReview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!reviewId) {
      setReview(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    return onValue(
      ref(db, `reviews/${reviewId}`),
      (snap) => {
        setReview(snap.exists() ? normalizePublicReview(reviewId, snap.val()) : null);
        setLoading(false);
      },
      () => {
        setReview(null);
        setLoading(false);
      },
    );
  }, [reviewId]);

  return { review, loading };
}

/* ── Saved public destinations ─────────────────────────────────────── */

function savedDestinationsPath(uid: string) {
  // Keep this under the existing per-user index. Firebase rules already grant
  // each signed-in user access to their own userTrips branch.
  return `userTrips/${uid}/savedDestinations`;
}

function normalizeSavedDestination(id: string, destination: any): SavedDestination {
  return {
    id,
    destination: destination?.destination ?? "",
    days: Number(destination?.days ?? 0),
    rating: Number(destination?.rating ?? 0),
    highlight: destination?.highlight ?? "",
    photos: Array.isArray(destination?.photos) ? destination.photos : [],
    memberNames: Array.isArray(destination?.memberNames) ? destination.memberNames : [],
    vibes: Array.isArray(destination?.vibes) ? destination.vibes : [],
    savedAt: Number(destination?.savedAt ?? 0),
  };
}

export function useSavedDestinations(uid: string | undefined) {
  const [savedDestinations, setSavedDestinations] = useState<SavedDestination[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setSavedDestinations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    return onValue(
      ref(db, savedDestinationsPath(uid)),
      (snap) => {
        const data = snap.val() as Record<string, any> | null;
        const list = data
          ? Object.entries(data).map(([id, destination]) => normalizeSavedDestination(id, destination))
          : [];
        setSavedDestinations(list.sort((a, b) => b.savedAt - a.savedAt));
        setLoading(false);
      },
      () => {
        setSavedDestinations([]);
        setLoading(false);
      },
    );
  }, [uid]);

  return { savedDestinations, loading };
}

export async function savePublicDestination(uid: string, review: PublicReview): Promise<void> {
  await set(ref(db, `${savedDestinationsPath(uid)}/${review.id}`), {
    destination: review.destination,
    days: review.days,
    rating: review.rating,
    highlight: review.highlight,
    // Keep the Profile card lightweight while retaining the best available image.
    photos: review.photos.slice(0, 1),
    memberNames: review.memberNames.slice(0, 4),
    vibes: review.vibes.slice(0, 4),
    savedAt: Date.now(),
  });
}

export async function removeSavedPublicDestination(uid: string, reviewId: string): Promise<void> {
  await set(ref(db, `${savedDestinationsPath(uid)}/${reviewId}`), null);
}

/* ── Explicit saved activities & stays ─────────────────────────────── */

function savedActivitiesPath(uid: string) {
  return `userTrips/${uid}/savedActivities`;
}
function savedStaysPath(uid: string) {
  return `userTrips/${uid}/savedStays`;
}

export function savedActivityKey(reviewId: string, day: number, activity: { name: string; time?: string }) {
  return `${keySegment(reviewId)}_d${keySegment(day)}_${keySegment(activity.name)}`;
}

export function savedStayKey(reviewId: string, stay: { name: string }) {
  return `${keySegment(reviewId)}_${keySegment(stay.name)}`;
}

function normalizeSavedActivity(id: string, v: any): SavedActivity {
  return {
    id,
    reviewId: String(v?.reviewId ?? ""),
    destination: String(v?.destination ?? ""),
    cityKey: String(v?.cityKey ?? normalizeCity(v?.destination)),
    day: Number(v?.day ?? 0),
    time: String(v?.time ?? ""),
    name: String(v?.name ?? ""),
    description: String(v?.description ?? ""),
    category: classifyActivity({ name: v?.name, description: v?.description, fallback: v?.category }),
    ...(typeof v?.estimatedCost === "number" ? { estimatedCost: v.estimatedCost } : {}),
    savedAt: Number(v?.savedAt ?? 0),
  };
}

function normalizeSavedStay(id: string, v: any): SavedStay | null {
  const accommodation = serializePublicAccommodation(v?.accommodation);
  if (!accommodation) return null;
  return {
    id,
    reviewId: String(v?.reviewId ?? ""),
    destination: String(v?.destination ?? ""),
    cityKey: String(v?.cityKey ?? normalizeCity(v?.destination)),
    accommodation,
    savedAt: Number(v?.savedAt ?? 0),
  };
}

function useLiveUserList<T>(uid: string | undefined, path: (uid: string) => string, map: (id: string, v: any) => T | null) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Never show a previous account's items while the next account loads.
    setItems([]);
    if (!uid) {
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    return onValue(
      ref(db, path(uid)),
      (snap) => {
        const data = snap.val() as Record<string, any> | null;
        const list = data
          ? Object.entries(data).map(([id, v]) => map(id, v)).filter((x): x is T => x !== null)
          : [];
        setItems(list);
        setLoading(false);
      },
      () => {
        setItems([]);
        setError(true);
        setLoading(false);
      },
    );
    // path/map are module-level stable functions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  return { items, loading, error };
}

export function useSavedActivities(uid: string | undefined) {
  const { items, loading, error } = useLiveUserList<SavedActivity>(uid, savedActivitiesPath, normalizeSavedActivity);
  return { savedActivities: [...items].sort((a, b) => b.savedAt - a.savedAt), loading, error };
}

export function useSavedStays(uid: string | undefined) {
  const { items, loading, error } = useLiveUserList<SavedStay>(uid, savedStaysPath, normalizeSavedStay);
  return { savedStays: [...items].sort((a, b) => b.savedAt - a.savedAt), loading, error };
}

export async function saveActivity(
  uid: string,
  review: Pick<PublicReview, "id" | "destination">,
  day: PublicItineraryDay,
  activity: PublicItineraryActivity,
): Promise<string> {
  const key = savedActivityKey(review.id, day.day, activity);
  const destination = review.destination || day.city || "";
  await set(ref(db, `${savedActivitiesPath(uid)}/${key}`), {
    reviewId: review.id,
    destination,
    cityKey: normalizeCity(destination),
    day: day.day,
    time: activity.time || "",
    name: activity.name || "",
    description: activity.description || "",
    category: classifyActivity({ name: activity.name, description: activity.description, fallback: activity.category }),
    ...(typeof activity.estimatedCost === "number" ? { estimatedCost: activity.estimatedCost } : {}),
    savedAt: Date.now(),
  });
  return key;
}

export async function removeSavedActivity(uid: string, key: string): Promise<void> {
  await set(ref(db, `${savedActivitiesPath(uid)}/${key}`), null);
}

export async function saveStay(
  uid: string,
  review: Pick<PublicReview, "id" | "destination">,
  accommodation: AccommodationSuggestion,
): Promise<string> {
  const clean = serializePublicAccommodation(accommodation);
  if (!clean) throw new Error("This stay can't be saved.");
  const key = savedStayKey(review.id, clean);
  await set(ref(db, `${savedStaysPath(uid)}/${key}`), {
    reviewId: review.id,
    destination: review.destination,
    cityKey: normalizeCity(review.destination),
    accommodation: clean,
    savedAt: Date.now(),
  });
  return key;
}

export async function removeSavedStay(uid: string, key: string): Promise<void> {
  await set(ref(db, `${savedStaysPath(uid)}/${key}`), null);
}

/** Deterministic id for a saved stay added to a trip, so it can only be added once. */
export function savedStaySuggestionId(stay: SavedStay) {
  return `saved-${stay.id}`;
}

function toSuggestionList(value: any): AccommodationSuggestion[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === "object") {
    // RTDB may return sparse arrays as index-keyed objects; keep index order.
    return Object.keys(value)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => value[k])
      .filter(Boolean);
  }
  return [];
}

export function isSavedStaySuggestion(s: { id?: string } | null | undefined) {
  return String(s?.id ?? "").startsWith("saved-");
}

/**
 * Saved prices come from a past trip. Re-estimate for this trip by scaling the
 * historical nightly rate to the new nights and splitting by group size.
 */
export function estimateSavedStayCost(stay: SavedStay, nights: number, memberCount: number) {
  const base = stay.accommodation;
  const pastNights = Math.max(base.nights || 0, 0);
  const groupSize = Math.max(memberCount, 1);
  const nightly = base.totalCost > 0 && pastNights > 0 ? base.totalCost / pastNights : 0;
  const totalCost = nightly > 0 ? Math.round(nightly * Math.max(nights, 1)) : 0;
  return {
    nightly: Math.round(nightly),
    totalCost,
    costPerPerson: totalCost > 0 ? Math.round(totalCost / groupSize) : 0,
  };
}

/**
 * Appends a saved stay to the trip's accommodation suggestions atomically.
 * Existing entries keep their indices (votes are keyed by index), so no votes
 * are lost. Locks are cleared afterwards so locked members can see and vote on
 * the new option. Idempotent by deterministic suggestion id.
 */
export async function addSavedStayToTrip(
  tripId: string,
  stay: SavedStay,
  submittedBy: string,
  trip: Pick<Trip, "days" | "members">,
): Promise<"added" | "exists"> {
  const suggestionId = savedStaySuggestionId(stay);
  const memberCount = Math.max(Object.keys(trip.members ?? {}).length, 1);
  const nights = Math.max(trip.days || 1, 1);
  const estimate = estimateSavedStayCost(stay, nights, memberCount);
  const base = stay.accommodation;
  const pastNote = base.totalCost > 0
    ? `Past-trip estimate: about $${estimate.nightly}/night when stayed on a previous Packyo trip to ${stay.destination}. Check current prices before booking.`
    : `Saved from a past Packyo trip to ${stay.destination}. No price on record; check current prices.`;
  const suggestion: AccommodationSuggestion = {
    ...base,
    id: suggestionId,
    nights,
    totalCost: estimate.totalCost,
    costPerPerson: estimate.costPerPerson,
    beds: base.beds || memberCount,
    whyItFits: pastNote,
    tags: Array.from(new Set([...(base.tags ?? []).filter((t) => t !== "Member pick"), "Saved stay", "Past-trip estimate"])),
    submittedBy,
  };

  let outcome: "added" | "exists" = "exists";
  const result = await runTransaction(ref(db, `trips/${tripId}/accommodationSuggestions`), (current) => {
    const list = toSuggestionList(current);
    if (list.some((s) => s?.id === suggestionId)) {
      outcome = "exists";
      return; // abort: no write
    }
    outcome = "added";
    return [...list, suggestion];
  });
  if (result.committed && (outcome as "added" | "exists") === "added") {
    // A new option exists: unlock everyone so they can weigh in. Votes stay.
    await set(ref(db, `trips/${tripId}/accommodationLockedBy`), null).catch(() => {});
    return "added";
  }
  return "exists";
}

/**
 * Stores freshly generated AI suggestions without dropping saved-stay picks that
 * members added (including ones added while the AI request was in flight).
 * Saved picks keep their indices; every other slot is replaced and its votes
 * are cleared, so no vote ends up attached to a different stay.
 */
export async function mergeAiAccommodationSuggestions(
  tripId: string,
  aiSuggestions: AccommodationSuggestion[],
): Promise<void> {
  let replacedIndices: number[] = [];
  await runTransaction(ref(db, `trips/${tripId}/accommodationSuggestions`), (current) => {
    const list = toSuggestionList(current);
    const queue = [...aiSuggestions];
    const next: AccommodationSuggestion[] = [];
    replacedIndices = [];
    const lastSavedIdx = list.reduce((acc, s, i) => (isSavedStaySuggestion(s) ? i : acc), -1);
    list.forEach((s, idx) => {
      if (isSavedStaySuggestion(s)) {
        next.push(s);
      } else if (queue.length > 0) {
        next.push(queue.shift()!);
        replacedIndices.push(idx);
      } else if (idx < lastSavedIdx) {
        // Rare: fewer AI results than old slots. Keep the old option (and its
        // votes) rather than shifting a later saved stay to another index.
        next.push(s);
      } else {
        replacedIndices.push(idx);
      }
    });
    return [...next, ...queue];
  });
  const patch: Record<string, unknown> = {
    accommodationStatus: "voting",
    accommodationPreferences: null,
    accommodationLockedBy: null,
  };
  for (const idx of new Set(replacedIndices)) patch[`accommodationVotes/${idx}`] = null;
  await update(ref(db, `trips/${tripId}`), patch);
}

/* ── submitTripReview ─────────────────────────────────────────────── */

export async function submitTripReview(
  tripId: string,
  trip: any,
  uid: string,
  reviewData: {
    rating: number;
    text: string;
    vibes: string[];
    highlight: string;
    isPublic: boolean;
    photoUris: string[];
  },
): Promise<void> {
  const member = trip?.members?.[uid];
  if (!member) {
    throw new Error("Only members of this trip can leave a review.");
  }
  const tripEnd = trip?.endDate ?? (
    trip?.startDate
      ? new Date(
          new Date(`${trip.startDate}T00:00:00`).getTime() +
            Math.max(Number(trip.days) || 1, 1) * 86400000,
        ).toISOString().slice(0, 10)
      : null
  );
  if (!tripEnd || new Date(`${tripEnd}T23:59:59`).getTime() > Date.now()) {
    throw new Error("Reviews open after this trip has finished.");
  }

  // Convert photos to base64 data-URIs and store directly in RTDB.
  // Firebase Storage rules block unauthenticated writes; using base64 in RTDB
  // sidesteps that entirely without needing a storage rule change.
  const photoUrls = await Promise.all(
    reviewData.photoUris.map(async (uri) => {
      const blob = await fetch(uri).then((r) => r.blob());
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }),
  );

  const memberEntries = Object.values(trip.members || {}) as any[];
  const itineraryDays = serializePublicItineraryDays(trip, 4);
  const publicStay = serializePublicAccommodation(trip.confirmedAccommodation);

  const review = {
    rating: reviewData.rating,
    text: reviewData.text,
    vibes: reviewData.vibes,
    highlight: reviewData.highlight,
    isPublic: reviewData.isPublic,
    photos: photoUrls,
    destination: trip.destination,
    days: trip.days,
    memberCount: memberEntries.length,
    memberNames: memberEntries.map((m: any) => m.name).filter(Boolean),
    reviewedAt: new Date().toISOString(),
    reviewedBy: uid,
    ...(itineraryDays ? { itineraryDays } : {}),
    ...(publicStay ? { confirmedAccommodation: publicStay } : {}),
  };

  await set(ref(db, `trips/${tripId}/memberReviews/${uid}`), review);
  // Keep the original single-review field populated for older clients and
  // existing Discover links. New clients use memberReviews for member gating.
  if (!trip.review) {
    await set(ref(db, `trips/${tripId}/review`), review);
  }
  if (reviewData.isPublic) {
    await set(ref(db, `reviews/${tripId}_${uid}`), review);
  } else {
    await set(ref(db, `reviews/${tripId}_${uid}`), null);
  }
}

/* ── Helpers ──────────────────────────────────────────────────────── */

/* ── createTrip ───────────────────────────────────────────────────── */

export async function createTrip(data: {
  destination: string;
  days: number;
  vibes: string[];
  budget: string;
  showEstimatedCosts?: boolean;
  planningDefaults?: {
    pace: string;
    focus: string;
  };
  startDate: string;
  endDate: string;
  uid: string;
  displayName: string;
}) {
  const newTripRef = push(ref(db, "trips"));
  const tripId = newTripRef.key!;

  const tripData = {
    destination: data.destination,
    days: data.days,
    vibes: data.vibes,
    budget: data.budget,
    showEstimatedCosts: data.showEstimatedCosts ?? true,
    planningDefaults: data.planningDefaults,
    startDate: data.startDate,
    endDate: data.endDate,
    hostMemberId: data.uid,
    createdAt: new Date().toISOString(),
    members: {
      [data.uid]: {
        name: data.displayName,
        joinedAt: new Date().toISOString(),
        isHost: true,
      },
    },
  };

  await set(newTripRef, tripData);

  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== data.uid) {
    await set(newTripRef, null).catch(() => undefined);
    throw new Error("Sign in again before creating a trip.");
  }
  const token = await currentUser.getIdToken();
  const codeResponse = await apiFetch("/api/reserve-invite-code", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ tripId }),
  });
  if (!codeResponse.ok) {
    await set(newTripRef, null).catch(() => undefined);
    const body = await codeResponse.json().catch(() => ({})) as { error?: string };
    if (codeResponse.status === 404) {
      throw new Error(
        "Packyo's trip service is out of date. Please try again after the service is updated.",
      );
    }
    if (codeResponse.status === 401) {
      throw new Error("Your sign-in expired. Sign in again, then retry.");
    }
    throw new Error(body.error ?? "Could not create a secure invite code. Please try again.");
  }

  await addLocalTripId(data.uid, tripId);

  try { await set(ref(db, `userTrips/${data.uid}/${tripId}`), true); } catch {}
  return tripId;
}

/* ── joinTrip ─────────────────────────────────────────────────────── */

function inviteError(error: unknown, fallback: string): Error {
  const code = (error as { code?: string })?.code;
  if (code === "PERMISSION_DENIED" || code === "permission-denied") {
    return new Error(
      "Packyo could not verify this invite with your account. Make sure you are signed in, then ask the trip host to send a fresh invite.",
    );
  }
  return new Error(fallback);
}

export async function joinTrip(tripId: string, uid: string, displayName: string) {
  const input = tripId.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  const candidate = decodeURIComponent(input.split("/").pop() ?? input).trim();
  if (!candidate) throw new Error("Enter an invite code or trip link.");

  // The trusted API can read the invite-code index even when client RTDB rules
  // intentionally hide it. It also performs membership + user index writes as
  // one authenticated operation, which makes code-only joining reliable.
  const currentUser = auth.currentUser;
  if (currentUser?.uid === uid) {
    const token = await currentUser.getIdToken();
    const response = await apiFetch("/api/join-by-invite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ invite: candidate, displayName }),
    });
    const result = await response.json().catch(() => ({})) as { tripId?: string; error?: string };
    if (response.ok && result.tripId) return result.tripId;
    if (response.status !== 404) {
      throw new Error(result.error ?? "We couldn't join that trip. Please try again.");
    }
  }

  // Invite links may contain the short invite code, while older links may
  // contain the Firebase trip ID. Try the code index first, then fall back to
  // the direct ID for backwards compatibility.
  const codeCandidates = [
    candidate,
    candidate.toUpperCase(),
    candidate.replace(/[^a-z0-9]/gi, "").toUpperCase(),
  ];
  let id = candidate;
  for (const code of [...new Set(codeCandidates)]) {
    let codeSnap;
    try {
      codeSnap = await get(ref(db, `inviteCodes/${code}`));
    } catch (error) {
      throw inviteError(error, "We couldn't verify that invite code. Please try again.");
    }
    if (codeSnap.exists() && typeof codeSnap.val() === "string") {
      id = codeSnap.val() as string;
      break;
    }
  }

  // Read the specific trip by ID — Firebase rules allow reading a known trip
  // by its ID for any authenticated user (same approach as the web app).
  let snap;
  try {
    snap = await get(ref(db, `trips/${id}`));
  } catch (error) {
    throw inviteError(error, "We couldn't open that trip. Please try again.");
  }
  if (!snap.exists()) throw new Error("Trip not found. Check the ID and try again.");
  if ((snap.val() as { isPack?: boolean }).isPack) {
    throw new Error("That invite is for a pack, not a trip.");
  }

  const existingMember = (snap.val() as Trip).members?.[uid];
  try {
    if (!existingMember) {
      await update(ref(db, `trips/${id}/members`), {
        [uid]: {
          name: displayName,
          joinedAt: new Date().toISOString(),
          isHost: false,
        },
      });
    }
  } catch (error) {
    throw inviteError(error, "We couldn't add you to this trip. Ask the host to check the invite and try again.");
  }

  await addLocalTripId(uid, id);
  try {
    await set(ref(db, `userTrips/${uid}/${id}`), true);
  } catch {
    // Membership already succeeded. The local index keeps the trip visible;
    // the next successful signed-in session will repair the remote index.
  }

  return id;
}

/* ── addWish / voteWish ───────────────────────────────────────────── */

export async function addWish(
  tripId: string,
  text: string,
  uid: string,
  displayName: string,
) {
  const wishRef = push(ref(db, `trips/${tripId}/wishes`));
  await set(wishRef, {
    text,
    authorId: uid,
    authorName: displayName,
    upvoters: {},
    downvoters: {},
    createdAt: Date.now(),
  });
}

export async function voteWish(
  tripId: string,
  wishId: string,
  uid: string,
  userName: string,
  dir: "up" | "down",
) {
  const snap = await get(ref(db, `trips/${tripId}/wishes/${wishId}`));
  const wish = snap.val() ?? {};
  const upvoters: Record<string, string> = wish.upvoters ?? {};
  const downvoters: Record<string, string> = wish.downvoters ?? {};
  const updates: Record<string, unknown> = {};

  if (dir === "up") {
    if (upvoters[uid]) {
      updates[`trips/${tripId}/wishes/${wishId}/upvoters/${uid}`] = null;
    } else {
      updates[`trips/${tripId}/wishes/${wishId}/upvoters/${uid}`] = userName;
      if (downvoters[uid]) {
        updates[`trips/${tripId}/wishes/${wishId}/downvoters/${uid}`] = null;
      }
    }
  } else {
    if (downvoters[uid]) {
      updates[`trips/${tripId}/wishes/${wishId}/downvoters/${uid}`] = null;
    } else {
      updates[`trips/${tripId}/wishes/${wishId}/downvoters/${uid}`] = userName;
      if (upvoters[uid]) {
        updates[`trips/${tripId}/wishes/${wishId}/upvoters/${uid}`] = null;
      }
    }
  }
  await update(ref(db), updates);
}

/* ── useNotifications ─────────────────────────────────────────────── */

export interface AppNotification {
  id: string;
  type:
    | "itinerary_ready"
    | "accom_vote"
    | "dest_vote"
    | "votes_complete"
    | "dest_confirmed"
    | "new_member"
    | "chat"
    | "invite"
    | "trip_invite";
  text: string;
  subtext?: string;
  tripId: string;
  tripName: string;
  timestamp: number;
  actionable?: boolean;
  serverNotificationId?: string;
}

export function useNotifications(uid: string | undefined) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setNotifications([]); setLoading(false); return; }

    // Subscribe to the user's trip ID list
    const unsubTrips = onValue(ref(db, `userTrips/${uid}`), async (snap) => {
      const val = snap.val() as Record<string, boolean | string> | null;
      if (!val) { setNotifications([]); setLoading(false); return; }

      const tripIds = Object.entries(val)
        .filter(([, v]) => v === true)
        .map(([k]) => k);

      if (tripIds.length === 0) { setNotifications([]); setLoading(false); return; }

      // Fetch each trip once (not subscribing to avoid N listeners)
      const snaps = await Promise.all(tripIds.map((id) => get(ref(db, `trips/${id}`))));

      const events: AppNotification[] = [];

      for (const snap of snaps) {
        if (!snap.exists()) continue;
        const d = snap.val() as any;
        const tripId = snap.key!;
        if (d.isPack) continue;

        const dest = d.destination ?? d.packName ?? "your trip";
        const members = Object.entries(d.members ?? {});
        const memberCount = members.length;
        const lockedCount = Object.keys(d.votesLockedBy ?? {}).length;
        const allLocked = memberCount > 0 && lockedCount >= memberCount;
        const myAccomVote = d.accommodationVotes?.[uid];
        const myDestVote = d.destinationVotes ? Object.values(d.destinationVotes as Record<string, any>).some((v: any) => v?.[uid]) : false;
        const createdTs = d.createdAt ? new Date(d.createdAt).getTime() : 0;

        // Itinerary ready
        if (d.itinerary?.days?.length > 0) {
          events.push({
            id: `${tripId}-itinerary`,
            type: "itinerary_ready",
            text: `Itinerary ready`,
            subtext: `Your ${dest} itinerary has been generated.`,
            tripId,
            tripName: dest,
            timestamp: createdTs + 86400000 * 3,
          });
        }

        // Accommodation vote needed
        if (d.accommodationStatus === "voting" && !myAccomVote) {
          events.push({
            id: `${tripId}-accom-vote`,
            type: "accom_vote",
            text: `Accommodation vote`,
            subtext: `${dest} needs your vote on where to stay.`,
            tripId,
            tripName: dest,
            timestamp: Date.now() - 1000 * 60 * 10,
            actionable: true,
          });
        }

        // Destination vote needed
        if ((d.destinationSuggestions?.length ?? 0) > 0 && !d.destination && !myDestVote) {
          events.push({
            id: `${tripId}-dest-vote`,
            type: "dest_vote",
            text: `Destination vote open`,
            subtext: `AI found matches for your pack — vote now.`,
            tripId,
            tripName: dest,
            timestamp: Date.now() - 1000 * 60 * 20,
            actionable: true,
          });
        }

        // All wishes votes locked → itinerary can be built
        if (allLocked && !d.itinerary) {
          events.push({
            id: `${tripId}-votes-done`,
            type: "votes_complete",
            text: `Wishlist voting complete`,
            subtext: `All ${memberCount} members voted for ${dest}. Ready to build the itinerary.`,
            tripId,
            tripName: dest,
            timestamp: Date.now() - 1000 * 60 * 30,
          });
        }

        // Destination confirmed
        if (d.destination) {
          events.push({
            id: `${tripId}-dest-confirmed`,
            type: "dest_confirmed",
            text: `Destination confirmed`,
            subtext: `${d.destination} is your pack's destination.`,
            tripId,
            tripName: d.destination,
            timestamp: createdTs + 3600000,
          });
        }

        // New member joined (show all non-self members as "joined" events)
        for (const [muid, m] of members as [string, any][]) {
          if (muid === uid) continue;
          const joinedTs = m.joinedAt ? new Date(m.joinedAt).getTime() : createdTs;
          events.push({
            id: `${tripId}-member-${muid}`,
            type: "new_member",
            text: `${m.name} joined ${dest}`,
            subtext: `Your pack is growing!`,
            tripId,
            tripName: dest,
            timestamp: joinedTs,
          });
        }

        // Latest chat message
        const chatSnap = await get(ref(db, `trips/${tripId}/chat`));
        if (chatSnap.exists()) {
          const chatData = chatSnap.val() as Record<string, any>;
          const msgs = Object.values(chatData).sort((a: any, b: any) => b.timestamp - a.timestamp);
          const latest = msgs[0] as any;
          if (latest && latest.authorId !== uid) {
            events.push({
              id: `${tripId}-chat`,
              type: "chat",
              text: `${latest.authorName} in ${dest}`,
              subtext: latest.text.length > 60 ? latest.text.slice(0, 60) + "…" : latest.text,
              tripId,
              tripName: dest,
              timestamp: latest.timestamp,
            });
          }
        }
      }

      // Sort newest first, deduplicate by id
      const seen = new Set<string>();
      const deduped = events
        .sort((a, b) => b.timestamp - a.timestamp)
        .filter((e) => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });

      setNotifications(deduped);
      setLoading(false);
    });

    return () => unsubTrips();
  }, [uid]);

  return { notifications, loading };
}

export async function lockVotes(tripId: string, uid: string) {
  await set(ref(db, `trips/${tripId}/votesLockedBy/${uid}`), true);
}

export async function unlockVotes(tripId: string, uid: string) {
  await set(ref(db, `trips/${tripId}/votesLockedBy/${uid}`), null);
}

/* ── Destination suggester ────────────────────────────────────────── */

export async function setCollectingPreferences(tripId: string, collecting: boolean) {
  await set(ref(db, `trips/${tripId}/collectingPreferences`), collecting || null);
}

export async function submitMemberPreference(
  tripId: string,
  uid: string,
  pref: Omit<MemberPreference, "submittedAt">,
) {
  await set(ref(db, `trips/${tripId}/memberPreferences/${uid}`), {
    ...pref,
    submittedAt: new Date().toISOString(),
  });
}

export async function storeDestinationSuggestions(
  tripId: string,
  suggestions: DestinationSuggestion[],
) {
  await update(ref(db, `trips/${tripId}`), {
    destinationSuggestions: suggestions,
    collectingPreferences: null,
    // memberPreferences intentionally kept so redo can re-use them
  });
}

export async function storeRedoSuggestions(
  tripId: string,
  suggestions: DestinationSuggestion[],
) {
  await update(ref(db, `trips/${tripId}`), {
    destinationSuggestions: suggestions,
    destination: null,
    destinationVotes: null,
    destinationLockedBy: null,
    aiDestinationDecision: null,
  });
}

export async function voteDestination(
  tripId: string,
  idx: number,
  uid: string,
  dir: "up" | "down",
) {
  const voteRef = ref(db, `trips/${tripId}/destinationVotes/${idx}/${uid}`);
  const snap = await get(voteRef);
  const current = snap.val() as string | null;
  await set(voteRef, current === dir ? null : dir);
}

export async function lockDestinationVotes(tripId: string, uid: string) {
  await set(ref(db, `trips/${tripId}/destinationLockedBy/${uid}`), true);
}

/** Reset all votes + locks (keep suggestions) so everyone re-swipes — used for tie-break re-vote. */
export async function resetDestinationForRevote(tripId: string) {
  await update(ref(db, `trips/${tripId}`), {
    destination: null,
    destinationVotes: null,
    destinationLockedBy: null,
    aiDestinationDecision: null,
  });
}

export async function unlockDestinationVotes(tripId: string, uid: string) {
  await set(ref(db, `trips/${tripId}/destinationLockedBy/${uid}`), null);
}

export async function confirmDestination(tripId: string, name: string) {
  await update(ref(db, `trips/${tripId}`), {
    destination: name,
    destinationSuggestions: null,
    destinationVotes: null,
    destinationLockedBy: null,
    aiDestinationDecision: null,
  });
}

export async function chooseDestinationWithAi(
  tripId: string,
  suggestionIndex: number,
  name: string,
  reason: string,
) {
  await update(ref(db, `trips/${tripId}`), {
    destination: name,
    aiDestinationDecision: {
      suggestionIndex,
      name,
      reason,
      decidedAt: new Date().toISOString(),
    },
  });
}

export async function clearDestinationSuggestions(tripId: string) {
  await update(ref(db, `trips/${tripId}`), {
    destinationSuggestions: null,
    destinationVotes: null,
    destinationLockedBy: null,
    collectingPreferences: true,
  });
}

/* ── sendMessage ──────────────────────────────────────────────────── */

export async function sendMessage(
  tripId: string,
  text: string,
  uid: string,
  displayName: string,
) {
  const msgRef = push(ref(db, `trips/${tripId}/chat`));
  await set(msgRef, {
    text: text.trim(),
    authorId: uid,
    authorName: displayName,
    timestamp: Date.now(),
  });
}

/* ── saveItinerary ────────────────────────────────────────────────── */

export async function saveItinerary(tripId: string, itinerary: unknown) {
  await set(ref(db, `trips/${tripId}/itinerary`), itinerary);
}

/* ── Packing list ─────────────────────────────────────────────────── */

export async function savePackingList(
  tripId: string,
  rawList: Record<string, string[]>,
) {
  const converted: PackingList = Object.fromEntries(
    Object.entries(rawList).map(([cat, items]) => [
      cat,
      items.map((text) => ({ text, checked: false })),
    ]),
  );
  await set(ref(db, `trips/${tripId}/packingItems`), converted);
}

export async function addPackItem(
  tripId: string,
  category: string,
  text: string,
) {
  const categoryRef = ref(db, `trips/${tripId}/packingItems/${category}`);
  const snap = await get(categoryRef);
  const rawItems = snap.val();
  const currentItems = Array.isArray(rawItems)
    ? rawItems
    : rawItems && typeof rawItems === "object"
      ? Object.values(rawItems)
      : [];

  await set(categoryRef, [
    ...currentItems,
    { text: text.trim(), checked: false },
  ]);
}

export async function togglePackItem(
  tripId: string,
  category: string,
  index: number,
  checked: boolean,
) {
  await set(
    ref(db, `trips/${tripId}/packingItems/${category}/${index}/checked`),
    checked,
  );
}

/* ── Trip metadata ────────────────────────────────────────────────── */

export async function updateTripStartDate(tripId: string, startDate: string) {
  await update(ref(db, `trips/${tripId}`), { startDate });
}

/* ── Accommodation flow ───────────────────────────────────────────── */

export async function setAccommodationStatus(
  tripId: string,
  status: Trip["accommodationStatus"],
) {
  await set(ref(db, `trips/${tripId}/accommodationStatus`), status ?? null);
}

export async function submitAccommodationPreference(
  tripId: string,
  uid: string,
  pref: Omit<AccommodationPreference, "submittedAt">,
) {
  await set(ref(db, `trips/${tripId}/accommodationPreferences/${uid}`), {
    ...pref,
    submittedAt: new Date().toISOString(),
  });
}

export async function storeAccommodationSuggestions(
  tripId: string,
  suggestions: AccommodationSuggestion[],
) {
  await update(ref(db, `trips/${tripId}`), {
    accommodationSuggestions: suggestions,
    accommodationStatus: "voting",
    accommodationPreferences: null,
  });
}

export async function addMemberAccommodationLink(
  tripId: string,
  suggestion: AccommodationSuggestion,
) {
  const existing = await get(ref(db, `trips/${tripId}/accommodationSuggestions`));
  const current: AccommodationSuggestion[] = existing.val() ?? [];
  await set(ref(db, `trips/${tripId}/accommodationSuggestions`), [...current, suggestion]);
}

export async function voteAccommodation(
  tripId: string,
  idx: number,
  uid: string,
  dir: "up" | "down",
) {
  const voteRef = ref(db, `trips/${tripId}/accommodationVotes/${idx}/${uid}`);
  const snap = await get(voteRef);
  const current = snap.val() as string | null;
  await set(voteRef, current === dir ? null : dir);
}

export async function lockAccommodationVotes(tripId: string, uid: string) {
  await set(ref(db, `trips/${tripId}/accommodationLockedBy/${uid}`), true);
}

export async function unlockAccommodationVotes(tripId: string, uid: string) {
  await set(ref(db, `trips/${tripId}/accommodationLockedBy/${uid}`), null);
}

export async function confirmAccommodation(
  tripId: string,
  suggestion: AccommodationSuggestion,
) {
  await update(ref(db, `trips/${tripId}`), {
    confirmedAccommodation: suggestion,
    accommodationStatus: "confirmed",
    accommodationSuggestions: null,
    accommodationVotes: null,
    accommodationLockedBy: null,
  });
}

/* ── Activity CRUD ────────────────────────────────────────────────── */

async function writeSharedActivity(body: {
  tripId: string;
  operation: "add" | "update" | "delete";
  dayNumber: number;
  activityId?: string;
  activityIndex?: number;
  targetActivity?: Activity;
  activity?: Partial<Activity>;
}) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Sign in before changing a shared activity.");
  const token = await currentUser.getIdToken();
  const response = await apiFetch("/api/trip-activity", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({} as { error?: string }));
  if (!response.ok) {
    throw new Error(result.error ?? "Could not save the shared activity.");
  }
}

export async function updateActivity(
  tripId: string,
  dayNumber: number,
  targetActivity: Activity,
  partial: Partial<Activity>,
  activityIndex?: number,
) {
  await writeSharedActivity({
    tripId,
    operation: "update",
    dayNumber,
    activityId: targetActivity.id,
    activityIndex,
    targetActivity,
    activity: partial,
  });
}

export async function addActivity(
  tripId: string,
  dayNumber: number,
  activity: Partial<Activity>,
) {
  const newAct: Activity = {
    time: activity.time ?? "12:00 PM",
    name: activity.name ?? "New activity",
    description: activity.description ?? "",
    tag: activity.tag ?? "culture",
    fromWish: false,
    suggester: activity.suggester ?? "Member",
    matchedVibe: activity.matchedVibe ?? null,
    estimatedCost: activity.estimatedCost ?? 0,
    labels: activity.labels ?? [],
    nearPrevious: activity.nearPrevious ?? false,
    photoQuery: activity.photoQuery,
    lat: activity.lat,
    lng: activity.lng,
  };
  await writeSharedActivity({ tripId, operation: "add", dayNumber, activity: newAct });
}

export async function deleteActivity(
  tripId: string,
  dayNumber: number,
  targetActivity: Activity,
  activityIndex?: number,
) {
  await writeSharedActivity({
    tripId,
    operation: "delete",
    dayNumber,
    activityId: targetActivity.id,
    activityIndex,
    targetActivity,
  });
}

export async function deleteTrip(tripId: string, uid: string) {
  await set(ref(db, `trips/${tripId}`), null);
  try { await set(ref(db, `userTrips/${uid}/${tripId}`), null); } catch {}
  await removeLocalTripId(uid, tripId);
}

export async function leaveTrip(tripId: string, uid: string) {
  await set(ref(db, `trips/${tripId}/members/${uid}`), null);
  try { await set(ref(db, `userTrips/${uid}/${tripId}`), null); } catch {}
  await removeLocalTripId(uid, tripId);
}

/**
 * Permanently removes all trip data associated with a user before their
 * account is deleted: trips they host are deleted entirely, trips they've
 * only joined have their membership removed, and the userTrips index is
 * cleared. Best-effort — failures on individual trips are swallowed so one
 * bad record can't block the rest of account deletion.
 */
export async function wipeUserData(uid: string) {
  let firebaseIds: string[] = [];
  try {
    const snap = await get(ref(db, `userTrips/${uid}`));
    if (snap.exists()) {
      firebaseIds = Object.entries(snap.val() as Record<string, unknown>)
        .filter(([, value]) => value === true)
        .map(([tripId]) => tripId);
    }
  } catch {}

  const localIds = await getLocalTripIds(uid);
  const tripIds = [...new Set([...firebaseIds, ...localIds])];

  await Promise.all(
    tripIds.map(async (tripId) => {
      try {
        const tripSnap = await get(ref(db, `trips/${tripId}`));
        if (!tripSnap.exists()) return;
        const trip = tripSnap.val() as Trip;
        if (trip.hostMemberId === uid) {
          await deleteTrip(tripId, uid);
        } else {
          await leaveTrip(tripId, uid);
        }
      } catch {}
    }),
  );

  try { await set(ref(db, `userTrips/${uid}`), null); } catch {}
  try { await AsyncStorage.removeItem(storageKey(uid)); } catch {}
}

export async function confirmPack(tripId: string) {
  await update(ref(db, `trips/${tripId}`), { packConfirmed: true });
}

export async function setTripPremium(tripId: string) {
  await update(ref(db, `trips/${tripId}`), { isPremium: true });
}

export async function setDayUnlocked(tripId: string, dayNumber: number) {
  await update(ref(db, `trips/${tripId}/unlockedDays`), { [String(dayNumber)]: true });
}

export async function incrementAiUsage(tripId: string, feature: string) {
  const r = ref(db, `trips/${tripId}/aiUsage/${feature}`);
  const snap = await get(r);
  const current = (snap.val() as number) ?? 0;
  await set(r, current + 1);
}

/* ── Pack (Travel Group) ─────────────────────────────────────────── */

export interface Pack {
  id: string;
  hostUid: string;
  name: string;
  createdAt: number;
  members: Record<string, { name: string }>;
  lastTripDestination?: string;
  lastTripAt?: number;
  tripIds?: Record<string, boolean>;
}

export interface PackInvite {
  id: string;        // composite "${packId}:${tripId}"
  packId: string;
  fromUid: string;
  fromName: string;
  tripId: string;
  destination: string;
  packName: string;
  createdAt: number;
}

export function usePacks(uid: string | undefined) {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) { setPacks([]); setLoading(false); return; }
    // packs are stored in /trips with isPack=true, indexed in /userTrips/{uid}/{packId} = "pack"
    return onValue(ref(db, `userTrips/${uid}`), (snap) => {
      const data = snap.val() as Record<string, boolean | string> | null;
      if (!data) { setPacks([]); setLoading(false); return; }
      const packIds = Object.entries(data)
        .filter(([, v]) => v === "pack")
        .map(([k]) => k);
      if (packIds.length === 0) { setPacks([]); setLoading(false); return; }
      Promise.all(packIds.map((pid) => get(ref(db, `trips/${pid}`))))
        .then((snaps) => {
          const list = snaps
            .map((s, i) => {
              if (!s.exists()) return null;
              const v = s.val();
              return {
                id: packIds[i],
                hostUid: v.hostMemberId ?? "",
                name: v.name ?? "Pack",
                createdAt: typeof v.createdAt === "number" ? v.createdAt : Date.parse(v.createdAt ?? "0"),
                members: v.members ?? {},
                lastTripDestination: v.lastTripDestination,
                lastTripAt: v.lastTripAt,
                tripIds: v.tripIds ?? {},
              } as Pack;
            })
            .filter((p): p is Pack => p !== null)
            .sort((a, b) => (b.lastTripAt ?? b.createdAt) - (a.lastTripAt ?? a.createdAt));
          setPacks(list);
          setLoading(false);
        })
        .catch((err) => {
          console.warn("usePacks fetch error:", err);
          setLoading(false);
        });
    });
  }, [uid]);

  return { packs, loading };
}

export function useInvites(uid: string | undefined) {
  const [invites, setInvites] = useState<PackInvite[]>([]);

  useEffect(() => {
    if (!uid) { setInvites([]); return; }
    const myUid = uid; // capture for use inside callbacks

    let cancelled = false;
    // Level 2: per-trip → watches /trips/{tripId}/savedPacks
    const tripUnsubs = new Map<string, () => void>();
    // Level 3: per-pack → watches /trips/{packId}/pendingInvites
    const packUnsubs = new Map<string, () => void>();
    // Aggregated invite list per pack, rebuilt on any change
    const invitesByPack = new Map<string, PackInvite[]>();

    function rebuildInvites() {
      if (cancelled) return;
      const list: PackInvite[] = [];
      invitesByPack.forEach((items) => list.push(...items));
      list.sort((a, b) => b.createdAt - a.createdAt);
      setInvites(list);
    }

    // Level 3: live subscription to a pack's pendingInvites
    function subscribeToPackInvites(packId: string) {
      if (packUnsubs.has(packId)) return;
      const unsub = onValue(ref(db, `trips/${packId}/pendingInvites`), (snap) => {
        if (cancelled) return;
        const packInvites: PackInvite[] = [];
        if (snap.exists()) {
          const invMap = snap.val() as Record<string, {
            destination: string; fromUid: string; fromName: string;
            packName: string; createdAt: number; members: Record<string, string>;
          }>;
          for (const [targetTripId, inv] of Object.entries(invMap)) {
            if (inv.members?.[myUid] === "pending") {
              packInvites.push({
                id: `${packId}:${targetTripId}`,
                packId,
                tripId: targetTripId,
                fromUid: inv.fromUid ?? "",
                fromName: inv.fromName ?? "Someone",
                destination: inv.destination ?? "",
                packName: inv.packName ?? "",
                createdAt: inv.createdAt ?? 0,
              });
            }
          }
        }
        invitesByPack.set(packId, packInvites);
        rebuildInvites();
      });
      packUnsubs.set(packId, unsub);
    }

    // Level 2: live subscription to a trip's savedPacks list
    function subscribeToTripPacks(tripId: string) {
      if (tripUnsubs.has(tripId)) return;
      const unsub = onValue(ref(db, `trips/${tripId}/savedPacks`), (snap) => {
        if (cancelled || !snap.exists()) return;
        Object.keys(snap.val() as Record<string, boolean>).forEach((packId) =>
          subscribeToPackInvites(packId),
        );
      });
      tripUnsubs.set(tripId, unsub);
    }

    // Level 1: watch which trips the user has joined
    const unsubUserTrips = onValue(ref(db, `userTrips/${uid}`), (snap) => {
      if (cancelled) return;
      const data = snap.val() as Record<string, boolean | string> | null;
      if (!data) { setInvites([]); return; }
      Object.entries(data)
        .filter(([, v]) => v === true)
        .forEach(([tripId]) => subscribeToTripPacks(tripId));
    });

    return () => {
      cancelled = true;
      unsubUserTrips();
      tripUnsubs.forEach((u) => u());
      packUnsubs.forEach((u) => u());
    };
  }, [uid]);

  return invites;
}

export async function savePack({
  hostUid,
  name,
  members,
  tripId,
  destination,
}: {
  hostUid: string;
  name: string;
  members: Record<string, { name: string }>;
  tripId: string;
  destination: string;
}): Promise<string> {
  // store pack as a special trip entry under the already-allowed /trips path
  const newRef = push(ref(db, "trips"));
  const packId = newRef.key!;
  await set(newRef, {
    isPack: true,
    hostMemberId: hostUid,
    name,
    destination,
    days: 0,
    vibes: [],
    budget: "",
    startDate: null,
    createdAt: Date.now(),
    members,
    lastTripDestination: destination,
    lastTripAt: Date.now(),
    tripIds: { [tripId]: true },
  });
  // Link pack into the originating trip so every member can discover it for invites
  await set(ref(db, `trips/${tripId}/savedPacks/${packId}`), true);
  // Index pack for the host only (own userTrips path ✓)
  await set(ref(db, `userTrips/${hostUid}/${packId}`), "pack");
  return packId;
}

export async function deletePack(packId: string, uid: string): Promise<void> {
  const packSnap = await get(ref(db, `trips/${packId}`));
  if (!packSnap.exists()) return;

  const pack = packSnap.val() as { hostMemberId?: string; tripIds?: Record<string, boolean> };
  if (pack.hostMemberId !== uid) {
    throw new Error("Only the pack host can delete this pack.");
  }

  const updates: Record<string, null> = {
    [`trips/${packId}`]: null,
    [`userTrips/${uid}/${packId}`]: null,
  };
  for (const tripId of Object.keys(pack.tripIds ?? {})) {
    updates[`trips/${tripId}/savedPacks/${packId}`] = null;
  }
  await update(ref(db), updates);
}

export async function renamePack(packId: string, name: string): Promise<void> {
  await update(ref(db, `trips/${packId}`), { name });
}

export async function removePackMember(packId: string, memberUid: string): Promise<void> {
  await set(ref(db, `trips/${packId}/members/${memberUid}`), null);
}

export async function addTripToPack(
  packId: string,
  tripId: string,
  destination: string,
): Promise<void> {
  await update(ref(db, `trips/${packId}`), {
    [`tripIds/${tripId}`]: true,
    lastTripDestination: destination,
    lastTripAt: Date.now(),
  });
  await set(ref(db, `trips/${tripId}/savedPacks/${packId}`), true);
}

export async function invitePackToTrip(
  pack: Pack,
  tripId: string,
  destination: string,
  fromUid: string,
  fromName: string,
): Promise<void> {
  // Build per-member status map (skip the inviter)
  const members: Record<string, string> = {};
  for (const memberUid of Object.keys(pack.members)) {
    if (memberUid === fromUid) continue;
    members[memberUid] = "pending";
  }
  if (Object.keys(members).length === 0) return;

  // Write invite to the PACK's own trip node (host writes to their own trip ✓)
  // No cross-user writes needed — friends discover this via savedPacks links on their shared trips
  const inviteWrite = set(ref(db, `trips/${pack.id}/pendingInvites/${tripId}`), {
    destination,
    fromUid,
    fromName,
    packName: pack.name,
    createdAt: Date.now(),
    members,
  });
  // Update pack metadata
  const packUpdate = update(ref(db, `trips/${pack.id}`), {
    [`tripIds/${tripId}`]: true,
    lastTripDestination: destination,
    lastTripAt: Date.now(),
  });
  // Retroactively ensure savedPacks links exist on all shared trips.
  // This handles packs that were saved before the savedPacks link was introduced,
  // and also triggers the friends' Level-2 subscriptions in useInvites immediately.
  const savedPacksWrites = Object.keys(pack.tripIds ?? {}).map((sharedTripId) =>
    set(ref(db, `trips/${sharedTripId}/savedPacks/${pack.id}`), true),
  );
  await Promise.all([inviteWrite, packUpdate, ...savedPacksWrites]);
}

export async function dismissInvite(uid: string, packId: string, tripId: string): Promise<void> {
  await set(ref(db, `trips/${packId}/pendingInvites/${tripId}/members/${uid}`), "dismissed");
}

export async function acceptInvite(
  packId: string,
  uid: string,
  displayName: string,
  tripId: string,
): Promise<void> {
  await set(ref(db, `trips/${tripId}/members/${uid}`), {
    name: displayName,
    joinedAt: new Date().toISOString(),
    isHost: false,
  });
  await set(ref(db, `userTrips/${uid}/${tripId}`), true);
  await set(ref(db, `trips/${packId}/pendingInvites/${tripId}/members/${uid}`), "accepted");
  await addLocalTripId(uid, tripId);
}
