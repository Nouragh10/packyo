import { useEffect, useState, useCallback } from "react";
import { ref, onValue, push, set, update, get, remove, runTransaction } from "firebase/database";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../lib/firebase";
import { useAuth } from "./useAuth";

/* ─── usePublicReviews ──────────────────────────────────────────
   Reads /reviews — publicly written by members after their trip ends.
   Requires Firebase RTDB rules to allow ".read": true at /reviews.
──────────────────────────────────────────────────────────────── */
/* ─── useGlobalStats ────────────────────────────────────────────
   Reads /trips to compute real aggregate stats (all trips ever).
   Falls back silently if Firebase rules deny access.
──────────────────────────────────────────────────────────────── */
export function useGlobalStats() {
  const [stats, setStats] = useState({ tripCount: 0, memberCount: 0, destinationCount: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const statsRef = ref(db, "stats");
    const unsubscribe = onValue(
      statsRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.val();
          setStats({
            tripCount: data.tripCount || 0,
            memberCount: data.memberCount || 0,
            destinationCount: data.destinationCount || 0,
          });
        }
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsubscribe();
  }, []);

  return { stats, loading };
}

/* Normalizes both old and new review schemas into a consistent shape.
   Old schema: { review, vibeLabel, authorName, itinerary, createdAt, authorUid, tripId }
   New schema: { text, vibes[], memberNames[], itineraryDays[], reviewedAt, reviewedBy } */
function normalizeReview(id: string, v: any) {
  // Text: new schema → "text", old schema → "review"
  const text = v.text?.trim() || v.review?.trim() || "";

  // Vibes: new schema → string[], old schema → "Culture & Foodie & ..." string
  const vibes: string[] = Array.isArray(v.vibes)
    ? v.vibes
    : v.vibeLabel
    ? v.vibeLabel.split(/\s*&\s*/).map((s: string) => s.trim()).filter(Boolean)
    : [];

  // Member names: new schema → string[], old schema → authorName string
  const memberNames: string[] = Array.isArray(v.memberNames)
    ? v.memberNames
    : v.authorName
    ? [v.authorName]
    : [];

  // Reviewed at: new schema → ISO string, old schema → unix ms timestamp
  const reviewedAt = v.reviewedAt
    || (v.createdAt ? new Date(Number(v.createdAt)).toISOString() : null);

  // Itinerary days: new schema → itineraryDays[], old schema → itinerary.days[]
  const itineraryDays: any[] | null =
    Array.isArray(v.itineraryDays) && v.itineraryDays.length > 0
      ? v.itineraryDays
      : Array.isArray(v.itinerary?.days) && v.itinerary.days.length > 0
      ? v.itinerary.days.map((d: any, di: number) => ({
          day: d.day ?? di + 1,
          theme: d.theme || d.title || `Day ${d.day ?? di + 1}`,
          activities: (d.activities || []).slice(0, 4).map((a: any) => ({
            time: a.time || "",
            name: a.name || "",
            category: a.category || "",
            ...(typeof a.estimatedCost === "number" ? { estimatedCost: a.estimatedCost } : {}),
            ...(a.pricing && typeof a.pricing === "object" ? { pricing: a.pricing } : {}),
          })),
        }))
      : null;

  return {
    id,
    text,
    vibes,
    memberNames,
    reviewedAt,
    itineraryDays,
    destination: v.destination || "",
    days: v.days || 0,
    rating: v.rating || 0,
    highlight: v.highlight?.trim() || "",
    memberCount: v.memberCount || memberNames.length,
    photos: Array.isArray(v.photos) ? v.photos : [],
  };
}

export function usePublicReviews() {
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const reviewsRef = ref(db, "reviews");
    let cancel = false;

    const unsubscribe = onValue(
      reviewsRef,
      (snap) => {
        if (!snap.exists()) {
          if (!cancel) { setReviews([]); setLoading(false); }
          return;
        }
        const data = snap.val();
        const arr = Object.entries(data)
          .map(([id, v]: [string, any]) => normalizeReview(id, v))
          .filter((r) => r.destination)
          .sort((a, b) => new Date(b.reviewedAt || 0).getTime() - new Date(a.reviewedAt || 0).getTime());

        if (!cancel) { setReviews(arr); setLoading(false); }
      },
      () => { if (!cancel) setLoading(false); },
    );

    return () => { cancel = true; unsubscribe(); };
  }, []);

  return { reviews, loading };
}

