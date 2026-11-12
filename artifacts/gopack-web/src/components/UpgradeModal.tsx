import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Check } from "lucide-react";
import { SiApple } from "react-icons/si";
import { APP_STORE_URL, UNLOCK_OPTIONS } from "@/lib/unlocks";

interface Props {
  open: boolean;
  reason?: string;
  tripId: string;
  onClose: () => void;
}

// Unlocks are sold through the App Store only, so the web points people to the app.
export function UpgradeModal({ open, reason, onClose }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            key="modal"
            initial={{ opacity: 0, y: 48, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 48, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className="fixed bottom-0 left-0 right-0 z-50 sm:inset-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-md"
          >
            <div className="relative bg-background rounded-t-3xl sm:rounded-2xl shadow-2xl border border-border p-8">
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>

              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
                <Sparkles size={22} className="text-primary" />
              </div>

              {reason && (
                <p className="text-xs font-semibold text-primary/70 uppercase tracking-widest mb-1.5">{reason}</p>
              )}

              <h2 className="font-serif text-2xl font-bold mb-1 leading-tight">Unlock the whole trip</h2>
              <p className="text-sm text-muted-foreground mb-5">
                Day 1 is free. Unlock every day of the itinerary in the Packyo app.
              </p>

              <ul className="space-y-2.5 mb-6">
                {UNLOCK_OPTIONS.map((o) => (
                  <li key={o.title} className="flex items-start gap-3 rounded-2xl border border-border p-3.5">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                      <Check size={11} className="text-primary" strokeWidth={3} />
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-semibold">{o.title}</span>
                      <span className="block text-xs text-muted-foreground">{o.detail}</span>
                    </span>
                    <span className="text-sm font-bold">{o.price}</span>
                  </li>
                ))}
              </ul>

              <a
                href={APP_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full bg-foreground text-background font-semibold py-3.5 rounded-full hover:bg-foreground/90 transition-colors text-base mb-2.5"
              >
                <SiApple size={16} /> Open Packyo on the App Store
              </a>
              <p className="text-center text-[11px] text-muted-foreground mb-2">
                One-time purchase per trip · No subscription · Paid through Apple
              </p>
              <button
                onClick={onClose}
                className="w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Not now
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
