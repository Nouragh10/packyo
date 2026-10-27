/**
 * Shared semantic classifier for itinerary activities.
 *
 * The venue name is the strongest signal ("British Museum" is Culture no matter
 * what the trip vibe was), then the description. Generic trip vibes such as
 * "Relaxing" are only kept when neither text gives a confident answer.
 */

type Rule = { category: string; pattern: RegExp };

const RULES: Rule[] = [
  { category: "Culture", pattern: /\b(museum|museo|musee|gallery|galleria|art centre|art center|exhibition|cathedral|basilica|church|temple|shrine|mosque|synagogue|palace|castle|fort|fortress|abbey|monastery|ruins|heritage|historic|history|monument|memorial|opera|theatre|theater|library|archaeolog\w*|colosseum|acropolis)\b/ },
  { category: "Food", pattern: /\b(restaurant|cafe|caf\u00e9|coffee|bakery|brunch|breakfast|lunch|dinner|food|tasting|street food|food hall|market hall|cooking class|cookery|bistro|trattoria|tavern|izakaya|ramen|sushi|tapas|pizzeria|brewery|winery|vineyard|distillery)\b/ },
  { category: "Nightlife", pattern: /\b(bar|pub|club|nightclub|cocktail|rooftop bar|speakeasy|live music|jazz|karaoke|nightlife)\b/ },
  { category: "Wellness", pattern: /\b(spa|massage|hammam|onsen|bathhouse|sauna|thermal bath|hot spring|yoga|wellness|retreat)\b/ },
  { category: "Beach", pattern: /\b(beach|bay|cove|surf|surfing|snorkel\w*|scuba|diving|lagoon|seaside|coast)\b/ },
  { category: "Adventure", pattern: /\b(hike|hiking|trek|trekking|climb|climbing|zipline|zip line|kayak\w*|canoe|rafting|paraglid\w*|bungee|quad|atv|via ferrata|canyoning)\b/ },
  { category: "Nature", pattern: /\b(park|garden|gardens|botanic\w*|forest|lake|river walk|waterfall|mountain|valley|national park|nature reserve|zoo|aquarium|wildlife)\b/ },
  { category: "Shopping", pattern: /\b(market|bazaar|souk|shopping|boutique|mall|flea market|department store|arcade)\b/ },
  { category: "Sightseeing", pattern: /\b(tour|walking tour|viewpoint|lookout|observation deck|tower|bridge|square|plaza|harbour|harbor|cruise|boat ride|landmark|old town)\b/ },
  { category: "Relaxing", pattern: /\b(relax\w*|unwind|lounge|chill|slow afternoon|picnic|sunbathe|leisurely)\b/ },
];

function matchText(text: string): string | null {
  const lower = text.toLowerCase();
  if (!lower.trim()) return null;
  for (const rule of RULES) {
    if (rule.pattern.test(lower)) return rule.category;
  }
  return null;
}

function titleCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

/** Returns a display category. Unknown activities keep their existing (cleaned) category. */
export function classifyActivity(input: {
  name?: string | null;
  description?: string | null;
  fallback?: string | null;
}): string {
  return (
    matchText(input.name ?? "") ??
    matchText(input.description ?? "") ??
    (titleCase(input.fallback ?? "") || "Activity")
  );
}

/* ── Destination + key helpers ────────────────────────────────────── */

const REGION_ALIASES: Record<string, string> = {
  uk: "united kingdom", "u k": "united kingdom", "great britain": "united kingdom", britain: "united kingdom",
  england: "united kingdom", scotland: "united kingdom", wales: "united kingdom", gb: "united kingdom",
  us: "united states", usa: "united states", "u s": "united states", "u s a": "united states",
  "united states of america": "united states", america: "united states",
  uae: "united arab emirates", "the netherlands": "netherlands", holland: "netherlands",
  "czechia": "czech republic", "south korea": "korea", "republic of korea": "korea",
};

function normalizePart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Splits "Paris, Île-de-France, France" into city + normalised region set. Works for any script. */
export function parseDestination(destination: string | null | undefined): { city: string; regions: string[] } {
  const parts = String(destination ?? "").split(/[,\uFF0C\u3001]/).map(normalizePart).filter(Boolean);
  const [city = "", ...rest] = parts;
  return { city, regions: rest.map((r) => REGION_ALIASES[r] ?? r) };
}

/** City key only ("Paris, France" -> "paris", "東京" -> "東京"). */
export function normalizeCity(destination: string | null | undefined): string {
  return parseDestination(destination).city;
}

/**
 * Exact city match. If both sides carry a country/region suffix, at least one
 * must agree (so Paris, France != Paris, Texas). A city-only side is tolerated.
 */
export function sameCity(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = parseDestination(a);
  const pb = parseDestination(b);
  if (!pa.city || pa.city !== pb.city) return false;
  if (pa.regions.length === 0 || pb.regions.length === 0) return true;
  return pa.regions.some((r) => pb.regions.includes(r));
}

/** Firebase-safe deterministic key segment; keeps letters/digits of any script. */
export function keySegment(value: string | number): string {
  const cleaned = String(value)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned) return Array.from(cleaned).slice(0, 60).join("");
  // Fallback for symbol-only input: stable hash rather than a shared constant.
  let h = 5381;
  for (const ch of String(value)) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0;
  return `h${h.toString(36)}`;
}
