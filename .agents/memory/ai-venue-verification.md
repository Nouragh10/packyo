---
name: AI venue verification needs live web search
description: Live venue verification and the user's decision to keep the original activity cost estimator.
---

Asking an LLM to "double check" or "prefer well-known venues" in a prompt does not fix closed-venue or wrong-city hallucinations, no matter how strongly worded. The model has no way to know a venue's real current status — it can only guess from static training data, which is exactly what caused the bug in the first place.

**Why:** Two rounds of prompt-only tweaks (stronger wording, then adding city context to the dedupe pass) failed to fix recurring closed-venue and wrong-location complaints in GoPackNow's itinerary generator, because the underlying problem — no access to real-time information — was never addressed.

**How to apply:** When a task requires current/real-world factual verification (open/closed status, current pricing, live availability, etc.), give the model an actual tool to check reality rather than refining instructions. For Anthropic models called directly with an API key (not through a proxy), this means enabling the native `web_search_20250305` server tool (requires the `anthropic-beta: web-search-2025-03-05` header) and instructing the model to search per-item before answering, then parse only the final `text` content block from the response (search-tool response blocks are interleaved and must be filtered out). This adds real latency (tens of seconds per verification pass) — factor that into UX expectations for any feature built this way.

## Activity pricing policy

Keep the original activity cost estimator. Do not add the verified-totals section, a Verify prices button, or automatic source-backed price checks.

**Why:** The user explicitly reversed the earlier source-backed pricing choice and repeated that they want the original estimator, without the “No verified totals yet” and “Verify prices” section shown in the walkthrough.

**How to apply:** Keep per-person activity estimates from the itinerary generator, editable estimates, and estimated totals. Venue existence/location checks remain separate and should still use live evidence. Do not reintroduce price verification unless the user asks.
