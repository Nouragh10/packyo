# Packyo app walkthrough

Recorded from the actual Expo web-rendered mobile app using an isolated demo account. No app screens were recreated. Example accommodation amounts and expense entries are demo data, not live booking quotes.

The captioned video is silent. The companion SRT contains the same chapter explanations.

## Files

- [Watch the walkthrough](packyo-app-walkthrough.mp4)
- [Download captions](packyo-app-walkthrough.srt)

## Chapters

- **0:00:00 — Welcome to Packyo:** Actual mobile-app screens, recorded in the browser. Demonstration data is isolated from real travellers.
- **0:00:04 — Sign in to your account:** Email sign-in is available alongside Google and Apple. No real credentials are shown.
- **0:00:08 — Your trips at a glance:** Actual app screens with an isolated demo pack. Plan together, vote and manage the trip.
- **0:00:13 — Create a trip:** Choose a destination, dates, budget, pack and travel vibes.
- **0:00:18 — Join your pack:** Join an existing trip with its invitation code. No real invitations are sent in this recording.
- **0:00:23 — The trip hub:** See members and planning progress. Invite the pack and complete the checklist.
- **0:00:28 — Everyone shares preferences:** Collect vibes, travel distance, budget and pace before choosing a destination.
- **0:00:32 — Vote on destinations:** Compare destination suggestions and vote as a group.
- **0:00:37 — Discover real trip ideas:** Open a shared itinerary, see its rating, travellers and where the pack stayed.
- **0:00:42 — Save a stay:** Save accommodation from a Discover itinerary to your profile.
- **0:00:46 — Save an activity:** Activities have category labels. Save British Museum to reuse on another London trip.
- **0:00:52 — Your travel profile:** Your profile brings together trips, wishes, saved stays, activities and memories.
- **0:00:57 — Explicitly saved activities:** Only activities you choose to save belong here. Voting does not automatically save them.
- **0:01:02 — Your saved stays:** Keep stays from Discover ready to reuse when planning the same destination.
- **0:01:07 — Build the pack wishlist:** Each traveller adds wishes. Expand a member to view or add their activities.
- **0:01:11 — Reuse a saved activity:** Saved activities for this destination can become normal, votable wishes.
- **0:01:17 — Add the saved wish:** British Museum is added to the new trip's wishlist rather than being automatically copied.
- **0:01:23 — Vote on wishes:** Swipe or use the love and skip controls. Track which members have finished voting.
- **0:01:28 — Review wishlist results:** See the pack's activity preferences before building the itinerary.
- **0:01:33 — Find somewhere to stay:** Add a listing, submit stay preferences or reuse a saved stay.
- **0:01:38 — Accommodation preferences:** Collect budget, property type, rooms, location and amenities.
- **0:01:42 — Reuse a saved stay:** Open saved stays for the same destination and add one as a voting option.
- **0:01:48 — Add a stay for the pack:** A saved stay becomes a normal accommodation suggestion, not an automatic booking.
- **0:01:54 — Tied stays stay tied:** Both tied options display WINNER. Packyo only breaks the vote when the creator requests it.
- **0:01:59 — Ask Packyo to break the tie:** The creator explicitly requests a choice between the tied winners.
- **0:02:05 — One chosen stay:** After the requested tiebreak, Book this one appears for the selected stay. No booking is made.
- **0:02:09 — Live AI itinerary generation:** This chapter starts a real itinerary request for the temporary one-day London trip.
- **0:02:14 — The generated result:** The live request returns a new itinerary for this demo trip.
- **0:02:19 — Your trip overview:** Destination, dates, budget, pack members and vibes appear before the day-by-day itinerary.
- **0:02:24 — Wishes and upcoming activities:** See what is coming up and who suggested the wishes included in your plan.
- **0:02:28 — The day-by-day itinerary:** Browse scheduled activities, categories and who suggested each wish.
- **0:02:33 — Activity details:** Open an activity for its description, practical details and price status.
- **0:02:38 — Edit your itinerary:** Open an activity to change its name, time, description or manually entered price.
- **0:02:43 — Redo activity choices:** Request a replacement or a different part of an activity. Changes remain within the trip.
- **0:02:49 — Add another activity:** Use the add-activity tools to extend the plan.
- **0:02:54 — Price transparency:** Unverified prices say Price unavailable. Verify prices looks for source-backed amounts, not AI guesses.
- **0:02:59 — Live price research:** Price checks run separately from itinerary generation. Unknown amounts remain unavailable.
- **0:03:03 — Check sources before booking:** Verified entries show their source and check date; unavailable prices are excluded from totals.
- **0:03:08 — Practical trip information:** Keep trip information together alongside your itinerary.
- **0:03:13 — Map and directions:** See the day's stops and open directions in an external maps app.
- **0:03:17 — The packing checklist:** Manage essentials and clothing. Check items off as you pack.
- **0:03:22 — Shared expenses:** Track total spending, your balance, member balances and recent expenses.
- **0:03:27 — Add and split an expense:** Choose who paid, who shares the cost, and equal or custom splits.
- **0:03:31 — Settle up:** Record repayment between members. Packyo tracks the record; it does not transfer money.
- **0:03:36 — Talk with your pack:** Keep planning conversations inside the trip.
- **0:03:41 — Share and export:** Export options include PDF and calendar. Native iOS share sheets require the installed app.
- **0:03:45 — Plan together with Packyo:** Actual app pages, real interactions and isolated demo data. No real bookings, payments or invitations were made.

## Scope and limitations

- This is a feature walkthrough, not an exhaustive test of every possible state.
- Planning, votes, saves, packing and financial examples use temporary fixture records. The account and records are removed after recording.
- Native Apple/Google sign-in, notification delivery, external bookings, payments and iOS share sheets are not completed in this browser recording.
- Export, settlement and other forms may be opened to demonstrate their options without completing an external or destructive action.
- Most itinerary screens use a pre-existing demo plan. A separately labelled live-generation chapter, when present, records a real request and its result; waiting time is cut out.

## Re-recording

Requires the managed API and Expo workflows, Chromium and FFmpeg. Run from the workspace root:

1. Start headless Chromium on debugging port 9223 with a fresh temporary user-data directory.
2. Run `pnpm --filter @workspace/api-server exec tsx scripts/walkthrough-fixtures.ts` to create an isolated demo pack and sign in the recording browser.
3. Run `node scripts/walkthrough/record.mjs`.
   Optionally create an empty reuse trip with the fixture script's `--prepare-extras` flag and record `node scripts/walkthrough/record.mjs --extras` for saved-item reuse, the AI tiebreak and a live generation. A separate signed-out Chromium on port 9224 supports `node scripts/walkthrough/record-public.mjs`.
4. Run `node scripts/walkthrough/render.mjs`.
5. Always run `pnpm --filter @workspace/api-server exec tsx scripts/walkthrough-fixtures.ts --cleanup`, then stop the recording browser.

Intermediate frames and fixture IDs remain in the ignored `generated-artifacts/walkthrough/` folder. Authentication tokens are never saved by the scripts. Only the finished compressed video, captions and recording tools belong in the repository.
