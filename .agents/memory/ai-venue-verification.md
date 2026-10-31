---
name: AI venue verification needs live web search
description: Live-source verification for venue facts and the user's source-backed activity pricing policy.
---

Asking an LLM to "double check" or "prefer well-known venues" in a prompt does not fix closed-venue or wrong-city hallucinations, no matter how strongly worded. The model has no way to know a venue's real current status — it can only guess from static training data, which is exactly what caused the bug in the first place.

**Why:** Two rounds of prompt-only tweaks (stronger wording, then adding city context to the dedupe pass) failed to fix recurring closed-venue and wrong-location complaints in GoPackNow's itinerary generator, because the underlying problem — no access to real-time information — was never addressed.

**How to apply:** When a task requires current/real-world factual verification (open/closed status, current pricing, live availability, etc.), give the model an actual tool to check reality rather than refining instructions. For Anthropic models called directly with an API key (not through a proxy), this means enabling the native `web_search_20250305` server tool (requires the `anthropic-beta: web-search-2025-03-05` header) and instructing the model to search per-item before answering, then parse only the final `text` content block from the response (search-tool response blocks are interleaved and must be filtered out). This adds real latency (tens of seconds per verification pass) — factor that into UX expectations for any feature built this way.

## Activity pricing policy

Use source-backed activity prices, not model guesses, generic dollar ranges, or admission prices adjusted by the group's budget tier. An unverifiable price must remain unavailable, not become a zero/free activity. A source-listed price is not a guaranteed booking quote or a recorded shared expense.

**Why:** The user reported incorrect activity estimates and explicitly chose “Verify prices with sources.”

**How to apply:** Preserve currency, source evidence and check date across saved activities, Discover snapshots and exports. Keep live pricing research separate from initial itinerary generation so a slow or rate-limited lookup cannot prevent opening a trip. Do not replace missing proof with model knowledge.
