---
name: Firebase SDK consistency
description: Native analytics can introduce a second Firebase JavaScript SDK and break service registration.
---

Keep the mobile Firebase JavaScript SDK compatible with the SDK pulled in by React Native Firebase; verify actual startup after dependency installation, not just TypeScript and bundle compilation.

**Why:** Adding native analytics introduced another Firebase app SDK version. Compilation succeeded, but the browser preview crashed with “Service database is not available” because services registered against a different app registry.

**How to apply:** When updating Firebase or native analytics, inspect the resolved dependency graph for conflicting Firebase app versions, align compatible SDK releases, and check that the signed-out app starts successfully.

Also verify Firebase service imports from their own package context under pnpm's isolated layout, not only from the app's imports.

**Why:** Firebase database releases can omit runtime app-SDK dependency declarations. A previously populated or hoisted installation may hide that omission; a valid frozen lockfile and matching versions alone do not prove that a clean publishing build can resolve every service import.

**How to apply:** For Firebase installation failures, confirm the service package itself resolves the same app SDK as the application. Do not replace Firebase or enable broad hoisting to hide a narrowly identified package metadata problem.
