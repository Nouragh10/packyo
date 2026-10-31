---
name: Trip screen failure diagnosis
description: Distinguish itinerary generation errors from crashes opening an already-generated trip.
---

Treat a generic trip-screen error as potentially a render failure, not proof that AI generation failed.

**Why:** Packyo opens existing itineraries on Overview. Legacy stored values can crash the new presentation even when the server successfully generated and saved the complete plan. Repeated regeneration can obscure the original evidence and consume allowance unnecessarily.

**How to apply:** Distinguish the reload/Try Again error boundary from the generation screen's Go back error. Check actual request results and persisted data types before changing the AI pipeline. For backwards-compatible type repairs, preserve the original value and never infer an ambiguous clock time or AM/PM.
