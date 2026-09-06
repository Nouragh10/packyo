import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { GenerateItineraryBody, GeneratePackingListBody } from "@workspace/api-zod";
import { getAdminDb, getAdminApp } from "../lib/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import {
  InviteCodeReservationError,
  reserveHostInviteCode,
} from "../lib/invite-code";
import {
  extractAndParseJson,
  AccommodationResponseError,
  ItineraryResponseError,
  isItineraryShape,
  parseAccommodationSuggestionsResponse,
  parseItineraryResponse,
  type ItineraryShape,
} from "../lib/itinerary-parser";
import {
  firebaseListEntries,
  normalizeActivityList,
  resolveFirebaseActivityIndex,
  resolveUniqueFirebaseActivitySlotIndex,
  resolveFirebaseDayEntry,
} from "../lib/firebase-lists";

const router: IRouter = Router();
const joinAttemptWindows = new Map<string, { count: number; resetAt: number }>();
const mapActivityWindows = new Map<string, { count: number; resetAt: number }>();

function allowJoinAttempt(uid: string): boolean {
  const now = Date.now();
  const current = joinAttemptWindows.get(uid);
  if (!current || current.resetAt <= now) {
    joinAttemptWindows.set(uid, { count: 1, resetAt: now + 10 * 60_000 });
    return true;
  }
  current.count += 1;
  return current.count <= 10;
}

function allowMapActivityImport(uid: string): boolean {
  const now = Date.now();
  const current = mapActivityWindows.get(uid);
  if (!current || current.resetAt <= now) {
    mapActivityWindows.set(uid, { count: 1, resetAt: now + 10 * 60_000 });
    return true;
  }
  if (current.count >= 10) return false;
  current.count += 1;
  return true;
}

