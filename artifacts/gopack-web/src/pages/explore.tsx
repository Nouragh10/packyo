import { useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  MapPin, Star, Users, ArrowLeft, Sparkles, Loader2,
  MessageSquare, CalendarDays, Camera, Search, Sun,
} from "lucide-react";
import { ActivityPrice } from "@/components/ActivityPrice";
import { usePublicReviews, useGlobalStats } from "@/hooks/useFirebase";

const MONTHLY_PICKS = [
  { name: "Machu Picchu, Peru",      why: "Dry season perfection — clear trails and stunning Andean views.",        tags: ["Adventure", "Nature"],   photo: "https://images.unsplash.com/photo-1587595431973-160d0d94add1?w=1200&h=500&fit=crop&q=80" },
  { name: "Rio de Janeiro, Brazil",  why: "Carnival season — the world's greatest street party is in full swing.",  tags: ["Culture", "Beach"],      photo: "https://images.unsplash.com/photo-1483729558449-99ef09a8c325?w=1200&h=500&fit=crop&q=80" },
  { name: "Tokyo, Japan",            why: "Cherry blossom season turns the city into a pink wonderland.",           tags: ["Culture", "Food", "City"], photo: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=1200&h=500&fit=crop&q=80" },
  { name: "Santorini, Greece",       why: "Spring warmth arrives before the summer crowds — perfect timing.",       tags: ["Beach", "Culture"],      photo: "https://images.unsplash.com/photo-1570077188670-e3a8d69ac5ff?w=1200&h=500&fit=crop&q=80" },
  { name: "Amalfi Coast, Italy",     why: "Perfect Mediterranean weather and lemon groves in full bloom.",          tags: ["Beach", "Food", "Culture"], photo: "https://images.unsplash.com/photo-1516483638261-f4dbaf036963?w=1200&h=500&fit=crop&q=80" },
  { name: "Reykjavik, Iceland",      why: "Midnight sun and endless daylight — hike, kayak, or just stay up.",     tags: ["Adventure", "Nature"],   photo: "https://images.unsplash.com/photo-1504893524553-b855bce32c67?w=1200&h=500&fit=crop&q=80" },
  { name: "Dubrovnik, Croatia",      why: "Peak Adriatic summer — crystal water, city walls, and island day trips.", tags: ["Beach", "City"],       photo: "https://images.unsplash.com/photo-1555990538-1bf7e3a75cb8?w=1200&h=500&fit=crop&q=80" },
  { name: "Scottish Highlands, UK",  why: "Warm summer days and purple heather rolling across the moorland.",      tags: ["Nature", "Adventure"],   photo: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&h=500&fit=crop&q=80" },
  { name: "New York City, USA",      why: "Fall foliage hits Central Park and the city energy peaks in autumn.",   tags: ["City", "Culture", "Food"], photo: "https://images.unsplash.com/photo-1538970272646-f61fabb3a8a2?w=1200&h=500&fit=crop&q=80" },
  { name: "Kyoto, Japan",            why: "Autumn leaves turn the temples and bamboo groves into fire.",           tags: ["Culture", "Nature"],     photo: "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=1200&h=500&fit=crop&q=80" },
  { name: "Marrakech, Morocco",      why: "Cool dry desert air — ideal for the souks, riads, and Atlas day trips.", tags: ["Culture", "Adventure", "Food"], photo: "https://images.unsplash.com/photo-1597212720673-5b4a2bf73a95?w=1200&h=500&fit=crop&q=80" },
  { name: "Rovaniemi, Finland",      why: "Northern lights, reindeer, and deep snow — Christmas as it should be.", tags: ["Nature", "Adventure"],  photo: "https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=1200&h=500&fit=crop&q=80" },
];

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const VIBE_COLORS: Record<string, string> = {
  culture:     "bg-violet-100 text-violet-700 border-violet-200",
  Culture:     "bg-violet-100 text-violet-700 border-violet-200",
  food:        "bg-amber-100 text-amber-700 border-amber-200",
  Foodie:      "bg-amber-100 text-amber-700 border-amber-200",
  nightlife:   "bg-pink-100 text-pink-700 border-pink-200",
  Nightlife:   "bg-pink-100 text-pink-700 border-pink-200",
  shopping:    "bg-orange-100 text-orange-700 border-orange-200",
  Shopping:    "bg-orange-100 text-orange-700 border-orange-200",
  relaxation:  "bg-blue-100 text-blue-700 border-blue-200",
  Relaxation:  "bg-blue-100 text-blue-700 border-blue-200",
  adventure:   "bg-green-100 text-green-700 border-green-200",
  Adventure:   "bg-green-100 text-green-700 border-green-200",
  beach:       "bg-cyan-100 text-cyan-700 border-cyan-200",
  Beach:       "bg-cyan-100 text-cyan-700 border-cyan-200",
  nature:      "bg-emerald-100 text-emerald-700 border-emerald-200",
  Nature:      "bg-emerald-100 text-emerald-700 border-emerald-200",
  city:        "bg-indigo-100 text-indigo-700 border-indigo-200",
  City:        "bg-indigo-100 text-indigo-700 border-indigo-200",
  history:     "bg-stone-100 text-stone-700 border-stone-200",
  History:     "bg-stone-100 text-stone-700 border-stone-200",
  art:         "bg-purple-100 text-purple-700 border-purple-200",
  Art:         "bg-purple-100 text-purple-700 border-purple-200",
  wellness:    "bg-teal-100 text-teal-700 border-teal-200",
  Wellness:    "bg-teal-100 text-teal-700 border-teal-200",
};

const VIBE_LABELS: Record<string, string> = {
  culture: "Culture", food: "Foodie", adventure: "Adventure",
  relaxation: "Relaxation", nightlife: "Nightlife", shopping: "Shopping",
  beach: "Beach", nature: "Nature", city: "City",
  history: "History", art: "Art", wellness: "Wellness",
};

const VIBE_FILTER_ITEMS = [
  { key: "beach", label: "Beach" },
  { key: "nature", label: "Nature" },
  { key: "culture", label: "Culture" },
  { key: "food", label: "Foodie" },
  { key: "adventure", label: "Adventure" },
  { key: "relaxation", label: "Relaxation" },
  { key: "nightlife", label: "Nightlife" },
  { key: "shopping", label: "Shopping" },
  { key: "city", label: "City" },
  { key: "history", label: "History" },
  { key: "art", label: "Art" },
  { key: "wellness", label: "Wellness" },
];

const CATEGORY_BORDER: Record<string, string> = {
  culture: "border-l-violet-400", Culture: "border-l-violet-400",
  food: "border-l-amber-400", Foodie: "border-l-amber-400",
  nightlife: "border-l-pink-400", Nightlife: "border-l-pink-400",
  adventure: "border-l-green-400", Adventure: "border-l-green-400",
  relaxation: "border-l-blue-400", Relaxation: "border-l-blue-400",
  shopping: "border-l-orange-400", Shopping: "border-l-orange-400",
};

function StarRating({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={size} className={i <= rating ? "fill-amber-400 text-amber-400" : "text-border fill-muted"} />
      ))}
    </div>
  );
}

