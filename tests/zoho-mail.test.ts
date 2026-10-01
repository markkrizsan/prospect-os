import assert from "node:assert/strict";
import test from "node:test";

import {
  absolutizeSignatureHtml,
  buildZohoDraftPayload,
  renderDraftHtml,
} from "../lib/zohoDraft";

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

test("Zoho bridge builds a draft-only provider payload", () => {
  const payload = buildZohoDraftPayload({
    fromAddress: "mark@example.com",
    toAddress: "lead@example.com",
    subject: "Subject",
    bodyText: "Hello",
    signatureHtml: '<a href="https://mark.test">Mark</a>',
  });

  assert.deepEqual(
    {
      mode: payload.mode,
      fromAddress: payload.fromAddress,
      toAddress: payload.toAddress,
      subject: payload.subject,
      mailFormat: payload.mailFormat,
      askReceipt: payload.askReceipt,
      encoding: payload.encoding,
    },
    {
      mode: "draft",
      fromAddress: "mark@example.com",
      toAddress: "lead@example.com",
      subject: "Subject",
      mailFormat: "html",
      askReceipt: "no",
      encoding: "UTF-8",
    },
  );
  assert.match(payload.content, /Hello/);
  assert.match(payload.content, /https:\/\/mark\.test/);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "send"), false);
});