function activityTimeToMinutes(value: unknown): number {
  const match = String(value ?? "").match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return 0;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (match[3].toUpperCase() === "PM" && hours !== 12) hours += 12;
  if (match[3].toUpperCase() === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function activityTimeGuidance(value: unknown): string {
  const minutes = activityTimeToMinutes(value);
  if (minutes < 11 * 60) {
    return "This is a morning slot: choose breakfast, coffee, a market, a walk, or an attraction that is confirmed open in the morning. Do not choose nightlife, dinner, or a venue that opens later.";
  }
  if (minutes < 14 * 60) {
    return "This is a midday slot: choose lunch, a market, a museum, a tour, or another venue confirmed open around midday.";
  }
  if (minutes < 18 * 60) {
    return "This is an afternoon slot: choose an attraction, tour, shopping, relaxation, or another venue confirmed open in the afternoon.";
  }
  if (minutes < 22 * 60) {
    return "This is an evening slot: choose dinner, a show, a sunset activity, or an evening venue confirmed open at this time.";
  }
  return "This is a late-night slot: choose nightlife, a late venue, or another activity explicitly confirmed open this late. Do not choose daytime-only attractions.";
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function callAnthropic(body: object, retries = 3, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const baseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error("AI itinerary generation is not configured. Please try again shortly.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    ...extraHeaders,
  };

  for (let i = 0; i < retries; i++) {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (response.status !== 429) return response as unknown as Response;
    const wait = (i + 1) * 8000;
    console.log(`gopack: rate limited, retrying in ${wait}ms`);
    await sleep(wait);
  }
  throw new Error("Rate limit exceeded after retries. Please try again in a minute.");
}

async function verifyItineraryVenues(
  itinerary: ItineraryShape,
  destination: string,
  log: { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void },
): Promise<ItineraryShape> {
  const venueNames = itinerary.days.flatMap((d) => d.activities.map((a) => a.name)).filter(Boolean);
  if (venueNames.length === 0) return itinerary;

  const activityList = itinerary.days.flatMap((d) =>
    d.activities.map((a) => `- "${a.name}" — Day ${String((d as Record<string, unknown>).dayNumber)}, declared city "${String((d as Record<string, unknown>).city)}", tag "${a.tag}"`),
  ).join("\n");

  const verifyPrompt = `You are a fact-checker reviewing a travel itinerary for ${destination}. You have access to a web_search tool — USE IT to check real, current information. Do not rely only on your training data, since venues open and close over time and your knowledge may be outdated.

Here is the full list of activities in this itinerary:
${activityList}

For EVERY activity listed above, perform these checks:
1. SEARCH THE WEB for each venue (especially anything tagged "food" or restaurant/cafe/bar-like — these close far more often than museums or landmarks) to confirm:
   - It is a REAL, specific, existing place in ${destination} (not invented or generic).
   - It is CURRENTLY OPEN AND OPERATING — not permanently closed, demolished, or out of business. Search things like "<venue name> <city> permanently closed" or "<venue name> <city> hours" to check.
   - It is physically located in the exact declared city for that day, not a different city/suburb/region.
2. Also flag (no search needed) if:
   - It is a duplicate of another activity's venue elsewhere in the itinerary.
   - It is far enough from the other activities that same day (different neighborhood, suburb, or a long drive) that it breaks a realistic, walkable-or-short-transit day plan.

For every flagged activity (failed a check above, or you found evidence it's closed, or you could not verify it exists), REPLACE it with a different, well-known, currently-operating real venue that IS located in the day's declared city and close to the day's other activities, and fits the same "tag" and time slot. Prefer iconic, long-established, famous places you can verify via search over obscure ones.

Do NOT change anything about activities that already pass all checks — keep them byte-for-byte identical.

After you finish researching, respond with ONLY the corrected, complete itinerary JSON in the exact same shape as the input below (no markdown, no explanation, no preamble in your FINAL message — your final message must start directly with {).

Itinerary JSON:
${JSON.stringify(itinerary)}`;

  try {
    const body = {
      model: "claude-sonnet-4-5",
      max_tokens: 8192,
      system: "You are a fact-checking JSON API with web search access. Investigate using web search first, then your FINAL response must be only valid JSON matching the input shape — no preamble, no explanation, no markdown code blocks, starting directly with {.",
      messages: [{ role: "user", content: verifyPrompt }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 25 }],
    };
    const response = await callAnthropic(body, 3, { "anthropic-beta": "web-search-2025-03-05" });
    const data = await (response as unknown as globalThis.Response).json() as {
      content?: Array<{ type: string; text?: string }>;
      error?: { message: string };
      stop_reason?: string;
    };
    if (!(response as unknown as globalThis.Response).ok) {
      log.warn({ data }, "Venue verification pass failed, keeping original itinerary");
      return itinerary;
    }
    const textBlocks = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "");
    const allText = textBlocks[textBlocks.length - 1] ?? "";
    if (data.stop_reason === "max_tokens") {
      log.warn({ chars: allText.length }, "Venue verification response truncated, keeping original itinerary");
      return itinerary;
    }
    const verified = extractAndParseJson(allText);
    if (!isItineraryShape(verified)) {
      log.warn({}, "Venue verification returned malformed shape, keeping original itinerary");
      return itinerary;
    }
    return verified;
  } catch (err) {
    log.error({ err }, "Venue verification pass threw, keeping original itinerary");
    return itinerary;
  }
}

function findDuplicateSlots(itinerary: ItineraryShape): Array<{ dayNumber: unknown; time: unknown; name: string; tag: string; city: unknown; otherActivityNames: string[] }> {
  const seen = new Set<string>();
  const dupes: Array<{ dayNumber: unknown; time: unknown; name: string; tag: string; city: unknown; otherActivityNames: string[] }> = [];
  for (const day of itinerary.days) {
    for (const activity of day.activities) {
      const key = (activity.name ?? "").toString().trim().toLowerCase();
      if (!key) continue;
      // Guaranteed wishes are an explicit group decision. Do not replace one
      // merely because two members asked for the same venue; a later AI pick
      // with that name can still be repaired.
      if (activity.fromWish === true) {
        seen.add(key);
        continue;
      }
      if (seen.has(key)) {
        dupes.push({
          dayNumber: (day as Record<string, unknown>).dayNumber,
          time: activity.time,
          name: activity.name,
          tag: activity.tag,
          city: (day as Record<string, unknown>).city,
          otherActivityNames: day.activities.map((a) => (a.name ?? "").toString()).filter((n) => n && n.trim().toLowerCase() !== key),
        });
      } else {
        seen.add(key);
      }
    }
  }
  return dupes;
}

async function dedupeItineraryVenues(
  itinerary: ItineraryShape,
  destination: string,
  log: { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void },
): Promise<ItineraryShape> {
  const dupes = findDuplicateSlots(itinerary);
  if (dupes.length === 0) return itinerary;

  const usedNames = [...new Set(itinerary.days.flatMap((d) => d.activities.map((a) => (a.name ?? "").toString())))];

  const repairPrompt = `This travel itinerary for ${destination} has duplicate venues — the same venue name was used more than once across different days. Below are the SPECIFIC duplicate slots that need a brand-new replacement venue (identified by day number + time + current name + that day's declared city + the day's other activities for location context):

${dupes.map((d) => `- Day ${String(d.dayNumber)}, ${String(d.time)}: "${d.name}" (tag: ${d.tag}). This day's city is "${String(d.city)}". Other activities that same day (the replacement must be in the same neighborhood/area as these): ${d.otherActivityNames.length > 0 ? d.otherActivityNames.map((n) => `"${n}"`).join(", ") : "(none)"}`).join("\n")}

All venue names already used anywhere in this itinerary (do NOT reuse any of these for the replacements):
${usedNames.map((n) => `- ${n}`).join("\n")}

For each duplicate slot listed above, pick ONE new, different venue that fits the same tag. The replacement MUST meet ALL of these:
- LOCATION LOCK — physically located in the exact city named for that slot (not just somewhere in ${destination} broadly — ${destination} may span multiple cities/towns/regions). Never place it in a different city, suburb, or region than the one declared for that day.
- SAME-AREA — close to that day's other listed activities (same neighborhood/district, or at most a short taxi/metro ride) so the day stays geographically realistic. Do not pick something requiring a long drive or a trip out of the metro area from the other activities.
- REAL and verifiable — a specific, well-known place you are highly confident actually exists (findable on Google Maps). Never invent a name.
- CURRENTLY OPEN AND OPERATING as of 2025 — do NOT pick anything permanently closed, demolished, under indefinite closure, or out of business.
- If the tag is "food" or "restaurant"-like, strongly prefer iconic, long-established, well-known institutions (10+ years operating) over trendy, small, or recently-opened spots — small restaurants close far more often and you are less likely to have reliable knowledge of their current status.
- If you are not certain a specific venue exists, is open, and is in the right city, use a well-known category anchor instead (e.g. a famous, long-running market or landmark in that exact city) rather than a specific small business you're unsure about.

Respond with ONLY a JSON array, one object per duplicate slot IN THE SAME ORDER as listed above, each with just: {"dayNumber": <number>, "time": "<same time>", "name": "<new venue name>"}. No markdown, no explanation.`;

  try {
    const body = {
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      system: "You are a JSON API. Always respond with only a valid JSON array. No preamble, no explanation, no markdown code blocks.",
      messages: [{ role: "user", content: repairPrompt }],
    };
    const response = await callAnthropic(body);
    const data = await (response as unknown as globalThis.Response).json() as {
      content?: Array<{ type: string; text?: string }>;
      error?: { message: string };
    };
    if (!(response as unknown as globalThis.Response).ok) {
      log.warn({ data }, "Dedup repair pass failed, keeping itinerary with duplicates");
      return itinerary;
    }
    const allText = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const replacements = extractAndParseJson(allText) as Array<{ dayNumber: unknown; time: unknown; name: string }>;
    if (!Array.isArray(replacements)) {
      log.warn({}, "Dedup repair returned non-array, keeping itinerary with duplicates");
      return itinerary;
    }

    const replacementQueue = [...replacements];
    for (const day of itinerary.days) {
      for (const activity of day.activities) {
        const key = (activity.name ?? "").toString().trim().toLowerCase();
        const dupeIndex = dupes.findIndex(
          (d) => d.dayNumber === (day as Record<string, unknown>).dayNumber && d.time === activity.time && d.name.toString().trim().toLowerCase() === key,
        );
        if (dupeIndex !== -1) {
          const replacement = replacementQueue.shift();
          if (replacement?.name) {
            activity.name = replacement.name;
          }
        }
      }
    }
    return itinerary;
  } catch (err) {
    log.error({ err }, "Dedup repair pass threw, keeping itinerary with duplicates");
    return itinerary;
  }
}

type GenerationFeature = "itinerary" | "packing" | "redo-activity" | "suggest-destinations" | "map-activity";

async function checkAndIncrementGenerationCount(
  _userId: string,
  _feature: GenerationFeature,
  _isPlusUser: boolean,
  _res: Response,
): Promise<boolean> {
  return true;
}

type RedoActivity = {
  time: string;
  name: string;
  description: string;
  tag: string;
  fromWish: false;
  suggester: "AI pick";
  estimatedCost: number;
  labels: string[];
  nearPrevious: boolean;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const GOOGLE_MAPS_HOSTS = new Set([
  "google.com",
  "www.google.com",
  "maps.google.com",
  "maps.app.goo.gl",
  "goo.gl",
]);

function parseGoogleMapsUrl(value: string): URL {
  let url: URL;
  try {
    const pastedUrl = value.match(/https:\/\/[^\s<>"']+/i)?.[0] ?? value.trim();
    url = new URL(pastedUrl.replace(/[),.;]+$/, ""));
  } catch {
    throw new Error("Paste a valid Google Maps link.");
  }
  const host = url.hostname.toLowerCase();
  const isGoogleHost = GOOGLE_MAPS_HOSTS.has(host) || host.endsWith(".google.com");
  const isMapsPath = host === "maps.app.goo.gl" || host === "maps.google.com" || url.pathname.includes("/maps");
  if (url.protocol !== "https:" || !isGoogleHost || !isMapsPath) {
    throw new Error("Only Google Maps place links are supported.");
  }
  return url;
}

function googleMapsDetails(urlValue: string, pageTitle: string): {
  placeName: string;
  lat?: number;
  lng?: number;
} {
  const url = new URL(urlValue);
  const placePath = url.pathname.match(/\/maps\/place\/([^/]+)/i)?.[1];
  const queryPlace = url.searchParams.get("query")
    ?? url.searchParams.get("q")
    ?? url.searchParams.get("destination");
  const decodedCandidate = decodeURIComponent(placePath ?? queryPlace ?? "")
    .replace(/\+/g, " ")
    .trim();
  const coordinateOnly = /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(decodedCandidate);
  const placeName = pageTitle.trim() || (coordinateOnly ? "" : decodedCandidate);
  const atCoordinates = url.href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const dataCoordinates = url.href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const lat = Number(atCoordinates?.[1] ?? dataCoordinates?.[1]);
  const lng = Number(atCoordinates?.[2] ?? dataCoordinates?.[2]);
  return {
    placeName,
    ...(Number.isFinite(lat) ? { lat } : {}),
    ...(Number.isFinite(lng) ? { lng } : {}),
  };
}

async function resolveGoogleMapsLink(link: string): Promise<{ finalUrl: string; pageTitle: string }> {
  let current = parseGoogleMapsUrl(link);
  for (let redirectCount = 0; redirectCount < 5; redirectCount += 1) {
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 Packyo/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break;
      current = parseGoogleMapsUrl(new URL(location, current).toString());
      continue;
    }
    const html = response.ok ? await response.text() : "";
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return {
      finalUrl: current.toString(),
      pageTitle: titleMatch?.[1]?.replace(/\s*-\s*Google Maps\s*$/i, "").trim() ?? "",
    };
  }
  return { finalUrl: current.toString(), pageTitle: "" };
}

function findRedoActivity(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 5) return null;

  if (isObject(value)) {
    if (typeof value.name === "string" && value.name.trim().length > 0) return value;
    if ("activity" in value) {
      const nestedActivity = findRedoActivity(value.activity, depth + 1);
      if (nestedActivity) return nestedActivity;
    }
    for (const nestedValue of Object.values(value)) {
      const nestedActivity = findRedoActivity(nestedValue, depth + 1);
      if (nestedActivity) return nestedActivity;
    }
    return null;
  }

  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const nestedActivity = findRedoActivity(value[index], depth + 1);
      if (nestedActivity) return nestedActivity;
    }
  }

  return null;
}

function normalizeRedoActivity(
  value: unknown,
  fallback: { time: string; tag: string },
): RedoActivity {
  const activity = findRedoActivity(value);
  if (!activity) {
    throw new ItineraryResponseError("The AI did not return a complete replacement activity.");
  }

  const name = typeof activity.name === "string" ? activity.name.trim() : "";
  if (!name) {
    throw new ItineraryResponseError("The AI did not return a replacement activity name.");
  }

  const description = typeof activity.description === "string" && activity.description.trim()
    ? activity.description.trim()
    : "A Packyo AI recommendation for this time slot.";
  const tag = typeof activity.tag === "string" && activity.tag.trim()
    ? activity.tag.trim()
    : fallback.tag;
  const rawCost = typeof activity.estimatedCost === "number"
    ? activity.estimatedCost
    : Number(activity.estimatedCost);

  return {
    time: fallback.time,
    name,
    description,
    tag,
    fromWish: false,
    suggester: "AI pick",
    estimatedCost: Number.isFinite(rawCost) && rawCost >= 0 ? rawCost : 0,
    labels: Array.isArray(activity.labels)
      ? activity.labels.filter((label): label is string => typeof label === "string")
      : [],
    nearPrevious: activity.nearPrevious === true,
  };
}

router.post("/itinerary", async (req: Request, res: Response): Promise<void> => {
  const parsed = GenerateItineraryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req.body as { userId?: string }).userId;
  const isPlusUser = (req.body as { isPlusUser?: boolean }).isPlusUser === true;
  if (userId) {
    const allowed = await checkAndIncrementGenerationCount(userId, "itinerary", isPlusUser, res);
    if (!allowed) return;
  }

  const { destination, days, vibes, budget, startDate } = parsed.data;
  const pace = (req.body as { pace?: string }).pace ?? "balanced";
  const activitiesPerDay = pace === "relaxed" ? 3 : pace === "packed" ? 7 : 5;

  // Support both new two-tier format (guaranteed + candidates) and legacy wishes array.
  const bodyAny = req.body as {
    guaranteed?: Array<{ id?: string; wishId?: string; text: string; author: string; votes: number }>;
    candidates?: Array<{ text: string; author: string; votes: number }>;
    wishes?: Array<{ text: string; author: string; votes: number }>;
  };

  type WishItem = { id?: string; text: string; author: string; votes: number };
  const formatWishLine = (w: WishItem, i: number) =>
    `${i + 1}. "${w.text}" by ${w.author} (net score: ${w.votes})${w.id ? ` [wishId: ${w.id}]` : ""}`;

  let guaranteedWishes: WishItem[];
  let candidateWishes: WishItem[];

  if (bodyAny.guaranteed !== undefined || bodyAny.candidates !== undefined) {
    // New two-tier format from mobile client
    guaranteedWishes = (bodyAny.guaranteed ?? []).map((wish) => ({
      ...wish,
      id: wish.id ?? wish.wishId,
    }));
    candidateWishes = (bodyAny.candidates ?? []).slice(0, 15);
  } else {
    // Legacy: treat entire wishes list as guaranteed (backward compat)
    guaranteedWishes = ((parsed.data as { wishes?: WishItem[] }).wishes ?? [])
      .sort((a, b) => b.votes - a.votes);
    candidateWishes = [];
  }

  const guaranteedList = guaranteedWishes.map(formatWishLine);
  const candidateList = candidateWishes.map(formatWishLine);

  const validTags = vibes.map(v => v.toLowerCase());

  const vibeActivityGuide: Record<string, string> = {
    culture: "museums, historical sites, galleries, monuments, UNESCO sites, local performances",
    food: "restaurants, food markets, cooking classes, street food tours, wineries, breweries",
    foodie: "restaurants, food markets, cooking classes, street food tours, fine dining, tastings",
    adventure: "hiking, zip-lining, rock climbing, kayaking, paragliding, extreme sports",
    relaxation: "spas, beaches, parks, scenic viewpoints, sunset spots, leisurely walks",
    nightlife: "bars, clubs, rooftop lounges, night markets, live music venues, cocktail bars",
    shopping: "markets, malls, boutiques, artisan shops, souvenir districts, designer stores",
    nature: "national parks, botanical gardens, wildlife reserves, waterfalls, lakes, forests",
    beach: "beaches, snorkeling spots, beachfront cafes, water sports, coastal walks",
    wellness: "yoga studios, spas, meditation centers, hot springs, wellness retreats",
  };

  const vibeGuide = vibes.map(v => {
    const key = v.toLowerCase();
    return vibeActivityGuide[key] ? `- ${v}: ${vibeActivityGuide[key]}` : `- ${v}: activities matching this theme`;
  }).join("\n");

  const totalActivities = days * activitiesPerDay;

  const prompt = `You are a world-class group travel planner. Generate a detailed ${days}-day itinerary for a group trip to ${destination}.

Trip details:
- Destination: ${destination}
- Duration: ${days} days (EXACTLY — never more, never fewer)
- Group vibes: ${vibes.join(", ")}
- Budget level: ${budget}
${startDate ? `- Start date: ${startDate}` : ""}

${(guaranteedList.length === 0 && candidateList.length === 0) ? `━━━ NO WISHES PROVIDED — FULL AI ITINERARY ━━━
The group has not added any wishes yet. Generate a world-class, opinionated itinerary for ${destination} entirely from your own expertise. Base every activity on the group's vibes (${vibes.join(", ")}) and budget level (${budget}). Every activity must use "fromWish": false and "suggester": "AI pick".` : `━━━ SECTION A — GROUP WISHES (two-tier, priority-ordered) ━━━

TIER 1 — GUARANTEED (non-negotiable):
These wishes were democratically selected by the group and MUST all appear as real named activities in the itinerary — every single one, no exceptions:
${guaranteedList.join("\n")}

Each guaranteed wish counts as exactly ONE activity slot. Mark with "fromWish": true and the author's name as "suggester". If a wish includes [wishId: ...], copy that exact value into the activity's "wishId" field. If it has no ID, include its exact original text in the activity's "wishText" field. If the total number of guaranteed wishes exceeds the total activity slots available, add extra activities to those days to absorb them all — do NOT drop any guaranteed wish.

TIER 2 — CANDIDATES (include if slots allow, skip if not):
These wishes have group support but are not guaranteed. Include them only if you have spare activity slots remaining after placing all guaranteed wishes and your AI picks. Do NOT force them in at the expense of pacing or geography — skip any that don't fit naturally:
${candidateList.length > 0 ? candidateList.join("\n") : "None."}

Candidates also use "fromWish": true and the author's name as "suggester".

CONFLICT RESOLUTION: If two guaranteed wishes are geographically incompatible on the same day (e.g., opposite ends of the city with no reasonable way to visit both), split them across different days rather than degrading pacing or cramming both in. Record any such adjustment in the top-level "conflicts" array (one string per conflict, e.g. "Moved 'X' from Day 1 to Day 3 — too far from other Day 1 activities"). If there are no conflicts, return an empty array.`}

━━━ SECTION B — AI PICKS (fill all remaining slots) ━━━
After placing all guaranteed wishes (and any candidates that fit), fill the remaining activity slots (target: ${totalActivities} total activities across ${days} days) with original AI recommendations — diverse, specific, real-world venues the group would love.
Use the group's vibes as inspiration, not as a hard constraint. A great itinerary mixes iconic sights, local gems, meals, and experiences.
These must have "fromWish": false and "suggester": "AI pick".

Vibe inspiration guide:
${vibeGuide}

━━━ STRICT RULES ━━━
0. LOCATION LOCK — Every single activity, restaurant, venue, and experience MUST be physically located in or immediately around ${destination}. Do NOT suggest activities in other cities, regions, or countries, even as a day trip. If a wish mentions a place outside ${destination}, adapt the spirit of it to something available in ${destination} instead.
0b. SAME-AREA CLUSTERING — All activities within a SINGLE day must be in the same city and reasonably close to each other (same neighborhood/district, or at most a short taxi/metro ride apart — never a multi-hour drive or a trip requiring leaving the metro area). Order the day's activities so they flow geographically (e.g. don't bounce from the north side of town to the south and back). Every activity's "city" for that day must exactly match the day's declared "city" field — never mix venues from a different town, suburb, or region into a day assigned to another city.
1. The "days" array MUST have EXACTLY ${days} elements numbered 1–${days}.
2. Each day MUST have AT LEAST ${activitiesPerDay} activities (pace: ${pace}). This is the normal daily minimum, not a maximum: add activities beyond it whenever needed to retain every guaranteed wish.
3. Every activity's "tag" must be one of: ${validTags.join(", ")}.
4. REAL VENUES ONLY — Every activity "name" must be a real, verifiable place that actually exists in ${destination} and can be found on Google Maps. Only use venues you are highly confident exist: famous landmarks, well-known restaurants, major museums, established bars, popular parks. If you are not certain a specific venue exists, use a well-known category anchor instead (e.g. "Mercado de San Miguel" not an invented market name). Never invent a venue name. Generic titles are also forbidden — "Famous Cathedral" is as bad as a made-up name.
5. OPEN & OPERATING — Only suggest venues that are currently open and operating as of 2025. Do NOT suggest venues that are permanently closed, demolished, under indefinite closure, or no longer in business. Restaurants and cafes close far more often than museums or landmarks — for any "food" or dining-related activity, strongly prefer iconic, long-established institutions (10+ years operating) that you are highly confident are still open, rather than trendy, small, or recently-opened spots you're less certain about. If unsure, choose a well-known alternative that you are confident about.
6. Descriptions: ONE sentence, max 15 words.
7. NO REPEATS ACROSS THE WHOLE TRIP — Never use the same venue name twice anywhere in the itinerary, across ANY day, not just within a single day. Track every venue name you've already used across all previous days and pick a different one each time. Also avoid repeating the same narrow activity type (e.g. two ramen shops, two rooftop bars) more than once per day.
8. ACCOMMODATION BAN — Do NOT include any hotels, hostels, Airbnbs, resorts, check-ins, check-outs, or any form of "place to stay" as an activity. Activities are things the group DOES, not where they sleep.
9. For AI pick activities, set "matchedVibe" to the single group vibe this activity best matches (must be one of: ${vibes.map(v => v.toLowerCase()).join(", ")}). For wish-based activities, set "matchedVibe" to null.
10. COST ACCURACY — "estimatedCost" is the price ONE single traveler pays out of pocket, exactly as listed at the ticket counter, on Google, Viator, or GetYourGuide. It is NEVER the group total divided by the number of travelers — do NOT divide by group size. Treat each traveler as booking independently and paying their own full individual admission or meal. Use these realistic single-ticket ranges:
  NO-ENTRY-COST (always $0): open-air landmarks, beaches, temples with no entry fee, public parks, viewpoints, self-guided walks, markets with no admission charge
  PAID ADMISSION ($5–30): museums, archaeological sites, palaces, zoos — use the known single-ticket admission price if you know it (e.g. Louvre = $22, Uffizi = $28)
  GUIDED TOURS booked on Viator/GetYourGuide ($30–150 per person): walking food tours $40–80, city sightseeing tours $30–60, cooking classes $60–130, boat trips/cruises $40–100, wine/spirits tastings $35–80, day trips outside city $80–200, private tours $150–400
  FOOD & DRINK (price of one person's meal): street food / food stall $3–12, casual local café or noodle shop $8–20, mid-range sit-down restaurant $20–55, upscale restaurant $55–120, fine dining / Michelin $100–250
  NIGHTLIFE (one person's spend): local bar / beer $8–18, cocktail bar $15–35, rooftop bar $20–45, nightclub entry + drink $20–50
  WELLNESS (one person's session): spa / hammam $40–120, yoga or fitness class $15–40, surf lesson $50–90
  Budget modifier: ${budget === "budget" ? "lean toward lower end of each range above; prefer no-admission or cheapest-available options; avoid expensive tours" : budget === "luxury" ? "lean toward upper end; use premium/private pricing; upgrade restaurants to upscale/fine-dining tier" : "use mid-range values within each range above"}
  NEVER output 25 as a default. NEVER divide a venue's price by the group size. Every activity must have a cost that honestly reflects what one individual pays for that specific venue/experience.
11. COORDINATES & PHOTO — For every activity include:
  - "photoQuery": a 3–5 word image-search phrase that will return a great photo of this specific activity (e.g. "Uluwatu Temple cliff sunset" or "Tsukiji Fish Market Tokyo morning")
  - "lat": exact latitude of the venue as a decimal number (e.g. -8.8291)
  - "lng": exact longitude of the venue as a decimal number (e.g. 115.0849)
  These must be accurate for the real venue. Never omit them.

Respond with ONLY valid JSON in this exact format (no markdown, no extra text):
{
  "title": "Catchy trip title",
  "conflicts": [],
  "days": [
    {
      "dayNumber": 1,
      "city": "City name",
      "theme": "Day theme",
      "activities": [
        {
          "time": "9:00 AM",
          "name": "Activity name",
          "description": "1-2 sentence description with practical tip",
          "tag": "${vibes[0]?.toLowerCase() ?? "culture"}",
          "fromWish": true,
          "wishId": "optional stable ID from a guaranteed wish",
          "wishText": "optional original guaranteed wish text",
          "suggester": "member name or 'AI pick'",
          "matchedVibe": "culture",
          "estimatedCost": 0,
          "labels": ["Must-try"],
          "nearPrevious": false,
          "photoQuery": "Activity name city keyword",
          "lat": 0.0,
          "lng": 0.0
        }
      ]
    }
  ]
}`;

  try {
    const body = {
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      system: "You are a JSON API. Always respond with only valid JSON. No preamble, no explanation, no markdown code blocks. Never start your response with words — start directly with the opening brace {.",
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: "{" },
      ],
    };

    const response = await callAnthropic(body);
    const data = await (response as unknown as globalThis.Response).json() as {
      content?: Array<{ type: string; text?: string }>;
      error?: { message: string };
      stop_reason?: string;
    };

    if (!(response as unknown as globalThis.Response).ok) {
      req.log.error({ data }, "Anthropic API error (itinerary)");
      res.status(400).json({ error: data.error?.message ?? "AI generation failed. Please try again." });
      return;
    }

    const allText = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    if (data.stop_reason === "max_tokens") {
      req.log.warn({ chars: allText.length }, "Itinerary response truncated at max_tokens");
    }

    let itinerary: ItineraryShape;
    try {
      itinerary = parseItineraryResponse(allText, {
        expectedDays: days,
        activitiesPerDay,
        guaranteedWishes,
      });
    } catch (firstParseError) {
      req.log.warn(
        { chars: allText.length, error: firstParseError instanceof Error ? firstParseError.message : String(firstParseError) },
        "Itinerary response was malformed; requesting a compact retry",
      );

      const retryBody = {
        ...body,
        messages: [{
          role: "user",
          content: `${prompt}

IMPORTANT RETRY: The previous response was not valid JSON. Return a compact, complete JSON object now. Keep every required field and exactly the requested number of days. Include at least the requested activity pace on every day, but add extra activities when needed to retain every guaranteed wish. Keep descriptions under 8 words. Do not use markdown, comments, or any text outside the JSON object.`,
        }, { role: "assistant", content: "{" }],
      };
      try {
        const retryResponse = await callAnthropic(retryBody);
        const retryData = await (retryResponse as unknown as globalThis.Response).json() as {
          content?: Array<{ type: string; text?: string }>;
          error?: { message: string };
          stop_reason?: string;
        };
        if (!(retryResponse as unknown as globalThis.Response).ok) {
          throw new Error(retryData.error?.message ?? "AI itinerary retry failed.");
        }
        const retryText = (retryData.content ?? [])
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("");
        itinerary = parseItineraryResponse(retryText, {
          expectedDays: days,
          activitiesPerDay,
          guaranteedWishes,
        });
      } catch (retryError) {
        if (retryError instanceof ItineraryResponseError) throw retryError;
        throw new ItineraryResponseError(
          "The AI could not return a complete itinerary after retrying.",
          { cause: retryError },
        );
      }
    }
    const dedupedItinerary = await dedupeItineraryVenues(itinerary, destination, req.log);
    // Keep the invariant true after post-processing as well as after the
    // model response. This also protects future itinerary repair passes.
    res.json(parseItineraryResponse(JSON.stringify(dedupedItinerary), {
      expectedDays: days,
      activitiesPerDay,
      guaranteedWishes,
    }));
  } catch (err) {
    if (err instanceof ItineraryResponseError) {
      req.log.warn({ code: err.code, error: err.message }, "Returning recoverable itinerary parse error");
      res.status(502).json({
        error: "We could not build a complete itinerary right now. Please try again.",
        code: err.code,
        recoverable: err.recoverable,
      });
      return;
    }
    req.log.error({ err }, "Failed to generate itinerary");
    res.status(500).json({ error: (err as Error).message || "Failed to generate itinerary" });
  }
});

router.post("/packing", async (req: Request, res: Response): Promise<void> => {
  const parsed = GeneratePackingListBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req.body as { userId?: string }).userId;
  const isPlusUser = (req.body as { isPlusUser?: boolean }).isPlusUser === true;
  if (userId) {
    const allowed = await checkAndIncrementGenerationCount(userId, "packing", isPlusUser, res);
    if (!allowed) return;
  }

  const { destination, days, vibes, budget } = parsed.data;

  const prompt = `You are a seasoned travel packer. Generate a smart, curated packing list for a ${days}-day group trip to ${destination}.

Trip details:
- Destination: ${destination}
- Duration: ${days} days
- Vibes: ${vibes.join(", ")}
- Budget: ${budget}

Create a practical packing list tailored to these trip vibes and destination. Include destination-specific items.

Respond with ONLY valid JSON (no markdown):
{
  "list": {
    "essentials": ["Passport", "Travel insurance docs"],
    "clothing": ["items appropriate for vibes and destination"],
    "toiletries": ["travel-sized items"],
    "tech": ["adapters, chargers, devices"],
    "activities": ["gear specific to the trip vibes"],
    "tips": ["2-3 destination-specific pro tips"]
  }
}`;

  try {
    const body = {
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      system: "You are a JSON API. Always respond with only valid JSON. No preamble, no explanation, no markdown code blocks. Start directly with {.",
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: "{" },
      ],
    };

    const response = await callAnthropic(body);
    const data = await (response as unknown as globalThis.Response).json() as {
      content?: Array<{ type: string; text?: string }>;
      error?: { message: string };
    };

    if (!(response as unknown as globalThis.Response).ok) {
      req.log.error({ data }, "Anthropic API error (packing)");
      res.status(400).json({ error: data.error?.message ?? "AI generation failed. Please try again." });
      return;
    }

    const allText = "{" + (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    const packingResult = extractAndParseJson(allText);
    res.json(packingResult);
  } catch (err) {
    req.log.error({ err }, "Failed to generate packing list");
    res.status(500).json({ error: (err as Error).message || "Failed to generate packing list" });
  }
});

function flightRangeDescription(distance: string): string {
  const d = distance.toLowerCase();
  if (d.includes("nearby") || d.includes("< 3") || d.includes("<3")) {
    return "under 3 hours (short-haul only — do NOT suggest destinations that require 3+ hours of flying)";
  }
  if (d.includes("mid") || d.includes("3") && d.includes("8")) {
    return "between 3 and 8 hours — MINIMUM 3 hours and MAXIMUM 8 hours. Destinations reachable in UNDER 3 hours are TOO CLOSE and must not be included. Destinations requiring MORE THAN 8 hours are TOO FAR and must not be included.";
  }
  if (d.includes("anywhere") || d.includes("long") || d.includes("any")) {
    return "ANY flight duration — absolutely no restriction on distance. Long-haul destinations (8h, 12h, 15h+) are completely valid and encouraged. Do NOT default to nearby short-haul options just because they are convenient — think globally: Southeast Asia, South America, Japan, Australia, East Africa, etc. are all fair game.";
  }
  return distance;
}

router.post("/suggest-destinations", async (req: Request, res: Response): Promise<void> => {
  // Support both single-preference (legacy) and multi-member preferences
  const body = req.body as {
    // Legacy single-preference fields
    tripType?: string[];
    distance?: string;
    budget?: string;
    days?: number;
    mustHaves?: string;
    // New: array of per-member preferences
    memberPreferences?: Array<{
      name: string;
      vibes: string[];
      distance: string;
      budget: string;
      days: number;
      startDate?: string | null;
      startLocation?: string;
    }>;
    // Destinations already shown — must not appear again
    excludedDestinations?: string[];
  };

  const isGroupMode = Array.isArray(body.memberPreferences) && body.memberPreferences.length > 0;

  if (!isGroupMode && (!body.tripType?.length || !body.distance || !body.budget || !body.days)) {
    res.status(400).json({ error: "Missing required fields." });
    return;
  }

  const userId = (req.body as { userId?: string }).userId;
  const isPlusUser = (req.body as { isPlusUser?: boolean }).isPlusUser === true;
  if (userId) {
    const allowed = await checkAndIncrementGenerationCount(userId, "suggest-destinations", isPlusUser, res);
    if (!allowed) return;
  }

  let prompt: string;

  const excluded = body.excludedDestinations ?? [];

  if (isGroupMode) {
    const prefs = body.memberPreferences!;
    const memberLines = prefs.map((p) =>
      `- ${p.name}: vibes [${p.vibes.join(", ")}], flight range: ${flightRangeDescription(p.distance)}, budget "${p.budget}", duration ${p.days} days${p.startDate ? `, preferred start ${p.startDate}` : ""}${p.startLocation ? `, flying from ${p.startLocation}` : ""}`
    ).join("\n");

    // Aggregate vibes with counts
    const allVibes = prefs.flatMap((p) => p.vibes);
    const vibeCounts: Record<string, number> = {};
    allVibes.forEach((v) => { vibeCounts[v] = (vibeCounts[v] ?? 0) + 1; });
    const sortedVibes = Object.entries(vibeCounts).sort((a, b) => b[1] - a[1]);
    const topVibes = sortedVibes.slice(0, 5).map(([v]) => v);
    const dominantVibe = sortedVibes[0]?.[0] ?? "";
    const totalMembers = prefs.length;

    prompt = `You are a world-class group travel expert. Suggest exactly 3 destinations that genuinely match this group's vibes.

Individual member preferences:
${memberLines}

Group vibe summary (sorted by popularity):
${sortedVibes.map(([v, count]) => `- "${v}": ${count}/${totalMembers} members want this`).join("\n")}
Dominant vibe: "${dominantVibe}"
${excluded.length > 0 ? `
ALREADY SHOWN — DO NOT REPEAT THESE UNDER ANY CIRCUMSTANCES:
${excluded.map((d) => `- ${d}`).join("\n")}
` : ""}

━━━ HARD RULE 1: VIBES ARE NON-NEGOTIABLE ━━━
Each vibe maps to SPECIFIC destination types. You MUST respect these mappings:

"beach" → coastal/island destinations with actual beaches: tropical islands (Bali, Phuket, Maldives, Zanzibar, Mykonos, Santorini), beach resort towns (Algarve, Tulum, Cancún, Antalya coast, Hurghada, Koh Samui). Cities like Istanbul, London, Paris, Rome, Madrid, Berlin — even if near water — are NOT beach destinations. Never suggest an inland city or generic capital when beach is a top vibe.

"nature" → destinations where nature IS the attraction: national parks, mountains, fjords, rainforests, volcanic landscapes (Iceland, Patagonia, New Zealand, Costa Rica, Norwegian fjords, Swiss Alps, Azores, Scottish Highlands, Canadian Rockies). Do NOT suggest major cities.

"city" → vibrant urban centres with nightlife, museums, architecture: Tokyo, NYC, London, Paris, Dubai, Singapore, Barcelona, Berlin. ONLY use this type when "city" is an explicit vibe.

"culture" → historically rich destinations with heritage sites, local traditions: Kyoto, Rome, Athens, Cairo, Marrakech, Petra, Havana, Tbilisi, Sarajevo.

"adventure" → destinations built around outdoor thrills: Queenstown NZ, Interlaken, Moab Utah, Nepal, Madagascar, Patagonia, Iceland.

"relaxation" → slow-paced resort or wellness destinations: Maldives, Seychelles, Bora Bora, Tuscany countryside, Ubud Bali, Amalfi Coast.

"party" / "nightlife" → known nightlife hubs: Ibiza, Mykonos, Bangkok, Las Vegas, Cancún, Miami, Rio, Amsterdam.

"foodie" → destinations world-renowned for cuisine: Tokyo, Lyon, Bologna, San Sebastián, Mexico City, Singapore, Istanbul, Osaka.

SCORING RULE: For each candidate destination, count how many of the group's vibes it genuinely satisfies. Rank candidates by vibe score. Only suggest destinations with the HIGHEST scores. A destination that matches 3/4 vibes beats one that matches 1/4 even if the latter is more "famous".

━━━ HARD RULE 2: FLIGHT TIME ━━━
Each member's flight range is a strict limit — not a guideline. "Under 3 hours from Riyadh" means Europe (~6h) is INVALID. Only suggest destinations whose actual flight time falls within EVERY member's stated range. If members have different ranges, find destinations within the tightest shared window or flag the majority trade-off.

━━━ FORMATTING RULES ━━━
- Suggest 3 destinations that are genuinely different from each other (different regions or meaningfully different vibes)
- Each pitch: ONE punchy sentence (max 12 words) explaining why it works for THIS group
- Each destination: exactly 3 short tags (2–4 words each) reflecting the matched vibes
- flightHint: actual flight time from the most common start location, e.g. "~2h from Riyadh"
- bestTime: e.g. "May–Sept" or "Year-round"

Respond with ONLY valid JSON, no markdown:
{
  "suggestions": [
    {
      "name": "Bali, Indonesia",
      "pitch": "Beaches, jungle temples, and sunsets that never disappoint.",
      "tags": ["Beach paradise", "Spiritual vibes", "Adventure ready"],
      "flightHint": "~9h from London",
      "bestTime": "May–October"
    }
  ]
}`;
  } else {
    // Legacy single-preference mode
    const tripVibes = body.tripType ?? [];
    const vibeLines = tripVibes.length > 0 ? `- Vibes requested: ${tripVibes.join(", ")}` : "";

    prompt = `You are a world-class travel expert. Suggest exactly 3 distinct destinations that genuinely match the requested vibes.

Trip preferences:
${vibeLines}
- Flight range: ${flightRangeDescription(body.distance!)}
- Budget level: ${body.budget}
- Duration: ${body.days} days${body.mustHaves ? `\n- Must have: ${body.mustHaves}` : ""}
${excluded.length > 0 ? `
ALREADY SHOWN — DO NOT REPEAT THESE UNDER ANY CIRCUMSTANCES:
${excluded.map((d) => `- ${d}`).join("\n")}
` : ""}

━━━ HARD RULE 1: VIBES ARE NON-NEGOTIABLE ━━━
Each vibe maps to SPECIFIC destination types:
"beach" → actual coastal/island destinations with beaches (Bali, Phuket, Mykonos, Maldives, Algarve, Tulum, Zanzibar). NEVER suggest inland cities or generic capitals for a beach vibe.
"nature" → national parks, mountains, fjords, rainforests (Iceland, Patagonia, Costa Rica, NZ, Swiss Alps, Azores).
"city" → major urban centres (Tokyo, NYC, London, Barcelona, Dubai). Only use when city is explicitly requested.
"culture" → heritage-rich destinations (Rome, Athens, Kyoto, Marrakech, Cairo, Havana).
"adventure" → outdoor thrills (Queenstown, Interlaken, Nepal, Iceland, Moab).
"relaxation" → slow-paced resort/wellness destinations (Maldives, Seychelles, Tuscany, Ubud).
"party" / "nightlife" → nightlife hubs (Ibiza, Mykonos, Bangkok, Las Vegas, Cancún, Amsterdam).
"foodie" → cuisine capitals (Tokyo, Lyon, Bologna, San Sebastián, Mexico City, Singapore).

Rank destinations by how many of the requested vibes they satisfy. Highest score wins.

━━━ HARD RULE 2: FLIGHT TIME ━━━
The flight range above is a strict limit. Every suggestion must fall within those bounds exactly.

━━━ FORMATTING RULES ━━━
- 3 destinations, genuinely different regions or vibes
- Each pitch: ONE punchy sentence (max 12 words)
- Each destination: exactly 3 short tags (2–4 words each)
- flightHint: actual flight time e.g. "~2h from London"
- bestTime: e.g. "May–Sept" or "Year-round"

Respond with ONLY valid JSON, no markdown:
{
  "suggestions": [
    {
      "name": "Mykonos, Greece",
      "pitch": "Whitewashed cliffs, party beaches, and legendary Aegean sunsets.",
      "tags": ["Beach paradise", "Nightlife", "Stunning scenery"],
      "flightHint": "~3.5h from London",
      "bestTime": "June–September"
    },
    {
      "name": "Bali, Indonesia",
      "pitch": "Surf, rice terraces, temples, and the world's best sunsets.",
      "tags": ["Beach vibes", "Cultural depth", "Adventure ready"],
      "flightHint": "~15h from London",
      "bestTime": "May–October"
    },
    {
      "name": "Algarve, Portugal",
      "pitch": "Golden cliffs, hidden sea caves, and warm Atlantic waves.",
      "tags": ["Beach escape", "Scenic coast", "Relaxed pace"],
      "flightHint": "~2.5h from London",
      "bestTime": "May–October"
    }
  ]
}`;
  }

  try {
    const body = {
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    };

    const response = await callAnthropic(body);
    const data = await (response as unknown as globalThis.Response).json() as {
      content?: Array<{ type: string; text?: string }>;
      error?: { message: string };
    };

    if (!(response as unknown as globalThis.Response).ok) {
      req.log.error({ data }, "Anthropic API error (suggest-destinations)");
      res.status(400).json({ error: data.error?.message ?? "AI generation failed. Please try again." });
      return;
    }

    const allText = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    if (!allText.trim()) {
      req.log.error({ data }, "Empty response from Anthropic (suggest-destinations)");
      res.status(500).json({ error: "AI returned an empty response. Please try again." });
      return;
    }

    const result = extractAndParseJson(allText);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to suggest destinations");
    res.status(500).json({ error: (err as Error).message || "Failed to suggest destinations" });
  }
});

router.post("/suggest-accommodations", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    destination: string;
    days: number;
    memberCount: number;
    memberPreferences: Array<{
      name: string;
      maxCostPerPerson: number;
      type: string;
      rooms: number;
      location: string;
      amenities: string[];
      priority: string;
      cancellation: string;
    }>;
  };

  if (!body.destination || !body.days || !Array.isArray(body.memberPreferences) || body.memberPreferences.length === 0) {
    res.status(400).json({ error: "Missing required fields." });
    return;
  }

  const { destination, days, memberCount, memberPreferences } = body;
  const safeMemberCount = Math.max(1, Number(memberCount) || memberPreferences.length);

  const memberLines = memberPreferences.map((p) => {
    // Older clients may not have persisted every optional preference field.
    // Normalize before interpolating so a missing amenities array cannot crash
    // the suggestion endpoint with "undefined is not a function".
    const amenities = Array.isArray(p?.amenities)
      ? p.amenities.filter((amenity): amenity is string => typeof amenity === "string")
      : [];
    return `- ${p?.name || "Member"}: max $${Number(p?.maxCostPerPerson) || 0}/person, prefers ${p?.type || "no preference"}, ${Number(p?.rooms) || 1} room(s), wants to be near "${p?.location || "city center"}", amenities [${amenities.join(", ") || "none specified"}], priority: ${p?.priority || "balanced"}, cancellation: ${p?.cancellation || "any"}`;
  }).join("\n");

  const totalNights = days;
  const avgMaxBudget = Math.round(
    memberPreferences.reduce((sum, preference) => sum + (Number(preference?.maxCostPerPerson) || 0), 0) /
      memberPreferences.length,
  );

  const prompt = `You are a group travel accommodation expert. A group of ${safeMemberCount} traveler(s) needs accommodation in ${destination} for ${totalNights} night(s).

Individual member preferences:
${memberLines}

Group summary:
- Average max budget per person: $${avgMaxBudget} total for the trip
- Group size: ${safeMemberCount} people

Suggest exactly 3 distinct, realistic accommodation options for ${destination} that best balance the group's needs. Make them genuinely different types or price points.

For each suggestion:
1. Use a realistic property name that could exist in ${destination}
2. Calculate totalCost = cost for ALL ${safeMemberCount} people for ALL ${totalNights} nights
3. Calculate costPerPerson = totalCost / ${safeMemberCount}
4. Keep costPerPerson close to avgMaxBudget but show range across the 3 options
5. distanceNote should reference how far it is from the city center or main attractions in ${destination}
6. whyItFits must explain in 1 punchy sentence why it works for THIS specific group

Respond with ONLY valid JSON, no markdown:
{
  "suggestions": [
    {
      "id": "opt-1",
      "name": "Hotel Palacio Central",
      "type": "hotel",
      "location": "Barrio Gótico, Barcelona",
      "totalCost": 1800,
      "costPerPerson": 450,
      "nights": ${totalNights},
      "rating": 4.3,
      "amenities": ["WiFi", "Breakfast included", "AC", "Rooftop terrace"],
      "rooms": 2,
      "beds": 4,
      "cancellation": "Cancellation available until 48h before check-in",
      "whyItFits": "Central location puts you 5 min from most of your wishlist spots.",
      "tags": ["Best location", "Breakfast included", "Great value"],
      "distanceNote": "5 min walk to La Rambla, 10 min to Gothic Quarter",
      "submittedBy": "AI"
    }
  ]
}`;

  try {
    const requestBody = {
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    };

    const response = await callAnthropic(requestBody);
    const data = await (response as unknown as globalThis.Response).json() as {
      content?: Array<{ type: string; text?: string }>;
      error?: { message: string };
    };

    if (!(response as unknown as globalThis.Response).ok) {
      req.log.error({ data }, "Anthropic API error (suggest-accommodations)");
      res.status(400).json({ error: data.error?.message ?? "AI generation failed. Please try again." });
      return;
    }

    const allText = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    const result = parseAccommodationSuggestionsResponse(allText);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to suggest accommodations");
    if (err instanceof AccommodationResponseError) {
      res.status(502).json({
        error: "We could not build complete accommodation suggestions right now. Please try again.",
        code: err.code,
        recoverable: err.recoverable,
      });
      return;
    }
    res.status(500).json({ error: (err as Error).message || "Failed to suggest accommodations" });
  }
});

router.post("/parse-accommodation", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { url?: string; destination?: string };
  if (!body.url) {
    res.status(400).json({ error: "Missing url." });
    return;
  }

  const rawUrl = body.url.trim();
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const destination = body.destination ?? "the destination";

  // ── Pre-parse the URL for structured hints ────────────────────────────────
  let parsedObj: URL | null = null;
  try { parsedObj = new URL(url); } catch { /* ignore */ }

  const hostname = parsedObj?.hostname?.replace(/^www\./, "") ?? "";
  const params = parsedObj ? Object.fromEntries(parsedObj.searchParams.entries()) : {};
  const pathSegments = parsedObj?.pathname?.split("/").filter(Boolean) ?? [];

  // Detect platform
  const platform =
    hostname.includes("airbnb") ? "airbnb" :
    hostname.includes("booking.com") ? "booking.com" :
    hostname.includes("expedia") ? "expedia" :
    hostname.includes("hotels.com") ? "hotels.com" :
    hostname.includes("hostelworld") ? "hostelworld" :
    hostname.includes("vrbo") ? "vrbo" :
    hostname.includes("tripadvisor") ? "tripadvisor" :
    hostname;

  // Extract human-readable slug from path (convert dashes to spaces, strip IDs)
  const slugHints = pathSegments
    .map(s => s.replace(/\.[a-z0-9]+$/i, ""))       // strip .h123 suffixes
    .map(s => s.replace(/[-_]/g, " "))
    .filter(s => s.length > 2 && !/^\d+$/.test(s))  // skip pure numeric segments
    .join(" | ");

  // Known query param keys that carry useful data across platforms
  const paramHints: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (["destination", "city", "location", "place", "q", "query", "name",
         "property_name", "hotel_name", "region", "chkin", "chkout",
         "checkin", "checkout", "check_in", "check_out"].includes(k)) {
      paramHints[k] = v;
    }
  }

  const urlContext = [
    `Platform: ${platform}`,
    slugHints ? `Path hints: ${slugHints}` : "",
    Object.keys(paramHints).length
      ? `Query params: ${Object.entries(paramHints).map(([k,v]) => `${k}=${v}`).join(", ")}`
      : "",
  ].filter(Boolean).join("\n");

  // ── Try fetching page content (best-effort; many sites block bots) ─────────
  let pageContent = "";
  const extractedPhotos: string[] = [];
  try {
    const pageRes = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (pageRes.ok) {
      const html = await pageRes.text();

      // Extract photos from meta tags before stripping HTML.
      // og:image and twitter:image often survive bot-protection since they're
      // in the initial HTML payload (not JS-rendered).
      const photoPatterns = [
        /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*/gi,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*/gi,
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*/gi,
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*/gi,
      ];
      for (const pattern of photoPatterns) {
        for (const m of html.matchAll(pattern)) {
          const src = m[1];
          if (src && src.startsWith("http") && !extractedPhotos.includes(src)) {
            extractedPhotos.push(src);
          }
          if (extractedPhotos.length >= 5) break;
        }
        if (extractedPhotos.length >= 5) break;
      }

      pageContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim()
        .slice(0, 4000);
    }
  } catch {
    // Silently fall back to URL-only inference
  }

  const prompt = `You are extracting accommodation listing details for a group travel app.

Full URL: ${url}
Trip destination (from app): ${destination}

URL analysis (pre-parsed — use these as primary hints):
${urlContext}

${pageContent ? `Page content (truncated, may be partial due to bot protection):\n${pageContent}` : "(Page content unavailable — infer entirely from the URL analysis above.)"}

Instructions:
- Extract the property name from the path slug or page content. For Expedia, the path is usually "{City}-Hotels-{Property-Name}.h{id}.Hotel-Information" — so extract just the property name part.
- Infer the property type from the platform (airbnb → "airbnb", hostelworld → "hostel", expedia/booking/hotels.com → "hotel").
- Use destination query param or path slug for location if page content is unavailable.
- For rating: only set a non-zero value if you find an actual rating number. Use 0 if unknown.
- Make amenities, tags, and whyItFits reasonable given the property name, platform, and destination.

Return ONLY valid JSON with these fields (no markdown, no explanation):
{
  "name": string,
  "type": "hotel" | "airbnb" | "hostel" | "other",
  "location": string,
  "rating": number,
  "amenities": string[],
  "cancellation": string,
  "tags": string[],
  "distanceNote": string,
  "whyItFits": string
}`;

  try {
    const response = await callAnthropic({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    const data = await (response as unknown as globalThis.Response).json() as {
      content?: Array<{ type: string; text?: string }>;
      error?: { message: string };
    };
    if (!(response as unknown as globalThis.Response).ok) {
      res.status(400).json({ error: data.error?.message ?? "AI generation failed. Please try again." });
      return;
    }
    const allText = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const result = extractAndParseJson(allText) as any;

    // Fallback photos by accommodation type when og:image extraction yields nothing.
    // These are stable Unsplash photo IDs representing each category.
    const FALLBACK_BY_TYPE: Record<string, string> = {
      hotel:  "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&h=480&fit=crop",
      airbnb: "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&h=480&fit=crop",
      hostel: "https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=800&h=480&fit=crop",
      other:  "https://images.unsplash.com/photo-1455587734955-081b22074882?w=800&h=480&fit=crop",
    };
    const photos = extractedPhotos.length > 0
      ? extractedPhotos
      : [FALLBACK_BY_TYPE[(result as any).type ?? "other"] ?? FALLBACK_BY_TYPE.hotel];

    res.json({ ...result, photos });
  } catch (err) {
    req.log.error({ err }, "Failed to parse accommodation");
    res.status(500).json({ error: "Could not parse listing. Please try again." });
  }
});

router.post("/ai-pick-destination", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    suggestions: Array<{ name: string; pitch: string; tags: string[]; flightHint: string }>;
    memberCount: number;
  };

  if (!body.suggestions?.length) {
    res.status(400).json({ error: "Missing required fields." });
    return;
  }

  const optionLines = body.suggestions
    .map((s, i) =>
      `Option ${i + 1} (index ${i}): ${s.name} — ${s.pitch} (tags: ${s.tags.join(", ")}) | ${s.flightHint}`
    )
    .join("\n");

  const prompt = `A group of ${body.memberCount} travelers are tied on destination votes. Break the tie by picking the single best destination for the group.

Options:
${optionLines}

Pick the best option by its 0-based index and explain in one sentence why it is the best group choice.
Respond with ONLY valid JSON: {"winnerIdx": 0, "reason": "One clear sentence."}`;

  try {
    const requestBody = {
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    };

    const response = await callAnthropic(requestBody);
    const data = await (response as unknown as globalThis.Response).json() as {
      content?: Array<{ type: string; text?: string }>;
    };

    const allText = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const result = extractAndParseJson(allText);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to pick destination");
    res.status(500).json({ error: "Could not determine destination winner." });
  }
});

router.post("/ai-pick-accommodation", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as {
    suggestions: Array<{ name: string; type: string; location: string; costPerPerson: number; whyItFits: string }>;
    destination: string;
    memberCount: number;
  };

  if (!body.suggestions?.length || !body.destination) {
    res.status(400).json({ error: "Missing required fields." });
    return;
  }

  const optionLines = body.suggestions
    .map((s, i) =>
      `Option ${i + 1} (index ${i}): ${s.name} (${s.type}) at ${s.location} — $${s.costPerPerson}/person — ${s.whyItFits}`
    )
    .join("\n");

  const prompt = `A group of ${body.memberCount} travelers are tied on accommodation options for ${body.destination}. Break the tie by picking the single best option for the group.

Options:
${optionLines}

Pick the best option by its 0-based index and explain in one sentence why it is the best group choice.
Respond with ONLY valid JSON: {"winnerIdx": 0, "reason": "One clear sentence."}`;

  try {
    const requestBody = {
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    };

    const response = await callAnthropic(requestBody);
    const data = await (response as unknown as globalThis.Response).json() as {
      content?: Array<{ type: string; text?: string }>;
    };

    const allText = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const result = extractAndParseJson(allText);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to pick accommodation");
    res.status(500).json({ error: "Could not determine accommodation winner." });
  }
});

router.post("/redo-activity", async (req: Request, res: Response): Promise<void> => {
  const { activity, city, theme, destination, budget, redoType, otherActivities, allTripActivities } = req.body as {
    activity: { name: string; description: string; tag: string; time: string; estimatedCost: number };
    city: string;
    theme: string;
    destination: string;
    budget?: string;
    redoType: "same_type" | "whole";
    otherActivities: string[];
    allTripActivities?: string[];
  };
  const budgetTier = budget ?? "midrange";
  const resolvedDestination = destination?.trim() ?? "";
  // Some itineraries created by earlier mobile builds do not persist city per
  // day. A destination-level redo is still valid, so use it as the fallback.
  const resolvedCity = city?.trim() || resolvedDestination;
  const timeGuidance = activityTimeGuidance(activity?.time);

  if (!activity || !resolvedCity || !resolvedDestination || !redoType) {
    res.status(400).json({ error: "Missing required fields." });
    return;
  }

  const userId = (req.body as { userId?: string }).userId;
  const isPlusUser = (req.body as { isPlusUser?: boolean }).isPlusUser === true;
  if (userId) {
    const allowed = await checkAndIncrementGenerationCount(userId, "redo-activity", isPlusUser, res);
    if (!allowed) return;
  }

  const others = (otherActivities ?? []).length > 0
    ? `\nActivities already on this day — do NOT repeat these:\n${(otherActivities ?? []).map((a: string) => `- ${a}`).join("\n")}`
    : "";

  const usedElsewhere = [...new Set(allTripActivities ?? [])];
  const tripWide = usedElsewhere.length > 0
    ? `\nVenues already used elsewhere in this trip (on OTHER days too) — do NOT reuse any of these:\n${usedElsewhere.map((a) => `- ${a}`).join("\n")}`
    : "";

  const sameTypeHint: Record<string, string> = {
    food: "different restaurant or eatery",
    nightlife: "different bar, club, or venue",
    shopping: "different market or shop",
    relaxation: "different spot or viewpoint for this experience",
    adventure: "different location or route for this activity type",
    culture: "different museum, gallery, or historic site",
    travel: "different travel stop or transit experience",
  };

  const task = redoType === "same_type"
    ? `TASK: Keep the same category (${activity.tag}) but suggest a DIFFERENT specific ${sameTypeHint[activity.tag] ?? "venue or location"} in ${resolvedCity}. Same vibe, completely new place. The name must be a different real venue.`
    : `TASK: Replace this with a COMPLETELY DIFFERENT activity of a different type that fits the day theme "${theme}" in ${resolvedCity}. Pick any of these tags: food, culture, adventure, relaxation, nightlife, shopping, travel.`;

  const prompt = `You are a travel researcher and planner. Your job is to find a REAL, currently-open venue in ${resolvedCity} and return it as JSON.

USE web_search to:
1. Search for top venues in ${resolvedCity} that match the criteria below.
2. Pick the best real candidate — well-known, long-established, findable on Google Maps.
3. Verify it is currently open: search "<venue name> ${resolvedCity} open hours 2025" or "<venue name> ${resolvedCity} closed" to confirm.
4. If your first pick fails verification, search for an alternative and verify that one instead.
Only suggest a venue once you have search evidence it exists and is open.

Current activity being replaced:
- Name: ${activity.name}
- Type: ${activity.tag}
- Time: ${activity.time}

Destination: ${resolvedDestination}
City: ${resolvedCity}
Day theme: ${theme}
${others}
${tripWide}

${task}

RULES:
- Keep the same time slot (${activity.time}).
- ${timeGuidance}
- Verify the venue is actually open at or before ${activity.time}; operating on the same date but opening later is not acceptable.
- The venue must be physically located in ${city} — not a different suburb, town, or region.
- Must be currently open and operating (confirmed by web search).
- Prefer iconic, well-known, long-established places (10+ years) over trendy or obscure ones.
- Description: ONE sentence, max 15 words.
- Cost = what ONE individual traveler pays (never group total divided by size):
    NO-ENTRY-COST $0: open parks, beaches, viewpoints, temples with no entry fee
    PAID ADMISSION $5–30: museums, palaces, archaeological sites
    GUIDED TOURS $30–150: food tours $40–80, cooking classes $60–130, boat trips $40–100
    FOOD (one person's meal): street food $3–12, casual $8–20, mid-range $20–55, upscale $55–120
    NIGHTLIFE: local bar $8–18, cocktail bar $15–35, rooftop bar $20–45, nightclub $20–50
    WELLNESS: spa/hammam $40–120, yoga class $15–40
    Budget modifier (${budgetTier}): ${budgetTier === "budget" ? "lean toward lower end; prefer no-admission/cheap options" : budgetTier === "luxury" ? "lean toward upper end; use premium pricing" : "use mid-range values"}
  NEVER output 25 as a default. NEVER divide by group size.

After your research, your FINAL message must be ONLY valid JSON (no markdown, no preamble):
{
  "time": "${activity.time}",
  "name": "Specific real venue name you verified exists",
  "description": "One sentence max 15 words.",
  "tag": "${redoType === "same_type" ? activity.tag : "culture"}",
  "fromWish": false,
  "suggester": "AI pick",
  "estimatedCost": 0,
  "labels": [],
  "nearPrevious": false
}`;

  try {
    const body = {
      model: "claude-sonnet-4-5",
      max_tokens: 8192,
      system: "You are a travel research API. Use web_search to find and verify real venues. Your FINAL message must be only valid JSON starting with { — no preamble, no markdown.",
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
    };
    const response = await callAnthropic(body, 2, { "anthropic-beta": "web-search-2025-03-05" });
    const data = await (response as unknown as globalThis.Response).json() as {
      content?: Array<{ type: string; text?: string }>;
      error?: { message: string };
    };
    if (!(response as unknown as globalThis.Response).ok) {
      req.log.error({ data }, "Anthropic API error (redo-activity)");
      res.status(400).json({ error: data.error?.message ?? "AI generation failed. Please try again." });
      return;
    }
    // Prefer the final text block, but accept a valid activity in any text
    // block because tool-backed model responses can include nested wrappers.
    const textBlocks = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "");
    let newActivity: RedoActivity | null = null;
    let parseError: unknown = null;
    for (const text of [...textBlocks].reverse()) {
      try {
        newActivity = normalizeRedoActivity(extractAndParseJson(text), {
          time: activity.time,
          tag: activity.tag,
        });
        break;
      } catch (err) {
        parseError = err;
      }
    }
    if (!newActivity) {
      throw parseError ?? new ItineraryResponseError("The AI did not return a replacement activity.");
    }
    res.json({ activity: newActivity });
  } catch (err) {
    req.log.error({ err }, "Failed to redo activity");
    res.status(500).json({ error: (err as Error).message || "Failed to redo activity" });
  }
});

/* ─── Read user notifications via Admin SDK (bypasses RTDB read rules) ─── */
router.get("/my-notifications", async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const idToken = authHeader.slice(7);
  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(idToken);
    const uid = decoded.uid;
    const db = getAdminDb();
    const snap = await db.ref(`notifications/${uid}`).get();
    if (!snap.exists()) {
      res.json({ notifications: [] });
      return;
    }
    const notifications = Object.entries(snap.val() as Record<string, unknown>)
      .map(([id, v]) => ({ id, ...(v as object) }))
      .filter((n: any) => n.status === "pending")
      .sort((a: any, b: any) => b.createdAt - a.createdAt);
    res.json({ notifications });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

/* ─── Deliver actionable trip updates through Expo Push ─── */
router.post("/send-trip-push", async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(authHeader.slice(7));
    const { tripId, title, body, path } = req.body as {
      tripId?: string;
      title?: string;
      body?: string;
      path?: string;
    };
    if (!tripId || !title?.trim() || !body?.trim() || !path?.startsWith("/")) {
      res.status(400).json({ error: "A valid trip update is required." });
      return;
    }

    const db = getAdminDb();
    const tripSnap = await db.ref(`trips/${tripId}`).get();
    const trip = tripSnap.val() as { members?: Record<string, unknown> } | null;
    if (!trip?.members?.[decoded.uid]) {
      res.status(403).json({ error: "Only trip members can send trip updates." });
      return;
    }

    const recipients = Object.keys(trip.members).filter((uid) => uid !== decoded.uid);
    const tokenSnaps = await Promise.all(
      recipients.map((uid) => db.ref(`userTrips/${uid}/pushTokens`).get()),
    );
    const tokens = tokenSnaps.flatMap((snap) =>
      snap.exists()
        ? Object.values(snap.val() as Record<string, { token?: string }>)
            .map((entry) => entry?.token)
            .filter((token): token is string =>
              typeof token === "string" && /^(ExponentPushToken|ExpoPushToken)/.test(token),
            )
        : [],
    );

    if (tokens.length > 0) {
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tokens.map((to) => ({
          to,
          title: title.trim().slice(0, 120),
          body: body.trim().slice(0, 240),
          sound: "default",
          data: { path, tripId },
        }))),
      });
      if (!response.ok) {
        req.log.warn({ status: response.status }, "Expo push request was not accepted");
      }
    }
    res.json({ ok: true, recipients: tokens.length });
  } catch (err) {
    req.log.error({ err }, "Failed to deliver trip push");
    res.status(500).json({ error: "Could not deliver this trip update." });
  }
});

/* ─── Shared activity writes ─── */
router.post("/trip-activity", async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(authHeader.slice(7));
    const {
      tripId,
      operation,
      dayNumber,
      activityId,
      activityIndex,
      targetActivity,
      activity,
    } = req.body as {
      tripId?: string;
      operation?: "add" | "update" | "delete";
      dayNumber?: number;
      activityId?: string;
      activityIndex?: number;
      targetActivity?: Record<string, unknown>;
      activity?: Record<string, unknown>;
    };

    if (
      !tripId ||
      !["add", "update", "delete"].includes(operation ?? "") ||
      !Number.isInteger(Number(dayNumber))
    ) {
      res.status(400).json({ error: "A trip, operation, and itinerary day are required." });
      return;
    }

    const db = getAdminDb();
    const tripRef = db.ref(`trips/${tripId}`);

    if (
      (operation === "update" || operation === "delete") &&
      !activityId &&
      (!targetActivity || typeof targetActivity !== "object")
    ) {
      res.status(400).json({ error: "The activity to change is required." });
      return;
    }
    if ((operation === "add" || operation === "update") && (!activity || typeof activity !== "object")) {
      res.status(400).json({ error: "Activity details are required." });
      return;
    }
    if (typeof activity?.name === "string" && activity.name.trim().length > 160) {
      res.status(400).json({ error: "Activity names must be 160 characters or fewer." });
      return;
    }

    const tripSnapshot = await tripRef.get();
    const currentTrip = tripSnapshot.val() as {
      members?: Record<string, { name?: string }>;
      itinerary?: {
        days?: Array<{
          day?: number;
          dayNumber?: number;
          activities?: Array<Record<string, unknown>>;
        }> | Record<string, {
          day?: number;
          dayNumber?: number;
          activities?: Array<Record<string, unknown>> | Record<string, Record<string, unknown>>;
        }>;
      };
    } | null;
    const member = currentTrip?.members?.[decoded.uid];
    if (!member) {
      res.status(403).json({ error: "Only trip members can change activities." });
      return;
    }
    const dayEntries = firebaseListEntries<{
      day?: number;
      dayNumber?: number;
      activities?: Array<Record<string, unknown>> | Record<string, Record<string, unknown>>;
    }>(currentTrip?.itinerary?.days);
    if (dayEntries.length === 0) {
      res.status(409).json({ error: "This trip does not have an itinerary to update." });
      return;
    }
    const requestedDayNumber = Number(dayNumber);
    let matchingDay = resolveFirebaseDayEntry(dayEntries, requestedDayNumber);
    if (!matchingDay) {
      req.log.warn(
        {
          tripId,
          requestedDayNumber,
          availableDays: dayEntries.map(({ key, value }, index) => ({
            key,
            dayNumber: value.dayNumber ?? value.day ?? index + 1,
          })),
        },
        "Could not resolve itinerary day for activity mutation",
      );
      res.status(409).json({ error: "That itinerary day is no longer available. Please refresh and try again." });
      return;
    }

    if (operation === "update" || operation === "delete") {
      const requestedActivities = normalizeActivityList(matchingDay.value.activities);
      const requestedActivityIndex = resolveFirebaseActivityIndex(
        requestedActivities,
        activityId,
        targetActivity,
      );
      if (requestedActivityIndex === -1) {
        const matchingActivityDays = dayEntries.flatMap((entry, index) => {
          const activities = normalizeActivityList(entry.value.activities);
          const resolvedIndex = resolveFirebaseActivityIndex(activities, activityId, targetActivity);
          return resolvedIndex === -1
            ? []
            : [{ ...entry, canonicalDayNumber: index + 1 }];
        });
        if (matchingActivityDays.length === 1) {
          matchingDay = matchingActivityDays[0]!;
        }
      }
    }

    if (Number(matchingDay.value.dayNumber) !== matchingDay.canonicalDayNumber) {
      await tripRef
        .child(`itinerary/days/${matchingDay.key}/dayNumber`)
        .set(matchingDay.canonicalDayNumber);
    }
    const activitiesRef = tripRef.child(`itinerary/days/${matchingDay.key}/activities`);
    const newActivityId = operation === "add" ? randomUUID() : null;
    let lastResolution = {
      activityCount: 0,
      matchedIndex: -1,
      providedIndex: Number.isInteger(Number(activityIndex)) ? Number(activityIndex) : null,
      slotIndex: -1,
    };
    const applyActivityMutation = (currentActivities: unknown) => {
      const activities = normalizeActivityList(currentActivities);

      if (operation === "add") {
        const source = activity!;
        const newActivity: Record<string, unknown> = {
          id: newActivityId!,
          time: typeof source.time === "string" ? source.time : "12:00 PM",
          name: typeof source.name === "string" ? source.name.trim() : "New activity",
          description: typeof source.description === "string" ? source.description.trim() : "",
          tag: typeof source.tag === "string" ? source.tag : "culture",
          fromWish: false,
          suggester: member.name?.trim() || "Member",
          matchedVibe: source.matchedVibe ?? null,
          estimatedCost: Number.isFinite(Number(source.estimatedCost)) ? Number(source.estimatedCost) : 0,
          labels: Array.isArray(source.labels) ? source.labels.slice(0, 8) : [],
          nearPrevious: Boolean(source.nearPrevious),
          ...(typeof source.photoQuery === "string" ? { photoQuery: source.photoQuery } : {}),
          ...(Number.isFinite(Number(source.lat)) ? { lat: Number(source.lat) } : {}),
          ...(Number.isFinite(Number(source.lng)) ? { lng: Number(source.lng) } : {}),
        };
        const insertAt = activities.findIndex(
          (existing) => activityTimeToMinutes(existing.time) > activityTimeToMinutes(newActivity.time),
        );
        if (insertAt === -1) activities.push(newActivity);
        else activities.splice(insertAt, 0, newActivity);
      } else {
        let index = resolveFirebaseActivityIndex(activities, activityId, targetActivity);
        const matchedIndex = index;
        if (
          index === -1 &&
          Number.isInteger(Number(activityIndex)) &&
          Number(activityIndex) >= 0 &&
          Number(activityIndex) < activities.length
        ) {
          index = Number(activityIndex);
        }
        let slotIndex = -1;
        if (index === -1) {
          slotIndex = resolveUniqueFirebaseActivitySlotIndex(activities, targetActivity);
          index = slotIndex;
        }
        lastResolution = {
          activityCount: activities.length,
          matchedIndex,
          providedIndex: Number.isInteger(Number(activityIndex)) ? Number(activityIndex) : null,
          slotIndex,
        };
        if (index === -1) return;
        if (operation === "delete") {
          activities.splice(index, 1);
        } else {
          const source = activity!;
          activities[index] = {
            ...activities[index],
            ...(typeof source.name === "string" ? { name: source.name.trim() } : {}),
            ...(typeof source.time === "string" ? { time: source.time.trim() } : {}),
            ...(typeof source.description === "string" ? { description: source.description.trim() } : {}),
            ...(Number.isFinite(Number(source.estimatedCost)) ? { estimatedCost: Number(source.estimatedCost) } : {}),
          };
        }
      }

      return activities;
    };

    // RTDB can invoke a transaction against a cold local child cache before it
    // has loaded the server value. Update/delete would see that temporary null
    // as an empty list and abort. Reading this exact child first ensures the
    // scoped transaction starts from the current Firebase activity list.
    await activitiesRef.get();
    let transaction = await activitiesRef.transaction(applyActivityMutation);
    if (!transaction.committed && operation !== "add") {
      await activitiesRef.get();
      transaction = await activitiesRef.transaction(applyActivityMutation);
      if (transaction.committed) {
        req.log.warn(
          { tripId, dayNumber, operation },
          "Recovered a cold-cache activity transaction after a fresh read",
        );
      }
    }

    let committed = transaction.committed;
    if (!committed && operation !== "add") {
      // In this Firebase runtime, a transaction on a cold array child can
      // receive null even after an explicit get(), causing a valid update or
      // delete to abort before seeing server data. Resolve once more against a
      // fresh snapshot and persist only this day's activity list. The resolver
      // still rejects missing or ambiguous targets, so this cannot silently
      // mutate a different activity.
      const latestSnapshot = await activitiesRef.get();
      const recoveredActivities = applyActivityMutation(latestSnapshot.val());
      if (recoveredActivities) {
        await activitiesRef.set(recoveredActivities);
        committed = true;
        req.log.warn(
          { tripId, dayNumber, operation },
          "Recovered an aborted activity transaction from a fresh Firebase snapshot",
        );
      }
    }
    if (!committed && operation === "add") {
      // A new activity has no stale target to conflict with. Some legacy
      // Firebase array shapes can still abort a transaction before committing,
      // so re-read and persist the add once rather than surfacing a false 409.
      const latestSnapshot = await activitiesRef.get();
      const latestActivities = normalizeActivityList(latestSnapshot.val());
      if (!latestActivities.some((candidate) => candidate.id === newActivityId)) {
        const source = activity!;
        const newActivity: Record<string, unknown> = {
          id: newActivityId!,
          time: typeof source.time === "string" ? source.time : "12:00 PM",
          name: typeof source.name === "string" ? source.name.trim() : "New activity",
          description: typeof source.description === "string" ? source.description.trim() : "",
          tag: typeof source.tag === "string" ? source.tag : "culture",
          fromWish: false,
          suggester: member.name?.trim() || "Member",
          matchedVibe: source.matchedVibe ?? null,
          estimatedCost: Number.isFinite(Number(source.estimatedCost)) ? Number(source.estimatedCost) : 0,
          labels: Array.isArray(source.labels) ? source.labels.slice(0, 8) : [],
          nearPrevious: Boolean(source.nearPrevious),
          ...(typeof source.photoQuery === "string" ? { photoQuery: source.photoQuery } : {}),
          ...(Number.isFinite(Number(source.lat)) ? { lat: Number(source.lat) } : {}),
          ...(Number.isFinite(Number(source.lng)) ? { lng: Number(source.lng) } : {}),
        };
        const insertAt = latestActivities.findIndex(
          (existing) => activityTimeToMinutes(existing.time) > activityTimeToMinutes(newActivity.time),
        );
        if (insertAt === -1) latestActivities.push(newActivity);
        else latestActivities.splice(insertAt, 0, newActivity);
        await activitiesRef.set(latestActivities);
      }
      committed = true;
      req.log.warn({ tripId, dayNumber }, "Recovered an aborted add-activity transaction");
    }

    if (!committed) {
      req.log.warn(
        {
          tripId,
          requestedDayNumber,
          resolvedDayKey: matchingDay.key,
          operation,
          hasActivityId: Boolean(activityId),
          hasTargetActivity: Boolean(targetActivity),
          ...lastResolution,
        },
        "Could not resolve selected activity during Firebase transaction",
      );
      res.status(409).json({
        error: "The selected activity is no longer available. Please refresh and try again.",
      });
      return;
    }
    const itinerarySnapshot = await tripRef.child("itinerary").get();
    res.json({ itinerary: itinerarySnapshot.val() });
  } catch (err) {
    req.log.error({ err }, "Failed to update shared trip activity");
    res.status(500).json({ error: "Could not save the shared activity. Please try again." });
  }
});

/* ─── Parse a Google Maps place into a member-added itinerary activity ─── */
router.post("/parse-map-activity", async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(authHeader.slice(7));
    const {
      tripId,
      link,
      destination,
      city,
      dayNumber,
      existingActivities,
    } = req.body as {
      tripId?: string;
      link?: string;
      destination?: string;
      city?: string;
      dayNumber?: number;
      existingActivities?: Array<{ time?: string; name?: string }>;
    };
    if (!tripId || !link?.trim() || !destination?.trim() || !Number.isFinite(Number(dayNumber))) {
      res.status(400).json({ error: "A trip, Google Maps link, destination, and itinerary day are required." });
      return;
    }

    const db = getAdminDb();
    const tripSnap = await db.ref(`trips/${tripId}`).get();
    const trip = tripSnap.val() as { members?: Record<string, unknown> } | null;
    if (!trip?.members?.[decoded.uid]) {
      res.status(403).json({ error: "Only trip members can add an activity." });
      return;
    }
    if (!allowMapActivityImport(decoded.uid)) {
      res.status(429).json({ error: "Too many place imports. Please wait a few minutes and try again." });
      return;
    }

    const resolved = await resolveGoogleMapsLink(link.trim());
    const resolvedDetails = googleMapsDetails(resolved.finalUrl, resolved.pageTitle);
    const response = await callAnthropic({
      model: "claude-haiku-4-5",
      max_tokens: 700,
      system: `Turn a Google Maps place link into one itinerary activity. Return JSON only:
{"time":"h:mm AM","name":"string","description":"string","tag":"food|culture|adventure|outdoor|nature|transport|accommodation|relax|nightlife|shopping|beach","estimatedCost":number,"photoQuery":"string","lat":number|null,"lng":number|null}
Use the place name and coordinates from the supplied URL/title when available. Choose a sensible visit time for the activity type that does not conflict with existing activities on that day. Keep the description factual and concise. Use 0 when cost is unknown.`,
      messages: [{
        role: "user",
        content: JSON.stringify({
          googleMapsUrl: resolved.finalUrl,
          pageTitle: resolved.pageTitle,
          extractedPlaceName: resolvedDetails.placeName,
          extractedCoordinates: {
            lat: resolvedDetails.lat ?? null,
            lng: resolvedDetails.lng ?? null,
          },
          destination,
          city: city || destination,
          dayNumber,
          existingActivities: Array.isArray(existingActivities) ? existingActivities.slice(0, 20) : [],
        }),
      }],
    });
    if (!(response as unknown as globalThis.Response).ok) {
      throw new Error("The AI service could not read that place.");
    }
    const payload = await (response as unknown as globalThis.Response).json() as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const allText = (payload.content ?? [])
      .filter((block) => !block.type || block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    const parsedValue = extractAndParseJson(allText || "{}");
    const parsed = findRedoActivity(parsedValue) ?? {};
    const name = String(parsed.name ?? resolvedDetails.placeName ?? "").trim();
    if (!name) {
      res.status(422).json({ error: "Packyo could not identify a place from that link." });
      return;
    }
    res.json({
      activity: {
        time: String(parsed.time ?? "12:00 PM"),
        name,
        description: String(parsed.description ?? `Visit ${name}.`),
        tag: String(parsed.tag ?? "culture"),
        fromWish: false,
        suggester: "Member",
        estimatedCost: Number.isFinite(Number(parsed.estimatedCost)) ? Number(parsed.estimatedCost) : 0,
        labels: ["Google Maps"],
        nearPrevious: false,
        photoQuery: String(parsed.photoQuery ?? `${name} ${city || destination}`),
        ...(parsed.lat !== null && parsed.lat !== undefined && Number.isFinite(Number(parsed.lat))
          ? { lat: Number(parsed.lat) }
          : resolvedDetails.lat !== undefined ? { lat: resolvedDetails.lat } : {}),
        ...(parsed.lng !== null && parsed.lng !== undefined && Number.isFinite(Number(parsed.lng))
          ? { lng: Number(parsed.lng) }
          : resolvedDetails.lng !== undefined ? { lng: resolvedDetails.lng } : {}),
      },
    });
  } catch (err) {
    const message = (err as Error).message || "Could not read that Google Maps place.";
    const status = /valid Google Maps|Only Google Maps/.test(message) ? 400 : 500;
    req.log.error({ err }, "Failed to parse Google Maps activity");
    res.status(status).json({ error: message });
  }
});

/* ─── Generate and persist an AI-organized post-trip memory guide ─── */
router.post("/memory-guide", async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(authHeader.slice(7));
    const { tripId } = req.body as { tripId?: string };
    if (!tripId) {
      res.status(400).json({ error: "tripId is required" });
      return;
    }
    const db = getAdminDb();
    const tripSnap = await db.ref(`trips/${tripId}`).get();
    const trip = tripSnap.val() as any;
    if (!trip?.members?.[decoded.uid]) {
      res.status(403).json({ error: "Only trip members can create this memory guide." });
      return;
    }
    const memberReview = trip.memberReviews?.[decoded.uid] ?? (
      trip.review?.reviewedBy === decoded.uid ? trip.review : null
    );
    if (!memberReview) {
      res.status(400).json({ error: "Add a trip review before creating the memory guide." });
      return;
    }

    const activities = (trip.itinerary?.days ?? []).flatMap((day: any) =>
      (day.activities ?? []).map((activity: any) => ({
        day: day.dayNumber ?? day.day,
        city: day.city,
        name: activity.name,
        description: activity.description,
      })),
    );
    const response = await callAnthropic({
      model: "claude-haiku-4-5",
      max_tokens: 1800,
      system: `Create a warm, polished trip memory guide. Return JSON only:
{"title":"string","opening":"string","highlights":[{"title":"string","story":"string"}],"byTheNumbers":[{"label":"string","value":"string"}],"closing":"string"}
Use only details supplied by the traveler. Do not invent events. Keep 3-6 highlights and make the writing concise, vivid, and suitable for a keepsake.`,
      messages: [{
        role: "user",
        content: JSON.stringify({
          destination: trip.destination,
          dates: { start: trip.startDate, end: trip.endDate },
          members: Object.values(trip.members).map((member: any) => member.name).filter(Boolean),
          review: {
            rating: memberReview.rating,
            text: memberReview.text,
            vibes: memberReview.vibes,
            highlight: memberReview.highlight,
            photoCount: Array.isArray(memberReview.photos) ? memberReview.photos.length : 0,
          },
          confirmedStay: trip.confirmedAccommodation?.name,
          activities,
        }),
      }],
    });
    if (!(response as unknown as globalThis.Response).ok) {
      throw new Error("AI service did not accept the memory request.");
    }
    const payload = await (response as unknown as globalThis.Response).json() as { content?: Array<{ text?: string }> };
    const parsed = extractAndParseJson(payload.content?.[0]?.text ?? "{}") as any;
    const guide = {
      title: String(parsed.title || `${trip.destination} memories`),
      opening: String(parsed.opening || memberReview.text || ""),
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights.slice(0, 6) : [],
      byTheNumbers: Array.isArray(parsed.byTheNumbers) ? parsed.byTheNumbers.slice(0, 6) : [],
      closing: String(parsed.closing || "Until the next adventure."),
      generatedAt: new Date().toISOString(),
    };
    await db.ref(`trips/${tripId}/memoryGuides/${decoded.uid}`).set(guide);
    if (!trip.memoryGuide) {
      await db.ref(`trips/${tripId}/memoryGuide`).set(guide);
    }
    res.json({ guide });
  } catch (err) {
    req.log.error({ err }, "Failed to generate memory guide");
    res.status(500).json({ error: (err as Error).message || "Could not create the memory guide." });
  }
});

/* ─── Accept trip invite via Admin SDK (bypasses RTDB member-write rules) ─── */
router.post("/accept-invite", async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const idToken = authHeader.slice(7);
  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(idToken);
    const uid = decoded.uid;
    const { notifId, tripId, displayName } = req.body as {
      notifId: string;
      tripId: string;
      displayName: string | null;
    };
    const db = getAdminDb();
    const notificationSnap = await db.ref(`notifications/${uid}/${notifId}`).get();
    const notification = notificationSnap.val() as { type?: string; tripId?: string; status?: string } | null;
    if (
      !notification ||
      notification.type !== "trip_invite" ||
      notification.tripId !== tripId ||
      notification.status !== "pending"
    ) {
      res.status(400).json({ error: "This invite is invalid or has already been used." });
      return;
    }
    const tripSnap = await db.ref(`trips/${tripId}`).get();
    if (!tripSnap.exists() || (tripSnap.val() as { isPack?: boolean }).isPack) {
      res.status(404).json({ error: "This trip is no longer available." });
      return;
    }
    await db.ref(`trips/${tripId}/members/${uid}`).set({
      name: displayName || "Traveler",
      joinedAt: new Date().toISOString(),
      isHost: false,
    });
    try { await db.ref(`userTrips/${uid}/${tripId}`).set(true); } catch {}
    await db.ref(`notifications/${uid}/${notifId}`).update({ status: "accepted" });
    res.json({ ok: true, tripId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || "Failed to accept invite" });
  }
});

/* ─── Join with a short code or a legacy trip-ID link ─── */
router.post("/reserve-invite-code", async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(authHeader.slice(7));
    const { tripId } = req.body as { tripId?: string };
    if (!tripId) {
      res.status(400).json({ error: "tripId is required" });
      return;
    }
    const db = getAdminDb();
    const inviteCode = await reserveHostInviteCode(
      {
        async getTrip(id) {
          const snapshot = await db.ref(`trips/${id}`).get();
          return snapshot.exists() ? snapshot.val() : null;
        },
        async reserveCode(code, id) {
          const reserved = await db
            .ref(`inviteCodes/${code}`)
            .transaction((current) => current ?? id);
          return reserved.committed && reserved.snapshot.val() === id;
        },
        async releaseCode(code, id) {
          await db.ref(`inviteCodes/${code}`).transaction(
            (current) => current === id ? null : undefined,
          );
        },
        async claimTripCode(id, candidate) {
          const result = await db.ref(`trips/${id}/inviteCode`).transaction(
            (current) =>
              typeof current === "string" && current ? current : candidate,
          );
          const canonical = result.snapshot.val();
          if (!result.committed || typeof canonical !== "string" || !canonical) {
            throw new Error("Could not save the trip invite code.");
          }
          return canonical;
        },
        async clearTripCode(id, expectedCode) {
          await db.ref(`trips/${id}/inviteCode`).transaction(
            (current) => current === expectedCode ? null : undefined,
          );
        },
      },
      { tripId, uid: decoded.uid },
    );
    res.json({ inviteCode });
  } catch (err) {
    req.log.error({ err }, "Failed to reserve invite code");
    if (err instanceof InviteCodeReservationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    res.status(500).json({
      error: "Packyo could not reach the invite service. Please try again.",
    });
  }
});

router.post("/join-by-invite", async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Sign in before joining a trip." });
    return;
  }
  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(authHeader.slice(7));
    if (!allowJoinAttempt(decoded.uid)) {
      res.status(429).json({ error: "Too many invite attempts. Wait a few minutes and try again." });
      return;
    }
    const raw = String((req.body as { invite?: string }).invite ?? "")
      .trim()
      .replace(/\s+/g, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
    const candidate = decodeURIComponent(raw.split("/").pop() ?? raw);
    if (!candidate) {
      res.status(400).json({ error: "Enter an invite code or trip link." });
      return;
    }

    const db = getAdminDb();
    const code = candidate.replace(/[^a-z0-9]/gi, "").toUpperCase();
    const indexed = await db.ref(`inviteCodes/${code}`).get();
    let tripId = indexed.exists() && typeof indexed.val() === "string"
      ? indexed.val() as string
      : candidate;
    let tripSnap = await db.ref(`trips/${tripId}`).get();

    // Older trips can predate the inviteCodes index. Search their stored code
    // before treating the input as invalid.
    if (!tripSnap.exists() && code) {
      const legacy = await db.ref("trips").orderByChild("inviteCode").equalTo(code).limitToFirst(1).get();
      if (legacy.exists()) {
        tripId = Object.keys(legacy.val() as Record<string, unknown>)[0];
        tripSnap = await db.ref(`trips/${tripId}`).get();
        await db.ref(`inviteCodes/${code}`).set(tripId);
      }
    }

    const trip = tripSnap.val() as { isPack?: boolean; members?: Record<string, unknown> } | null;
    if (!trip || trip.isPack) {
      res.status(404).json({ error: "We couldn't find that invite. Check the code and try again." });
      return;
    }
    if (!trip.members?.[decoded.uid]) {
      await db.ref(`trips/${tripId}/members/${decoded.uid}`).set({
        name: String((req.body as { displayName?: string }).displayName || "Traveler"),
        joinedAt: new Date().toISOString(),
        isHost: false,
      });
    }
    await db.ref(`userTrips/${decoded.uid}/${tripId}`).set(true);
    res.json({ ok: true, tripId });
  } catch (err) {
    req.log.error({ err }, "Failed to join by invite");
    res.status(500).json({ error: "Packyo couldn't join that trip. Please try again." });
  }
});

/* ─── Send pack invites (server-side, bypasses client RTDB rules) ─── */
router.post("/send-pack-invites", async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const idToken = authHeader.slice(7);
  let fromUid: string;
  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(idToken);
    fromUid = decoded.uid;
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  const { packId, tripId, tripName, fromName, packName } = req.body as {
    packId: string;
    tripId: string;
    tripName: string;
    fromName: string;
    packName: string;
  };

  if (!packId || !tripId) {
    res.status(400).json({ error: "packId and tripId are required" });
    return;
  }

  try {
    const db = getAdminDb();
    const tripSnap = await db.ref(`trips/${tripId}`).get();
    const trip = tripSnap.val() as { members?: Record<string, unknown>; hostMemberId?: string; isPack?: boolean } | null;
    if (!trip || trip.isPack || (!trip.members?.[fromUid] && trip.hostMemberId !== fromUid)) {
      res.status(403).json({ error: "Only trip members can invite a pack." });
      return;
    }
    const packSnap = await db.ref(`trips/${packId}`).get();
    const pack = packSnap.val() as {
      isPack?: boolean;
      members?: Record<string, { name?: string }>;
      hostMemberId?: string;
      name?: string;
    } | null;
    if (!pack?.isPack || (!pack.members?.[fromUid] && pack.hostMemberId !== fromUid)) {
      res.status(403).json({ error: "You are not allowed to invite this pack." });
      return;
    }
    const members = Object.entries(pack.members ?? {})
      .filter(([uid]) => uid !== fromUid)
      .map(([uid, member]) => ({ uid, name: member.name ?? "Traveler" }));
    if (members.length === 0) {
      res.json({ ok: true, sent: 0 });
      return;
    }
    await Promise.all(
      members.map(m =>
        db.ref(`notifications/${m.uid}`).push({
          type: "trip_invite",
          tripId,
          tripName: tripName || "a trip",
          fromName: fromName || "Someone",
          fromUid,
          packName: pack.name || packName || "a pack",
          createdAt: Date.now(),
          status: "pending",
        })
      )
    );
    res.json({ ok: true, sent: members.length });
  } catch (err) {
    req.log.error({ err }, "Failed to send pack invites");
    res.status(500).json({ error: (err as Error).message || "Failed to send invites" });
  }
});

// ── MultiMind Math: AI approach suggestion ─────────────────────────────────
router.post("/ai/multimind/suggest", async (req, res) => {
  const { question, mascot, personality } = req.body as {
    question: string;
    mascot: string;
    personality: string;
  };

  if (!question || !mascot) {
    res.status(400).json({ error: "question and mascot are required" });
    return;
  }

  const systemPrompt = `You are a math learning assistant for children ages 5–10. Your job is to suggest the BEST learning approach for a child given their math problem and their chosen guide character's personality.

The child's guide is **${mascot}** who is described as: "${personality}".

Available learning approaches (pick exactly one as the primary recommendation):
1. Get the idea
2. Follow the steps
3. See a picture
4. Explain in words
5. Do it hands-on
6. Real-world example
7. Spot the pattern
8. Teach a friend
9. Play a game

Personality → approach guidelines:
- Ziggy (Curious & Encouraging): Loves visual discovery → prefer "See a picture" or "Spot the pattern"
- Pip (Calm & Patient): Methodical and thorough → prefer "Follow the steps" or "Explain in words"
- Nova (Energetic & Fun): High energy, competitive → prefer "Play a game" or "Do it hands-on"
- Bramble (Thoughtful & Wise): Deep thinker → prefer "Spot the pattern" or "Real-world example"
- Echo (Logical & Clear): Precise and structured → prefer "Follow the steps" or "Get the idea"
- Luna (Kind & Cheerful): Gentle encourager → prefer "See a picture" or "Teach a friend"

Question type → approach guidelines:
- Addition / subtraction: "See a picture" (number line) works great
- Multiplication: "Spot the pattern" or "Real-world example"
- Division: "Follow the steps" or "Do it hands-on"
- Fractions: "See a picture" (pie chart) or "Real-world example"
- Word problems: "Real-world example" or "Explain in words"
- Large numbers: "Follow the steps" or "Get the idea"

Always give the response in this exact JSON format (no markdown, no code fences):
{
  "approach": "<one of the 9 approach names above, exact match>",
  "reason": "<one sentence explaining why this approach fits both the question type AND ${mascot}'s personality>",
  "mascotMessage": "<a short encouraging message in ${mascot}'s voice, 1-2 sentences, warm and child-friendly>",
  "tips": ["<actionable tip 1>", "<actionable tip 2>", "<actionable tip 3>"]
}`;

  try {
    const response = await callAnthropic({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: `Math question: "${question}"` }],
    });

    if (!(response as unknown as globalThis.Response).ok) {
      const text = await (response as unknown as globalThis.Response).text();
      req.log.error({ text }, "Anthropic error for multimind suggest");
      res.status(502).json({ error: "AI service error" });
      return;
    }

    const data = await (response as unknown as globalThis.Response).json() as { content: Array<{ text: string }> };
    const rawText = data.content[0]?.text ?? "{}";
    const parsed = extractAndParseJson(rawText) as {
      approach: string;
      reason: string;
      mascotMessage: string;
      tips: string[];
    };

    res.json(parsed);
  } catch (err) {
    req.log.error({ err }, "multimind/suggest failed");
    res.status(500).json({ error: (err as Error).message ?? "Unknown error" });
  }
});

export default router;
