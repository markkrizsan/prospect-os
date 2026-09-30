/**
 * Apps Script ContentService sends JSON via a 302 to script.googleusercontent.com.
 * A reported Google issue can make the signed content URL transiently 404 even
 * after doPost() successfully executes. Never retry the original mutation.
 */
export async function fetchAppsScriptResponse(
  target: URL,
  init: RequestInit,
  fetcher: typeof fetch = fetch,
  pause: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<Response> {
  const response = await fetcher(target, { ...init, redirect: "manual", cache: "no-store" });
  if (![301, 302, 303, 307, 308].includes(response.status)) return response;

  // ContentService may return another signed ContentService URL before JSON.
  // Follow ONLY the approved Google content endpoint. Never replay the original
  // POST, never forward its body/credentials to the signed response URL, and
  // never follow a redirect to a login or unrelated Google host.
  const signedContentUrl = (location: string | null, base: URL): URL => {
    if (!location) {
      throw new Error("Apps Script response redirected without a Location header; check the deployed web app.");
    }
    let next: URL;
    try { next = new URL(location, base); } catch {
      throw new Error("Apps Script returned an invalid ContentService redirect.");
    }
    if (next.protocol !== "https:" ||
        next.hostname !== "script.googleusercontent.com" ||
        !next.pathname.startsWith("/macros/")) {
      throw new Error(
        "Apps Script redirected to an unexpected destination. Verify deployment access (Execute as: Me; Who has access: Anyone) and the current /exec URL.",
      );
    }
    return next;
  };
  let contentUrl = signedContentUrl(response.headers.get("location"), target);
  for (let hop = 0; hop < 3; hop += 1) {
    // A signed response can transiently 404. Retry GET at the SAME URL; a
    // mutation may already have committed, so the original request is sacred.
    let content = await fetcher(contentUrl, { method: "GET", redirect: "manual", cache: "no-store", signal: init.signal });
    for (const delay of [1800, 2500]) {
      if (content.status !== 404) break;
      await pause(delay);
      content = await fetcher(contentUrl, { method: "GET", redirect: "manual", cache: "no-store", signal: init.signal });
    }
    if (content.status === 404) {
      throw new Error(
        "Google ContentService's redirected response remained HTTP 404. The Apps Script operation MAY have completed. Refresh the live Sheet before trying again; the original mutation was not retried.",
      );
    }
    if (![301, 302, 303, 307, 308].includes(content.status)) return content;
    contentUrl = signedContentUrl(content.headers.get("location"), contentUrl);
  }
  throw new Error("Apps Script exceeded the allowed signed ContentService redirect limit; check the active web-app deployment.");
}

const RETRYABLE_READ_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function retryableReadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|network|timeout|timed out|abort|operation MAY have completed/i.test(message);
}

/**
 * Dashboard reads are idempotent, so transient upstream failures may safely replay the
 * original GET. Mutations continue to use fetchAppsScriptResponse directly and are
 * never replayed.
 */
export async function fetchAppsScriptReadResponse(
  target: URL,
  init: RequestInit = { method: "GET" },
  fetcher: typeof fetch = fetch,
  pause: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  attempts = 2,
): Promise<Response> {
  if ((init.method ?? "GET").toUpperCase() !== "GET") {
    throw new Error("Read retry transport accepts GET only; mutations must never be replayed.");
  }
  let lastError: unknown = null;
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const attemptInit: RequestInit = {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(8_000),
    };
    try {
      const response = await fetchAppsScriptResponse(target, attemptInit, fetcher, pause);
      lastResponse = response;
      if (!RETRYABLE_READ_STATUS.has(response.status) || attempt === attempts - 1) return response;
    } catch (error) {
      lastError = error;
      if (!retryableReadError(error) || attempt === attempts - 1) throw error;
    }
    await pause(250);
  }
  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error("Apps Script read failed after retries.");
}

export function assertAppsScriptUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch {
    throw new Error("PROSPECT_API_URL is not a valid deployed Apps Script web-app URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "script.google.com" ||
    !/^\/(?:a\/[^/]+\/)?macros\/s\/[^/]+\/exec\/?$/.test(url.pathname) ||
    url.search || url.hash
  ) {
    throw new Error(
      "PROSPECT_API_URL must contain the exact current Google Apps Script web-app /exec URL, with no query parameters, /dev path, account-switching /u/N path, or editor URL.",
    );
  }
  return url;
}