/* ─── localStorage trip-id index ────────────────────────────────
   Firebase RTDB rules restrict reading /userTrips and root /trips.
   We keep a per-user index in localStorage so the dashboard always
   knows which trips the user has created or joined.
   Limitation: index is local to this browser only.
──────────────────────────────────────────────────────────────── */
const storageKey = (uid: string) => `gopack_trips_${uid}`;

function firebaseErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function isFirebasePermissionError(error: unknown): boolean {
  return firebaseErrorCode(error)?.toLowerCase().includes("permission") ?? false;
}

function joinError(code: "permission-denied" | "invalid-trip", message: string): Error {
  return Object.assign(new Error(message), { code });
}

function getLocalTripIds(uid: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(uid));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function addLocalTripId(uid: string, tripId: string) {
  const ids = getLocalTripIds(uid);
  if (!ids.includes(tripId)) {
    localStorage.setItem(storageKey(uid), JSON.stringify([...ids, tripId]));
  }
}

function removeLocalTripId(uid: string, tripId: string) {
  const ids = getLocalTripIds(uid).filter(id => id !== tripId);
  localStorage.setItem(storageKey(uid), JSON.stringify(ids));
}

export async function deleteTrip(tripId: string, uid: string, isHost: boolean) {
  if (isHost) {
    await remove(ref(db, `trips/${tripId}`));
  } else {
    await remove(ref(db, `trips/${tripId}/members/${uid}`));
  }
  removeLocalTripId(uid, tripId);
  try { await remove(ref(db, `userTrips/${uid}/${tripId}`)); } catch { /* ignore */ }
}

