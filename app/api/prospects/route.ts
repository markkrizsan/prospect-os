import { isAuthorized, unauthorized } from "@/lib/auth";
import { diagnoseProspectPayload, markProspectSent, readProspectsCached, recordProspectOutcome, reconcileSentProspects, rejectProspect } from "@/lib/prospectApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One-time reconciliation may touch multiple Sheets; allow time for its response.
export const maxDuration = 60;

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
    return Response.json(await readProspectsCached(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  try {
    const body = await request.json() as { action?: unknown; id?: unknown; reason?: unknown; outcome?: unknown; amount?: unknown; note?: unknown };
    if (body.action === "SYNC_SENT") {
      return Response.json(await reconcileSentProspects(), { headers: { "Cache-Control": "private, no-store" } });
    }
    if (typeof body.id !== "string" || !body.id.trim()) {
      return Response.json({ error: "A valid record ID is required" }, { status: 400 });
    }
    if (body.action === "MARK_SENT") {
      return Response.json(await markProspectSent(body.id.trim()), { headers: { "Cache-Control": "private, no-store" } });
    }
    if (body.action === "REJECT" && typeof body.reason === "string" && body.reason.trim()) {
      return Response.json(await rejectProspect(body.id.trim(), body.reason.trim()), { headers: { "Cache-Control": "private, no-store" } });
    }
    if (body.action === "RECORD_OUTCOME" && typeof body.outcome === "string") {
      const amount = typeof body.amount === "number" ? body.amount : undefined;
      const note = typeof body.note === "string" ? body.note : "";
      return Response.json(await recordProspectOutcome(body.id.trim(), body.outcome, amount, note), { headers: { "Cache-Control": "private, no-store" } });
    }
    return Response.json({ error: "A valid MARK_SENT, REJECT, RECORD_OUTCOME or SYNC_SENT action is required" }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
