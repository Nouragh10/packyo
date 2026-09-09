---
name: Native Apple audience exchange
description: Why Packyo exchanges native Apple identity tokens through its API instead of Firebase Web Auth directly.
---

Native Sign in with Apple tokens use the signed iOS app’s bundle identifier as their audience. When Firebase Web Auth is configured with an Apple Services ID for browser OAuth, passing that native token directly to `OAuthProvider` can fail with an expected-audience mismatch.

**Why:** Packyo uses the Firebase JavaScript SDK in React Native rather than the native Firebase Auth SDK, so Firebase’s single configured Apple audience can conflict with the audience Apple places in a native TestFlight token.

**How to apply:** Keep the browser popup flow on Firebase. For native iOS, verify Apple’s JWT signature, issuer, expiration, bundle audience, and hashed nonce on the API, then return a short-lived Firebase custom token. Treat the bundle ID in the signed App Store app as authoritative.