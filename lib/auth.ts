import { timingSafeEqual } from "node:crypto";

export function isAuthorized(request: Request): boolean {
  const expected = process.env.DASHBOARD_KEY;
  if (!expected) return true;
  const actual = request.headers.get("x-dashboard-key") ?? "";
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
