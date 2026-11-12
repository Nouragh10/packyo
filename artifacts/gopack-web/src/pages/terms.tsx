const h2 = { fontSize: 20, marginTop: 36, marginBottom: 10 } as const;
const ul = { paddingLeft: 22 } as const;
const link = { color: "#E85D3A" } as const;

export default function Terms() {
  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      maxWidth: 720,
      margin: "0 auto",
      padding: "40px 20px 80px",
      lineHeight: 1.6,
      color: "#1a1a1a",
    }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Terms of Service</h1>
      <p style={{ color: "#777", fontSize: 14, marginBottom: 32 }}>Last updated: November 12, 2026</p>

      <p>Welcome to Packyo ("Packyo," "we," "us," or "our"). By using the Packyo app or the website at packyo.app (the "Service"), you agree to these Terms of Service. Please read them carefully.</p>

      <h2 style={h2}>1. Eligibility</h2>
      <p>You must be at least 13 years old to use the Service. By using Packyo you confirm that you meet this requirement and can enter into these Terms.</p>

      <h2 style={h2}>2. Your Account</h2>
      <p>You can sign up with email, Sign in with Apple, or Google. You are responsible for activity under your account. Contact us at <a href="mailto:support@gopack.now" style={link}>support@gopack.now</a> if you suspect unauthorized use. You can delete your account at any time in the app under Profile → Settings → Delete account.</p>

      <h2 style={h2}>3. Purchases</h2>
      <p>Planning trips with Packyo is free. Packyo offers optional one-time purchases in the iOS app to unlock a trip's full itinerary:</p>
      <ul style={ul}>
        <li><strong>Group unlock:</strong> one member pays and the full itinerary is unlocked for every member of that trip.</li>
        <li><strong>Personal unlock:</strong> unlocks the full itinerary only for the member who paid.</li>
      </ul>
      <p>Each unlock applies only to the trip it was bought for and is not a subscription. Purchases are made through Apple's App Store, are charged to your Apple ID, and are subject to Apple's terms. Prices are shown in the app before you buy. See our <a href="/refunds" style={link}>Refund Policy</a> for refunds.</p>

      <h2 style={h2}>4. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul style={ul}>
        <li>Upload or share content that is unlawful, offensive, or violates anyone's rights</li>
        <li>Attempt to reverse-engineer, scrape, or disrupt the Service</li>
        <li>Use the Service to send spam or unsolicited messages</li>
        <li>Get around unlocks, access controls, or usage limits</li>
      </ul>

      <h2 style={h2}>5. AI-Generated Content</h2>
      <p>Itineraries and packing lists are generated with AI (Anthropic Claude) and are provided for planning purposes only. We don't guarantee their accuracy, opening hours, availability, or prices. Always check important details yourself before you travel or book.</p>

      <h2 style={h2}>6. Third-Party Sites</h2>
      <p>Packyo may link to third-party sites such as Booking.com or Expedia. We don't control those sites, and bookings you make there are between you and that provider under their terms.</p>

      <h2 style={h2}>7. Intellectual Property</h2>
      <p>The Packyo name, design, and software belong to us. Content you create (trips, wishes, chat messages, reviews, photos) remains yours. You give us a limited license to store it and show it to your trip members, and to other users when you choose to make a review public, as needed to run the Service.</p>

      <h2 style={h2}>8. Disclaimers</h2>
      <p>The Service is provided "as is" without warranties of any kind. We don't guarantee that it will always be available or free of errors.</p>

      <h2 style={h2}>9. Limitation of Liability</h2>
      <p>To the maximum extent permitted by law, Packyo's total liability to you for any claim arising from these Terms or your use of the Service is limited to the amount you paid us in the 12 months before the claim, or US$50, whichever is greater.</p>

      <h2 style={h2}>10. Changes to These Terms</h2>
      <p>We may update these Terms from time to time. If you keep using the Service after changes are posted, you accept the updated Terms.</p>

      <h2 style={h2}>11. Contact</h2>
      <div style={{ background: "#f7f7f7", borderRadius: 10, padding: "16px 20px", marginTop: 12 }}>
        <p style={{ margin: 0 }}>Questions? Reach us at:</p>
        <p style={{ margin: "4px 0 0" }}><a href="mailto:support@gopack.now" style={link}>support@gopack.now</a></p>
      </div>
    </div>
  );
}
