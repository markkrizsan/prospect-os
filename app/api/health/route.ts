export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    service: "prospect-os",
    version: "10.1",
    build: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "local",
  }, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=30",
    },
  });
}
