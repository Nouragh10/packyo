export const ITINERARY_TOOL = "submit_itinerary";

/** A forced tool response avoids prose, truncated JSON repair and missing days. */
export function itineraryTool(days: number, activitiesPerDay: number) {
  return {
    name: ITINERARY_TOOL,
    description: "Submit the complete trip plan. Include every requested day, the requested pace, and every guaranteed wish.",
    input_schema: {
      type: "object",
      required: ["title", "days"],
      properties: {
        title: { type: "string" },
        conflicts: { type: "array", items: { type: "string" } },
        days: {
          type: "array", minItems: days, maxItems: days,
          items: {
            type: "object",
            required: ["dayNumber", "city", "theme", "activities"],
            properties: {
              dayNumber: { type: "integer", minimum: 1, maximum: days },
              city: { type: "string" },
              theme: { type: "string" },
              activities: {
                type: "array", minItems: activitiesPerDay,
                items: {
                  type: "object",
                  required: ["time", "name", "description", "tag", "fromWish", "suggester", "estimatedCost"],
                  properties: {
                    time: { type: "string" },
                    name: { type: "string" },
                    description: { type: "string", description: "One practical tip in at most 12 words." },
                    tag: { type: "string" },
                    fromWish: { type: "boolean" },
                    wishId: { type: "string", description: "Exact stable ID of the source guaranteed wish, when provided." },
                    wishText: { type: "string" },
                    suggester: { type: "string" },
                    matchedVibe: { type: "string" },
                estimatedCost: { type: ["number", "null"] },
                    labels: { type: "array", items: { type: "string" } },
                    nearPrevious: { type: "boolean" },
                    photoQuery: { type: "string" },
                    lat: { type: "number" },
                    lng: { type: "number" },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

export type ItineraryAiResponse = {
  content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  error?: { message: string };
  stop_reason?: string;
};

export function itineraryResponseText(data: ItineraryAiResponse): string {
  const tool = data.content?.find((block) => block.type === "tool_use" && block.name === ITINERARY_TOOL);
  if (tool) return JSON.stringify(tool.input) ?? "";
  // Keep legacy/mock responses and old model output readable.
  return (data.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
}
