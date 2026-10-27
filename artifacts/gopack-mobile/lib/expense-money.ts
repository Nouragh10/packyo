/**
 * Precise money helpers. All amounts are integer minor units (cents, yen, fils).
 * Parsing works on decimal strings so no floating-point math touches stored values.
 */

const ZERO_DECIMAL = new Set(["JPY", "KRW", "CLP", "VND", "ISK", "UGX", "XAF", "XOF", "PYG", "RWF", "KMF", "GNF", "VUV", "XPF", "DJF", "BIF"]);
const THREE_DECIMAL = new Set(["BHD", "KWD", "OMR", "JOD", "TND", "IQD", "LYD"]);

export const COMMON_CURRENCIES = [
  "USD", "EUR", "GBP", "JPY", "KRW", "AUD", "CAD", "CHF", "MXN", "SGD",
  "AED", "SAR", "BHD", "KWD", "INR", "THB", "IDR", "CLP", "BRL", "ZAR",
];

export function isValidCurrencyCode(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

const FOUR_DECIMAL = new Set(["CLF", "UYW"]);
const digitCache = new Map<string, number>();

export function currencyDigits(currency: string): number {
  const code = currency.toUpperCase();
  const cached = digitCache.get(code);
  if (cached !== undefined) return cached;
  let digits: number;
  if (FOUR_DECIMAL.has(code)) digits = 4;
  else if (ZERO_DECIMAL.has(code)) digits = 0;
  else if (THREE_DECIMAL.has(code)) digits = 3;
  else {
    try {
      digits = new Intl.NumberFormat("en-US", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      digits = 2;
    }
  }
  digitCache.set(code, digits);
  return digits;
}

export type MoneyParseResult = { ok: true; minor: number } | { ok: false; error: string };

export function parseMoneyInput(raw: string, currency: string): MoneyParseResult {
  const digits = currencyDigits(currency);
  const s = raw.trim().replace(/[\s,]/g, "");
  if (!s) return { ok: false, error: "Enter an amount." };
  if (!/^\d+(\.\d*)?$/.test(s) && !/^\.\d+$/.test(s)) {
    return { ok: false, error: "Use numbers only, like 24.50." };
  }
  const [intPartRaw, fracRaw = ""] = s.split(".");
  const intPart = intPartRaw || "0";
  if (fracRaw.length > digits) {
    return {
      ok: false,
      error: digits === 0
        ? `${currency} has no decimal places.`
        : `${currency} allows up to ${digits} decimal places.`,
    };
  }
  const minorStr = (intPart + fracRaw.padEnd(digits, "0")).replace(/^0+(?=\d)/, "");
  const minor = Number(minorStr);
  if (!Number.isSafeInteger(minor)) return { ok: false, error: "That amount is too large." };
  return { ok: true, minor };
}

/** Converts minor units back to an editable decimal string without float math. */
export function minorToInput(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  const negative = minor < 0;
  const abs = String(Math.abs(Math.trunc(minor)));
  if (digits === 0) return (negative ? "-" : "") + abs;
  const padded = abs.padStart(digits + 1, "0");
  const int = padded.slice(0, -digits);
  const frac = padded.slice(-digits);
  return `${negative ? "-" : ""}${int}.${frac}`;
}

export function formatMoney(minor: number, currency: string, opts?: { signed?: boolean }): string {
  const digits = currencyDigits(currency);
  const value = Number(minorToInput(Math.abs(minor), currency));
  let body: string;
  try {
    body = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    body = `${currency} ${minorToInput(Math.abs(minor), currency)}`;
  }
  if (minor < 0) return `-${body}`;
  if (opts?.signed && minor > 0) return `+${body}`;
  return body;
}

export function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (y < 1900 || m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function formatShortDate(value: string | undefined | null): string {
  if (!value) return "";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
