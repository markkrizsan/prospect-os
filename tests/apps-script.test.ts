import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

type Datum = string | Date;
class FakeSheet {
  rows: Datum[][];
  constructor(rows: Datum[][]) { this.rows = rows.map((row) => [...row]); }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return Math.max(0, ...this.rows.map((r) => r.length)); }
  appendRow(row: Datum[]) { this.rows.push([...row]); }
  deleteRow(row: number) { this.rows.splice(row - 1, 1); }
  getDataRange() { return this.getRange(1, 1, this.getLastRow(), this.getLastColumn()); }
  getRange(row: number, column: number, height = 1, width = 1) {
    const sheet = this;
    const data = () => Array.from({ length: height }, (_, i) =>
      Array.from({ length: width }, (_, j) => sheet.rows[row - 1 + i]?.[column - 1 + j] ?? ""));
    return {
      getDisplayValues() { return data().map((r) => r.map((x) => x instanceof Date ? x.toISOString().slice(0, 10) : String(x))); },
      getValues() { return data(); },
      getValue() { return sheet.rows[row - 1]?.[column - 1] ?? ""; },
      getDisplayValue() {
        const x = sheet.rows[row - 1]?.[column - 1] ?? "";
        return x instanceof Date ? x.toISOString().slice(0, 10) : String(x);
      },
      setValue(value: Datum) {
        const r = sheet.rows[row - 1] ||= [];
        r[column - 1] = value;
      },
      createTextFinder(search: string) {
        return {
          matchEntireCell() { return this; },
          matchCase() { return this; },
          findNext() {
            for (let i = 0; i < height; i++) {
              if (String(sheet.rows[row - 1 + i]?.[column - 1] ?? "") === search) {
                return { getRow: () => row + i };
              }
            }
            return null;
          },
        };
      },
    };
  }
  record(id: string) {
    const idx = this.rows.findIndex((r, i) => i > 0 && r[0] === id);
    if (idx < 0) return null;
    return Object.fromEntries(this.rows[0].map((k, j) => [k, this.rows[idx][j] ?? ""])) as Record<string, Datum>;
  }
}

const oppHeaders = ["Opportunity ID", "Status", "Company", "Website", "Person", "Role", "Contact Path",
  "Business (FACT)", "Situation (FACT)", "Consequence (INFERENCE)", "UNKNOWN", "Service Idea",
  "Micro-Offer", "Offer Lane", "Access", "Economics", "Need", "Confidence", "Business Strength Evidence",
  "Digital Reality / Gap", "Mark Intervention Delta", "Economic Justification", "Customer Dream Outcome",
  "Value Equation Lever", "Value Gap Gate", "Why Now / Booster", "Next Action", "Market ID", "Source", "Created", "Notes"];
const outHeaders = ["Opportunity ID", "Status", "Company", "Person", "Email / Channel", "Subject",
  "Observation", "Commercial Relevance", "Why Mark", "Micro-Offer", "Signal / Trigger", "Value Gap Hypothesis",
  "Experiment Tag", "Founder-Minute Priority", "Draft Message", "Mark Approved?", "Sent At", "Follow-up Due",
  "Reply?", "Reply Type", "Next Move", "Notes"];
const pipelineHeaders = ["Opportunity ID", "Company", "Person", "Stage", "Offer Lane", "First Touch",
  "Last Touch", "Reply?", "Qualified Conversation?", "Problem / Desired Outcome", "Proposal $",
  "Deposit $", "Revenue $", "Next Action", "Next Action Date", "Outcome / Learning", "Source", "Message Angle"];

