---
name: Expo bundle routing
description: Keeping a path-based Expo preview able to load its JavaScript bundle in Replit.
---

For an Expo artifact served under a path-based preview route, its service must also own Metro’s absolute `/node_modules/` bundle route.

**Why:** Expo emits its development entry bundle at an absolute `/node_modules/.../entry.bundle` URL. Without a matching artifact route, the preview proxy returns 502 before JavaScript starts, leaving the native iOS Simulator loading indefinitely.

**How to apply:** Preserve the artifact’s normal preview path and add `/node_modules/` to that service’s paths using the validated artifact configuration workflow. Confirm that both web and iOS variants of the `entry.bundle` endpoint return HTTP 200 after restarting Expo.

Resolve the active native bundle URL from Expo's manifest (`launchAsset.url`) rather than guessing a short package path.

**Why:** pnpm can resolve Expo Router through a versioned virtual-store path; a guessed entry URL can return 404 even while the native bundle compiles correctly.

**How to apply:** Request the Expo manifest with the iOS platform header, then fetch its advertised launch asset when checking native compilation.