import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildCampaignPayload,
  buildProspectImport,
  plainTextToHtml,
  reviewBatchName,
  type ReviewProspect,
} from "../lib/outboundReview";

const prospects: ReviewProspect[] = [{
  id: "V10-O124",
  email: "team@example.com",
  company: "Example Co.",
  website: "https://example.com",
  subject: "A quick thought",
  bodyText: "Hi team,\n\nOne useful idea.\n\nMark",
}];

test("review batch names are deterministic across ID order", () => {
  assert.equal(
    reviewBatchName(["V10-O124", "V10-O120", "V10-O124"]),
    "Prospect OS Review · V10-O120 · V10-O124",
  );
});

test("plain prospect copy becomes safe HTML", () => {
  assert.equal(
    plainTextToHtml("Hi <team>\nThanks & bye"),
    "Hi &lt;team&gt;<br />Thanks &amp; bye",
  );
});

test("campaign payload is review-ready, human-run, and privacy-friendly", () => {
  const payload = buildCampaignPayload({
    name: reviewBatchName(prospects.map((prospect) => prospect.id)),
    mailboxId: 123,
    timezone: "America/Los_Angeles",
    postalAddress: "123 Business Mailbox, Irvine, CA 92618",
    prospects,
  });

  assert.deepEqual(payload.email_account_ids, [123]);
  assert.equal(payload.settings.daily_enroll, 1);
  assert.equal(payload.settings.gdpr_unsubscribe, true);
  assert.equal(payload.settings.list_unsubscribe, true);
  assert.equal(payload.settings.catch_all_verification_mode, "ONLY_VERIFY");

  const version = payload.steps.followup.body.versions[0];
  assert.equal(version.subject, "{{SNIPPET_1}}");
  assert.match(version.message, /{{SNIPPET_2}}/);
  assert.match(version.message, /{{UNSUBSCRIBE}}/);
  assert.match(version.message, /Business outreach from Mark Krizsan/);
  assert.match(version.message, /123 Business Mailbox/);
  assert.equal(version.signature, "SENDER");
  assert.equal(version.track_opens, false);
  assert.equal(payload.steps.followup.followup, null);
});

test("prospect import carries exact subject/body in custom snippets", () => {
  const payload = buildProspectImport(456, prospects, "Review batch");
  assert.equal(payload.force, false);
  assert.equal(payload.prospects[0].email, "team@example.com");
  assert.equal(payload.prospects[0].snippet1, "A quick thought");
  assert.match(payload.prospects[0].snippet2, /One useful idea/);
  assert.equal(payload.prospects[0].snippet3, "V10-O124");
  assert.match(payload.prospects[0].tags, /PROSPECT_OS/);
});

test("Woodpecker bridge intentionally contains no campaign run endpoint", () => {
  const source = readFileSync(new URL("../lib/woodpecker.ts", import.meta.url), "utf8");
  assert.equal(source.includes("/run"), false);
  assert.equal(source.includes("runCampaign"), false);
});
