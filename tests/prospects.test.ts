import assert from "node:assert/strict";
import test from "node:test";
import { inView, normalizePayload } from "../lib/normalizeProspects";

test("normalizes and merges V10 OUTREACH with OPPORTUNITIES", () => {
  const data = normalizePayload({
    OPPORTUNITIES: [{ "Opportunity ID": "V10-001", Company: "Acme", Person: "Ari", Version: "V10", Status: "READY", "Business Strength": "Strong referrals", "Digital/Commercial Gap": "Weak proof" }],
    OUTREACH: [{ "Opportunity ID": "V10-001", "Contact Path": "ari@acme.test", "Subject Line": "A useful idea", "Finished Outreach Draft": "Hi Ari — draft." }],
  }, "2026-09-29T12:00:00.000Z");
  assert.equal(data.prospects.length, 1);
  assert.equal(data.prospects[0].contactPath, "ari@acme.test");
  assert.equal(data.prospects[0].businessStrength, "Strong referrals");
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
