import { Link, useLocation } from "wouter";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { MapPin, Users, Sparkles, Star } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SiApple } from "react-icons/si";
import { trackEvent } from "@/lib/analytics";

const steps = [
  { number: "1", label: "Wish", desc: "Everyone drops their dream activities into the group wishlist" },
  { number: "2", label: "Vote", desc: "The group votes on what matters most — democracy with a passport" },
  { number: "3", label: "Go", desc: "AI builds the perfect itinerary from your collective imagination" },
];

const avatarColors = ["#E85D3A", "#7F77DD", "#1D9E75", "#378ADD", "#BA7517"];

const exploreTrips = [
  { dest: "Tokyo", days: 5, rating: 5, review: "The AI nailed our itinerary — every wish made it in.", by: "Razan's pack", vibes: ["Culture", "Foodie"] },
  { dest: "Paris", days: 4, rating: 5, review: "Planning 8 people used to be chaos. Packyo sorted us in minutes.", by: "Noura's crew", vibes: ["Shopping", "Nightlife"] },
  { dest: "Bali", days: 7, rating: 4, review: "Perfect balance of beach and culture. The packing list was a lifesaver.", by: "Sam & friends", vibes: ["Relaxation", "Adventure"] },
];

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(i => (
        <Star key={i} size={13} className={i <= rating ? "fill-amber-400 text-amber-400" : "text-border fill-border"} />
      ))}
    </div>
  );
}

