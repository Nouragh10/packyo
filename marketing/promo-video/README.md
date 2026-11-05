# Packyo promo video (9:16)

`packyo-promo-9x16.mp4` is a 25.5s vertical promo for TikTok, Reels and Shorts: 1080x1920, 30fps, about -14 LUFS.
It's cut from the two app recordings in the repo root.

| Time | Beat | Caption |
|------|------|---------|
| 0.0–2.5 | Lisbon trip page (hook) | Group trips, minus the chaos. |
| 2.5–5.5 | Create a trip | Step 01 · Start a trip |
| 5.5–8.5 | Pack wishlists | Step 02 · Everyone adds wishes |
| 8.5–12.5 | Swipe to vote, then results | Step 03 · Swipe to vote |
| 12.5–17.0 | Building, then itinerary | Step 04 · Get your itinerary |
| 17.0–22.0 | Packing, chat, memories | Packing, chat & trip memories |
| 21.6–25.5 | End card | packyo · Wish · Vote · Go |

## Rebuild

Requires Node with Playwright, ffmpeg and bc.

```bash
node graphics.mjs   # renders captions/background/end card to build/
./build.sh          # cuts footage and composites the final mp4
```

To change the edit, edit `CUTS` and `CAPS` in `build.sh`. To change the copy, edit `CAPTIONS` in `graphics.mjs`.
