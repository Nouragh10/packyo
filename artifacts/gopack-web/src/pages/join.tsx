import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Loader2, ArrowLeft, MapPin } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTrips } from "@/hooks/useFirebase";
import { ref, get } from "firebase/database";
import { db } from "@/lib/firebase";
import { trackEvent } from "@/lib/analytics";

export default function JoinTrip() {
  const [, params] = useRoute("/join/:tripId");
  const tripId = params?.tripId || "";
  const { user, loading: authLoading } = useAuth();
  const { joinTrip } = useTrips();
  const [, setLocation] = useLocation();

  const [tripInfo, setTripInfo] = useState<any>(null);
  const [joining, setJoining] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [joinError, setJoinError] = useState("");

  // Only fetch trip details once we have an authenticated user — Firebase
  // rules require auth != null to read trip data.
  useEffect(() => {
    if (!tripId || authLoading || !user) return;

    setFetching(true);
    setFetchError("");
    get(ref(db, `trips/${tripId}`))
      .then(snap => {
        if (snap.exists()) {
          setTripInfo({ id: tripId, ...snap.val() });
        } else {
          setFetchError("This invite link is invalid or the trip was deleted.");
        }
      })
      .catch((error: unknown) => {
        const code = typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
        setFetchError(
          code.toLowerCase().includes("permission")
            ? "Firebase permissions do not allow you to view this trip."
            : "Could not load trip details. Check your connection."
        );
      })
      .finally(() => setFetching(false));
  }, [tripId, user, authLoading]);

  const handleJoin = async () => {
    if (!user) {
      setLocation(`/login?from=${encodeURIComponent(`/join/${tripId}`)}`);
      return;
    }
    setJoining(true);
    setJoinError("");
    try {
      const name = user.displayName || user.email?.split("@")[0] || "Guest";
      await joinTrip(tripId, name);
      trackEvent("trip_joined", { join_surface: "invite_page" });
      setLocation(`/trip/${tripId}`);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      setJoinError(
        code.toLowerCase().includes("permission")
          ? "Firebase permissions do not allow you to join this trip."
          : code === "invalid-trip"
          ? "This invite link is invalid or the trip was deleted."
          : error instanceof Error
          ? error.message
          : "Failed to join. Please try again."
      );
      setJoining(false);
    }
  };

  // Still resolving auth state
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="flex items-center gap-4 px-8 py-5 border-b border-border">
        <button onClick={() => setLocation("/")} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <div className="font-display font-bold text-xl">go<span className="text-primary">pack</span></div>
      </nav>

      <div className="max-w-md mx-auto px-8 py-20">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <p className="text-xs text-muted-foreground tracking-widest uppercase mb-2">You&apos;re invited</p>
          <h1 className="font-serif text-5xl font-bold mb-3">Join the trip</h1>

          {/* Show trip details once loaded, or a placeholder card while we wait */}
          {fetching ? (
            <div className="bg-muted/30 border border-border rounded-2xl p-5 mb-8 flex items-center gap-3">
              <Loader2 size={18} className="animate-spin text-muted-foreground shrink-0" />
              <span className="text-sm text-muted-foreground">Loading trip details…</span>
            </div>
          ) : tripInfo ? (
            <div className="bg-muted/30 border border-border rounded-2xl p-5 mb-8">
              <div className="flex items-start gap-3">
                <MapPin size={18} className="text-primary mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium text-lg">{tripInfo.destination}</div>
                  <div className="text-sm text-muted-foreground">
                    {tripInfo.days} day{tripInfo.days !== 1 ? "s" : ""}
                    {tripInfo.vibes?.length ? ` · ${tripInfo.vibes.join(", ")}` : ""}
                  </div>
                </div>
              </div>
            </div>
          ) : fetchError ? (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-xl px-4 py-3 mb-8">
              {fetchError}
            </div>
          ) : (
            /* Not signed in yet — show generic invite card */
            <div className="bg-muted/30 border border-border rounded-2xl p-5 mb-8">
              <p className="text-sm text-muted-foreground">Sign in to see trip details and join.</p>
            </div>
          )}

          {joinError && (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-xl px-4 py-3 mb-6">
              {joinError}
            </div>
          )}

          {!user ? (
            /* Unauthenticated — prompt sign-in, redirecting back here after */
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setLocation(`/login?from=${encodeURIComponent(`/join/${tripId}`)}`)}
                className="w-full bg-primary text-white font-medium py-4 rounded-full hover:bg-primary/90 transition-colors"
                data-testid="button-go-login"
              >
                Sign in to join
              </button>
            </div>
          ) : (
            /* Authenticated — show who they're joining as, then join */
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 px-4 py-3 bg-muted/40 rounded-xl border border-border">
                <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white text-sm font-bold shrink-0">
                  {(user.displayName || user.email || "G")[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user.displayName || user.email || "Guest"}</p>
                  <p className="text-xs text-muted-foreground">Joining as this account</p>
                </div>
              </div>
              <button
                onClick={handleJoin}
                disabled={joining || !!fetchError}
                className="w-full bg-primary text-white font-medium py-4 rounded-full hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                data-testid="button-join-confirm"
              >
                {joining && <Loader2 size={18} className="animate-spin" />}
                {joining ? "Joining…" : "Join the trip"}
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
