import { isAuthorized, unauthorized } from "@/lib/auth";
import { createProspectZohoDraft } from "@/lib/prospectApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Zoho draft creation failed";
  return Response.json({ error: message }, {
    status: 503,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  try {
    const body = await request.json() as { id?: unknown };
    if (typeof body.id !== "string" || !body.id.trim()) {
      return Response.json({ error: "A valid READY record ID is required" }, { status: 400 });
    }
    const result = await createProspectZohoDraft(body.id.trim());
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
