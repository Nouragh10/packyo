// Itinerary unlocks are sold only in the iOS app (App Store + RevenueCat).
export const APP_STORE_URL = "https://apps.apple.com/app/packyo/id6785086190";

export const UNLOCK_OPTIONS = [
  { title: "Unlock for the whole pack", detail: "One person pays, everyone in the trip sees every day", price: "$3.99" },
  { title: "Just for me", detail: "Only you see the full itinerary", price: "$2.99" },
] as const;
