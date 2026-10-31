import { Platform } from "react-native";
import { fetchWithTimeout } from "./timed-fetch";

let _baseUrl: string | null = null;

function normalizeBaseUrl(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

export function setBaseUrl(url: string | null): void {
  _baseUrl = normalizeBaseUrl(url);
}

export function getBaseUrl(): string | null {
  return _baseUrl;
}

export function getConfiguredApiBaseUrl(): string | null {
  return normalizeBaseUrl(process.env.EXPO_PUBLIC_DOMAIN);
}

export function getApiBaseUrl(): string {
  if (Platform.OS === "web") return "";

  const baseUrl = _baseUrl ?? getConfiguredApiBaseUrl();
  if (!baseUrl) {
    throw new Error(
      "This app build is missing the Packyo API address. Please update to the latest version and try again.",
    );
  }

  return baseUrl;
}

export function apiFetch(path: string, init?: RequestInit, timeoutMs?: number): Promise<Response> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${getApiBaseUrl()}${normalizedPath}`;
  return timeoutMs === undefined ? fetch(url, init) : fetchWithTimeout(url, init, timeoutMs);
}
