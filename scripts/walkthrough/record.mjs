// Records the running app, not reconstructed screens. Requires isolated fixtures.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectBrowser, pause } from "./cdp.mjs";

const out = resolve("generated-artifacts/walkthrough");
mkdirSync(`${out}/frames`, { recursive: true });
const fixture = JSON.parse(readFileSync(`${out}/fixtures.json`, "utf8"));
const browser = await connectBrowser();
const base = `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`;
const extras = process.argv.includes("--extras");
const previous = extras ? JSON.parse(readFileSync(`${out}/recording.json`, "utf8")) : null;
let recording = false, finished = false, index = previous ? Math.max(...previous.frames.map(f => Number(f.file.split("/").at(-1).split(".")[0]))) + 1 : 0;
const failed = previous?.issues.map(issue => previous.chapters.findIndex(chapter => chapter.title === issue.title)) ?? [];
const frames = previous?.frames.filter(frame => !failed.includes(frame.chapter)) ?? [];
const chapters = previous?.chapters ?? [];
const issues = [];
const pump = (async () => {
  while (!finished) {
    if (!recording) { await pause(100); continue; }
    const started = performance.now();
    const file = `${out}/frames/${String(index++).padStart(6, "0")}.jpg`;
    try {
      await browser.screenshot(file);
      frames.push({ file, chapter: chapters.length - 1, duration: Math.max(0.25, (performance.now() - started) / 1000) });
    } catch { /* Navigation can invalidate an in-flight frame; the next frame continues. */ }
    await pause(Math.max(0, 250 - (performance.now() - started)));
  }
})();
const view = async (route) => {
  recording = false;
  await browser.go(base + route);
  await pause(2300);
  if ((await browser.text()).includes("Save this group as a Pack?")) await browser.click("Not now");
};
const shot = async (title, caption, action) => {
  chapters.push({ title, caption });
  console.log(`Recording: ${title}`);
  recording = true;
  await pause(2200);
  try { if (action) await action(); }
  catch (error) { issues.push({ title, issue: error.message }); console.log(`Capture note: ${error.message}`); }
  await pause(2400);
  recording = false;
  writeFileSync(`${out}/recording.json`, JSON.stringify({ frames, chapters, issues }, null, 2));
};
const aria = async (label) => {
  const point = await browser.evaluate(`(() => { const e=[...document.querySelectorAll('[aria-label]')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)}); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if (!point) throw new Error(`Missing action ${label}`);
  await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
};
const fill = async (placeholder, text) => {
  const found = await browser.evaluate(`(() => {const e=[...document.querySelectorAll('input,textarea')].find(e=>e.placeholder===${JSON.stringify(placeholder)});if(!e)return false;e.focus();return true})()`);
  if (!found) throw new Error(`Missing input ${placeholder}`);
  await browser.send("Input.insertText", { text });
};
try {
  if (extras) {
    await view(`/wishlist/${fixture.reuseId}`);
    await shot("Reuse a saved activity", "Saved activities for this destination can become normal, votable wishes.", async () => {
      await browser.click("Add a wish from activities", false);
      await pause(1300);
    });
    await shot("Add the saved wish", "British Museum is added to the new trip's wishlist rather than being automatically copied.", async () => {
      await browser.click("British Museum");
      await pause(1300);
    });
    await view(`/accommodation-preferences/${fixture.reuseId}`);
    await shot("Reuse a saved stay", "Open saved stays for the same destination and add one as a voting option.", async () => {
      await browser.click("Add from saved stays", false);
      await pause(900);
    });
    await shot("Add a stay for the pack", "A saved stay becomes a normal accommodation suggestion, not an automatic booking.", async () => {
      await browser.click("The Resident Covent Garden");
      await pause(1100);
    });
    await view(`/accommodation-vote/${fixture.planningId}`);
    await shot("Ask Packyo to break the tie", "The creator explicitly requests a choice between the tied winners.", async () => {
      await browser.click("Let Packyo break the vote", false);
      await pause(1000);
    });
    recording = false;
    for (let i = 0; i < 45; i++) {
      if ((await browser.text()).includes("Book this one")) break;
      await pause(1800);
    }
    if ((await browser.text()).includes("Book this one")) {
      await shot("One chosen stay", "After the requested tiebreak, Book this one appears for the selected stay. No booking is made.");
    } else issues.push({ title: "Tie decision", issue: "The live AI choice did not finish during this recording window." });

    await view(`/itinerary/${fixture.tripId}`);
    await browser.click("Itinerary");
    await shot("Edit your itinerary", "Open an activity to change its name, time, description or manually entered price.", async () => {
      await browser.click("Edit");
      await pause(900);
    });
    await view(`/itinerary/${fixture.tripId}`);
    await browser.click("Itinerary");
    await shot("Redo activity choices", "Request a replacement or a different part of an activity. Changes remain within the trip.", async () => {
      await browser.click("Redo");
      await pause(800);
    });
    await view(`/itinerary/${fixture.tripId}`);
    await browser.click("Itinerary");
    await shot("Add another activity", "Use the add-activity tools to extend the plan.", async () => {
      await browser.click("Add activity");
      await pause(800);
    });
    await view(`/building/${fixture.reuseId}`);
    await shot("Live AI itinerary generation", "This chapter starts a real itinerary request for the temporary one-day London trip.");
    recording = false;
    let generated = false;
    for (let i = 0; i < 90; i++) {
      const text = await browser.text();
      if (text.includes("Who suggested what") || (text.includes("Overview") && text.includes("Itinerary") && text.includes("The pack"))) { generated = true; break; }
      if (text.includes("Go back")) { issues.push({ title: "Live generation", issue: text.replace(/\s+/g, " ").slice(0, 220) }); break; }
      await pause(1800);
    }
    if (generated) {
      if ((await browser.text()).includes("Save this group as a Pack?")) await browser.click("Not now");
      await shot("The generated result", "The live request returns a new itinerary for this demo trip.");
      await browser.click("Itinerary");
      await shot("Live price research", "Price checks run separately from itinerary generation. Unknown amounts remain unavailable.");
      recording = false;
      await pause(25000);
      await shot("Check sources before booking", "Verified entries show their source and check date; unavailable prices are excluded from totals.", async () => { await browser.scroll(390); });
    } else if (!issues.some(i => i.title === "Live generation")) {
      issues.push({ title: "Live generation", issue: "The live request did not finish during the recording window." });
    }
    await view("/");
    await shot("Plan together with Packyo", "Actual app pages, real interactions and isolated demo data. No real bookings, payments or invitations were made.");
  } else {
  await view("/");
  await shot("Your trips at a glance", "Actual app screens with an isolated demo pack. Plan together, vote and manage the trip.", async () => { await browser.scroll(220); await pause(800); });

  await view("/create");
  await shot("Create a trip", "Choose a destination, dates, budget, pack and travel vibes.", async () => {
    await fill("Search destinations or anywhere", "London");
    await browser.click("Culture");
    await browser.click("Foodie");
    await browser.scroll(240);
  });
  await view("/join");
  await shot("Join your pack", "Join an existing trip with its invitation code. No real invitations are sent in this recording.");

  await view(`/trip/${fixture.planningId}`);
  await shot("The trip hub", "See members and planning progress. Invite the pack and complete the checklist.", async () => { await browser.scroll(430); });
  await view(`/destination-preferences/${fixture.planningId}`);
  await shot("Everyone shares preferences", "Collect vibes, travel distance, budget and pace before choosing a destination.", async () => { await browser.scroll(470); });
  await view(`/destination-vote/${fixture.planningId}`);
  await shot("Vote on destinations", "Compare destination suggestions and vote as a group.", async () => { await browser.scroll(400); });

  await view(`/discover-itinerary/${fixture.reviewId}`);
  await shot("Discover real trip ideas", "Open a shared itinerary, see its rating, travellers and where the pack stayed.");
  await shot("Save a stay", "Save accommodation from a Discover itinerary to your profile.", async () => { await aria("Save The Resident Covent Garden to your stays"); });
  await shot("Save an activity", "Activities have category labels. Save British Museum to reuse on another London trip.", async () => { await aria("Save British Museum"); await pause(1200); });
  await view("/profile");
  await shot("Your travel profile", "Your profile brings together trips, wishes, saved stays, activities and memories.", async () => { await browser.scroll(480); });
  await view("/saved?section=activities");
  await shot("Explicitly saved activities", "Only activities you choose to save belong here. Voting does not automatically save them.");
  await view("/saved?section=stays");
  await shot("Your saved stays", "Keep stays from Discover ready to reuse when planning the same destination.");

  await view(`/wishlist/${fixture.planningId}`);
  await shot("Build the pack wishlist", "Each traveller adds wishes. Expand a member to view or add their activities.", async () => { await browser.click("You (Alex Demo)", false); });
  await shot("Reuse a saved activity", "Add a wish from activities filters your saved ideas to the trip destination.", async () => { await browser.click("Add a wish from activities", false); });
  await view(`/wishlist-vote/${fixture.planningId}`);
  await shot("Vote on wishes", "Swipe or use the love and skip controls. Track which members have finished voting.", async () => { await browser.click("By member"); });
  await view(`/wishlist-results/${fixture.planningId}`);
  await shot("Review wishlist results", "See the pack's activity preferences before building the itinerary.", async () => { await browser.scroll(380); });

  await view(`/accommodation/${fixture.planningId}`);
  await shot("Find somewhere to stay", "Add a listing, submit stay preferences or reuse a saved stay.", async () => { await browser.scroll(360); });
  await shot("Reuse a saved stay", "Saved London stays can become accommodation options and receive normal pack votes.", async () => { await browser.click("Add from saved stays", false); });
  await view(`/accommodation-preferences/${fixture.planningId}`);
  await shot("Accommodation preferences", "Collect budget, property type, rooms, location and amenities.", async () => { await browser.scroll(440); });
  await view(`/accommodation-vote/${fixture.planningId}`);
  await shot("Tied stays stay tied", "Both tied options display WINNER. Packyo only breaks the vote when the creator requests it.", async () => { await browser.scroll(460); await pause(800); await browser.scroll(-600); });

  await view(`/itinerary/${fixture.tripId}`);
  await shot("Your trip overview", "Destination, dates, budget, pack members and vibes appear before the day-by-day itinerary.");
  await shot("Wishes and upcoming activities", "See what is coming up and who suggested the wishes included in your plan.", async () => { await browser.scroll(470); });
  await browser.click("Itinerary");
  await shot("The day-by-day itinerary", "Browse scheduled activities, categories and who suggested each wish.", async () => { await browser.scroll(350); });
  await shot("Price transparency", "Unverified prices say Price unavailable. Verify prices looks for source-backed amounts, not AI guesses.", async () => { await browser.scroll(-420); });
  await shot("Activity details", "Open an activity for its description, practical details and price status.", async () => { await browser.click("British Museum"); });

  await view(`/itinerary/${fixture.tripId}`);
  await browser.click("Info");
  await shot("Practical trip information", "Keep trip information together alongside your itinerary.", async () => { await browser.scroll(310); });
  await browser.click("Map");
  await shot("Map and directions", "See the day's stops and open directions in an external maps app.", async () => { await browser.scroll(240); });
  await browser.click("Packing");
  await shot("The packing checklist", "Manage essentials and clothing. Check items off as you pack.", async () => {
    const text = await browser.text();
    if (text.includes("Phone charger")) await browser.click("Phone charger");
  });
  await browser.click("Expenses");
  await pause(1100);
  await shot("Shared expenses", "Track total spending, your balance, member balances and recent expenses.", async () => { await browser.scroll(180); });
  await browser.click("Add expense", false);
  await shot("Add and split an expense", "Choose who paid, who shares the cost, and equal or custom splits.", async () => { await browser.scroll(460); });
  await view(`/itinerary/${fixture.tripId}`);
  await browser.click("Expenses");
  await pause(1000);
  await browser.click("Settle up", false);
  await shot("Settle up", "Record repayment between members. Packyo tracks the record; it does not transfer money.");

  await view(`/chat/${fixture.tripId}`);
  await shot("Talk with your pack", "Keep planning conversations inside the trip.");
  await view(`/itinerary/${fixture.tripId}`);
  await browser.click("Export");
  await shot("Share and export", "Export options include PDF and calendar. Native iOS share sheets require the installed app.");
  await view(`/review/${fixture.pastId}`);
  await shot("Review the trip", "Rate the experience and share highlights after travelling.", async () => { await browser.scroll(390); });
  await view(`/memory/${fixture.pastId}`);
  await shot("Keep the memories", "Revisit the trip and its memories after it ends.", async () => { await browser.scroll(310); });
  await view("/notifications");
  await shot("Trip alerts", "Voting, itinerary and chat updates appear in Alerts. Native push delivery is not demonstrated here.");
  await view("/settings");
  await shot("Account and preferences", "Manage profile and app settings. Destructive account actions are not performed.", async () => { await browser.scroll(350); });
  await view("/");
  await shot("Plan the next trip", "Discover, save, plan, vote, travel and share. Demo data is removed after recording.");
  }
} finally {
  recording = false;
  finished = true;
  await pump;
  browser.close();
  writeFileSync(`${out}/recording.json`, JSON.stringify({ frames, chapters, issues }, null, 2));
  console.log(`Saved ${frames.length} frames across ${chapters.length} chapters. ${issues.length} capture notes.`);
}