/* ─── useTrips ──────────────────────────────────────────────── */
export function useTrips() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTrips = useCallback(async (uid: string) => {
    const ids = getLocalTripIds(uid);
    if (ids.length === 0) {
      setTrips([]);
      setLoading(false);
      return;
    }
    try {
      const snaps = await Promise.all(ids.map(id => get(ref(db, `trips/${id}`))));
      const loaded = snaps
        .filter(s => s.exists())
        .map(s => ({ id: s.key, ...s.val() }));
      setTrips(loaded);
    } catch (err) {
      console.error("useTrips fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setTrips([]);
      setLoading(false);
      return;
    }
    fetchTrips(user.uid);
  }, [user, fetchTrips]);

  const createTrip = async (tripData: any) => {
    if (!user) return null;

    const tripsRef = ref(db, "trips");
    const newTripRef = push(tripsRef);
    const tripId = newTripRef.key!;

    const fullTripData = {
      ...tripData,
      hostMemberId: user.uid,
      createdAt: new Date().toISOString(),
      members: {
        [user.uid]: {
          name: user.displayName || "Guest",
          joinedAt: new Date().toISOString(),
          isHost: true,
        },
      },
    };

    await set(newTripRef, fullTripData);

    // Store trip ID locally so dashboard can list it
    addLocalTripId(user.uid, tripId);

    // Increment global stats (publicly readable /stats node)
    try {
      await runTransaction(ref(db, "stats/tripCount"), (cur) => (cur || 0) + 1);
      await runTransaction(ref(db, "stats/memberCount"), (cur) => (cur || 0) + 1);
      // Track unique destinations via a flat map
      const destKey = (tripData.destination || "").trim().replace(/[.#$[\]]/g, "_").toLowerCase();
      if (destKey) {
        await set(ref(db, `stats/destinations/${destKey}`), true);
        const destSnap = await get(ref(db, "stats/destinations"));
        if (destSnap.exists()) {
          await set(ref(db, "stats/destinationCount"), Object.keys(destSnap.val()).length);
        }
      }
    } catch {
      // Silently ignored — stats are best-effort
    }

    // Also attempt to write to Firebase index (works if rules allow)
    try {
      await set(ref(db, `userTrips/${user.uid}/${tripId}`), true);
    } catch {
      // Silently ignored — localStorage index is the fallback
    }

    // Refresh the trip list
    await fetchTrips(user.uid);
    return tripId;
  };

  const joinTrip = async (tripId: string, name: string) => {
    if (!user) {
      throw joinError("permission-denied", "Sign in before joining a trip.");
    }

    // Confirm the invite points to a real trip before writing. Writing directly
    // to /members could otherwise create a partial trip for a mistyped code.
    let tripData: any;
    try {
      const tripSnap = await get(ref(db, `trips/${tripId}`));
      if (!tripSnap.exists()) {
        throw joinError("invalid-trip", "This invite link is invalid or the trip was deleted.");
      }
      tripData = tripSnap.val();
    } catch (error) {
      if (firebaseErrorCode(error) === "invalid-trip") throw error;
      if (isFirebasePermissionError(error)) {
        throw joinError("permission-denied", "Firebase permissions do not allow you to view or join this trip.");
      }
      throw error;
    }

    const alreadyMember = Boolean(tripData.members?.[user.uid]);
    if (!alreadyMember) {
      try {
        await update(ref(db, `trips/${tripId}/members`), {
          [user.uid]: {
            name: name || user.displayName || "Guest",
            joinedAt: new Date().toISOString(),
            isHost: false,
          },
        });
      } catch (error) {
        if (isFirebasePermissionError(error)) {
          throw joinError("permission-denied", "Firebase permissions do not allow you to join this trip.");
        }
        throw error;
      }
    }

    if (!alreadyMember) {
      // Increment member count in global stats
      try {
        await runTransaction(ref(db, "stats/memberCount"), (cur) => (cur || 0) + 1);
      } catch {
        // Silently ignored
      }
    }

    // Store the proven trip ID locally only after membership succeeds.
    addLocalTripId(user.uid, tripId);

    try {
      // Writing this single child preserves all of the user's other remote
      // index entries. It is best-effort because some deployments restrict it.
      await set(ref(db, `userTrips/${user.uid}/${tripId}`), true);
    } catch {
      // Silently ignored
    }

    await fetchTrips(user.uid);
    return true;
  };

  return { trips, loading, createTrip, joinTrip };
}

/* ─── useTrip ───────────────────────────────────────────────── */
export function useTrip(tripId: string) {
  const { user } = useAuth();
  const [trip, setTrip] = useState<any>(null);
  const [wishes, setWishes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tripId) return;

    const tripRef = ref(db, `trips/${tripId}`);
    const unsubscribe = onValue(
      tripRef,
      (snapshot) => {
        const data = snapshot.val();
        if (data) {
          setTrip({ id: tripId, ...data });
          if (data.wishes) {
            const wishesArray = Object.keys(data.wishes)
              .map(key => ({ id: key, ...data.wishes[key] }))
              .sort((a, b) => (b.votes || 0) - (a.votes || 0));
            setWishes(wishesArray);
          } else {
            setWishes([]);
          }

          // Auto-patch: if a review exists but has no itinerary snapshot yet
          // and the trip already has itinerary data, write it in now.
          // This runs once per member who visits the trip page and ensures the
          // public /reviews entry always has the itinerary for the Discover page.
          if (
            data.review &&
            !data.review.itineraryDays?.length &&
            Array.isArray(data.itinerary?.days) &&
            data.itinerary.days.length > 0
          ) {
            const itineraryDays = (data.itinerary.days as any[]).map((d: any, di: number) => ({
              day: d.day ?? di + 1,
              theme: d.theme || d.title || `Day ${d.day ?? di + 1}`,
              city: d.city || "",
              activities: (d.activities || []).slice(0, 5).map((a: any) => ({
                time: a.time || "",
                name: a.name || "",
                category: a.category || "",
                ...(typeof a.estimatedCost === "number" ? { estimatedCost: a.estimatedCost } : {}),
                ...(a.pricing && typeof a.pricing === "object" ? { pricing: a.pricing } : {}),
              })),
            }));
            const patched = { ...data.review, itineraryDays };
            update(ref(db, `trips/${tripId}`), { review: patched }).catch(() => {});
            if (data.review.isPublic !== false) {
              set(ref(db, `reviews/${tripId}`), patched).catch(() => {});
            } else {
              // Keep an older public copy from surviving after its trip review
              // has been made private.
              remove(ref(db, `reviews/${tripId}`)).catch(() => {});
            }
          }
        } else {
          setTrip(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error("useTrip read error:", err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [tripId]);

  const addWish = async (text: string) => {
    if (!user || !tripId) return;
    const newWishRef = push(ref(db, `trips/${tripId}/wishes`));
    await set(newWishRef, {
      text,
      author: user.displayName || "Guest",
      memberId: user.uid,
      votes: 0,
      timestamp: new Date().toISOString(),
      votedBy: {},
    });
  };

  const toggleVote = async (wishId: string) => {
    if (!user || !tripId) return;
    const wishRef = ref(db, `trips/${tripId}/wishes/${wishId}`);
    const snapshot = await get(wishRef);
    const wish = snapshot.val();
    if (!wish) return;

    const votedBy = { ...(wish.votedBy || {}) };
    const hasVoted = !!votedBy[user.uid];
    if (hasVoted) {
      delete votedBy[user.uid];
    } else {
      votedBy[user.uid] = true;
    }

    await update(wishRef, {
      votes: hasVoted ? Math.max((wish.votes || 1) - 1, 0) : (wish.votes || 0) + 1,
      votedBy,
    });
  };

  const updateItinerary = async (itinerary: any) => {
    if (!tripId) return;
    await set(ref(db, `trips/${tripId}/itinerary`), itinerary);
  };

  const updatePackingList = async (packingList: any) => {
    if (!tripId) return;
    await set(ref(db, `trips/${tripId}/packingList`), packingList);
  };

  const submitReview = async (reviewData: {
    rating: number;
    text: string;
    vibes: string[];
    highlight: string;
    isPublic?: boolean;
    photos?: string[];
  }) => {
    if (!user || !tripId || !trip) {
      throw new Error("Trip details are unavailable.");
    }
    if (!trip.members?.[user.uid]) {
      throw new Error("Only trip members can submit a review.");
    }
    // Prefer the persisted end date, which may differ from a duration-derived
    // date when trip dates were edited. Match the mobile review rule by
    // opening reviews only after the final day has ended.
    const tripEnd = trip.endDate ?? (
      trip.startDate
        ? new Date(
            new Date(`${trip.startDate}T00:00:00`).getTime() +
              Math.max(Number(trip.days) || 1, 1) * 24 * 60 * 60 * 1000,
          ).toISOString().slice(0, 10)
        : null
    );
    const tripEndTime = tripEnd ? new Date(`${tripEnd}T23:59:59`).getTime() : NaN;
    if (!tripEnd || Number.isNaN(tripEndTime) || tripEndTime > Date.now()) {
      throw new Error("Reviews open after this trip has finished.");
    }
    const memberEntries = Object.values(trip.members || {}) as any[];

    // Snapshot compact itinerary for public display on explore page
    const itineraryDays = trip.itinerary?.days
      ? (trip.itinerary.days as any[]).map((d: any) => ({
          day: d.day,
          theme: d.theme || d.title || `Day ${d.day}`,
          activities: (d.activities || []).slice(0, 4).map((a: any) => ({
            time: a.time || "",
            name: a.name || "",
            category: a.category || "",
            ...(typeof a.estimatedCost === "number" ? { estimatedCost: a.estimatedCost } : {}),
            ...(a.pricing && typeof a.pricing === "object" ? { pricing: a.pricing } : {}),
          })),
        }))
      : null;

    const review = {
      ...reviewData,
      destination: trip.destination,
      days: trip.days,
      memberCount: memberEntries.length,
      memberNames: memberEntries.map((m: any) => m.name).filter(Boolean),
      reviewedAt: new Date().toISOString(),
      reviewedBy: user.uid,
      ...(itineraryDays ? { itineraryDays } : {}),
    };
    await set(ref(db, `trips/${tripId}/review`), review);
    if (reviewData.isPublic !== false) {
      await set(ref(db, `reviews/${tripId}`), review);
    } else {
      // A review may be changed from public to private. Remove its old public
      // copy rather than leaving it discoverable with stale visibility.
      await remove(ref(db, `reviews/${tripId}`));
    }
  };

  return { trip, wishes, loading, addWish, toggleVote, updateItinerary, updatePackingList, submitReview };
}

/* ─── Destination preference & voting ──────────────────────────── */

export async function uploadTripPhoto(tripId: string, file: File): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `tripPhotos/${tripId}/${Date.now()}_${safeName}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file);
  return getDownloadURL(fileRef);
}

export async function submitMemberPreference(tripId: string, uid: string, pref: any) {
  await set(ref(db, `trips/${tripId}/memberPreferences/${uid}`), pref);
}

export async function storeDestinationSuggestions(tripId: string, suggestions: any[]) {
  const snap = await get(ref(db, `trips/${tripId}/memberPreferences`));
  await update(ref(db, `trips/${tripId}`), {
    destinationSuggestions: suggestions,
    destinationVotes: null,
    destinationLockedBy: null,
    memberPreferences: snap.val() ?? null,
  });
}

export async function storeRedoSuggestions(tripId: string, suggestions: any[]) {
  await update(ref(db, `trips/${tripId}`), {
    destinationSuggestions: suggestions,
    destinationVotes: null,
    destinationLockedBy: null,
  });
}

export async function voteDestination(tripId: string, idx: number, uid: string, dir: "up" | "down") {
  const r = ref(db, `trips/${tripId}/destinationVotes/${idx}/${uid}`);
  const snap = await get(r);
  await set(r, snap.val() === dir ? null : dir);
}

export async function lockDestinationVotes(tripId: string, uid: string) {
  await set(ref(db, `trips/${tripId}/destinationLockedBy/${uid}`), true);
}

export async function unlockDestinationVotes(tripId: string, uid: string) {
  await set(ref(db, `trips/${tripId}/destinationLockedBy/${uid}`), null);
}

export async function startCollectingPreferences(tripId: string) {
  await update(ref(db, `trips/${tripId}`), { collectingPreferences: true });
}

export async function confirmDestination(tripId: string, destination: string) {
  await update(ref(db, `trips/${tripId}`), {
    destination,
    collectingPreferences: null,
  });
}

/* ─── Accommodation preference & voting ────────────────────────── */

export async function submitAccommodationPreference(tripId: string, uid: string, pref: any) {
  await set(ref(db, `trips/${tripId}/accommodationPreferences/${uid}`), pref);
}

export async function storeAccommodationSuggestions(tripId: string, suggestions: any[]) {
  await update(ref(db, `trips/${tripId}`), {
    accommodationSuggestions: suggestions,
    accommodationStatus: "voting",
    accommodationVotes: null,
    accommodationLockedBy: null,
  });
}

export async function voteAccommodation(tripId: string, idx: number, uid: string, dir: "up" | "down") {
  const r = ref(db, `trips/${tripId}/accommodationVotes/${idx}/${uid}`);
  const snap = await get(r);
  await set(r, snap.val() === dir ? null : dir);
}

export async function lockAccommodationVotes(tripId: string, uid: string) {
  await set(ref(db, `trips/${tripId}/accommodationLockedBy/${uid}`), true);
}

export async function unlockAccommodationVotes(tripId: string, uid: string) {
  await set(ref(db, `trips/${tripId}/accommodationLockedBy/${uid}`), null);
}

export async function confirmAccommodation(tripId: string, accom: any) {
  await update(ref(db, `trips/${tripId}`), {
    confirmedAccommodation: accom,
    accommodationStatus: "confirmed",
  });
}

export async function setAccommodationStatus(
  tripId: string,
  status: "collecting_prefs" | "voting" | "confirmed" | "booked" | "skipped",
) {
  await set(ref(db, `trips/${tripId}/accommodationStatus`), status);
}

export async function addMemberAccommodationLink(tripId: string, suggestion: any) {
  const snap = await get(ref(db, `trips/${tripId}/accommodationSuggestions`));
  const existing: any[] = snap.val() ?? [];
  existing.push(suggestion);
  await set(ref(db, `trips/${tripId}/accommodationSuggestions`), existing);
}

export async function saveItinerary(tripId: string, itinerary: any) {
  await set(ref(db, `trips/${tripId}/itinerary`), itinerary);
}

export async function confirmPack(tripId: string, startCollecting = false) {
  await update(ref(db, `trips/${tripId}`), {
    packConfirmed: true,
    ...(startCollecting ? { collectingPreferences: true } : {}),
  });
}

/* ─── Saved Packs (localStorage) ─────────────────────────────────── */

export interface SavedPack {
  id: string;
  name: string;
  members: Array<{ uid: string; name: string }>;
  savedAt: string;
  tripId: string;
}

const savedPacksKey = (uid: string) => `gopack_saved_packs_${uid}`;

export function getSavedPacks(uid: string): SavedPack[] {
  try {
    const raw = localStorage.getItem(savedPacksKey(uid));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function savePack(uid: string, pack: Omit<SavedPack, "id" | "savedAt">): SavedPack {
  const packs = getSavedPacks(uid);
  const newPack: SavedPack = {
    ...pack,
    id: `pack_${Date.now()}`,
    savedAt: new Date().toISOString(),
  };
  const updated = [newPack, ...packs.filter(p => p.tripId !== pack.tripId)];
  localStorage.setItem(savedPacksKey(uid), JSON.stringify(updated));
  return newPack;
}

export function deleteSavedPack(uid: string, packId: string) {
  const packs = getSavedPacks(uid).filter(p => p.id !== packId);
  localStorage.setItem(savedPacksKey(uid), JSON.stringify(packs));
}

/* ─── Notifications ──────────────────────────────────────────────── */

export async function sendPackInvites(
  tripId: string,
  tripName: string,
  fromName: string,
  _fromUid: string,
  members: Array<{ uid: string; name: string }>,
  packName: string,
  idToken: string,
) {
  // Route through server-side Firebase Admin to bypass client RTDB rules
  // fromUid is derived server-side from the verified ID token — not trusted from client
  const resp = await fetch("/api/send-pack-invites", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ tripId, tripName, fromName, members, packName }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? "Failed to send invites");
  }
}

export function renameSavedPack(uid: string, packId: string, newName: string) {
  const packs = getSavedPacks(uid).map(p => p.id === packId ? { ...p, name: newName } : p);
  localStorage.setItem(savedPacksKey(uid), JSON.stringify(packs));
}

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [useServerFallback, setUseServerFallback] = useState(false);

  // Primary: Firebase RTDB realtime listener
  useEffect(() => {
    if (!user?.uid || useServerFallback) return;
    const r = ref(db, `notifications/${user.uid}`);
    const unsub = onValue(
      r,
      snap => {
        if (!snap.exists()) { setNotifications([]); return; }
        const list = Object.entries(snap.val())
          .map(([id, v]: [string, any]) => ({ id, ...(v as object) }))
          .filter((n: any) => n.status === "pending")
          .sort((a: any, b: any) => b.createdAt - a.createdAt);
        setNotifications(list);
      },
      () => {
        // RTDB read denied by security rules — fall back to server polling
        setUseServerFallback(true);
      },
    );
    return () => unsub();
  }, [user?.uid, useServerFallback]);

  // Fallback: server-side polling via Firebase Admin (bypasses RTDB rules)
  useEffect(() => {
    if (!user || !useServerFallback) return;

    const fetchNotifs = async () => {
      try {
        const idToken = await user.getIdToken();
        const resp = await fetch("/api/my-notifications", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (resp.ok) {
          const data = await resp.json() as { notifications: any[] };
          setNotifications(data.notifications);
        }
      } catch { /* silent */ }
    };

    fetchNotifs();
    const interval = setInterval(fetchNotifs, 20000);
    return () => clearInterval(interval);
  }, [user, useServerFallback]);

  return notifications;
}

export async function acceptTripInvite(
  user: { uid: string; displayName: string | null; getIdToken: () => Promise<string> },
  notifId: string,
  tripId: string,
) {
  const idToken = await user.getIdToken();
  const resp = await fetch("/api/accept-invite", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ notifId, tripId, displayName: user.displayName }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || "Failed to accept invite");
  }
}

export async function declineNotification(uid: string, notifId: string) {
  await update(ref(db, `notifications/${uid}/${notifId}`), { status: "declined" });
}

/* ─── Premium management ─────────────────────────────────────────── */

export async function setTripPremium(tripId: string) {
  await update(ref(db, `trips/${tripId}`), { isPremium: true });
}

export async function incrementAiUsage(
  tripId: string,
  feature: "itinerary" | "packing" | "activityRedos",
) {
  const r = ref(db, `trips/${tripId}/aiUsage/${feature}`);
  const snap = await get(r);
  await set(r, (snap.val() ?? 0) + 1);
}
