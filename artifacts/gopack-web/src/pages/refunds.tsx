const h2 = { fontSize: 20, marginTop: 36, marginBottom: 10 } as const;
const ul = { paddingLeft: 22 } as const;
const link = { color: "#E85D3A" } as const;

export default function Refunds() {
  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      maxWidth: 720,
      margin: "0 auto",
      padding: "40px 20px 80px",
      lineHeight: 1.6,
      color: "#1a1a1a",
    }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Refund Policy</h1>
      <p style={{ color: "#777", fontSize: 14, marginBottom: 32 }}>Last updated: November 12, 2026</p>

      <p>Itinerary unlocks in Packyo are one-time purchases made in the iOS app through Apple's App Store. Packyo has no subscriptions, so there is nothing to cancel.</p>

      <h2 style={h2}>How to Request a Refund</h2>
      <p>Because Apple processes the payment, refunds are handled by Apple:</p>
      <ul style={ul}>
        <li>Go to <a href="https://reportaproblem.apple.com" target="_blank" rel="noopener noreferrer" style={link}>reportaproblem.apple.com</a> and sign in with your Apple ID.</li>
        <li>Find the Packyo purchase, choose "Request a refund," and tell Apple why.</li>
        <li>Apple reviews the request and lets you know the outcome, usually within a few days.</li>
      </ul>
      <p>Apple decides refunds under its own policies, and we can't issue them directly. If a refund is approved, the unlock may be removed from the trip.</p>

      <h2 style={h2}>Problems With a Purchase</h2>
      <p>If you paid but the itinerary didn't unlock, first open the trip and tap "Already paid? Refresh" on the unlock screen. If it still doesn't unlock, email us at <a href="mailto:support@gopack.now" style={link}>support@gopack.now</a> with your account email and the trip name, and we'll fix it.</p>

      <h2 style={h2}>Contact</h2>
      <div style={{ background: "#f7f7f7", borderRadius: 10, padding: "16px 20px", marginTop: 12 }}>
        <p style={{ margin: 0 }}>Questions about a purchase?</p>
        <p style={{ margin: "4px 0 0" }}><a href="mailto:support@gopack.now" style={link}>support@gopack.now</a></p>
      </div>
    </div>
  );
}
