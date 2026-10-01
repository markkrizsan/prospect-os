import { isAuthorized, unauthorized } from "@/lib/auth";
import { prepareProspectReviewBatch } from "@/lib/prospectApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Review-batch preparation failed";
  return Response.json({ error: message }, {
    status: 503,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  try {
    const body = await request.json() as { ids?: unknown };
    if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 10 ||
        body.ids.some((id) => typeof id !== "string" || !id.trim())) {
      return Response.json(
        { error: "Provide 1-10 strict READY prospect IDs." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return Response.json(
      await prepareProspectReviewBatch(body.ids as string[]),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
