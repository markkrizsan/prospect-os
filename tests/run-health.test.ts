import assert from "node:assert/strict";
import test from "node:test";
import type { RunMetrics } from "../lib/types";
import { classifyRunHealth } from "../lib/runHealth";

function run(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return { id: "2026-09-30T10:00:00Z", localTime: "3 AM", mode: "HOURLY / STARTED",
    readyStart: 0, screened: null, audited: null, passed: null, contactsVerified: null,
    readyAdded: null, readyEnd: null, gap: null, blocker: "IN PROGRESS", persistence: "",
    ...overrides };
}
test("missing report is not declared a target miss", () => {
  assert.equal(classifyRunHealth(null, "2026-09-30T10:05:00Z", 0), "AWAITING FIRST RUN");
  assert.equal(classifyRunHealth(run(), "2026-09-30T10:05:00Z", 0), "RUN IN PROGRESS");
  assert.equal(classifyRunHealth(run(), "2026-09-30T10:16:00Z", 0), "STALLED / NO TERMINAL REPORT");
});
test("forensic and incomplete results do not become fictitious zero production", () => {
  assert.equal(classifyRunHealth(run({ mode: "FORENSIC / NO RUN REPORT", blocker: "SCHEDULED RUN REPORT MISSING" }), "2026-09-30T11:00:00Z", 0), "INCOMPLETE / NO ACCEPTANCE");
  assert.equal(classifyRunHealth(run({ mode: "HOURLY", blocker: "", persistence: "", readyAdded: null, readyEnd: null }), "2026-09-30T10:09:00Z", 0), "UNVERIFIED / NO ACCEPTANCE");
});
test("persistence failure, a real target miss, and a healthy reserve are distinct", () => {
  assert.equal(classifyRunHealth(run({ mode: "HOURLY / FINISHED", blocker: "CONTACT WRITE BLOCKED", readyAdded: 0, readyEnd: 0 }), "2026-09-30T10:11:00Z", 0), "PRODUCTION BLOCKED");
  assert.equal(classifyRunHealth(run({ mode: "HOURLY / FINISHED", blocker: "", readyAdded: 5, readyEnd: 5 }), "2026-09-30T10:11:00Z", 5), "TARGET MET");
  assert.equal(classifyRunHealth(run({ mode: "HOURLY / FINISHED", blocker: "CONTACT PROOF", readyAdded: 3, readyEnd: 3 }), "2026-09-30T10:11:00Z", 3), "SHORT OF TARGET");
  assert.equal(classifyRunHealth(run({ mode: "BUFFER FULL", blocker: "", readyStart: 12, readyAdded: 0, readyEnd: 12 }), "2026-09-30T10:11:00Z", 12), "BUFFER HEALTHY");
});
