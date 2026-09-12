import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { signInWithGoogle } from "@/lib/firebase";
import { SiGoogle } from "react-icons/si";
import { Loader2 } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

export default function Login() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [loading, setLoading] = useState<"google" | null>(null);
  const [error, setError] = useState("");

  const params = new URLSearchParams(search);
  const redirectTo = params.get("from") || "/dashboard";

  // Already signed in — go straight to destination
  useEffect(() => {
    if (user) setLocation(redirectTo);
  }, [user]);

  const handleGoogle = async () => {
    setLoading("google");
    setError("");
    try {
      await signInWithGoogle();
      trackEvent("sign_in_succeeded", { method: "google", flow: "popup" });
      setLocation(redirectTo);
    } catch (err: any) {
      if (err?.code === "auth/popup-blocked") {
        setError("Popup was blocked. Please allow popups for gopacknow.app and try again.");
      } else if (err?.code === "auth/popup-closed-by-user" || err?.code === "auth/cancelled-popup-request") {
        setError("Sign-in was cancelled.");
      } else {
        setError("Google sign-in failed. Please try again.");
      }
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left panel */}
      <div className="hidden md:flex flex-col justify-between w-1/2 bg-foreground text-background p-12">
        <div className="font-display font-bold text-2xl">
          go<span className="text-primary">packnow</span>
        </div>
        <div>
          <p className="text-5xl font-serif font-bold leading-tight mb-6">
            Your next adventure<br />
            <span className="text-primary">starts here.</span>
          </p>
          <p className="text-background/60 text-lg leading-relaxed">
            Join your crew, drop your wishes, vote on what matters,
            and let AI plan the perfect trip.
          </p>
          <div className="mt-10 text-2xl font-display font-bold text-background/40 tracking-widest">
            WISH &middot; VOTE &middot; GO
          </div>
        </div>
        <div className="text-background/40 text-sm">GoPackNow &copy; 2026</div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm"
        >
          <div className="mb-8 md:hidden">
            <div className="font-display font-bold text-2xl mb-2">
              go<span className="text-primary">pack</span>
            </div>
          </div>

          <h1 className="font-serif text-4xl font-bold mb-2">Welcome back</h1>
          <p className="text-muted-foreground mb-10">
            {redirectTo.startsWith("/join/")
              ? "Sign in to join the trip"
              : "Sign in to continue planning"}
          </p>

          {error && (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg px-4 py-3 mb-6">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <button
              onClick={handleGoogle}
              disabled={!!loading}
              className="flex items-center justify-center gap-3 w-full border border-border rounded-full py-3.5 font-medium hover:bg-muted/50 transition-colors disabled:opacity-50"
              data-testid="button-signin-google"
            >
              {loading === "google" ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <SiGoogle size={18} />
              )}
              Continue with Google
            </button>

          </div>

          <p className="text-xs text-muted-foreground mt-8 text-center">
            By continuing you agree to GoPackNow&apos;s terms of service.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
