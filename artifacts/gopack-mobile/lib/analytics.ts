// Firebase (Google) Analytics for the iOS/Android app.
//
// Every call is fire-and-forget and silently does nothing where the native module
// isn't available (web, Expo Go, demo mode), so analytics can never break a user flow.
// Events show up in Firebase console → Analytics → Events (and Realtime / DebugView).
import { Platform } from "react-native";

type RNFBAnalytics = typeof import("@react-native-firebase/analytics");

let mod: RNFBAnalytics | null | undefined;
function analytics(): { m: RNFBAnalytics; a: ReturnType<RNFBAnalytics["getAnalytics"]> } | null {
  if (mod === undefined) {
    mod = null;
    if (Platform.OS !== "web") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        mod = require("@react-native-firebase/analytics") as RNFBAnalytics;
      } catch {
        mod = null;
      }
    }
  }
  if (!mod) return null;
  try {
    return { m: mod, a: mod.getAnalytics() };
  } catch {
    return null;
  }
}

const safe = (fn: () => Promise<unknown> | void) => {
  try {
    const p = fn();
    if (p && typeof (p as Promise<unknown>).catch === "function") (p as Promise<unknown>).catch(() => undefined);
  } catch {
    // never throw from analytics
  }
};

type Params = Record<string, string | number | boolean | undefined>;
const clean = (p?: Params) =>
  p ? Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== "")) : undefined;

/** Custom event. Names: lowercase_with_underscores, ≤40 chars. */
export function track(name: string, params?: Params) {
  const x = analytics();
  if (x) safe(() => x.m.logEvent(x.a, name, clean(params) as never));
}

export function trackScreen(path: string) {
  const x = analytics();
  // Collapse ids so "/trip/-Nab12" and "/trip/-Ncd34" count as one screen.
  const screen = path.replace(/\/[-_A-Za-z0-9]{12,}(?=\/|$)/g, "/[id]") || "/";
  if (x) safe(() => x.m.logScreenView(x.a, { screen_name: screen, screen_class: screen }));
}

export function trackSignUp(method: "email" | "apple" | "google" | "guest") {
  const x = analytics();
  if (x) safe(() => x.m.logSignUp(x.a, { method }));
}

export function trackLogin(method: "email" | "apple" | "google" | "guest") {
  const x = analytics();
  if (x) safe(() => x.m.logLogin(x.a, { method }));
}

export function setAnalyticsUser(uid: string | null) {
  const x = analytics();
  if (x) safe(() => x.m.setUserId(x.a, uid));
}