function ItineraryPreview({ days, tripDays, reviewId }: { days: any[]; tripDays: number; reviewId: string }) {
  return (
    <div className="mt-4 rounded-xl overflow-hidden border border-border/70 text-[11px]">
      <div className="bg-foreground text-background px-3 py-2 flex items-center gap-1.5 font-semibold">
        <CalendarDays size={11} />
        <span>{tripDays}-day itinerary</span>
      </div>
      <div className="divide-y divide-border/40 bg-background max-h-40 overflow-y-auto">
        {days.map((d: any, di: number) => (
          <div key={d.day ?? di} className="px-3 py-2">
            <div className="font-semibold text-foreground mb-1">
              Day {d.day ?? di + 1}{d.theme ? `: ${d.theme}` : ""}
            </div>
            {d.activities?.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {d.activities.map((a: any, ai: number) => (
                  <div
                    key={`${di}-${ai}`}
                    className={`pl-2 border-l-2 ${CATEGORY_BORDER[a.category] || "border-l-border"} text-muted-foreground leading-tight`}
                  >
                    {a.time && <span className="text-foreground/50 mr-1">{a.time}</span>}
                    {a.name}
                    <span className="ml-1.5 inline-block align-middle scale-90 origin-left">
                      <ActivityPrice activity={a} compact testId={`text-review-price-${di}-${ai}`}/>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Explore() {
  const { reviews, loading: reviewsLoading } = usePublicReviews();
  const { stats, loading: statsLoading } = useGlobalStats();
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  const loading = reviewsLoading || statsLoading;

  const tripCount = stats.tripCount || reviews.length;
  const memberCount = stats.memberCount;
  const destinationCount = stats.destinationCount;

  const month = new Date().getMonth();
  const monthlyPick = MONTHLY_PICKS[month];

  const toggleVibeFilter = (key: string) =>
    setSelectedVibes(prev => prev.includes(key) ? prev.filter(v => v !== key) : [...prev, key]);

  // Normalize a stored vibe to the canonical filter key.
  // Handles mixed case ("Beach", "beach"), label forms ("Foodie" → "food"),
  // and whitespace so stored data always matches the filter keys.
  const normalizeVibeKey = (v: string) => {
    const lower = v.toLowerCase().trim();
    if (lower === "foodie") return "food";
    if (lower === "cultural") return "culture";
    return lower;
  };

  const filteredReviews = reviews.filter(r => {
    const matchesQuery = !query || r.destination?.toLowerCase().includes(query.toLowerCase());
    const matchesVibe =
      selectedVibes.length === 0 ||
      (Array.isArray(r.vibes) && r.vibes.length > 0 &&
        r.vibes.some((v: string) => selectedVibes.includes(normalizeVibeKey(v))));
    return matchesQuery && matchesVibe;
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-border sticky top-0 bg-background/95 backdrop-blur-sm z-10">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <Link href="/" className="font-display font-bold text-xl" data-testid="link-logo">
            go<span className="text-primary">pack</span>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Sign in
          </Link>
          <Link href="/login" className="bg-foreground text-background text-sm font-medium px-5 py-2 rounded-full hover:bg-foreground/90 transition-colors">
            Start planning
          </Link>
        </div>
      </nav>

      {/* Header */}
      <div className="border-b border-border px-8 py-14 bg-muted/10">
        <div className="max-w-5xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <p className="text-xs font-semibold text-primary tracking-widest uppercase mb-3">Community</p>
            <h1 className="font-serif text-5xl font-bold mb-3">Real trips. Real reviews.</h1>
            <p className="text-muted-foreground text-lg max-w-xl mb-8">
              See where groups like yours went — and how GoPackNow helped them get there.
            </p>
            <div className="relative max-w-md">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search destinations…"
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
              />
            </div>
          </motion.div>
        </div>
      </div>

      {/* Stats bar */}
      {(tripCount > 0 || memberCount > 0 || destinationCount > 0) && (
        <div className="border-b border-border px-8 py-4 bg-background">
          <div className="max-w-5xl mx-auto flex items-center gap-8 text-sm text-muted-foreground">
            {tripCount > 0 && (
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-primary" />
                <span><strong className="text-foreground">{tripCount}</strong> trip{tripCount !== 1 ? "s" : ""} planned</span>
              </div>
            )}
            {memberCount > 0 && (
              <div className="flex items-center gap-2">
                <Users size={14} className="text-primary" />
                <span><strong className="text-foreground">{memberCount}</strong> traveller{memberCount !== 1 ? "s" : ""}</span>
              </div>
            )}
            {destinationCount > 0 && (
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-primary" />
                <span><strong className="text-foreground">{destinationCount}</strong> destination{destinationCount !== 1 ? "s" : ""}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Best This Month */}
      <div className="border-b border-border px-8 py-10 bg-background">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-semibold text-muted-foreground tracking-widest uppercase mb-5">Best This Month</p>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative rounded-2xl overflow-hidden h-64 cursor-pointer group bg-slate-700"
            onClick={() => window.location.href = "/create"}
          >
            <img
              src={monthlyPick.photo}
              alt={monthlyPick.name}
              loading="eager"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              onError={e => { (e.target as HTMLImageElement).style.opacity = "0"; }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent" />
            <div className="absolute top-4 left-4">
              <span className="flex items-center gap-1.5 bg-white/20 backdrop-blur-sm text-white text-xs font-semibold px-3 py-1.5 rounded-full border border-white/30">
                <Sun size={11} />
                {MONTH_NAMES[month].toUpperCase()}'S PICK
              </span>
            </div>
            <div className="absolute bottom-0 left-0 right-0 p-6">
              <h3 className="text-white font-serif text-3xl font-bold mb-1">{monthlyPick.name}</h3>
              <p className="text-white/80 text-sm mb-3 max-w-md">{monthlyPick.why}</p>
              <div className="flex items-center gap-2 flex-wrap">
                {monthlyPick.tags.map(tag => (
                  <span key={tag} className="bg-white/20 backdrop-blur-sm text-white text-xs font-medium px-2.5 py-1 rounded-full border border-white/25">
                    {tag}
                  </span>
                ))}
                <span className="ml-auto flex items-center gap-1 text-white text-sm font-semibold group-hover:gap-2 transition-all">
                  Plan this trip <MapPin size={13} />
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Vibe filter bar */}
      {!loading && reviews.length > 0 && (
        <div className="border-b border-border px-8 py-4 bg-background/50">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground font-medium shrink-0">Filter:</span>
              {VIBE_FILTER_ITEMS.map(({ key, label }) => {
                const active = selectedVibes.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleVibeFilter(key)}
                    className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${
                      active
                        ? "bg-primary text-white border-primary"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
              {selectedVibes.length > 0 && (
                <button
                  onClick={() => setSelectedVibes([])}
                  className="text-xs px-2 py-1.5 rounded-full text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reviews grid */}
      <div className="max-w-5xl mx-auto px-8 py-12">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={24} className="animate-spin text-primary" />
          </div>
        ) : reviews.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="text-center py-24">
            <MessageSquare size={40} className="mx-auto mb-4 text-muted-foreground/30" />
            <h2 className="font-serif text-2xl font-bold mb-3">No reviews yet</h2>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
              Reviews appear here after a trip ends and members share how it went. Be the first!
            </p>
            <Link href="/login" className="inline-flex items-center gap-2 bg-primary text-white font-medium px-7 py-3 rounded-full hover:bg-primary/90 transition-colors">
              Plan a trip
            </Link>
          </motion.div>
        ) : filteredReviews.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center py-16">
            <p className="text-muted-foreground mb-4">No reviews match the selected vibes.</p>
            <button
              onClick={() => setSelectedVibes([])}
              className="text-sm text-primary hover:underline"
            >
              Clear filters
            </button>
          </motion.div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredReviews.map((review, i) => (
                <motion.div
                  key={review.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="border border-border rounded-2xl overflow-hidden bg-background hover:border-primary/30 hover:shadow-sm transition-all flex flex-col"
                >
                  {/* Photo strip */}
                  {review.photos?.length > 0 && (
                    <div className="flex gap-0.5 h-28">
                      {review.photos.slice(0, 3).map((url: string, pi: number) => (
                        <div
                          key={pi}
                          className={`flex-1 overflow-hidden ${pi === 0 ? "" : ""} relative`}
                        >
                          <img
                            src={url}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                          {pi === 2 && review.photos.length > 3 && (
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                              <span className="text-white text-sm font-bold">
                                +{review.photos.length - 3}
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="p-5 flex flex-col flex-1">
                    {/* Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-semibold text-base leading-tight">{review.destination}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {review.days} day{review.days !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {review.photos?.length > 0 && (
                          <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                            <Camera size={10} />
                            {review.photos.length}
                          </span>
                        )}
                        {review.memberCount > 0 && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Users size={11} />
                            <span>{review.memberCount}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Stars */}
                    {review.rating > 0 && <StarRating rating={review.rating} />}

                    {/* Vibes */}
                    {review.vibes?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {review.vibes.map((v: string) => (
                          <span
                            key={v}
                            className={`text-xs px-2 py-0.5 rounded-full border font-medium ${VIBE_COLORS[v] || "bg-muted text-muted-foreground border-border"}`}
                          >
                            {VIBE_LABELS[v.toLowerCase()] || v}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Review quote */}
                    {review.text?.trim() && (
                      <blockquote className="mt-4 pl-3 border-l-2 border-primary/40">
                        <p className="text-sm text-foreground leading-relaxed italic">
                          &ldquo;{review.text}&rdquo;
                        </p>
                        {review.memberNames?.length > 0 && (
                          <cite className="not-italic text-xs text-muted-foreground/60 mt-1 block">
                            — {review.memberNames.slice(0, 2).join(" & ")}
                            {review.memberNames.length > 2 ? ` +${review.memberNames.length - 2} more` : ""}
                          </cite>
                        )}
                      </blockquote>
                    )}

                    {/* Highlight */}
                    {review.highlight?.trim() && (
                      <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 mt-3">
                        ✨ {review.highlight}
                      </p>
                    )}

                    {/* Itinerary preview */}
                    {review.itineraryDays?.length > 0 ? (
                      <ItineraryPreview days={review.itineraryDays} tripDays={review.days} reviewId={review.id} />
                    ) : (
                      <div className="mt-4 rounded-xl border border-border/70 overflow-hidden text-[11px]">
                        <div className="bg-foreground text-background px-3 py-2 flex items-center gap-1.5 font-semibold">
                          <CalendarDays size={11} />
                          <span>{review.days > 0 ? `${review.days}-day` : ""} itinerary</span>
                        </div>
                        <div className="px-3 py-2.5 text-muted-foreground bg-background italic">
                          Itinerary preview will appear here once a trip member opens the trip page.
                        </div>
                      </div>
                    )}

                    <div className="flex-1" />

                    {/* Byline fallback */}
                    {!review.text?.trim() && review.memberNames?.length > 0 && (
                      <p className="text-xs text-muted-foreground/60 mt-3">
                        — {review.memberNames.slice(0, 2).join(" & ")}
                        {review.memberNames.length > 2 ? ` +${review.memberNames.length - 2} more` : ""}
                      </p>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>

            {/* CTA */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="mt-16 border-2 border-dashed border-primary/40 rounded-2xl p-10 text-center bg-primary/3"
            >
              <Sparkles size={28} className="text-primary mx-auto mb-4" />
              <h2 className="font-serif text-3xl font-bold mb-3">Ready to write your own?</h2>
              <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                Start a trip, invite your crew, and let the wishlist decide where you go.
              </p>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 bg-primary text-white font-medium px-8 py-3.5 rounded-full hover:bg-primary/90 transition-colors"
              >
                Plan your trip <MapPin size={15} />
              </Link>
            </motion.div>
          </>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-border px-8 py-8 mt-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="font-display font-bold text-lg">go<span className="text-primary">pack</span></div>
          <p className="text-sm text-muted-foreground">Wish · Vote · Go</p>
        </div>
      </footer>
    </div>
  );
}
