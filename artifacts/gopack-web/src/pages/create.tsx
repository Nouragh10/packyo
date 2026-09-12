import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { useTrips, getSavedPacks, sendPackInvites, type SavedPack } from "@/hooks/useFirebase";
import { Loader2, ArrowLeft, Check, Users, Package } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

const VIBES = [
  { id: "culture", label: "Culture" },
  { id: "food", label: "Foodie" },
  { id: "adventure", label: "Adventure" },
  { id: "relaxation", label: "Relaxation" },
  { id: "nightlife", label: "Nightlife" },
  { id: "shopping", label: "Shopping" },
];

const BUDGETS = [
  { id: "budget", label: "Budget", desc: "Hostels, street food, transit" },
  { id: "midrange", label: "Mid-range", desc: "Hotels, restaurants, tours" },
  { id: "luxury", label: "Luxury", desc: "Five-star, private transfers" },
];

export default function Create() {
  const { user, loading: authLoading } = useAuth();
  const { createTrip } = useTrips();
  const [, setLocation] = useLocation();

  const [decideWithGroup, setDecideWithGroup] = useState(false);
  const [destination, setDestination] = useState("");
  const [days, setDays] = useState(5);
  const [vibes, setVibes] = useState<string[]>(["culture"]);
  const [budget, setBudget] = useState("midrange");
  const [startDate, setStartDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savedPacks, setSavedPacks] = useState<SavedPack[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);

  useEffect(() => {
    if (user?.uid) setSavedPacks(getSavedPacks(user.uid));
  }, [user?.uid]);

  if (authLoading) return null;
  if (!user) {
    setLocation("/login");
    return null;
  }

  const toggleVibe = (v: string) => {
    setVibes(prev =>
      prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!decideWithGroup && !destination.trim()) {
      setError("Enter a destination or choose to decide with the group");
      return;
    }
    if (vibes.length === 0) { setError("Pick at least one vibe"); return; }
    setError("");
    setLoading(true);
    try {
      const tripData: Record<string, unknown> = {
        destination: decideWithGroup ? "" : destination.trim(),
        days,
        vibes,
        budget,
        startDate,
        visibility: "private",
      };
      if (decideWithGroup) tripData.collectingPreferences = true;
      const tripId = await createTrip(tripData);
      if (tripId) {
        trackEvent("trip_created", {
          planning_mode: decideWithGroup ? "group_decides" : "fixed_destination",
          duration_days: days,
          has_start_date: Boolean(startDate),
          invited_saved_pack: Boolean(selectedPackId),
        });
        if (selectedPackId && user) {
          const pack = savedPacks.find(p => p.id === selectedPackId);
          if (pack) {
            const others = pack.members.filter((m: any) => m.uid !== user.uid);
            if (others.length > 0) {
              try {
                const idToken = await user.getIdToken();
                await sendPackInvites(
                  tripId,
                  destination.trim() || "Group trip",
                  user.displayName || "Your friend",
                  user.uid,
                  others,
                  pack.name,
                  idToken,
                );
              } catch {
                // Notification delivery failure is non-fatal — trip is still created
              }
            }
          }
        }
        setLocation(`/trip/${tripId}`);
      }
    } catch {
      setError("Failed to create trip. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="flex items-center gap-4 px-8 py-5 border-b border-border">
        <Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-back">
          <ArrowLeft size={20} />
        </Link>
        <div className="font-display font-bold text-xl">go<span className="text-primary">pack</span></div>
      </nav>

      <div className="max-w-xl mx-auto px-8 py-16">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="font-serif text-5xl font-bold mb-2">Plan a trip</h1>
          <p className="text-muted-foreground mb-10">Tell us where, when, and how you like to travel.</p>

          {error && (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg px-4 py-3 mb-6">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-8">
            {/* Destination */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground tracking-widest uppercase mb-3">
                Destination
              </label>

              {/* Decide with group toggle */}
              <button
                type="button"
                onClick={() => {
                  setDecideWithGroup(d => !d);
                  if (!decideWithGroup) setDestination("");
                }}
                className={`w-full flex items-center gap-3 px-5 py-4 rounded-xl border text-left transition-all mb-3 ${
                  decideWithGroup
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                  decideWithGroup ? "border-primary bg-primary" : "border-muted-foreground/40"
                }`}>
                  {decideWithGroup && <Check size={11} className="text-white" />}
                </div>
                <div>
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <Users size={14} className="text-primary" />
                    Decide with the group
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Everyone submits preferences, AI suggests destinations, group votes
                  </div>
                </div>
              </button>

              {!decideWithGroup && (
                <input
                  value={destination}
                  onChange={e => setDestination(e.target.value)}
                  placeholder="Paris, Tokyo, Bali..."
                  className="w-full border border-border rounded-xl px-5 py-3.5 text-base bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  data-testid="input-destination"
                />
              )}
            </div>

            {/* Days */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground tracking-widest uppercase mb-3">
                Duration: <span className="text-foreground font-bold">{days} days</span>
              </label>
              <input
                type="range"
                min={1}
                max={21}
                value={days}
                onChange={e => setDays(Number(e.target.value))}
                className="w-full accent-primary"
                data-testid="input-days"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>1 day</span>
                <span>3 weeks</span>
              </div>
            </div>

            {/* Vibes */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground tracking-widest uppercase mb-3">
                Vibes
              </label>
              <div className="flex flex-wrap gap-2">
                {VIBES.map(v => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => toggleVibe(v.id)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                      vibes.includes(v.id)
                        ? "bg-primary text-white border-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                    data-testid={`button-vibe-${v.id}`}
                  >
                    {vibes.includes(v.id) && <Check size={13} />}
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Budget */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground tracking-widest uppercase mb-3">
                Budget
              </label>
              <div className="flex flex-col gap-2">
                {BUDGETS.map(b => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBudget(b.id)}
                    className={`flex items-center justify-between px-5 py-4 rounded-xl border text-left transition-all ${
                      budget === b.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-border/80"
                    }`}
                    data-testid={`button-budget-${b.id}`}
                  >
                    <div>
                      <div className="font-medium">{b.label}</div>
                      <div className="text-sm text-muted-foreground">{b.desc}</div>
                    </div>
                    {budget === b.id && <Check size={16} className="text-primary shrink-0" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Start date */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground tracking-widest uppercase mb-3">
                Start date <span className="normal-case font-normal">(optional)</span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full border border-border rounded-xl px-5 py-3.5 text-base bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                data-testid="input-start-date"
              />
            </div>

            {/* Invite saved pack */}
            {savedPacks.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground tracking-widest uppercase mb-3">
                  Invite a saved pack <span className="normal-case font-normal">(optional)</span>
                </label>
                <div className="flex flex-col gap-2">
                  {savedPacks.map(pack => {
                    const selected = selectedPackId === pack.id;
                    return (
                      <button
                        key={pack.id}
                        type="button"
                        onClick={() => setSelectedPackId(selected ? null : pack.id)}
                        className={`flex items-center gap-3 px-5 py-3.5 rounded-xl border text-left transition-all ${
                          selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                          selected ? "border-primary bg-primary" : "border-muted-foreground/40"
                        }`}>
                          {selected && <Check size={11} className="text-white" />}
                        </div>
                        <Package size={15} className={selected ? "text-primary" : "text-muted-foreground"} />
                        <div>
                          <div className="font-medium text-sm">{pack.name}</div>
                          <div className="text-xs text-muted-foreground">{pack.members.length} {pack.members.length === 1 ? "member" : "members"}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {selectedPackId && (
                  <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                    <Users size={11} /> Pack members will get a trip invite notification
                  </p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-white font-medium py-4 rounded-full hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              data-testid="button-create-trip"
            >
              {loading && <Loader2 size={18} className="animate-spin" />}
              {loading ? "Creating..." : "Create trip"}
            </button>
          </form>
        </motion.div>
      </div>
    </div>
  );
}
