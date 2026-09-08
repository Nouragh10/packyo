import { jsonrepair } from "jsonrepair";

export type ItineraryActivity = {
  name: string;
  tag: string;
  [key: string]: unknown;
};

export type ItineraryDay = {
  activities: ItineraryActivity[];
  [key: string]: unknown;
};

export type ItineraryShape = {
  days: ItineraryDay[];
  [key: string]: unknown;
};

export class ItineraryResponseError extends Error {
  readonly code = "INVALID_ITINERARY_RESPONSE";
  readonly recoverable = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ItineraryResponseError";
  }
}

export class AccommodationResponseError extends Error {
  readonly code = "INVALID_ACCOMMODATION_RESPONSE";
  readonly recoverable = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AccommodationResponseError";
  }
}

type ParseOptions = {
  expectedDays?: number;
  activitiesPerDay?: number;
  guaranteedWishes?: Array<{ id?: string; text: string }>;
};

function stripMarkdownFence(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

/**
 * Finds JSON-shaped portions without assuming the model returned only JSON.
 * Incomplete candidates are intentionally included so jsonrepair can close a
 * response cut off by a token limit.
 */
function findJsonCandidates(text: string): string[] {
  const stripped = stripMarkdownFence(text);
  const candidates: string[] = [stripped];
  const seen = new Set(candidates);

  // Anthropic assistant prefill can mean the response starts after the
  // opening brace: `"title": "...", "days": [...]}`. Add this before
  // scanning nested activity objects so the generic parser preserves the
  // complete top-level response as its first candidate.
  if (/^\s*"/.test(stripped)) {
    const prefixed = `{${stripped}`;
    if (!seen.has(prefixed)) {
      candidates.push(prefixed);
      seen.add(prefixed);
    }
  }

  for (let start = 0; start < stripped.length; start++) {
    if (stripped[start] !== "{" && stripped[start] !== "[") continue;

    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    let closed = false;

    for (let index = start; index < stripped.length; index++) {
      const char = stripped[index];

      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === "{" || char === "[") {
        stack.push(char);
      } else if (char === "}" || char === "]") {
        const expected = stack[stack.length - 1] === "{" ? "}" : "]";
        if (char !== expected) break;
        stack.pop();
        if (stack.length === 0) {
          const candidate = stripped.slice(start, index + 1);
          if (!seen.has(candidate)) {
            candidates.push(candidate);
            seen.add(candidate);
          }
          closed = true;
          break;
        }
      }
    }

    // A response can be cut off before its closing braces arrive. Keep the
    // outermost partial object for jsonrepair instead of discarding it.
    if (!closed && stack.length > 0) {
      const candidate = stripped.slice(start);
      if (!seen.has(candidate)) {
        candidates.push(candidate);
        seen.add(candidate);
      }
    }
  }

  return candidates;
}

export function extractAndParseJson(text: string): unknown {
  const parsed = parseJsonCandidates(text);
  return parsed[0];
}

