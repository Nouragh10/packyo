const h2 = { fontSize: 20, marginTop: 36, marginBottom: 10 } as const;
const h3 = { fontSize: 16, marginTop: 20, marginBottom: 6 } as const;
const ul = { paddingLeft: 22 } as const;
const link = { color: "#E85D3A" } as const;

export default function Privacy() {
  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      maxWidth: 720,
      margin: "0 auto",
      padding: "40px 20px 80px",
      lineHeight: 1.6,
      color: "#1a1a1a",
    }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Privacy Policy</h1>
      <p style={{ color: "#777", fontSize: 14, marginBottom: 32 }}>Last updated: November 12, 2026</p>

      <p>Packyo ("Packyo," "we," "us," or "our") provides a collaborative group travel planning app for iOS and the web at packyo.app. This policy explains what information we collect, how we use it, who we share it with, and the choices you have.</p>

      <h2 style={h2}>1. Information We Collect</h2>

      <h3 style={h3}>Account Information</h3>
      <p>We use Firebase Authentication to manage your account. Depending on how you sign up, this includes:</p>
      <ul style={ul}>
        <li><strong>Email sign-up:</strong> your name, email address, and password (stored securely by Firebase; we never see it). We send you an email to confirm your address.</li>
        <li><strong>Sign in with Apple:</strong> the name and email address Apple shares with us. If you choose "Hide My Email," we receive a private relay address instead of your real email.</li>
        <li><strong>Sign in with Google:</strong> your Google profile name, email address, and profile photo.</li>
      </ul>

      <h3 style={h3}>Trip Content You Create</h3>
      <p>We store the information you create while using Packyo in Firebase, including:</p>
      <ul style={ul}>
        <li>Trips you create or join, including destinations, dates, budget, and trip names</li>
        <li>Wishes, votes, chat messages, stays, and expenses shared with your trip group</li>
        <li>Itineraries and packing lists generated for your trips</li>
        <li>Your membership and role within a trip (for example, host or member)</li>
        <li>Photos you choose to upload, such as a profile photo or photos in a trip review</li>
        <li>Trip reviews, saved activities, and saved stays</li>
      </ul>
      <p>Trip content is visible to the other members of the same trip, since Packyo is built for group planning. Trip reviews you choose to make public, including their photos and the first names of the trip's members, may be visible to other Packyo users.</p>

      <h3 style={h3}>Purchase Information</h3>
      <p>Purchases in Packyo, such as unlocking a trip's full itinerary for the whole group or just for yourself, are made in the iOS app. They are processed by Apple through the App Store and verified by <strong>RevenueCat</strong>, which receives transaction details from Apple on our behalf. We do not see or store your payment card details.</p>
      <p>We store which trips are unlocked, by whom, and when, so we can give you and your group access to what was purchased.</p>

      <h3 style={h3}>Usage &amp; Device Information (Analytics)</h3>
      <p>In the iOS app we use <strong>Google Analytics for Firebase</strong> to understand how Packyo is used and to improve it. This includes events such as signing up, creating a trip, generating an itinerary, viewing the unlock screen, and the screens you open, together with device information (such as device model, operating system, app version, and approximate country) and an app-specific analytics identifier. Analytics data is linked to an internal account ID so we can understand how people use Packyo, but it is not used for advertising, it is not combined with data from other companies' apps, and we do not collect your device's advertising identifier (IDFA).</p>
      <p>We may also collect crash and error logs to help us fix bugs.</p>

      <h3 style={h3}>Notifications</h3>
      <p>If you allow notifications, we store a push notification token for your device, delivered through Expo and Apple Push Notification service, so we can tell you about activity in your trips (for example, when someone joins or votes). You can turn notifications off at any time in your iPhone's Settings.</p>

      <h2 style={h2}>2. How We Use Your Information</h2>
      <ul style={ul}>
        <li>To run Packyo: creating and syncing trips, voting, chat, and generating itineraries and packing lists</li>
        <li>To verify purchases and unlock content you or your group paid for</li>
        <li>To send account emails (such as confirming your email address) and trip notifications</li>
        <li>To understand usage, fix problems, and improve the app</li>
        <li>To keep Packyo secure and prevent abuse</li>
      </ul>
      <p>We do not sell your personal information, and we do not use it for third-party advertising.</p>

      <h2 style={h2}>3. Who We Share Information With</h2>
      <p>We share data only with the service providers we need to run Packyo:</p>
      <ul style={ul}>
        <li><strong>Firebase (Google)</strong>: sign-in, database, photo storage, and analytics</li>
        <li><strong>Apple</strong>: Sign in with Apple, App Store purchases, and push notifications</li>
        <li><strong>RevenueCat</strong>: verifying iOS in-app purchases</li>
        <li><strong>Anthropic</strong>: trip details (such as destination, dates, budget, and group wishes) are sent to generate AI itineraries and packing lists. This data is used only to produce your results and is not used to train AI models.</li>
        <li><strong>Resend</strong>: sending account emails, such as email confirmation</li>
        <li><strong>Expo</strong>: delivering push notifications to the app</li>
        <li><strong>Replit</strong>: hosting our website and servers</li>
      </ul>
      <p>Packyo may show links to third-party sites such as Booking.com or Expedia for stays and activities. If you open those links, the third party's own privacy policy applies to anything you do there.</p>
      <p>We may also disclose information if required by law or to protect the rights and safety of our users and Packyo.</p>

      <h2 style={h2}>4. Data Retention &amp; Deletion</h2>
      <p>We keep your account and trip data for as long as your account is active. You can delete your account at any time in the app under <strong>Profile → Settings → Delete account</strong>. When you do, we delete:</p>
      <ul style={ul}>
        <li>Your sign-in account, profile photo, saved activities and stays, and notification tokens</li>
        <li>Trips you host, along with everything in them</li>
        <li>Your membership, reviews, and unlock records in trips hosted by other people</li>
        <li>Public trip reviews you wrote</li>
      </ul>
      <p>Messages or other content you added to a trip hosted by someone else may remain visible to that trip's members. You can also ask us to delete your data by emailing <a href="mailto:support@gopack.now" style={link}>support@gopack.now</a>.</p>
      <p>Records of purchases may be kept as long as required for accounting and legal purposes. Apple and RevenueCat keep their own records of transactions under their own policies.</p>

      <h2 style={h2}>5. Your Choices</h2>
      <ul style={ul}>
        <li>Edit or delete trip content you've created directly in the app</li>
        <li>Turn notifications on or off in your iPhone's Settings</li>
        <li>Delete your account in the app, or request a copy or deletion of your data by emailing us</li>
        <li>View your App Store purchases and request refunds through Apple at reportaproblem.apple.com</li>
      </ul>

      <h2 style={h2}>6. Security</h2>
      <p>We use industry-standard services (Firebase, Apple, and our other providers) to protect your information, and we limit access to it. No method of storage or transmission is completely secure, but we work to protect your data.</p>

      <h2 style={h2}>7. Children's Privacy</h2>
      <p>Packyo is not directed at children under 13, and we do not knowingly collect personal information from children under 13. If you believe a child has given us personal information, contact us and we will delete it.</p>

      <h2 style={h2}>8. Changes to This Policy</h2>
      <p>We may update this policy as Packyo evolves. When we do, we'll update the "Last updated" date above.</p>

      <h2 style={h2}>9. Contact Us</h2>
      <div style={{ background: "#f7f7f7", borderRadius: 10, padding: "16px 20px", marginTop: 12 }}>
        <p style={{ margin: 0 }}>Questions about this policy or your data?</p>
        <p style={{ margin: "4px 0 0" }}>
          <a href="mailto:support@gopack.now" style={link}>support@gopack.now</a>
        </p>
      </div>
    </div>
  );
}