function makeRow(headers: string[], data: Record<string, Datum>) {
  return headers.map((key) => data[key] ?? "");
}
function fixture(opts: { status?: string; sentAt?: string; existingPipeline?: Record<string, Datum> } = {}) {
  const status = opts.status ?? "V10 READY";
  const id = "V10-O038";
  const sheets: Record<string, FakeSheet> = {
    MARKET: new FakeSheet([["Market ID", "Company / Person", "Screen"], ["V10-M0233", "Desert Cleaning", "PROMOTE"]]),
    RUNS: new FakeSheet([["Run ID (UTC)", "READY Persisted", "Primary Blocker"]]),
    OPPORTUNITIES: new FakeSheet([oppHeaders, makeRow(oppHeaders, { "Opportunity ID": id, Status: status, Company: "Desert Cleaning", "Offer Lane": "Web Design + Development" })]),
    OUTREACH: new FakeSheet([outHeaders, makeRow(outHeaders, { "Opportunity ID": id, Status: status, Company: "Desert Cleaning",
      Person: "Desert Cleaning team", "Email / Channel": "team@example.test", Subject: "Homepage idea",
      "Draft Message": "Hi team", "Sent At": opts.sentAt ?? "", "Reply?": "NO", "Mark Approved?": "PENDING" })]),
    PIPELINE: new FakeSheet([pipelineHeaders, ...(opts.existingPipeline ? [makeRow(pipelineHeaders, opts.existingPipeline)] : [])]),
    TODAY: new FakeSheet([
      ...Array.from({ length: 6 }, () => Array(12).fill("")),
      ["Priority", "Company", "Person", "Gap", "Service", "Micro-Offer", "Draft", "Channel", "Status", "Next Action", "Opportunity ID", "Why Now"],
      ["1", "Desert Cleaning", "", "", "", "", "READY TO SEND", "", "V10 READY", "", id, ""],
      ["HOLD", "Some Company", "", "", "", "", "DO NOT SEND", "", "V10 HOLD", "", "V9-O028", ""],
    ]),
  };
  let locks = 0;
  let flushes = 0;
  const context = {
    SpreadsheetApp: {
      openById: (id: string) => {
        assert.equal(id, "1K2nfLH1ZBMJZLg0fiicnTJFBzobb3mCKt6rYsEmwR9M");
        return {
          getSheetByName: (name: string) => sheets[name] ?? null,
          getSpreadsheetTimeZone: () => "America/Los_Angeles",
        };
      },
      flush: () => { flushes++; },
    },
    LockService: { getScriptLock: () => ({
      waitLock() { locks++; },
      releaseLock() { locks--; },
    }) },
    Utilities: {
      formatDate: (date: Date, timezone: string) => {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
        }).formatToParts(date);
        const d = Object.fromEntries(parts.map((p) => [p.type, p.value]));
        return d.year + "-" + d.month + "-" + d.day;
      },
    },
    ContentService: {
      MimeType: { JSON: "JSON" },
      createTextOutput: (value: string) => ({ text: value, setMimeType() { return this; } }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => key === "PROSPECT_API_SECRET" ? "testing-only" : "" }) },
    Date, console,
  };
  const source = readFileSync("apps-script/Code.gs", "utf8");
  runInNewContext(source, context);
  const run = (functionName: string, ...args: unknown[]) =>
    (context as unknown as Record<string, (...args: unknown[]) => { text: string }>)[functionName](...args);
  return { sheets, run, get locks() { return locks; }, get flushes() { return flushes; } };
}

test("Apps Script list retains MARKET for the live dashboard", () => {
  const f = fixture();
  const output = JSON.parse(f.run("list_").text);
  assert.equal(output.ok, true);
  assert.equal(output.data.MARKET[0]["Market ID"], "V10-M0233");
  assert.equal(output.data.OUTREACH.length, 1);
  assert.equal(output.data.OPPORTUNITIES.length, 1);
  assert.equal(output.data.RUNS.length, 0);
});

