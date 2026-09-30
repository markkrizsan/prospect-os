import assert from "node:assert/strict";
import test from "node:test";
import {
  composeOutboundPacket, extractRecipientEmail, inView, normalizePayload,
  outreachCopyIssues, outreachQualityIssues,
} from "../lib/normalizeProspects";

function opportunity(id = "V10-O100", overrides: Record<string, string> = {}) {
  return {
    "Opportunity ID": id, Status: "V10 READY", Company: "Acme Co", Website: "https://acme.test",
    "Person": "Acme team", "Business Strength Evidence": "Established business with real work",
    "Digital Reality / Gap": "Buyer cannot find portfolio", "Mark Intervention Delta": "Surface actual project examples",
    "Economic Justification": "Commercial project requests could support a focused engagement",
    "Micro-Offer": "Annotated homepage fixes", "Why Now / Booster": "Current site buries work",
    ...overrides,
  };
}
function outreach(id = "V10-O100", overrides: Record<string, string> = {}) {
  return {
    "Opportunity ID": id, Status: "V10 READY", Company: "Acme Co", "Person": "Acme team",
    "Email / Channel": "team@acme.test — company inbox published on owned site",
    Subject: "A project-page idea",
    "Draft Message": "Hi Acme team,\n\nI noticed your project examples are buried. A simpler homepage could show the actual work sooner.\n\nMark",
    ...overrides,
  };
}
const normal = () => normalizePayload({ OPPORTUNITIES: [opportunity()], OUTREACH: [outreach()] });

test("SEND NOW requires complete matching OPPORTUNITIES and OUTREACH, not a lone READY label", () => {
  const complete = normal();
  assert.equal(complete.prospects.length, 1);
  assert.equal(complete.counts["send-now"], 1);
  assert.equal(complete.prospects[0].source, "OUTREACH");
  assert.equal(complete.prospects[0].readyValidated, true);
  const onlyOpportunity = normalizePayload({ OPPORTUNITIES: [opportunity()] });
  assert.equal(onlyOpportunity.counts["send-now"], 0);
  assert.match(onlyOpportunity.consistencyIssues.join(" "), /missing OUTREACH/);
  const onlyOutreach = normalizePayload({ OUTREACH: [outreach()] });
  assert.equal(onlyOutreach.counts["send-now"], 0);
  assert.match(onlyOutreach.consistencyIssues.join(" "), /missing OPPORTUNITIES/);
});

test("OUTREACH owns status, actual recipient, subject and draft; OPPORTUNITIES owns commercial research", () => {
  const data = normal();
  const item = data.prospects[0];
  assert.equal(item.contactPath, "team@acme.test — company inbox published on owned site");
  assert.equal(item.subjectLine, "A project-page idea");
  assert.equal(item.businessStrength, "Established business with real work");
  assert.equal(item.commercialGap, "Buyer cannot find portfolio");
  assert.equal(item.whyNow, "Current site buries work");
  assert.equal(data.consistencyIssues.length, 0);
});

test("conflicting statuses fail closed: a historical READY cannot resurface a SENT record", () => {
  const data = normalizePayload({
    OPPORTUNITIES: [opportunity()],
    OUTREACH: [outreach("V10-O100", { Status: "SENT", "Sent At": "9/30/2026" })],
  });
  assert.equal(data.counts["send-now"], 0);
  assert.equal(data.counts.sent, 1);
  assert.equal(data.prospects[0].status, "SENT");
  assert.match(data.consistencyIssues.join(" "), /status disagreement/);
});

test("duplicate operational IDs cannot enter SEND NOW even with fully populated records", () => {
  const data = normalizePayload({
    OPPORTUNITIES: [opportunity(), opportunity("V10-O100", { Company: "Accidental duplicate" })],
    OUTREACH: [outreach()],
  });
  assert.equal(data.counts["send-now"], 0);
  assert.match(data.consistencyIssues.join(" "), /duplicate OPPORTUNITIES/);
});

test("READY requires source facts, a real recipient and finished copy, not only two READY statuses", () => {
  for (const edited of [
    opportunity("V10-O100", { "Mark Intervention Delta": "" }),
    opportunity("V10-O100", { "Economic Justification": "" }),
    opportunity("V10-O100", { "Micro-Offer": "" }),
  ]) {
    const data = normalizePayload({ OPPORTUNITIES: [edited], OUTREACH: [outreach()] });
    assert.equal(data.counts["send-now"], 0);
  }
  const missingEmail = normalizePayload({
    OPPORTUNITIES: [opportunity()], OUTREACH: [outreach("V10-O100", { "Email / Channel": "Unknown" })],
  });
  assert.equal(missingEmail.counts["send-now"], 0);
  const guessed = normalizePayload({
    OPPORTUNITIES: [opportunity()],
    OUTREACH: [outreach("V10-O100", { "Email / Channel": "guessed person@acme.test — unverified" })],
  });
  assert.equal(guessed.counts["send-now"], 0);
});

