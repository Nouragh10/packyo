/**
 * React Native's fetch does not expose the native request timeout. Use XHR for
 * slow JSON requests so iOS gets an explicit timeout instead of its default.
 */
export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 180_000,
  makeRequest: () => XMLHttpRequest = () => new XMLHttpRequest(),
): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (init.body != null && typeof init.body !== "string") {
      reject(new Error("This request requires a JSON string body."));
      return;
    }
    const request = makeRequest();
    const cleanup = () => init.signal?.removeEventListener("abort", abort);
    const fail = (message: string) => {
      cleanup();
      reject(new Error(message));
    };
    const abort = () => {
      request.abort();
      fail("Planning was cancelled. Your wishes are still saved.");
    };
    if (init.signal?.aborted) {
      fail("Planning was cancelled. Your wishes are still saved.");
      return;
    }
    request.open(init.method ?? "GET", url, true);
    request.timeout = timeoutMs;
    request.withCredentials = init.credentials === "include";
    new Headers(init.headers).forEach((value, key) => request.setRequestHeader(key, value));
    request.onload = () => {
      cleanup();
      if (request.status === 0) {
        fail("Connection to Packyo was interrupted. Your wishes are still saved. Please try again.");
        return;
      }
      const headers = new Headers();
      for (const line of request.getAllResponseHeaders().split(/\r?\n/)) {
        const colon = line.indexOf(":");
        if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
      }
      resolve(new Response(request.responseText, { status: request.status, headers }));
    };
    request.onerror = () => fail("Connection to Packyo was interrupted. Your wishes are still saved. Please try again.");
    request.ontimeout = () => fail("Planning is taking longer than expected. Your wishes are still saved. Please try again.");
    request.onabort = () => fail("Planning was cancelled. Your wishes are still saved.");
    init.signal?.addEventListener("abort", abort, { once: true });
    request.send(init.body ?? null);
  });
}
