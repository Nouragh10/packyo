import { useState, useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, Star, Camera, X, Globe, Lock, Loader2, Check } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { useTrip } from "@/hooks/useFirebase";
import { trackEvent } from "@/lib/analytics";

const VIBES = [
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

const RATING_LABELS = ["", "Disappointing", "It was OK", "Pretty good", "Really good", "Incredible!"];

/** Compress an image file to a JPEG data URL using Canvas (≈ 800px wide, 70% quality). */
function compressImage(file: File, maxWidth = 800, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxWidth) { h = Math.round((h * maxWidth) / w); w = maxWidth; }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas unavailable")); URL.revokeObjectURL(objectUrl); return; }
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Could not load image")); };
    img.src = objectUrl;
  });
}

export default function Review() {
  const [, params] = useRoute("/trip/:tripId/review");
  const tripId = params?.tripId ?? "";
  const { user } = useAuth();
  const { trip, loading, submitReview } = useTrip(tripId);
  const [, setLocation] = useLocation();

  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [text, setText] = useState("");
  const [highlight, setHighlight] = useState("");
  const [vibes, setVibes] = useState<string[]>([]);
  const [isPublic, setIsPublic] = useState(true);
  const [photoItems, setPhotoItems] = useState<{ file: File; preview: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pre-populate vibes from trip
  useEffect(() => {
    if (trip?.vibes?.length) {
      setVibes(trip.vibes.map((v: string) => v.toLowerCase()));
    }
  }, [trip?.id]);

  // Trip-ended guard
  const tripEnded = (() => {
    const tripEnd = trip?.endDate ?? (
      trip?.startDate
        ? new Date(
            new Date(`${trip.startDate}T00:00:00`).getTime() +
              Math.max(Number(trip.days) || 1, 1) * 24 * 60 * 60 * 1000,
          ).toISOString().slice(0, 10)
        : null
    );
    const tripEndTime = tripEnd ? new Date(`${tripEnd}T23:59:59`).getTime() : NaN;
    return !Number.isNaN(tripEndTime) && tripEndTime <= Date.now();
  })();
  const isMember = Boolean(user && trip?.members?.[user.uid]);

  useEffect(() => {
    if (loading) return;
    if (!trip) { setLocation("/dashboard"); return; }
    if (!user) { setLocation("/login"); return; }
    if (!isMember || !tripEnded || trip.review) { setLocation(`/trip/${tripId}`); return; }
  }, [loading, trip, tripEnded, isMember, tripId, user, setLocation]);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const remaining = 6 - photoItems.length;
    files.slice(0, remaining).forEach(file => {
      setPhotoItems(prev => [...prev, { file, preview: URL.createObjectURL(file) }]);
    });
    e.target.value = "";
  };

  const removePhoto = (i: number) => {
    setPhotoItems(prev => {
      URL.revokeObjectURL(prev[i].preview);
      return prev.filter((_, idx) => idx !== i);
    });
  };

  const toggleVibe = (key: string) =>
    setVibes(prev => prev.includes(key) ? prev.filter(v => v !== key) : [...prev, key]);

  const handleSubmit = async () => {
    if (!rating || !text.trim()) return;
    if (!isMember || !tripEnded) {
      setError("Only members can review a trip after it has finished.");
      return;
    }
    setError("");
    try {
      let photoUrls: string[] = [];
      if (photoItems.length > 0) {
        setUploading(true);
        photoUrls = await Promise.all(photoItems.map(p => compressImage(p.file)));
        setUploading(false);
      }
      setSubmitting(true);
      await submitReview({
        rating,
        text: text.trim(),
        vibes,
        highlight: highlight.trim(),
        isPublic,
        photos: photoUrls,
      });
      trackEvent("review_submitted", {
        rating,
        is_public: isPublic,
        photo_count: photoUrls.length,
        vibe_count: vibes.length,
      });
      setLocation(`/trip/${tripId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit review.");
      setUploading(false);
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!trip) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border px-4 sm:px-6 py-3 flex items-center gap-3">
        <button
          onClick={() => setLocation(`/trip/${tripId}`)}
          className="p-1.5 hover:bg-muted rounded-lg transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold tracking-widest text-primary uppercase">Review</div>
          <div className="font-semibold text-sm truncate">{trip.destination}</div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 sm:px-6 py-8 flex flex-col gap-8">

        {/* Star rating */}
        <section>
          <p className="text-[10px] font-semibold text-muted-foreground tracking-widest uppercase mb-3">
            Overall rating
          </p>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                className="p-0.5 transition-transform hover:scale-110"
              >
                <Star
                  size={32}
                  className={n <= (hover || rating) ? "fill-amber-400 text-amber-400" : "text-border fill-muted"}
                />
              </button>
            ))}
            {(hover || rating) > 0 && (
              <span className="ml-2 text-sm text-muted-foreground">{RATING_LABELS[hover || rating]}</span>
            )}
          </div>
        </section>

        {/* Review text */}
        <section>
          <p className="text-[10px] font-semibold text-muted-foreground tracking-widest uppercase mb-3">
            Your review <span className="normal-case font-normal">(required)</span>
          </p>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="How did it go? What worked, what surprised you, what would you tell another group planning the same trip?"
            rows={5}
            className="w-full border border-border rounded-xl px-4 py-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
          />
        </section>

        {/* Highlight */}
        <section>
          <p className="text-[10px] font-semibold text-muted-foreground tracking-widest uppercase mb-3">
            Top highlight <span className="normal-case font-normal">(optional)</span>
          </p>
          <input
            value={highlight}
            onChange={e => setHighlight(e.target.value)}
            placeholder="e.g. Sunset hike, rooftop dinner, that hidden beach"
            className="w-full border border-border rounded-xl px-4 py-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </section>

        {/* Vibes */}
        <section>
          <p className="text-[10px] font-semibold text-muted-foreground tracking-widest uppercase mb-3">
            Trip vibes
          </p>
          <div className="flex flex-wrap gap-2">
            {VIBES.map(({ key, label }) => {
              const active = vibes.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleVibe(key)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                    active
                      ? "bg-primary text-white border-primary"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Photos */}
        <section>
          <p className="text-[10px] font-semibold text-muted-foreground tracking-widest uppercase mb-3">
            Trip photos <span className="normal-case font-normal">(optional, up to 6)</span>
          </p>
          <div className="grid grid-cols-3 gap-2">
            {photoItems.map((p, i) => (
              <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-border">
                <img src={p.preview} alt="" className="w-full h-full object-cover" />
                <button
                  onClick={() => removePhoto(i)}
                  className="absolute top-1 right-1 w-6 h-6 bg-black/50 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
                >
                  <X size={12} className="text-white" />
                </button>
              </div>
            ))}
            {photoItems.length < 6 && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="aspect-square rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 flex flex-col items-center justify-center gap-1.5 transition-colors"
              >
                <Camera size={20} className="text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Add photo</span>
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFiles}
          />
        </section>

        {/* Public / Private */}
        <section>
          <p className="text-[10px] font-semibold text-muted-foreground tracking-widest uppercase mb-3">
            Visibility
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setIsPublic(true)}
              className={`flex flex-col gap-2 p-4 rounded-xl border-2 transition-all text-left ${
                isPublic ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"
              }`}
            >
              <Globe size={18} className={isPublic ? "text-primary" : "text-muted-foreground"} />
              <div>
                <div className={`font-semibold text-sm ${isPublic ? "text-foreground" : "text-muted-foreground"}`}>
                  Public
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 leading-tight">
                  Review + itinerary + photos appear on the Discover page
                </div>
              </div>
              {isPublic && <Check size={14} className="text-primary" />}
            </button>
            <button
              type="button"
              onClick={() => setIsPublic(false)}
              className={`flex flex-col gap-2 p-4 rounded-xl border-2 transition-all text-left ${
                !isPublic ? "border-foreground bg-muted/30" : "border-border hover:border-foreground/30"
              }`}
            >
              <Lock size={18} className={!isPublic ? "text-foreground" : "text-muted-foreground"} />
              <div>
                <div className={`font-semibold text-sm ${!isPublic ? "text-foreground" : "text-muted-foreground"}`}>
                  Private
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 leading-tight">
                  Saved to your trip history only, not shared publicly
                </div>
              </div>
              {!isPublic && <Check size={14} className="text-foreground" />}
            </button>
          </div>
        </section>

        {error && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-sm text-destructive"
          >
            {error}
          </motion.p>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!rating || !text.trim() || uploading || submitting}
          className="w-full bg-primary text-white font-medium py-3.5 rounded-full hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {(uploading || submitting) && <Loader2 size={16} className="animate-spin" />}
          {uploading ? "Uploading photos…" : submitting ? "Submitting…" : "Submit review"}
        </button>
        <p className="text-xs text-center text-muted-foreground -mt-4">
          {isPublic
            ? "This review will appear on the Discover page."
            : "This review is private and won't be shared publicly."}
        </p>
      </div>
    </div>
  );
}
