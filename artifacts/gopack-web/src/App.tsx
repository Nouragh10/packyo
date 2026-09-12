import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Analytics } from "@vercel/analytics/react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { handleGoogleRedirectResult } from "@/lib/firebase";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Explore from "@/pages/explore";
import Create from "@/pages/create";
import JoinTrip from "@/pages/join";
import TripHub from "@/pages/trip-hub";
import Review from "@/pages/review";
import Itinerary from "@/pages/itinerary";
import Chat from "@/pages/chat";
import Packing from "@/pages/packing";
import Profile from "@/pages/profile";
import DestinationPreferences from "@/pages/destination-preferences";
import DestinationVote from "@/pages/destination-vote";
import AccommodationPreferences from "@/pages/accommodation-preferences";
import AccommodationVote from "@/pages/accommodation-vote";
import Building from "@/pages/building";
import Notifications from "@/pages/notifications";
import Privacy from "@/pages/privacy";
import Terms from "@/pages/terms";
import Refunds from "@/pages/refunds";
import Pricing from "@/pages/pricing";
import { trackEvent } from "@/lib/analytics";

const queryClient = new QueryClient();

// Handles the Google redirect result on any page — Firebase can redirect back
// to any URL (not just /login), so we must call getRedirectResult globally.
function GoogleAuthHandler() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    handleGoogleRedirectResult()
      .then((result) => {
        if (result?.user) {
          trackEvent("sign_in_succeeded", { method: "google", flow: "redirect" });
          const dest = sessionStorage.getItem("gopack_auth_redirect") || "/dashboard";
          sessionStorage.removeItem("gopack_auth_redirect");
          setLocation(dest);
        }
      })
      .catch((err) => {
        // auth/no-auth-event is the normal case when there's no pending redirect
        if (err?.code !== "auth/no-auth-event") {
          console.error("Google redirect auth error:", err);
        }
      });
  }, []);

  return null;
}

function Router() {
  return (
    <>
      <GoogleAuthHandler />
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/login" component={Login} />
        <Route path="/explore" component={Explore} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/create" component={Create} />
        <Route path="/join/:tripId" component={JoinTrip} />
        <Route path="/trip/:tripId/destination-preferences" component={DestinationPreferences} />
        <Route path="/trip/:tripId/destination-vote" component={DestinationVote} />
        <Route path="/trip/:tripId/accommodation-preferences" component={AccommodationPreferences} />
        <Route path="/trip/:tripId/accommodation-vote" component={AccommodationVote} />
        <Route path="/trip/:tripId/building" component={Building} />
        <Route path="/trip/:tripId/itinerary" component={Itinerary} />
        <Route path="/trip/:tripId/chat" component={Chat} />
        <Route path="/trip/:tripId/packing" component={Packing} />
        <Route path="/trip/:tripId/review" component={Review} />
        <Route path="/trip/:tripId" component={TripHub} />
        <Route path="/profile" component={Profile} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/terms" component={Terms} />
        <Route path="/refunds" component={Refunds} />
        <Route path="/pricing" component={Pricing} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
        <Analytics />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
