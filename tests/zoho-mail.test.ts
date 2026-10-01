import assert from "node:assert/strict";
import test from "node:test";

import {
  absolutizeSignatureHtml,
  createZohoDraft,
  renderDraftHtml,
  resetZohoCachesForTests,
} from "../lib/zohoMail";

test("renderDraftHtml escapes prospect text and preserves signature HTML", () => {
  const html = renderDraftHtml(
    "Hi <Team>\n\nThanks & bye",
    '<a href="https://example.com"><img src="https://img.test/sig.png" /></a>',
  );
  assert.match(html, /Hi &lt;Team&gt;<br \/><br \/>Thanks &amp; bye/);
  assert.match(html, /<a href="https:\/\/example.com">/);
});

test("absolutizeSignatureHtml converts Zoho-relative signature assets", () => {
  assert.equal(
    absolutizeSignatureHtml(
      '<a href="https://mark.test"><img src="/zm/ImageSignature?id=1" /></a>',
      "https://mail.zoho.com",
    ),
    '<a href="https://mark.test"><img src="https://mail.zoho.com/zm/ImageSignature?id=1" /></a>',
  );
});

test("createZohoDraft creates a draft and never sends", async () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  process.env.ZOHO_CLIENT_ID = "client";
  process.env.ZOHO_CLIENT_SECRET = "secret";
  process.env.ZOHO_REFRESH_TOKEN = "refresh";
  process.env.ZOHO_FROM_ADDRESS = "mark@example.com";
  process.env.ZOHO_ACCOUNTS_BASE_URL = "https://accounts.zoho.com";
  process.env.ZOHO_MAIL_BASE_URL = "https://mail.zoho.com";
  delete process.env.ZOHO_SIGNATURE_ID;
  resetZohoCachesForTests();

  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.includes("/oauth/v2/token")) {
      return Response.json({ access_token: "access", expires_in: 3600 });
    }
    if (url.endsWith("/api/accounts")) {
      return Response.json({
        status: { code: 200 },
        data: [{
          accountId: "123",
          enabled: true,
          primaryEmailAddress: "mark@example.com",
          sendMailDetails: [{
            fromAddress: "mark@example.com",
            signatureId: "sig-1",
            status: true,
          }],
        }],
      });
    }
    if (url.includes("/api/accounts/signature")) {
      return Response.json({
        status: { code: 200 },
        data: { content: '<a href="https://mark.test">Mark</a>' },
      });
    }
    if (url.endsWith("/api/accounts/123/messages")) {
      const body = JSON.parse(String(init?.body || "{}"));
      assert.equal(body.mode, "draft");
      assert.equal(body.fromAddress, "mark@example.com");
      assert.equal(body.toAddress, "lead@example.com");
      assert.equal(body.subject, "Subject");
      assert.match(body.content, /https:\/\/mark\.test/);
      return Response.json({ status: { code: 201 }, data: { messageId: "draft-123" } });
    }

    throw new Error("Unexpected URL " + url);
  }) as typeof fetch;

  try {
    const result = await createZohoDraft({
      toAddress: "lead@example.com",
      subject: "Subject",
      bodyText: "Hello",
    });
    assert.equal(result.draftId, "draft-123");
    assert.equal(calls.filter((call) => call.url.endsWith("/messages")).length, 1);
  } finally {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    resetZohoCachesForTests();
  }
});
