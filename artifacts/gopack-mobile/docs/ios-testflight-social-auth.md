# Packyo iOS social sign-in release checklist

Packyo's production iOS bundle ID is `com.gopack.app` and its Expo redirect
scheme is `gopack-mobile://sign-in`. Complete every item below before
submitting a build to TestFlight.

## Google sign-in

1. Create OAuth client IDs for:
    - iOS: bundle ID `com.gopack.app`
    - Android: package `com.gopacknow.app` and the release signing SHA-1/SHA-256
    - Web: the Firebase auth domain/authorized redirect URL required by
      `gopacknow-83d54`
2. In Firebase Authentication for `gopacknow-83d54`, enable the Google
   provider and associate the correct Web client ID where Firebase requests it.
3. Keep these public client identifiers available in Packyo’s production
   configuration (they are not secrets):
    - `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
   - `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`
   - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
Packyo’s EAS production profile injects the current values into the release
build. If any client ID is rotated, update that profile before creating a new
build.

## Apple sign-in

1. In Apple Developer, enable the **Sign in with Apple** capability for
   `com.gopack.app`, then regenerate the distribution provisioning profile.
2. In Firebase Authentication for `gopacknow-83d54`, enable the Apple
   provider and enter the Apple Team ID, Key ID, private `.p8` signing key, and
   Services ID/primary App ID requested by Firebase.
3. Register the Apple/Firebase return URL shown in the Firebase provider setup.
   Keep the Apple App ID, Firebase project, and App Store Connect bundle ID
   aligned with `com.gopack.app`.
4. Confirm the release build contains the Sign in with Apple entitlement.

## EAS and TestFlight verification

1. Create a fresh iOS production build with the EAS `production` profile.
   Do not reuse a build made before the OAuth variables or Apple entitlement
   were configured.
2. Upload it to App Store Connect and install it through TestFlight on a real
   iPhone or iPad.
3. Verify each path:
    - On iOS, Google sign-in returns through the registered reversed-client-ID
      scheme and creates/signs in to the Firebase user.
    - On web and Android, Google sign-in returns to Packyo and creates/signs in to the Firebase user.
   - Apple sign-in returns to Packyo and creates/signs in to the Firebase user.
   - A second Apple sign-in works after Apple only shares name/email on the
     first authorization.
   - Cancelling either provider leaves the user on the sign-in screen.
   - Relaunching Packyo preserves the Firebase session.

The app hashes a fresh Apple nonce for each request and passes the raw nonce to
Firebase, as required for Firebase's Apple token verification.