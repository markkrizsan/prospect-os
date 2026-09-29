import { isAuthorized, unauthorized } from "@/lib/auth";
import { diagnoseProspectPayload, markProspectSent, readProspects } from "@/lib/prospectApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "The Google Sheet could not be reached";
  return Response.json({ error: message }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  try {
    if (new URL(request.url).searchParams.get("diagnostic") === "shape") {
      return Response.json({ shape: await diagnoseProspectPayload() }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return Response.json(await readProspects(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  try {
    const body = await request.json() as { action?: unknown; id?: unknown };
    if (body.action !== "MARK_SENT" || typeof body.id !== "string" || !body.id.trim()) {
      return Response.json({ error: "A valid MARK_SENT action and record ID are required" }, { status: 400 });
    }
    return Response.json(await markProspectSent(body.id.trim()), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
