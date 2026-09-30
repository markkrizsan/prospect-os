import assert from "node:assert/strict";
import test from "node:test";
import { assertAppsScriptUrl, fetchAppsScriptReadResponse, fetchAppsScriptResponse } from "../lib/appsScriptTransport";

const deployment = new URL("https://script.google.com/macros/s/DEPLOYMENT_TEST/exec");
const contentUrl = "https://script.googleusercontent.com/macros/echo?user_content_key=SIGNED_TEST";

test("a POST runs once, then retries only GET of the SAME transiently-404 signed response URL", async () => {
  const calls: Array<{ url: string; method: string; redirect: string }> = [];
  const sleeps: number[] = [];
  let redirectedGets = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || "GET", redirect: init?.redirect || "follow" });
    if (String(url) === deployment.toString()) return Response.redirect(contentUrl, 302);
    redirectedGets += 1;
    if (redirectedGets <= 2) return new Response("Not yet available", { status: 404 });
    return Response.json({ ok: true, action: "SYNC_SENT", checked: 11 });
  };
  const result = await fetchAppsScriptResponse(
    deployment,
    { method: "POST", body: '{"action":"SYNC_SENT"}' },
    fetcher,
    async (ms) => { sleeps.push(ms); },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true, action: "SYNC_SENT", checked: 11 });
  assert.deepEqual(calls.map((c) => c.method), ["POST", "GET", "GET", "GET"]);
  assert.ok(calls.every((c) => c.redirect === "manual"));
  assert.ok(calls.slice(1).every((c) => c.url === contentUrl));
  assert.deepEqual(sleeps, [1800, 2500]);
});

test("follows a second approved signed ContentService redirect using GET only", async () => {
  const second = "https://script.googleusercontent.com/macros/echo?user_content_key=SIGNED_SECOND";
  const calls: Array<{ url: string; method: string }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || "GET" });
    if (String(url) === deployment.toString()) return Response.redirect(contentUrl, 302);
    if (String(url) === contentUrl) return Response.redirect(second, 302);
    return Response.json({ ok: true });
  };
  const response = await fetchAppsScriptResponse(
    deployment, { method: "POST", body: '{"action":"SYNC_SENT"}' }, fetcher, async () => {},
  );
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(calls.map((call) => call.method), ["POST", "GET", "GET"]);
  assert.deepEqual(calls.map((call) => call.url), [deployment.toString(), contentUrl, second]);
});

test("rejects an unapproved second hop without repeating a mutation or visiting the destination", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push((init?.method || "GET") + " " + String(url));
    return String(url) === deployment.toString()
      ? Response.redirect(contentUrl, 302)
      : Response.redirect("https://accounts.google.com/ServiceLogin", 302);
  };
  await assert.rejects(
    fetchAppsScriptResponse(deployment, { method: "POST" }, fetcher, async () => {}),
    /unexpected destination/,
  );
  assert.deepEqual(calls, ["POST " + deployment.toString(), "GET " + contentUrl]);
});

test("rejects an endless signed response redirect chain after a bounded number of GETs", async () => {
  const methods: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    methods.push(init?.method || "GET");
    return Response.redirect(contentUrl, 302);
  };
  await assert.rejects(
    fetchAppsScriptResponse(deployment, { method: "POST" }, fetcher, async () => {}),
    /redirect limit/,
  );
  assert.deepEqual(methods, ["POST", "GET", "GET", "GET"]);
});

test("a persistent content redirect 404 does not cause a second POST or expose its URL", async () => {
  const methods: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    methods.push(init?.method || "GET");
    return String(url) === deployment.toString()
      ? Response.redirect(contentUrl, 302)
      : new Response("<!doctype html>Not Found", { status: 404 });
  };
  await assert.rejects(
    fetchAppsScriptResponse(deployment, { method: "POST" }, fetcher, async () => {}),
    /operation MAY have completed/,
  );
  assert.deepEqual(methods, ["POST", "GET", "GET", "GET"]);
});

test("a direct deployment 404 is not retried and returned for actionable diagnosis", async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push(init?.method || "GET");
    return new Response("<!doctype html>Not Found", { status: 404 });
  };
  const result = await fetchAppsScriptResponse(deployment, { method: "POST" }, fetcher, async () => {});
  assert.equal(result.status, 404);
  assert.deepEqual(calls, ["POST"]);
});

test("reject a redirect to Google login or an arbitrary non-ContentService host", async () => {
  const fetcher: typeof fetch = async () => Response.redirect("https://accounts.google.com/ServiceLogin", 302);
  await assert.rejects(
    fetchAppsScriptResponse(deployment, { method: "POST" }, fetcher, async () => {}),
    /unexpected destination/,
  );
});

test("a plain JSON response needs no redirect or retry", async () => {
  const fetcher: typeof fetch = async () => Response.json({ ok: true, data: { MARKET: [] } });
  const result = await fetchAppsScriptResponse(deployment, { method: "GET" }, fetcher, async () => {});
  assert.deepEqual(await result.json(), { ok: true, data: { MARKET: [] } });
});

test("read-only transport retries transient original GET failures but never a permanent 404", async () => {
  const statuses = [503, 502, 200];
  const calls: string[] = [];
  const sleeps: number[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    calls.push(init?.method || "GET");
    const status = statuses.shift() ?? 200;
    return status === 200 ? Response.json({ ok: true, data: { MARKET: [] } }) : new Response("temporary", { status });
  };
  const result = await fetchAppsScriptReadResponse(
    deployment,
    { method: "GET" },
    fetcher,
    async (ms) => { sleeps.push(ms); },
  );
  assert.equal(result.status, 200);
  assert.deepEqual(calls, ["GET", "GET", "GET"]);
  assert.deepEqual(sleeps, [350, 900]);

  const permanentCalls: string[] = [];
  const permanent404: typeof fetch = async (_url, init) => {
    permanentCalls.push(init?.method || "GET");
    return new Response("Not Found", { status: 404 });
  };
  const permanent = await fetchAppsScriptReadResponse(
    deployment,
    { method: "GET" },
    permanent404,
    async () => {},
  );
  assert.equal(permanent.status, 404);
  assert.deepEqual(permanentCalls, ["GET"]);
});

test("read retry helper refuses POST so mutations cannot accidentally replay", async () => {
  await assert.rejects(
    fetchAppsScriptReadResponse(deployment, { method: "POST" }, async () => Response.json({ ok: true }), async () => {}),
    /GET only/,
  );
});

test("validate the exact deployed /exec shape without leaking configuration", () => {
  assert.equal(assertAppsScriptUrl(deployment.toString()).pathname, deployment.pathname);
  assert.equal(
    assertAppsScriptUrl("https://script.google.com/a/example.com/macros/s/ABC/exec").pathname,
    "/a/example.com/macros/s/ABC/exec",
  );
  for (const invalid of [
    "https://script.google.com/macros/s/ABC/dev",
    "https://script.google.com/macros/u/1/s/ABC/exec",
    "https://script.google.com/home/projects/123/edit",
    "https://script.googleusercontent.com/macros/echo?token=test",
    "https://attacker.invalid/macros/s/ABC/exec",
    "https://script.google.com/macros/s/ABC/exec?secret=do-not-log",
  ]) {
    assert.throws(() => assertAppsScriptUrl(invalid), /PROSPECT_API_URL/);
  }
});