function parseJsonCandidates(text: string): unknown[] {
  const parsed: unknown[] = [];
  let lastError: unknown;

  for (const candidate of findJsonCandidates(text)) {
    try {
      parsed.push(JSON.parse(candidate));
      continue;
    } catch (parseError) {
      lastError = parseError;
    }

    try {
      parsed.push(JSON.parse(jsonrepair(candidate)));
    } catch (repairError) {
      lastError = repairError;
    }
  }

  if (parsed.length === 0) {
    throw new ItineraryResponseError(
      "The AI returned malformed or incomplete itinerary data.",
      { cause: lastError },
    );
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateItineraryShape(
  value: unknown,
  { expectedDays, activitiesPerDay, guaranteedWishes }: ParseOptions,
): value is ItineraryShape {
  if (!isRecord(value)) return false;
  if (typeof value.title !== "string" || value.title.trim().length === 0) return false;
  if (!Array.isArray(value.days) || value.days.length === 0) return false;
  if (expectedDays !== undefined && value.days.length !== expectedDays) return false;

  const daysAreValid = value.days.every((day, dayIndex) => {
    if (!isRecord(day)) return false;
    if (typeof day.dayNumber !== "number" || day.dayNumber !== dayIndex + 1) return false;
    if (typeof day.city !== "string" || day.city.trim().length === 0) return false;
    if (typeof day.theme !== "string" || day.theme.trim().length === 0) return false;
    if (!Array.isArray(day.activities) || day.activities.length === 0) return false;
    // The requested pace is the normal minimum. The itinerary prompt permits
    // additional activities when retaining every guaranteed group wish would
    // otherwise exceed the normal trip capacity.
    if (activitiesPerDay !== undefined && day.activities.length < activitiesPerDay) return false;

    return day.activities.every((activity) => (
      isRecord(activity) &&
      typeof activity.name === "string" &&
      activity.name.trim().length > 0 &&
      typeof activity.tag === "string" &&
      activity.tag.trim().length > 0
    ));
  });

  if (!daysAreValid) return false;

  if (guaranteedWishes !== undefined && !hasDistinctGuaranteedWishActivities(value as ItineraryShape, guaranteedWishes)) {
    return false;
  }

  return true;
}

function normalizedWishText(value: string): string {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function wishTextMatchesActivity(wishText: string, activity: ItineraryActivity): boolean {
  const wish = normalizedWishText(wishText);
  const activityText = [activity.name, activity.wishText, activity.description]
    .filter((value): value is string => typeof value === "string")
    .map(normalizedWishText)
    .join(" ");
  if (!wish || !activityText) return false;
  if (activityText.includes(wish) || wish.includes(normalizedWishText(activity.name))) return true;

  // Permit a useful adaptation such as "visit the Louvre" → "Louvre Museum",
  // while avoiding a match based solely on generic words such as "visit".
  const ignored = new Set(["the", "and", "for", "with", "visit", "going", "go", "see", "try", "at", "in", "to"]);
  const wishTokens = [...new Set(wish.split(" ").filter((token) => token.length > 2 && !ignored.has(token)))];
  const activityTokens = new Set(activityText.split(" "));
  return wishTokens.length > 0 && wishTokens.every((token) => activityTokens.has(token));
}

function hasDistinctGuaranteedWishActivities(
  itinerary: ItineraryShape,
  guaranteedWishes: Array<{ id?: string; text: string }>,
): boolean {
  const wishActivities = itinerary.days.flatMap((day) => day.activities)
    .filter((activity) => activity.fromWish === true);
  if (wishActivities.length < guaranteedWishes.length) return false;

  const matches = guaranteedWishes.map((wish) => wishActivities.map((activity, index) => {
    const activityWishId = typeof activity.wishId === "string"
      ? activity.wishId
      : typeof activity.sourceWishId === "string" ? activity.sourceWishId : undefined;
    return (wish.id !== undefined && activityWishId === wish.id) ||
      (activityWishId === undefined && wishTextMatchesActivity(wish.text, activity))
      ? index
      : -1;
  }).filter((index) => index !== -1));

  // Find a one-to-one assignment. This prevents one returned activity from
  // satisfying two identical or similarly worded guaranteed wishes.
  const assigned = new Set<number>();
  const assign = (wishIndex: number): boolean => {
    if (wishIndex === matches.length) return true;
    for (const activityIndex of matches[wishIndex] ?? []) {
      if (assigned.has(activityIndex)) continue;
      assigned.add(activityIndex);
      if (assign(wishIndex + 1)) return true;
      assigned.delete(activityIndex);
    }
    return false;
  };
  return assign(0);
}

export function isItineraryShape(value: unknown): value is ItineraryShape {
  return validateItineraryShape(value, {});
}

export function parseItineraryResponse(
  text: string,
  options: ParseOptions = {},
): ItineraryShape {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new ItineraryResponseError("The AI returned an empty itinerary response.");
  }

  for (const parsed of parseJsonCandidates(text)) {
    if (validateItineraryShape(parsed, options)) return parsed;
  }

  const expected = options.expectedDays === undefined
    ? "the requested itinerary"
    : `${options.expectedDays} day${options.expectedDays === 1 ? "" : "s"} with at least ${options.activitiesPerDay ?? "the requested number of"} activities per day`;
  throw new ItineraryResponseError(
    `The AI returned an incomplete itinerary. Expected ${expected}.`,
  );
}

export type AccommodationSuggestion = {
  id: string;
  name: string;
  type: "hotel" | "airbnb" | "hostel" | "other";
  location: string;
  totalCost: number;
  costPerPerson: number;
  nights: number;
  rating: number;
  amenities: string[];
  rooms: number;
  beds: number;
  cancellation: string;
  whyItFits: string;
  tags: string[];
  distanceNote: string;
  submittedBy: string;
};

export type AccommodationSuggestionsResponse = {
  suggestions: AccommodationSuggestion[];
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function accommodationNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function accommodationPositiveInteger(value: unknown, fallback = 1): number {
  return Math.max(1, Math.round(accommodationNumber(value, fallback)));
}

function accommodationStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(isNonEmptyString).map((item) => item.trim())
    : [];
}

function normalizeAccommodationSuggestions(value: unknown): AccommodationSuggestionsResponse | null {
  if (!isRecord(value) || !Array.isArray(value.suggestions)) return null;

  const names = new Set<string>();
  const normalized: AccommodationSuggestion[] = [];
  for (const rawSuggestion of value.suggestions) {
    if (!isRecord(rawSuggestion) || !isNonEmptyString(rawSuggestion.name)) continue;

    const name = rawSuggestion.name.trim();
    const nameKey = name.toLowerCase();
    if (names.has(nameKey)) continue;
    names.add(nameKey);

    const rawType = isNonEmptyString(rawSuggestion.type)
      ? rawSuggestion.type.trim().toLowerCase()
      : "other";
    const type: AccommodationSuggestion["type"] =
      rawType === "hotel" || rawType === "airbnb" || rawType === "hostel"
        ? rawType
        : rawType.includes("rental") || rawType.includes("apartment")
          ? "airbnb"
          : "other";

    normalized.push({
      id: `opt-${normalized.length + 1}`,
      name,
      type,
      location: isNonEmptyString(rawSuggestion.location)
        ? rawSuggestion.location.trim()
        : "Central area",
      totalCost: accommodationNumber(rawSuggestion.totalCost),
      costPerPerson: accommodationNumber(rawSuggestion.costPerPerson),
      nights: accommodationPositiveInteger(rawSuggestion.nights),
      rating: accommodationNumber(rawSuggestion.rating),
      amenities: accommodationStrings(rawSuggestion.amenities),
      rooms: accommodationPositiveInteger(rawSuggestion.rooms),
      beds: accommodationPositiveInteger(rawSuggestion.beds),
      cancellation: isNonEmptyString(rawSuggestion.cancellation)
        ? rawSuggestion.cancellation.trim()
        : "Check property policy",
      whyItFits: isNonEmptyString(rawSuggestion.whyItFits)
        ? rawSuggestion.whyItFits.trim()
        : "A practical option for the group.",
      tags: accommodationStrings(rawSuggestion.tags),
      distanceNote: isNonEmptyString(rawSuggestion.distanceNote)
        ? rawSuggestion.distanceNote.trim()
        : "Check the listing for location details.",
      submittedBy: "AI",
    });

    if (normalized.length === 3) break;
  }

  return normalized.length === 3 ? { suggestions: normalized } : null;
}

export function parseAccommodationSuggestionsResponse(text: string): AccommodationSuggestionsResponse {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new AccommodationResponseError("The AI returned an empty accommodation suggestions response.");
  }

  try {
    for (const parsed of parseJsonCandidates(text)) {
      const normalized = normalizeAccommodationSuggestions(parsed);
      if (normalized) return normalized;
    }
  } catch (error) {
    throw new AccommodationResponseError(
      "The AI returned malformed accommodation suggestions.",
      { cause: error },
    );
  }

  throw new AccommodationResponseError(
    "The AI returned incomplete accommodation suggestions. Expected three distinct, complete accommodation options.",
  );
}