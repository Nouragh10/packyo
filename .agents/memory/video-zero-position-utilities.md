---
name: Video zero-position utilities
description: Prevents silently collapsed animated-video scenes when zero-position utility CSS is omitted.
---

In the Packyo video artifact, verify that the compiled stylesheet contains the zero-position utilities used by absolute scene roots. Keep explicit fallbacks when the utility build omits them.

**Why:** React rendered the full scene tree with no browser errors, but the preview remained blank because absolute roots using `inset-0` had no emitted positioning rule and therefore no dimensions.

**How to apply:** After video CSS or toolchain changes, inspect a rendered frame rather than trusting DOM presence or a successful build. If absolute scene roots collapse, confirm the compiled zero-position rules before changing animation timing or opacity.