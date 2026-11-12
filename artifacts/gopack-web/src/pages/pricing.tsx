import { Check } from "lucide-react";
import { SiApple } from "react-icons/si";
import { APP_STORE_URL, UNLOCK_OPTIONS } from "@/lib/unlocks";

const FREE_FEATURES = [
  "Create trips and invite your whole group",
  "Vote on destinations, stays, and wishes",
  "Realtime group chat, packing lists, and expenses",
  "AI itinerary, with Day 1 free on every trip",
];

export default function Pricing() {
  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      maxWidth: 760,
      margin: "0 auto",
      padding: "48px 20px 80px",
      color: "#1a1a1a",
    }}>
      <h1 style={{ fontSize: 34, fontWeight: 800, textAlign: "center", margin: "0 0 8px" }}>Simple pricing</h1>
      <p style={{ textAlign: "center", color: "#666", fontSize: 16, margin: "0 0 40px" }}>
        Planning with Packyo is free. Pay only when you want the full itinerary for a trip. No subscription.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
        <div style={{ border: "1px solid #e5e5e5", borderRadius: 20, padding: 28, background: "#fff" }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#888", margin: "0 0 8px" }}>Free</p>
          <p style={{ fontSize: 40, fontWeight: 800, margin: "0 0 18px" }}>$0</p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
            {FREE_FEATURES.map((f) => (
              <li key={f} style={{ display: "flex", gap: 10, fontSize: 14, color: "#333" }}>
                <Check size={16} color="#E85D3A" style={{ flexShrink: 0, marginTop: 2 }} /> {f}
              </li>
            ))}
          </ul>
        </div>

        <div style={{ borderRadius: 20, padding: 28, background: "#1a1a1a", color: "#fff" }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#E85D3A", margin: "0 0 8px" }}>Itinerary unlock</p>
          <p style={{ fontSize: 15, color: "#bbb", margin: "0 0 18px" }}>Unlock every day of a trip's itinerary, with times, routes, and prices.</p>
          <div style={{ display: "grid", gap: 12, marginBottom: 22 }}>
            {UNLOCK_OPTIONS.map((o) => (
              <div key={o.title} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid #333", borderRadius: 14, padding: "12px 14px" }}>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{o.title}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#999" }}>{o.detail}</p>
                </div>
                <p style={{ margin: 0, fontWeight: 800, fontSize: 18 }}>{o.price}</p>
              </div>
            ))}
          </div>
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#E85D3A", color: "#fff", fontWeight: 700, padding: "14px 20px", borderRadius: 999, textDecoration: "none" }}
          >
            <SiApple size={16} /> Get Packyo on the App Store
          </a>
          <p style={{ textAlign: "center", fontSize: 12, color: "#888", margin: "12px 0 0" }}>
            Unlocks are one-time purchases per trip, made in the iOS app and paid through Apple.
          </p>
        </div>
      </div>

      <p style={{ textAlign: "center", fontSize: 13, color: "#888", marginTop: 32 }}>
        Questions? <a href="mailto:support@gopack.now" style={{ color: "#E85D3A" }}>support@gopack.now</a> · <a href="/refunds" style={{ color: "#E85D3A" }}>Refunds</a> · <a href="/terms" style={{ color: "#E85D3A" }}>Terms</a>
      </p>
    </div>
  );
}
