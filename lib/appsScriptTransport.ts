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

  const location = response.headers.get("location");
  if (!location) {
    throw new Error("Apps Script returned a redirect without a Location header; verify the web app deployment.");
  }
  const contentUrl = new URL(location, target);
  if (
    contentUrl.protocol !== "https:" ||
    contentUrl.hostname !== "script.googleusercontent.com" ||
    !contentUrl.pathname.startsWith("/macros/")
  ) {
    throw new Error(
      "Apps Script redirected to an unexpected destination. Verify deployment access (Execute as: Me; Who has access: Anyone) and the current /exec URL.",
    );
  }

  // Google redirects ContentService responses to a signed URL. The redirect may
  // initially return 404 due to propagation. GET the SAME URL again, never
  // resubmit a POST that may already have changed the Sheet.
  let content = await fetcher(contentUrl, { method: "GET", redirect: "manual", cache: "no-store" });
  for (const delay of [1800, 2500]) {
    if (content.status !== 404) break;
    await pause(delay);
    content = await fetcher(contentUrl, { method: "GET", redirect: "manual", cache: "no-store" });
  }
  if (content.status === 404) {
    throw new Error(
      "Google ContentService's redirected response remained HTTP 404. The Apps Script operation MAY have completed. Refresh the live Sheet before trying again; the original mutation was not retried.",
    );
  }
  if ([301, 302, 303, 307, 308].includes(content.status)) {
    throw new Error("The Apps Script content response redirected unexpectedly. Verify web-app permissions.");
  }
  return content;
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
