import { Router, type IRouter } from "express";
import { placeDetails, searchPlaces } from "../lib/places";
import { validSession } from "../lib/google-places";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Light per-IP limit: the app debounces typing, so 60 lookups a minute is plenty.
const hits = new Map<string, { windowStart: number; count: number }>();
function allow(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.windowStart > 60_000) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  h.count++;
  return h.count <= 60;
}

// Destination autocomplete: countries, regions, cities and towns worldwide.
router.get("/places/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) { res.json({ places: [] }); return; }
  // Behind Replit's proxy every request shares one socket IP, so key on the client's.
  const client = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.ip || "unknown";
  if (!allow(client)) { res.status(429).json({ error: "Too many searches. Try again in a minute." }); return; }
  try {
    res.set("Cache-Control", "public, max-age=3600");
    res.json({ places: await searchPlaces(q, fetch, 8, validSession(req.query.session)) });
  } catch (err) {
    logger.warn({ err }, "place search failed");
    res.status(502).json({ error: "Place search is unavailable right now." });
  }
});

// Coordinates and area for a suggestion the user picked (Google suggestions
// come without them). Same session token as the search, so it's billed once.
router.get("/places/details", async (req, res) => {
  const id = String(req.query.id ?? "");
  if (!id) { res.status(400).json({ error: "Missing place." }); return; }
  try {
    const place = await placeDetails(id, validSession(req.query.session));
    if (!place) { res.status(404).json({ error: "Couldn't find that place. Try another." }); return; }
    res.set("Cache-Control", "public, max-age=86400");
    res.json({ place });
  } catch (err) {
    logger.warn({ err }, "place details failed");
    res.status(502).json({ error: "Place search is unavailable right now." });
  }
});

export default router;