export default function Landing() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && user) setLocation("/dashboard");
  }, [user, loading, setLocation]);

  const dest = user ? "/dashboard" : "/login";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 md:px-8 py-5 border-b border-border relative z-10 bg-background/90 backdrop-blur-md">
        <div className="font-display font-bold text-2xl tracking-tight">
          pack<span className="text-primary">yo</span>
        </div>
        <div className="flex items-center gap-4 md:gap-6">
          <Link href="/explore" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden md:block" data-testid="link-nav-explore">
            Explore
          </Link>
          <Link href={dest} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" data-testid="link-nav-login">
            {user ? "Dashboard" : "Sign in"}
          </Link>
          <a href="https://apps.apple.com/app/gopacknow/id6785086190" target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("app_store_click", { placement: "nav" })} className="bg-foreground text-background text-sm font-medium px-4 md:px-5 py-2.5 rounded-full hover:bg-foreground/90 transition-colors flex items-center gap-2" data-testid="link-nav-download">
            <SiApple size={16} /> <span className="hidden md:inline">Get the App</span><span className="md:hidden">Download</span>
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 md:px-8 pt-16 md:pt-24 pb-20 max-w-6xl mx-auto w-full">
        <div className="grid md:grid-cols-[1fr_320px] lg:grid-cols-[1fr_360px] gap-12 lg:gap-16 items-center">
          {/* Left: headline + CTAs */}
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }}>
            <p className="text-xs font-semibold text-primary tracking-widest uppercase mb-5">
              Group travel, finally sorted
            </p>
            <h1 className="font-serif text-5xl md:text-7xl font-bold leading-[1.05] md:leading-[0.95] mb-7">
              Pack your bags.<br />
              <span className="text-primary">Pack your friends.</span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-md font-sans mb-10 leading-relaxed">
              Turn your group chat chaos into a real trip. The ultimate collaborative planning app for iPhone. Everyone wishes, everyone votes, and AI builds the perfect plan.
            </p>

            <div className="flex flex-col gap-5 mb-10">
              <a href="https://apps.apple.com/app/gopacknow/id6785086190" target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("app_store_click", { placement: "hero" })} className="inline-flex items-center justify-center gap-3 bg-foreground text-background font-medium px-8 py-4 rounded-full hover:bg-foreground/90 transition-transform hover:scale-105 active:scale-95 shadow-xl w-fit" data-testid="link-hero-download">
                <SiApple size={28} />
                <div className="flex flex-col items-start leading-none text-left">
                  <span className="text-[10px] text-background/80 uppercase tracking-widest mb-1 font-semibold">Download on the</span>
                  <span className="text-xl font-bold tracking-tight">App Store</span>
                </div>
              </a>

              <div className="flex items-center gap-4 text-sm font-medium px-2">
                <Link href={dest} className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-hero-start">
                  Create trip on web
                </Link>
                <span className="text-border">•</span>
                <Link href={dest} className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-hero-join">
                  Join trip on web
                </Link>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                {avatarColors.map((color, i) => (
                  <div key={i} className="w-8 h-8 rounded-full border-2 border-background" style={{ backgroundColor: color }} />
                ))}
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground font-medium">One shared plan for the whole group</span>
              </div>
            </div>
          </motion.div>

          {/* Right: Phone Mockup */}
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.55, delay: 0.1 }} className="justify-center md:justify-end hidden sm:flex">
            <div className="relative w-[300px] h-[620px] border-[12px] border-foreground rounded-[3rem] bg-background shadow-2xl overflow-hidden flex flex-col transform md:rotate-2 hover:rotate-0 transition-transform duration-500 ring-1 ring-border">
              {/* Dynamic Island / Notch */}
              <div className="absolute top-2 inset-x-0 h-6 flex justify-center z-20">
                <div className="w-24 h-7 bg-foreground rounded-full"></div>
              </div>

              {/* Phone Header */}
              <div className="pt-12 px-6 pb-4 border-b border-border/50 bg-background/90 backdrop-blur-sm z-10">
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex -space-x-1.5">
                    {avatarColors.slice(0, 3).map((color, i) => (
                      <div key={i} className="w-5 h-5 rounded-full border-[1.5px] border-background" style={{ backgroundColor: color }} />
                    ))}
                  </div>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tokyo Crew</span>
                </div>
                <h3 className="font-serif text-2xl font-bold">Trip Plan</h3>
              </div>

              {/* Phone Content */}
              <div className="flex-1 bg-background pt-4 px-4 pb-6 flex flex-col gap-3 overflow-hidden relative">
                <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />

                <div className="relative z-10 flex flex-col gap-3">
                  {steps.map((step, i) => (
                    <motion.div key={step.number} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + i * 0.1 }}
                      className="flex items-start gap-3 border border-border/60 rounded-2xl p-4 bg-card shadow-sm">
                      <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-display font-bold text-sm shrink-0">
                        {step.number}
                      </div>
                      <div>
                        <p className="font-semibold text-sm mb-0.5">{step.label}</p>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">{step.desc}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* AI Itinerary card preview */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }} className="mt-auto relative z-10 border border-primary/20 rounded-2xl p-4 bg-primary/5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Sparkles size={14} className="text-primary" />
                      <span className="text-xs font-semibold text-primary">AI Itinerary</span>
                    </div>
                    <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">Ready</span>
                  </div>
                  <div className="space-y-2">
                    <div className="h-1.5 w-3/4 bg-primary/20 rounded-full"></div>
                    <div className="h-1.5 w-1/2 bg-primary/10 rounded-full"></div>
                  </div>
                </motion.div>

                {/* Home Indicator */}
                <div className="absolute bottom-2 inset-x-0 flex justify-center z-20">
                  <div className="w-1/3 h-1 bg-foreground/20 rounded-full" />
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Explore strip */}
      <section className="border-y border-border px-6 md:px-8 py-16 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-end justify-between mb-8">
            <div>
              <p className="text-xs font-semibold text-muted-foreground tracking-widest uppercase mb-2">Real trips · Real reviews</p>
              <h2 className="font-serif text-3xl font-bold">See where packs are going</h2>
            </div>
            <Link href="/explore" className="text-sm text-primary hover:underline font-medium">
              Explore all →
            </Link>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {exploreTrips.map((trip, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 * i }}
                className="border border-border rounded-2xl p-6 bg-background hover:border-primary/30 hover:shadow-sm transition-all">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-lg mb-1">{trip.dest}</h3>
                    <p className="text-xs text-muted-foreground font-medium">{trip.days} days · {trip.vibes.join(", ")}</p>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    <MapPin size={10} /> {trip.dest}
                  </div>
                </div>
                <StarRating rating={trip.rating} />
                <p className="text-sm text-muted-foreground mt-4 leading-relaxed">"{trip.review}"</p>
                <p className="text-xs text-muted-foreground/60 mt-4 font-medium">— {trip.by}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 md:px-8 py-20 max-w-6xl mx-auto w-full">
        <div className="grid md:grid-cols-3 gap-10 md:gap-8">
          <div className="flex gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <Users size={20} className="text-primary" />
            </div>
            <div>
              <h3 className="font-serif text-xl font-bold mb-2">Real-time collaboration</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">Everyone sees wishes and votes update live, no refreshing needed.</p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <Sparkles size={20} className="text-primary" />
            </div>
            <div>
              <h3 className="font-serif text-xl font-bold mb-2">AI itineraries</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">AI turns your group's collective wishes into a cohesive day-by-day plan.</p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
              <MapPin size={20} className="text-primary" />
            </div>
            <div>
              <h3 className="font-serif text-xl font-bold mb-2">Smart packing lists</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">AI generates packing lists tailored perfectly to your destination and vibes.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-border px-6 md:px-8 py-24 bg-primary/5 relative overflow-hidden">
        <div className="max-w-3xl mx-auto text-center relative z-10">
          <h2 className="font-serif text-4xl md:text-5xl font-bold mb-6">Ready to pack?</h2>
          <p className="text-lg text-muted-foreground mb-10 max-w-xl mx-auto">
            Download Packyo on your iPhone today and turn that group chat into a real getaway.
          </p>
          <a href="https://apps.apple.com/app/gopacknow/id6785086190" target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("app_store_click", { placement: "footer_cta" })} className="inline-flex items-center justify-center gap-3 bg-foreground text-background font-medium px-8 py-4 rounded-full hover:bg-foreground/90 transition-transform hover:scale-105 active:scale-95 shadow-xl mx-auto">
            <SiApple size={24} />
            <div className="flex flex-col items-start leading-none text-left">
              <span className="text-[10px] text-background/80 uppercase tracking-wider mb-1">Download on the</span>
              <span className="text-lg font-bold">App Store</span>
            </div>
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-6 md:px-8 py-8 mt-auto">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="font-display font-bold text-xl">pack<span className="text-primary">yo</span></div>
          <p className="text-sm text-muted-foreground font-medium">Wish · Vote · Go</p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
