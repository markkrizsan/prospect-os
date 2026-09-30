import assert from "node:assert/strict";
import test from "node:test";
import { composeOutboundPacket, extractRecipientEmail, inView, normalizePayload, outreachCopyIssues, outreachQualityIssues } from "../lib/normalizeProspects";

test("normalizes and merges V10 OUTREACH with OPPORTUNITIES", () => {
  const data = normalizePayload({
    OPPORTUNITIES: [{ "Opportunity ID": "V10-001", Company: "Acme", Person: "Ari", Version: "V10", Status: "READY", "Business Strength Evidence": "Strong referrals", "Digital Reality / Gap": "Weak proof", "Why Now / Booster": "New location" }],
    OUTREACH: [{ "Opportunity ID": "V10-001", "Contact Path": "ari@acme.test", "Subject Line": "A useful idea", "Finished Outreach Draft": "Hi Ari — draft." }],
  }, "2026-09-29T12:00:00.000Z");
  assert.equal(data.prospects.length, 1);
  assert.equal(data.prospects[0].contactPath, "ari@acme.test");
  assert.equal(data.prospects[0].businessStrength, "Strong referrals");
  assert.equal(data.prospects[0].commercialGap, "Weak proof");
  assert.equal(data.prospects[0].whyNow, "New location");
  assert.equal(data.counts["send-now"], 1);
});

test("accepts header-row arrays and excludes V9 from SEND NOW", () => {
  const data = normalizePayload({ OPPORTUNITIES: [["Opportunity ID", "Company", "Version", "Status"], ["V9-1", "Old", "V9", "READY"], ["V10-2", "New", "10", "V10 READY"]] });
  assert.equal(data.prospects.length, 2);
  assert.equal(data.counts["send-now"], 1);
  assert.equal(inView(data.prospects[0], "send-now"), false);
});

test("treats V10 READY status as the V10 marker when durable IDs retain a V9 prefix", () => {
  const data = normalizePayload({ OPPORTUNITIES: [{ "Opportunity ID": "V9-O022", Company: "KCI", Status: "V10 READY" }] });
  assert.equal(data.counts["send-now"], 1);
});

test("recognizes sent and replied records", () => {
  const data = normalizePayload({ records: [{ ID: "V10-3", Source: "OUTREACH", Status: "SENT", "Sent At": "2026-09-29", "Reply At": "2026-09-30" }] });
  assert.equal(data.counts.sent, 1);
  assert.equal(data.counts.replied, 1);
});

test("rejected records never appear in SEND NOW", () => {
  const data = normalizePayload({ OUTREACH: [{ "Opportunity ID": "V9-O999", Company: "Too Complex", Status: "REJECTED" }] });
  assert.equal(data.counts["send-now"], 0);
});

test("flags agency jargon in prospect-facing outreach", () => {
  const jargon = outreachQualityIssues({
    subjectLine: "A quick idea",
    outreachDraft: "I can send a first-scroll + proof map for the new site.",
  });
  assert.deepEqual(jargon, ["first-scroll", "proof map"]);

  const clear = outreachQualityIssues({
    subjectLine: "Your new site",
    outreachDraft: "If useful, I can sketch a homepage layout showing the services, project examples, and contact info.",
  });
  assert.deepEqual(clear, []);
});

test("exposes MARKET records and research/hold counts", () => {
  const data = normalizePayload({
    MARKET: [
      { "Market ID": "V10-M001", "Company / Person": "Research Co", Screen: "RESEARCH", "Business Signal": "Strong business", "Digital Signal": "Weak site", "Economics Proxy": "High-value work", "Offer Lane": "Web Design + Development" },
      { "Market ID": "V10-M002", "Company / Person": "Hold Co", Screen: "HOLD", "Business Signal": "Strong business" },
    ],
  });
  assert.equal(data.counts.market, 2);
  assert.equal(data.counts.research, 1);
  assert.equal(data.counts.hold, 1);
  assert.equal(data.prospects[0].company, "Research Co");
  assert.equal(data.prospects[0].businessStrength, "Strong business");
  assert.equal(data.prospects[0].commercialGap, "Weak site");
});

test("COPY ALL includes verified OUTREACH recipient, subject and entire draft", () => {
  const data = normalizePayload({
    OUTREACH: [{ "Opportunity ID": "V10-O100", Status: "V10 READY", "Email / Channel": "team@sample.test", "Subject Line": "A specific idea", "Finished Outreach Draft": "Hi team,\n\nI noticed the quote form.\n\nMark" }],
    OPPORTUNITIES: [{ "Opportunity ID": "V10-O100", Company: "Sample Co" }],
  });
  const item = data.prospects[0];
  assert.equal(item.contactPath, "team@sample.test");
  assert.equal(composeOutboundPacket(item), "To: team@sample.test\nSubject: A specific idea\n\nHi team,\n\nI noticed the quote form.\n\nMark");
  assert.deepEqual(outreachCopyIssues(item), []);
});

test("COPY ALL extracts annotated published address and refuses guessed addresses", () => {
  assert.equal(extractRecipientEmail("christine@am-ko.com — direct email published on site"), "christine@am-ko.com");
  assert.equal(extractRecipientEmail("Company contact — personal address UNKNOWN"), "");
  assert.equal(extractRecipientEmail("guessed firstname@company.test — unverified"), "");
  const item = { contactPath: "guessed firstname@company.test", subjectLine: "Your homepage", outreachDraft: "Hi team,\n\nA useful idea.\n\nMark" };
  assert.equal(composeOutboundPacket(item), "");
  assert.deepEqual(outreachCopyIssues(item), ["verified recipient email missing"]);
});