test("MARK_SENT writes through to stages, follow-up, pipeline and removes stale TODAY row", () => {
  const f = fixture();
  const response = JSON.parse(f.run("markSent_", "V10-O038", "2026-09-30T18:00:00.000Z").text);
  assert.equal(response.reconciled, true);
  assert.equal(f.sheets.OPPORTUNITIES.record("V10-O038")?.Status, "SENT");
  const out = f.sheets.OUTREACH.record("V10-O038")!;
  assert.equal(out.Status, "SENT");
  assert.equal(out["Mark Approved?"], "SENT BY MARK");
  assert.equal(out["Follow-up Due"], "2026-10-06");
  assert.equal(f.sheets.PIPELINE.record("V10-O038")?.Stage, "SENT");
  assert.equal(f.sheets.PIPELINE.record("V10-O038")?.["Message Angle"], "Homepage idea");
  assert.equal(f.sheets.PIPELINE.record("V10-O038")?.["Next Action Date"], "2026-10-06");
  assert.equal(f.sheets.TODAY.rows.length, 9); // Preserved legacy snapshot, no extra writes.
  assert.equal(f.sheets.TODAY.rows[8][10], "V9-O028");
  assert.equal(f.flushes, 1);
});

test("MARK_SENT repeated is idempotent: no duplicate pipeline or reset sent date", () => {
  const f = fixture();
  f.run("markSent_", "V10-O038", "2026-09-30T18:00:00.000Z");
  const stored = f.sheets.OUTREACH.record("V10-O038")?.["Sent At"];
  f.run("markSent_", "V10-O038", "2026-10-01T18:00:00.000Z");
  assert.equal(f.sheets.OUTREACH.record("V10-O038")?.["Sent At"], stored);
  assert.equal(f.sheets.PIPELINE.rows.length, 2);
  assert.equal(f.sheets.TODAY.rows.length, 9); // Preserved legacy snapshot, no extra writes.
});

test("SYNC_SENT backfills existing sent records without downgrading replied pipeline", () => {
  const f = fixture({ status: "SENT", sentAt: "9/30/2026", existingPipeline: {
    "Opportunity ID": "V10-O038", Company: "Desert Cleaning", Stage: "REPLIED",
    "Reply?": "YES", "First Touch": "2026-09-30", "Last Touch": "2026-10-01",
    "Outcome / Learning": "Actual reply received",
  } });
  const result = JSON.parse(f.run("syncSent_").text);
  assert.equal(result.checked, 1);
  assert.equal(result.missingTimestamps, 0);
  assert.equal(f.sheets.PIPELINE.rows.length, 2);
  assert.equal(f.sheets.PIPELINE.record("V10-O038")?.Stage, "REPLIED");
  assert.equal(f.sheets.PIPELINE.record("V10-O038")?.["Outcome / Learning"], "Actual reply received");
  assert.equal(f.sheets.OUTREACH.record("V10-O038")?.["Follow-up Due"], ""); // Real reply in pipeline wins over stale OUTREACH Reply? NO.
  assert.equal(f.sheets.TODAY.rows.length, 9); // Preserved legacy snapshot, no extra writes.
});

test("REJECT cannot retroactively turn a sent record into rejected", () => {
  const f = fixture({ status: "SENT", sentAt: "9/30/2026" });
  assert.throws(() => f.run("reject_", "V10-O038", "WEAK VALUE GAP"), /SENT prospect/);
  assert.equal(f.sheets.OUTREACH.record("V10-O038")?.Status, "SENT");
});

test("text-only sent dates preserve calendar day for America/Los_Angeles", () => {
  const f = fixture({ status: "SENT", sentAt: "9/30/2026" });
  f.run("syncSent_");
  assert.equal(f.sheets.OUTREACH.record("V10-O038")?.["Follow-up Due"], "2026-10-06");
});

