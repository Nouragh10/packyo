---
name: React Native Firebase uploads
description: Reliable Firebase Storage uploads from Packyo’s Expo iOS app.
---

Firebase Storage’s web-oriented string and byte upload helpers may internally construct a Blob from an `ArrayBuffer`, which React Native does not support reliably.

**Why:** Profile-photo uploads failed on iOS before reaching Storage with “creating blobs from ArrayBuffer and ArrayBufferView are not supported.”

**How to apply:** On native Expo, upload the selected local file URI with Expo FileSystem’s binary upload to Firebase Storage REST using the current Firebase ID token. Web may continue using the Firebase Storage upload helper.