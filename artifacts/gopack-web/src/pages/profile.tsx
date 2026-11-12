import { useState } from "react";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, LogOut, User, Mail, Edit2, Check, X, Loader2, MapPin, Users, ChevronDown, CreditCard, FileText, Shield, RotateCcw, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTrips } from "@/hooks/useFirebase";
import { updateProfile } from "firebase/auth";
import { ref, update } from "firebase/database";
import { auth, db } from "@/lib/firebase";
import { APP_STORE_URL } from "@/lib/unlocks";

const AVATAR_COLORS = ["#E85D3A", "#7F77DD", "#1D9E75", "#378ADD", "#BA7517", "#C4448A"];
const VIBE_LABELS: Record<string, string> = {
  culture: "Culture", food: "Foodie", adventure: "Adventure",
  relaxation: "Relaxation", nightlife: "Nightlife", shopping: "Shopping",
};

function getAvatarColor(uid: string): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = uid.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function Profile() {
  const { user, signOut } = useAuth();
  const [, setLocation] = useLocation();
  const { trips, loading: tripsLoading } = useTrips();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(user?.displayName || "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [tripsExpanded, setTripsExpanded] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    setLocation("/");
  };

  const handleSaveName = async () => {
    if (!user || !nameInput.trim()) return;
    setSaving(true);
    setSaveError("");
    try {
      const newName = nameInput.trim();
      await updateProfile(user, { displayName: newName });
      try {
        const storageKey = `gopack_trips_${user.uid}`;
        const raw = localStorage.getItem(storageKey);
        const tripIds: string[] = raw ? JSON.parse(raw) : [];
        await Promise.all(
          tripIds.map(tripId =>
            update(ref(db, `trips/${tripId}/members/${user.uid}`), { name: newName })
          )
        );
      } catch {
        // Non-critical
      }
      setEditingName(false);
    } catch {
      setSaveError("Could not update name. Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="mb-4">You&apos;re not signed in.</p>
          <Link href="/login" className="bg-primary text-white px-6 py-3 rounded-full hover:bg-primary/90 transition-colors">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const initial = (user.displayName || user.email || "?")[0].toUpperCase();
  const avatarColor = getAvatarColor(user.uid);
  const isAnonymous = user.isAnonymous;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="flex items-center justify-between px-8 py-5 border-b border-border">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-muted-foreground hover:text-foreground" data-testid="link-back">
            <ArrowLeft size={20} />
          </Link>
          <Link href="/" className="font-display font-bold text-xl" data-testid="link-logo">
            go<span className="text-primary">pack</span>
          </Link>
        </div>
      </nav>

      <div className="max-w-lg mx-auto px-8 py-16">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-6">

          {/* Avatar + name */}
          <div className="flex flex-col items-center gap-4">
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center text-white text-4xl font-bold"
              style={{ backgroundColor: avatarColor }}
            >
              {initial}
            </div>
            {editingName ? (
              <div className="flex items-center gap-2 w-full max-w-xs">
                <input
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  className="flex-1 border border-border rounded-lg px-4 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 text-center"
                  autoFocus
                  onKeyDown={e => { if (e.key === "Enter") handleSaveName(); if (e.key === "Escape") setEditingName(false); }}
                  data-testid="input-display-name"
                />
                <button onClick={handleSaveName} disabled={saving} className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors" data-testid="button-save-name">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                </button>
                <button onClick={() => { setEditingName(false); setNameInput(user.displayName || ""); }} className="p-2 text-muted-foreground hover:bg-muted/50 rounded-lg transition-colors">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="font-serif text-3xl font-bold">
                  {user.displayName || (isAnonymous ? "Guest" : user.email?.split("@")[0])}
                </h1>
                <button
                  onClick={() => setEditingName(true)}
                  className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors"
                  title="Edit display name"
                  data-testid="button-edit-name"
                >
                  <Edit2 size={14} />
                </button>
              </div>
            )}
            {saveError && <p className="text-destructive text-sm">{saveError}</p>}
            {isAnonymous && (
              <span className="text-xs px-3 py-1 bg-muted rounded-full text-muted-foreground border border-border">
                Guest account
              </span>
            )}
          </div>

          {/* Account details */}
          <div className="border border-border rounded-2xl divide-y divide-border bg-background">
            {user.email && (
              <div className="flex items-center gap-3 px-5 py-4">
                <Mail size={16} className="text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Email</p>
                  <p className="text-sm">{user.email}</p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 px-5 py-4">
              <User size={16} className="text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Account type</p>
                <p className="text-sm">{isAnonymous ? "Guest (anonymous)" : "Google account"}</p>
              </div>
            </div>
          </div>

          {/* My Trips — expandable card */}
          <div className="border border-border rounded-2xl overflow-hidden bg-background">
            <button
              onClick={() => setTripsExpanded(e => !e)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors text-left"
              data-testid="button-expand-trips"
            >
              <div className="flex items-center gap-3">
                <MapPin size={16} className="text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">My trips</p>
                  <p className="text-xs text-muted-foreground">
                    {tripsLoading ? "Loading..." : `${trips.length} trip${trips.length !== 1 ? "s" : ""}`}
                  </p>
                </div>
              </div>
              <motion.div animate={{ rotate: tripsExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                <ChevronDown size={16} className="text-muted-foreground" />
              </motion.div>
            </button>

            <AnimatePresence>
              {tripsExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden border-t border-border"
                >
                  {tripsLoading ? (
                    <div className="px-5 py-4 flex flex-col gap-2">
                      {[1, 2].map(i => <div key={i} className="h-14 rounded-xl bg-muted/40 animate-pulse" />)}
                    </div>
                  ) : trips.length === 0 ? (
                    <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                      <MapPin size={24} className="mx-auto mb-2 opacity-30" />
                      No trips yet
                    </div>
                  ) : (
                    <div className="px-5 py-3 flex flex-col gap-2">
                      {trips.map(trip => {
                        const memberCount = trip.members ? Object.keys(trip.members).length : 0;
                        return (
                          <Link
                            key={trip.id}
                            href={`/trip/${trip.id}`}
                            className="flex items-center justify-between py-3 px-4 rounded-xl hover:bg-muted/40 transition-colors border border-border"
                            data-testid={`link-trip-${trip.id}`}
                          >
                            <div>
                              <p className="text-sm font-medium">{trip.destination || "Deciding destination…"}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {trip.days} days · {(trip.vibes || []).map((v: string) => VIBE_LABELS[v] || v).join(", ")}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 ml-3">
                              <Users size={11} />
                              {memberCount}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {isAnonymous && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">
              <p className="font-medium mb-1">You&apos;re using a guest account</p>
              <p className="text-amber-700">Sign in with Google to keep your trips across devices and never lose your data.</p>
              <Link href="/login" className="mt-3 inline-block bg-amber-600 text-white px-5 py-2.5 rounded-full text-sm font-medium hover:bg-amber-700 transition-colors">
                Upgrade to Google sign-in
              </Link>
            </div>
          )}

          {/* Purchases */}
          {!isAnonymous && (
            <div className="border border-border rounded-2xl bg-background px-5 py-4" data-testid="purchases-card">
              <div className="flex items-center gap-3 mb-2">
                <CreditCard size={16} className="text-muted-foreground" />
                <span className="text-sm font-medium">Purchases</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Unlock a trip&apos;s full itinerary in the Packyo iOS app: $3.99 for the whole group or $2.99 just for you. One-time per trip, paid through Apple, no subscription.
              </p>
              <a
                href={APP_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex items-center justify-center gap-2 w-full border border-border py-3 rounded-full text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
              >
                <ExternalLink size={14} /> Open Packyo on the App Store
              </a>
              <p className="text-xs text-muted-foreground text-center mt-3">
                Need help?{" "}
                <a href="mailto:support@gopack.now" className="text-primary underline">support@gopack.now</a>
              </p>
            </div>
          )}

          {/* Legal links */}
          <div className="border border-border rounded-2xl divide-y divide-border bg-background">
            <Link
              href="/terms"
              className="flex items-center gap-3 px-5 py-4 hover:bg-muted/30 transition-colors"
              data-testid="link-terms"
            >
              <FileText size={16} className="text-muted-foreground shrink-0" />
              <span className="text-sm">Terms of Service</span>
            </Link>
            <Link
              href="/privacy"
              className="flex items-center gap-3 px-5 py-4 hover:bg-muted/30 transition-colors"
              data-testid="link-privacy"
            >
              <Shield size={16} className="text-muted-foreground shrink-0" />
              <span className="text-sm">Privacy Policy</span>
            </Link>
            <Link
              href="/refunds"
              className="flex items-center gap-3 px-5 py-4 hover:bg-muted/30 transition-colors"
              data-testid="link-refunds"
            >
              <RotateCcw size={16} className="text-muted-foreground shrink-0" />
              <span className="text-sm">Refund Policy</span>
            </Link>
          </div>

          {/* Sign out */}
          <button
            onClick={handleSignOut}
            className="flex items-center justify-center gap-2 w-full border border-border py-3.5 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            data-testid="button-sign-out"
          >
            <LogOut size={16} />
            Sign out
          </button>

        </motion.div>
      </div>
    </div>
  );
}
