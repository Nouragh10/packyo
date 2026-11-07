import { setTimeout as wait } from "node:timers/promises";
import { logger } from "./logger";

export async function callAnthropic(
  body: object,
  retries = 3,
  extraHeaders: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<Response> {
  const baseUrl = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("AI generation is not configured. Please try again shortly.");
  for (let attempt = 0; attempt < retries; attempt++) {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", ...extraHeaders },
      body: JSON.stringify(body),
      signal,
    });
    if (response.status !== 429) return response;
    if (attempt + 1 < retries) {
      logger.warn({ attempt: attempt + 1 }, "AI provider rate limited; retrying");
      await wait((attempt + 1) * 8000, undefined, { signal });
    }
  }
  throw new Error("Rate limit exceeded. Please try again in a minute.");
}