test("historical V9 ID can be V10 READY only after both records meet V10 gates", () => {
  const data = normalizePayload({
    OPPORTUNITIES: [opportunity("V9-O022")], OUTREACH: [outreach("V9-O022")],
  });
  assert.equal(data.counts["send-now"], 1);
  const missing = normalizePayload({ OPPORTUNITIES: [opportunity("V9-O022")] });
  assert.equal(missing.counts["send-now"], 0);
});

test("MARKET research remains separate and cannot override operational status", () => {
  const data = normalizePayload({
    MARKET: [
      { "Market ID": "V10-M001", "Company / Person": "Research Co", Screen: "RESEARCH",
        "Business Signal": "Strong company", "Digital Signal": "Buried proof" },
      { "Market ID": "V10-M002", "Company / Person": "Hold Co", Screen: "HOLD" },
    ],
    OPPORTUNITIES: [opportunity()], OUTREACH: [outreach()],
  });
  assert.equal(data.counts.market, 2);
  assert.equal(data.counts.research, 1);
  assert.equal(data.counts.hold, 1);
  assert.equal(data.counts["send-now"], 1);
  assert.equal(data.prospects.length, 3);
  assert.equal(data.prospects[0].businessStrength, "Strong company");
});

test("sent and replied orphan remains visible for audit but cannot reenter READY", () => {
  const data = normalizePayload({ records: [{
    ID: "V10-O099", Source: "OUTREACH", Status: "SENT",
    "Sent At": "2026-09-29", "Reply Date": "2026-09-30",
  }] });
  assert.equal(data.counts.sent, 1);
  assert.equal(data.counts.replied, 1);
  assert.equal(data.counts["send-now"], 0);
  assert.match(data.consistencyIssues.join(" "), /missing OPPORTUNITIES/);
});

test("jargon check remains strict and COPY ALL retains recipient, subject and multiline body", () => {
  assert.deepEqual(outreachQualityIssues({
    subjectLine: "Idea", outreachDraft: "I can send a first-scroll + proof map.",
  }), ["first-scroll", "proof map"]);
  const item = normal().prospects[0];
  assert.deepEqual(outreachCopyIssues(item), []);
  assert.equal(composeOutboundPacket(item),
    "To: team@acme.test\nSubject: A project-page idea\n\n" + item.outreachDraft);
  assert.equal(extractRecipientEmail("Christine@acme.test — direct work email"), "Christine@acme.test");
  assert.equal(extractRecipientEmail("guess guessed@acme.test (unverified)"), "");
});

test("latest RUNS entry preserves unknown metric state rather than reporting fictitious zero", () => {
  const data = normalizePayload({ RUNS: [{
    "Run ID (UTC)": "2026-09-30T08:00:00Z", "Local Run Time": "Sep 30, 1 AM",
    Mode: "HOURLY", "READY Start": "0", "Cheap Screened": "44", "Deep Audited": "15",
    "Substantive PASS": "7", "Contacts Verified": "5", "READY Persisted": "4",
    "READY End": "4", "Gap To Five": "1", "Primary Blocker": "CONTACT PROOF",
    "Persistence + Evidence": "4/4 READBACK PASS",
  }] });
  assert.equal(data.latestRun?.readyAdded, 4);
  assert.equal(data.latestRun?.gap, 1);
  assert.equal(data.latestRun?.screened, 44);
  const unknown = normalizePayload({ RUNS: [{
    "Run ID (UTC)": "2026-09-30T09:00:00Z", "READY Persisted": "", "Primary Blocker": "UNKNOWN",
  }] });
  assert.equal(unknown.latestRun?.readyAdded, null);
  assert.equal(normalizePayload({}).latestRun, null);
});

test("a rejected prospect cannot be shown in the manual send queue", () => {
  const data = normalizePayload({
    OPPORTUNITIES: [opportunity()], OUTREACH: [outreach("V10-O100", { Status: "REJECTED" })],
  });
  assert.equal(data.counts["send-now"], 0);
  assert.equal(inView(data.prospects[0], "send-now"), false);
});

test("legacy READY research under explicit V10 RE-AUDIT stays out of queue without a false corruption alert", () => {
  const data = normalizePayload({
    OPPORTUNITIES: [opportunity("V9-O020", { Status: "READY" })],
    OUTREACH: [outreach("V9-O020", { Status: "V10 RE-AUDIT", "Email / Channel": "" })],
  });
  assert.equal(data.counts["send-now"], 0);
  assert.equal(data.prospects[0].status, "V10 RE-AUDIT");
  assert.equal(data.consistencyIssues.length, 0);
});
