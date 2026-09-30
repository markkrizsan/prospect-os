import { timingSafeEqual } from "node:crypto";

/** Private contact data must never become public because deployment configuration is missing. */
export function dashboardKeyConfigured(): boolean {
  return Boolean(process.env.DASHBOARD_KEY?.trim());
}
export function isAuthorized(request: Request): boolean {
  const expected = process.env.DASHBOARD_KEY?.trim();
  if (!expected) return false;
  const actual = request.headers.get("x-dashboard-key") ?? "";
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer);
}
export function unauthorized(): Response {
  if (!dashboardKeyConfigured()) {
    return Response.json(
      { error: "Prospect OS access is not configured. Set DASHBOARD_KEY in production and redeploy." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return Response.json({ error: "Unauthorized" }, {
    status: 401, headers: { "Cache-Control": "private, no-store" },
  });
}
