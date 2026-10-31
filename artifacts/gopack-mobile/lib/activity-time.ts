/** Legacy saved activities can contain numeric or missing times. Never guess AM/PM. */
export function activityTimeLabel(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || /^\d+(?:\.\d+)?$/.test(value.trim())) return "Flexible time";
  return value.trim();
}

export function parseActivityTime(value: unknown): { h: number; m: number } | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2]);
  const period = match[3]?.toUpperCase();
  if (m > 59 || h > (period ? 12 : 23) || (period && h < 1)) return null;
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return { h, m };
}