test("schema mismatch fails before any partial SENT or PIPELINE changes", () => {
  const f = fixture();
  f.sheets.OUTREACH.rows[0][5] = "Subject Line"; // Regression against the real Sheet's Subject header
  assert.throws(() => f.run("markSent_", "V10-O038", "2026-09-30T18:00:00.000Z"), /Missing column: Subject/);
  assert.equal(f.sheets.OUTREACH.record("V10-O038")?.Status, "V10 READY");
  assert.equal(f.sheets.OPPORTUNITIES.record("V10-O038")?.Status, "V10 READY");
  assert.equal(f.sheets.PIPELINE.rows.length, 1);
});

test("missing finished draft is rejected before any SENT mutation", () => {
  const f = fixture();
  f.sheets.OUTREACH.rows[1][outHeaders.indexOf("Draft Message")] = "";
  assert.throws(() => f.run("markSent_", "V10-O038", "2026-09-30T18:00:00.000Z"), /finished draft missing/);
  assert.equal(f.sheets.OUTREACH.record("V10-O038")?.Status, "V10 READY");
  assert.equal(f.sheets.PIPELINE.rows.length, 1);
});

test("suppressed SENT record receives no new follow-up date", () => {
  const f = fixture({ status: "SENT", sentAt: "9/30/2026", existingPipeline: {
    "Opportunity ID": "V10-O038", Stage: "SUPPRESSED",
  } });
  f.run("syncSent_");
  assert.equal(f.sheets.OUTREACH.record("V10-O038")?.["Follow-up Due"], "");
  assert.equal(f.sheets.PIPELINE.record("V10-O038")?.Stage, "SUPPRESSED");
});


test("qualified materializer helpers allocate IDs and generate a human draft", () => {
  const f = fixture();
  const next = f.run("nextOpportunityId_", f.sheets.OPPORTUNITIES) as unknown as string;
  assert.equal(next, "V10-O039");
  const subject = f.run("subjectForCompany_", "Bullseye Cleaning") as unknown as string;
  assert.match(subject, /Bullseye Cleaning/);
  const draft = f.run(
    "draftForQualified_",
    "Bullseye Cleaning",
    "The commercial path is mixed with unrelated services",
    "The company serves substantial facilities",
    "One annotated homepage pass focused on the verified buyer-facing gap.",
  ) as unknown as string;
  assert.match(draft, /^Hi Bullseye Cleaning team,/);
  assert.match(draft, /commercial path/i);
  assert.match(draft, /annotated homepage pass/i);
});

test("materializer parses evidence-backed qualification signals without inventing HIGH scores", () => {
  const f = fixture();
  const reason = "PAIN=MEDIUM | TIMING=HIGH | ECONOMICS=HIGH | AUTHORITY=REALISTIC | SCOPE=PASS | INTENT=HIGH | CONFIDENCE=MEDIUM — evidence";
  assert.equal(f.run("qualificationSignal_", reason, "PAIN", "LOW"), "MEDIUM");
  assert.equal(f.run("qualificationSignal_", reason, "CONFIDENCE", "LOW"), "MEDIUM");
  assert.equal(f.run("qualificationSignal_", reason, "MISSING", "NONE"), "NONE");
});

test("owned-site email extraction ignores hidden vendor code", () => {
  const f = fixture();
  assert.equal(f.run("extractEmail_", "<script>const x='vendor@tracker.test'</script><a href='mailto:Sales@Acme.com'>Email us</a>"), "sales@acme.com");
  assert.equal(f.run("extractEmail_", "<script>const x='vendor@tracker.test'</script><p>Contact: info@acme.com</p>"), "info@acme.com");
  assert.equal(f.run("extractEmail_", "<script>const x='vendor@tracker.test'</script>"), "");
  assert.equal(f.run("extractEmail_", "<a href='mailto:noreply@acme.com'>mail</a>"), "");
});

test("materializer detects explicit website replacement language without confusing construction services", () => {
  const f = fixture();
  assert.equal(f.run("hasActiveRebuildSignal_", "<p>Our new website is coming soon.</p>"), true);
  assert.equal(f.run("hasActiveRebuildSignal_", "<p>Commercial construction and renovation services.</p>"), false);
});
