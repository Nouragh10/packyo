const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function dateOnlyToUtcMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return timestamp;
}

export function getInclusiveDateRangeDays(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): number | null {
  const start = dateOnlyToUtcMs(startDate);
  const end = dateOnlyToUtcMs(endDate);
  if (start === null || end === null || end < start) return null;
  return Math.floor((end - start) / DAY_MS) + 1;
}

export function resolveTripDays(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  storedDays: number | null | undefined,
  fallbackDays = 1,
): number {
  const rangeDays = getInclusiveDateRangeDays(startDate, endDate);
  if (rangeDays !== null) return rangeDays;

  const normalizedStoredDays = Math.floor(Number(storedDays));
  if (Number.isFinite(normalizedStoredDays) && normalizedStoredDays > 0) {
    return normalizedStoredDays;
  }

  return Math.max(1, Math.floor(fallbackDays) || 1);
}