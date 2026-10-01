const SPREADSHEET_ID = "1K2nfLH1ZBMJZLg0fiicnTJFBzobb3mCKt6rYsEmwR9M";
// Do not drop MARKET from this payload: the live dashboard needs research and backlog views.
const READ_TABS = ["MARKET", "OUTREACH", "OPPORTUNITIES", "RUNS"];

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (!authorized_(params, {})) return json_({ ok: false, error: "Unauthorized" });
    if (String(params.action || "list").toLowerCase() !== "list") {
      return json_({ ok: false, error: "Unsupported action" });
    }
    return list_();
  } catch (error) {
    return json_({ ok: false, error: safeMessage_(error) });
  }
}

function doPost(e) {
  try {
    const params = (e && e.parameter) || {};
    let body = {};
    try {
      body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    } catch (_) {
      return json_({ ok: false, error: "Invalid JSON body" });
    }
    if (!authorized_(params, body)) return json_({ ok: false, error: "Unauthorized" });
    const action = String(body.action || params.action || "").trim().toUpperCase();

    // Reconciles only records already recorded as SENT; it NEVER sends email or approves a draft.
    if (action === "SYNC_SENT") return withLock_(function () { return syncSent_(); });
    // Materializes only candidates already qualified in MARKET. It never discovers or qualifies.
    if (action === "MATERIALIZE_QUALIFIED") {
      return json_(withLock_(function () { return materializeQualified_(); }));
    }

    const id = String(body.opportunityId || body.id || "").trim();
    if (!id) return json_({ ok: false, error: "Missing opportunity ID" });
    if (action === "MARK_SENT") return withLock_(function () { return markSent_(id, body.sentAt); });
    if (action === "REJECT") return withLock_(function () { return reject_(id, body.reason); });
    if (action === "RECORD_OUTCOME") return withLock_(function () {
      return recordOutcome_(id, body.outcome, body.amount, body.note);
    });
    return json_({ ok: false, error: "Unsupported action" });
  } catch (error) {
    return json_({ ok: false, error: safeMessage_(error) });
  }
}

function withLock_(operation) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return operation(); } finally { lock.releaseLock(); }
}

function list_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const data = {};
  READ_TABS.forEach(function (name) {
    data[name] = sheetToObjects_(requiredSheet_(spreadsheet, name));
  });
  return json_({ ok: true, data: data, syncedAt: new Date().toISOString(), capabilities: ["MATERIALIZE_QUALIFIED", "RECORD_OUTCOME"] });
}

function markSent_(id, sentAt) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  assertReconciliationSchema_(spreadsheet);
  // Validate BOTH records before any mutation. Partial one-sided records are a production incident.
  const opportunity = requiredRecord_(spreadsheet, "OPPORTUNITIES", id);
  const outreach = requiredRecord_(spreadsheet, "OUTREACH", id);
  const beforeOpportunity = getByHeader_(opportunity, "Status");
  const beforeOutreach = getByHeader_(outreach, "Status");
  if (/reject|opt.?out|suppressed/i.test(beforeOpportunity + " " + beforeOutreach)) {
    throw new Error("Rejected or suppressed prospect cannot be marked SENT");
  }
  if (!/^(V10 READY|READY|READY TO SEND|SENT)$/i.test(beforeOutreach)) {
    throw new Error("Only a READY or previously SENT record can be marked SENT");
  }
  // Direct API callers must not bypass the verified recipient/draft gate.
  if (!getByHeader_(outreach, "Email / Channel").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) ||
      !getByHeader_(outreach, "Subject") || !getByHeader_(outreach, "Draft Message")) {
    throw new Error("Cannot mark SENT: verified recipient, subject or finished draft missing");
  }

  const existing = getByHeaderRaw_(outreach, "Sent At");
  const stamp = existing ? parseDate_(existing) : parseDate_(sentAt || new Date());
  if (!stamp) throw new Error("Invalid sent timestamp");
  setByHeader_(opportunity.sheet, opportunity.row, opportunity.headers, "Status", "SENT");
  setByHeader_(outreach.sheet, outreach.row, outreach.headers, "Status", "SENT");
  if (!existing) setByHeader_(outreach.sheet, outreach.row, outreach.headers, "Sent At", stamp);
  setByHeader_(outreach.sheet, outreach.row, outreach.headers, "Mark Approved?", "SENT BY MARK");
  setByHeader_(outreach.sheet, outreach.row, outreach.headers, "Next Move", "Await reply / follow-up");

  reconcileSentRecord_(spreadsheet, opportunity, outreach, stamp);
  SpreadsheetApp.flush();
  return json_({ ok: true, id: id, status: "SENT", reconciled: true });
}

function syncSent_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  assertReconciliationSchema_(spreadsheet);
  const sheet = requiredSheet_(spreadsheet, "OUTREACH");
  const headers = headerMap_(sheet);
  const values = sheet.getDataRange().getDisplayValues();
  const rawValues = sheet.getDataRange().getValues();
  const idColumn = requiredColumn_(headers, "Opportunity ID") - 1;
  const statusColumn = requiredColumn_(headers, "Status") - 1;
  const sentColumn = requiredColumn_(headers, "Sent At") - 1;
  let repaired = 0;
  let missingTimestamps = 0;
  let unmatched = 0;

  for (let index = 1; index < values.length; index += 1) {
    const record = values[index];
    if (String(record[statusColumn] || "").trim().toUpperCase() !== "SENT") continue;
    const id = String(record[idColumn] || "").trim();
    const stamp = parseDate_(rawValues[index][sentColumn] || record[sentColumn]);
    if (!id || !stamp) { missingTimestamps += 1; continue; }
    const oppSheet = requiredSheet_(spreadsheet, "OPPORTUNITIES");
    const oppRow = findOpportunityRow_(oppSheet, id);
    if (!oppRow) { unmatched += 1; continue; }
    const opportunity = { sheet: oppSheet, row: oppRow, headers: headerMap_(oppSheet) };
    const outreach = { sheet: sheet, row: index + 1, headers: headers };
    if (/reject|opt.?out|suppressed/i.test(getByHeader_(opportunity, "Status"))) {
      unmatched += 1;
      continue;
    }
    setByHeader_(oppSheet, oppRow, opportunity.headers, "Status", "SENT");
    reconcileSentRecord_(spreadsheet, opportunity, outreach, stamp);
    repaired += 1;
  }
  SpreadsheetApp.flush();
  return json_({ ok: true, action: "SYNC_SENT", checked: repaired, missingTimestamps: missingTimestamps, unmatched: unmatched });
}

function reconcileSentRecord_(spreadsheet, opportunity, outreach, stamp) {
  const due = businessDayOffset_(stamp, 4, spreadsheet.getSpreadsheetTimeZone() || "America/Los_Angeles");
  const id = getByHeader_(outreach, "Opportunity ID");
  const pipelineSheet = requiredSheet_(spreadsheet, "PIPELINE");
  const pipelineRow = findOpportunityRow_(pipelineSheet, id);
  const pipelineStage = pipelineRow
    ? getByHeader_({ sheet: pipelineSheet, row: pipelineRow, headers: headerMap_(pipelineSheet) }, "Stage").toUpperCase()
    : "";
  const replied = /^(YES|TRUE|REPLIED|POSITIVE|NEGATIVE)$/i.test(getByHeader_(outreach, "Reply?")) ||
    /^(REPLIED|CONVERSATION|MEETING|PROPOSAL|DEPOSIT|PAID|CLOSED|WON|LOST)$/i.test(pipelineStage);
  const suppressed = /opt.?out|unsubscrib|suppress|do not contact/i.test([
    getByHeader_(outreach, "Status"), getByHeader_(outreach, "Next Move"), pipelineStage,
  ].join(" "));
  if (!replied && !suppressed && !getByHeader_(outreach, "Follow-up Due")) {
    setByHeader_(outreach.sheet, outreach.row, outreach.headers, "Follow-up Due", due);
  }
  const actualDue = getByHeader_(outreach, "Follow-up Due") || due;
  upsertPipeline_(spreadsheet, opportunity, outreach, stamp, actualDue, replied || suppressed);
  // Legacy TODAY is now hidden reference history. The live queue is always
  // derived from matching OUTREACH + OPPORTUNITIES; no TODAY row mutation.
}

function upsertPipeline_(spreadsheet, opportunity, outreach, stamp, due, replied) {
  const sheet = requiredSheet_(spreadsheet, "PIPELINE");
  const headers = headerMap_(sheet);
  const id = getByHeader_(outreach, "Opportunity ID");
  let row = findOpportunityRow_(sheet, id);
  const isNew = !row;
  if (!row) {
    sheet.appendRow(new Array(sheet.getLastColumn()).fill(""));
    row = sheet.getLastRow();
    setByHeader_(sheet, row, headers, "Opportunity ID", id);
  }
  const existing = { sheet: sheet, row: row, headers: headers };
  const stage = getByHeader_(existing, "Stage").toUpperCase();
  // Never destroy an existing real reply, conversation, proposal, payment or opt-out.
  if (isNew || !stage || stage === "SENT" || stage === "READY") {
    setByHeader_(sheet, row, headers, "Stage", "SENT");
  }
  setIfBlank_(existing, "Company", getByHeader_(opportunity, "Company") || getByHeader_(outreach, "Company"));
  setIfBlank_(existing, "Person", getByHeader_(outreach, "Person"));
  setIfBlank_(existing, "Offer Lane", getByHeader_(opportunity, "Offer Lane") || "Web Design + Development");
  const tz = spreadsheet.getSpreadsheetTimeZone() || "America/Los_Angeles";
  const sentDate = Utilities.formatDate(stamp, tz, "yyyy-MM-dd");
  setIfBlank_(existing, "First Touch", sentDate);
  setIfBlank_(existing, "Last Touch", sentDate);
  if (!replied && !getByHeader_(existing, "Reply?") && !getByHeader_(existing, "Next Action Date")) {
    setIfBlank_(existing, "Next Action", "Review replies; follow up only if no response or opt-out");
    setIfBlank_(existing, "Next Action Date", due);
  }
  if (isNew) {
    setIfBlank_(existing, "Outcome / Learning", "Sent recorded by Mark; no reply or commercial outcome inferred.");
    setIfBlank_(existing, "Source", getByHeader_(outreach, "Experiment Tag") || "V10 / USER SEND");
    setIfBlank_(existing, "Message Angle", getByHeader_(outreach, "Subject"));
  }
}


function recordOutcome_(id, outcome, amount, note) {
  const stage = String(outcome || "").trim().toUpperCase();
  const allowed = ["REPLIED", "MEETING", "PROPOSAL", "WON", "LOST"];
  if (allowed.indexOf(stage) === -1) throw new Error("Unsupported outcome stage");

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  assertReconciliationSchema_(spreadsheet);
  const opportunity = requiredRecord_(spreadsheet, "OPPORTUNITIES", id);
  const outreach = requiredRecord_(spreadsheet, "OUTREACH", id);
  if (!getByHeader_(outreach, "Sent At") || !/^SENT$/i.test(getByHeader_(outreach, "Status"))) {
    throw new Error("Outcome can only be recorded after SENT is confirmed");
  }

  const sentStamp = parseDate_(getByHeaderRaw_(outreach, "Sent At"));
  if (!sentStamp) throw new Error("SENT timestamp is invalid");
  reconcileSentRecord_(spreadsheet, opportunity, outreach, sentStamp);

  const pipeline = requiredRecord_(spreadsheet, "PIPELINE", id);
  const current = getByHeader_(pipeline, "Stage").toUpperCase() || "SENT";
  const rank = { "SENT": 0, "REPLIED": 1, "CONVERSATION": 2, "MEETING": 2, "PROPOSAL": 3, "DEPOSIT": 4, "PAID": 4, "WON": 4, "CLOSED": 4, "LOST": 4 };
  if (current === "WON" && stage !== "WON") throw new Error("WON outcome cannot be downgraded");
  if (current === "LOST" && stage !== "LOST") throw new Error("LOST outcome cannot be reopened through this action");
  if ((rank[stage] || 0) < (rank[current] || 0)) throw new Error("Outcome stage cannot move backward");

  const today = todayInSheet_(spreadsheet);
  setByHeader_(pipeline.sheet, pipeline.row, pipeline.headers, "Stage", stage);
  setByHeader_(pipeline.sheet, pipeline.row, pipeline.headers, "Last Touch", today);

  if (stage !== "LOST") {
    setByHeader_(outreach.sheet, outreach.row, outreach.headers, "Reply?", "YES");
    setByHeader_(outreach.sheet, outreach.row, outreach.headers, "Reply Type", "POSITIVE");
    setByHeader_(pipeline.sheet, pipeline.row, pipeline.headers, "Reply?", "YES");
    setByHeader_(pipeline.sheet, pipeline.row, pipeline.headers, "Qualified Conversation?", stage === "REPLIED" ? "UNKNOWN" : "YES");
    setByHeader_(outreach.sheet, outreach.row, outreach.headers, "Follow-up Due", "");
  }

  const numericAmount = amount === "" || amount == null ? "" : Number(String(amount).replace(/[$,]/g, ""));
  if (numericAmount !== "" && (!Number.isFinite(numericAmount) || numericAmount < 0)) throw new Error("Outcome amount must be a non-negative number");
  if (stage === "PROPOSAL" && numericAmount !== "") setByHeader_(pipeline.sheet, pipeline.row, pipeline.headers, "Proposal $", numericAmount);
  if (stage === "WON" && numericAmount !== "") setByHeader_(pipeline.sheet, pipeline.row, pipeline.headers, "Revenue $", numericAmount);

  const nextByStage = {
    "REPLIED": "Reply and qualify the opportunity",
    "MEETING": "Run discovery and define scope",
    "PROPOSAL": "Follow up on proposal",
    "WON": "Begin delivery",
    "LOST": "Closed — preserve learning"
  };
  setByHeader_(pipeline.sheet, pipeline.row, pipeline.headers, "Next Action", nextByStage[stage]);
  setByHeader_(pipeline.sheet, pipeline.row, pipeline.headers, "Next Action Date", stage === "WON" || stage === "LOST" ? "" : today);
  setByHeader_(outreach.sheet, outreach.row, outreach.headers, "Next Move", nextByStage[stage]);

  const cleanNote = String(note || "").trim();
  appendByHeader_(pipeline.sheet, pipeline.row, pipeline.headers, "Outcome / Learning",
    stage + " recorded " + today + (cleanNote ? ": " + cleanNote : "."));
  SpreadsheetApp.flush();
  return json_({ ok: true, id: id, outcome: stage });
}

function reject_(id, reason) {
  const cleanReason = String(reason || "").trim();
  if (!cleanReason) return json_({ ok: false, error: "A rejection reason is required" });
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const opportunity = requiredRecord_(spreadsheet, "OPPORTUNITIES", id);
  const outreach = requiredRecord_(spreadsheet, "OUTREACH", id);
  if (getByHeader_(outreach, "Sent At") || /^SENT$/i.test(getByHeader_(outreach, "Status"))) {
    throw new Error("A SENT prospect must not be changed into REJECTED");
  }
  const stamp = Utilities.formatDate(new Date(), spreadsheet.getSpreadsheetTimeZone() || "America/Los_Angeles", "yyyy-MM-dd");
  [opportunity, outreach].forEach(function (record) {
    setByHeader_(record.sheet, record.row, record.headers, "Status", "REJECTED");
    appendByHeader_(record.sheet, record.row, record.headers, "Notes", "Rejected " + stamp + ": " + cleanReason);
  });
  setByHeader_(outreach.sheet, outreach.row, outreach.headers, "Next Move", "Do not send: " + cleanReason);
  SpreadsheetApp.flush();
  return json_({ ok: true, id: id, status: "REJECTED" });
}

function businessDayOffset_(stamp, days, timezone) {
  const localDate = Utilities.formatDate(stamp, timezone, "yyyy-MM-dd");
  const result = new Date(localDate + "T12:00:00Z");
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (result.getUTCDay() !== 0 && result.getUTCDay() !== 6) remaining -= 1;
  }
  return Utilities.formatDate(result, "Etc/UTC", "yyyy-MM-dd");
}

function parseDate_(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  // Sheets can contain a formatted calendar date string. Do not let JS interpret a
  // date-only string at UTC midnight: that shifts it into the previous California day.
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dateOnly = us
    ? us[3] + "-" + ("0" + us[1]).slice(-2) + "-" + ("0" + us[2]).slice(-2)
    : iso ? text : "";
  const stamp = new Date(dateOnly ? dateOnly + "T18:00:00Z" : text);
  return Number.isNaN(stamp.getTime()) ? null : stamp;
}

/** Guard actual LIVE headers before writing even one cell: no partial pipeline inserts. */
function assertReconciliationSchema_(spreadsheet) {
  const required = {
    "OPPORTUNITIES": ["Opportunity ID", "Status", "Company", "Offer Lane"],
    "OUTREACH": ["Opportunity ID", "Status", "Company", "Person", "Email / Channel", "Subject",
      "Draft Message", "Sent At", "Mark Approved?", "Follow-up Due", "Reply?", "Next Move"],
    "PIPELINE": ["Opportunity ID", "Company", "Person", "Stage", "Offer Lane",
      "First Touch", "Last Touch", "Reply?", "Next Action", "Next Action Date",
      "Outcome / Learning", "Source", "Message Angle"],
  };
  Object.keys(required).forEach(function(name) {
    const sheet = requiredSheet_(spreadsheet, name);
    const headers = headerMap_(sheet);
    required[name].forEach(function(column) { requiredColumn_(headers, column); });
  });

}

function requiredSheet_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error("Missing sheet: " + name);
  return sheet;
}

function requiredRecord_(spreadsheet, name, id) {
  const sheet = requiredSheet_(spreadsheet, name);
  const row = findOpportunityRow_(sheet, id);
  if (!row) throw new Error("Missing " + name + " row for opportunity ID: " + id);
  return { sheet: sheet, row: row, headers: headerMap_(sheet) };
}

function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return [];
  const headers = values[0].map(function (value) { return String(value || "").trim(); });
  return values.slice(1).filter(function (row) {
    return row.some(function (value) { return String(value || "").trim(); });
  }).map(function (row) {
    const record = {};
    headers.forEach(function (header, index) {
      if (header) record[header] = row[index] == null ? "" : row[index];
    });
    return record;
  });
}

function findOpportunityRow_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const finder = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(id).matchEntireCell(true).matchCase(true);
  const match = finder.findNext();
  return match ? match.getRow() : null;
}

function headerMap_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (!lastColumn) return {};
  const values = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const map = {};
  values.forEach(function (header, index) {
    const key = normalizeHeader_(header);
    if (key) map[key] = index + 1;
  });
  return map;
}

function requiredColumn_(headers, name) {
  const column = headers[normalizeHeader_(name)];
  if (!column) throw new Error("Missing column: " + name);
  return column;
}

function getByHeader_(record, name) {
  const column = requiredColumn_(record.headers, name);
  return String(record.sheet.getRange(record.row, column).getDisplayValue() || "").trim();
}

function getByHeaderRaw_(record, name) {
  const column = requiredColumn_(record.headers, name);
  return record.sheet.getRange(record.row, column).getValue();
}

function setByHeader_(sheet, row, headers, header, value) {
  const column = requiredColumn_(headers, header);
  sheet.getRange(row, column).setValue(value);
}

function setIfBlank_(record, header, value) {
  if (value && !getByHeader_(record, header)) {
    setByHeader_(record.sheet, record.row, record.headers, header, value);
  }
}

function appendByHeader_(sheet, row, headers, header, addition) {
  const column = requiredColumn_(headers, header);
  const cell = sheet.getRange(row, column);
  const existing = String(cell.getDisplayValue() || "").trim();
  if (existing.indexOf(addition) !== -1) return;
  cell.setValue(existing ? existing + " " + addition : addition);
}

function normalizeHeader_(value) {
  return String(value || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function authorized_(params, body) {
  const expected = configuredSecret_();
  const supplied = [params.secret, params.token, params.key, params.apiKey, body.secret, body.token, body.key, body.apiKey]
    .map(function (value) { return String(value || ""); });
  return supplied.indexOf(expected) !== -1;
}

function configuredSecret_() {
  const properties = PropertiesService.getScriptProperties();
  const keys = ["PROSPECT_API_SECRET", "API_SECRET", "SECRET", "TOKEN"];
  for (let i = 0; i < keys.length; i += 1) {
    const value = properties.getProperty(keys[i]);
    if (value) return value;
  }
  throw new Error("Server secret not configured in Apps Script properties");
}

function safeMessage_(error) {
  if (error && error.message) return String(error.message).slice(0, 300);
  return "Unknown Apps Script error";
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}


/**
 * Second-stage materializer for the simplified funnel.
 * Research automation may only mark MARKET rows QUALIFIED — MATERIALIZE after a
 * bounded evidence pass. This Sheet-owned worker independently finds a public
 * email on the owned website, creates the canonical READY pair, verifies it,
 * then marks MARKET PROMOTE. No email is ever sent here.
 */
function runQualifiedMaterializer() {
  return withLock_(function () { return materializeQualified_(); });
}

function installProspectMaterializerTrigger() {
  const handler = "runQualifiedMaterializer";
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === handler) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger(handler).timeBased().everyMinutes(1).create();
  return { ok: true, handler: handler, cadenceMinutes: 1 };
}

function materializeQualified_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const market = requiredSheet_(spreadsheet, "MARKET");
  const opportunities = requiredSheet_(spreadsheet, "OPPORTUNITIES");
  const outreach = requiredSheet_(spreadsheet, "OUTREACH");
  const marketHeaders = headerMap_(market);
  const oppHeaders = headerMap_(opportunities);
  const outHeaders = headerMap_(outreach);
  const values = market.getDataRange().getDisplayValues();
  const screenColumn = requiredColumn_(marketHeaders, "Screen") - 1;
  const idColumn = requiredColumn_(marketHeaders, "Market ID") - 1;
  const companyColumn = requiredColumn_(marketHeaders, "Company / Person") - 1;
  const websiteColumn = requiredColumn_(marketHeaders, "Website") - 1;
  const businessColumn = requiredColumn_(marketHeaders, "Business Signal") - 1;
  const digitalColumn = requiredColumn_(marketHeaders, "Digital Signal") - 1;
  const economicsColumn = requiredColumn_(marketHeaders, "Economics Proxy") - 1;
  const offerColumn = requiredColumn_(marketHeaders, "Offer Lane") - 1;
  const reasonColumn = requiredColumn_(marketHeaders, "Reason") - 1;
  const signalColumn = requiredColumn_(marketHeaders, "Signal Strength") - 1;
  const checkedColumn = requiredColumn_(marketHeaders, "Last Checked") - 1;
  const stats = { ok: true, checked: 0, materialized: 0, noOwnedEmail: 0, rebuildConflict: 0, alreadyMaterialized: 0, failures: [], timeBudgetHit: false };
  // Output-bound, not attempt-bound: keep advancing through terminal failures until
  // five READY pairs are created or the Apps Script execution budget is nearly spent.
  const readyTarget = 5;
  const deadlineMs = Date.now() + (4.5 * 60 * 1000);

  const candidates = [];
  for (let index = 1; index < values.length; index += 1) {
    const row = values[index];
    if (String(row[screenColumn] || "").trim().toUpperCase() !== "QUALIFIED — MATERIALIZE") continue;
    const signal = String(row[signalColumn] || "").trim().toUpperCase();
    candidates.push({ index: index, row: row, rank: signal === "P1" ? 0 : signal === "P2" ? 1 : 2 });
  }
  candidates.sort(function (a, b) { return a.rank - b.rank || a.index - b.index; });

  for (let candidateIndex = 0; candidateIndex < candidates.length && stats.materialized < readyTarget; candidateIndex += 1) {
    if (Date.now() >= deadlineMs) { stats.timeBudgetHit = true; break; }
    const index = candidates[candidateIndex].index;
    const row = candidates[candidateIndex].row;
    stats.checked += 1;
    const marketId = String(row[idColumn] || "").trim();
    const company = String(row[companyColumn] || "").trim();
    const website = String(row[websiteColumn] || "").trim();
    if (!marketId || !company || !website) {
      stats.failures.push(marketId || ("row " + (index + 1)) + ": missing market ID/company/website");
      continue;
    }

    const existingOpportunityId = opportunityIdForMarket_(opportunities, marketId);
    if (existingOpportunityId) {
      setByHeader_(market, index + 1, marketHeaders, "Screen", "PROMOTE");
      appendByHeader_(market, index + 1, marketHeaders, "Reason", "Existing operational record " + existingOpportunityId + " confirmed during materialization.");
      stats.alreadyMaterialized += 1;
      continue;
    }

    const emailEvidence = findOwnedSiteEmail_(website);
    if (emailEvidence.rebuildConflict) {
      stats.rebuildConflict += 1;
      setByHeader_(market, index + 1, marketHeaders, "Screen", "REJECT — ACTIVE REBUILD CONFLICT");
      setByHeader_(market, index + 1, marketHeaders, "Last Checked", todayInSheet_(spreadsheet));
      appendByHeader_(market, index + 1, marketHeaders, "Reason", "Materializer recheck found an active website replacement signal on the owned site; qualification revoked before contact creation.");
      continue;
    }
    if (!emailEvidence.email) {
      stats.noOwnedEmail += 1;
      setByHeader_(market, index + 1, marketHeaders, "Screen", "REJECT — NO VERIFIED CHANNEL");
      setByHeader_(market, index + 1, marketHeaders, "Last Checked", todayInSheet_(spreadsheet));
      appendByHeader_(market, index + 1, marketHeaders, "Reason", "Materializer bounded first-party check found no verified usable email channel; terminalized so this row cannot starve newer qualified inventory.");
      continue;
    }

    const business = String(row[businessColumn] || "").trim();
    const gap = String(row[digitalColumn] || "").trim();
    const economics = String(row[economicsColumn] || "").trim();
    const offerLane = String(row[offerColumn] || "").trim() || "Web Design + Development";
    const reason = String(row[reasonColumn] || "").trim();
    const priority = String(row[signalColumn] || "").trim().toUpperCase() || "P2";
    const pain = qualificationSignal_(reason, "PAIN", "MEDIUM");
    const economicsSignal = qualificationSignal_(reason, "ECONOMICS", economics ? "MEDIUM" : "UNKNOWN");
    const authority = qualificationSignal_(reason, "AUTHORITY", "REALISTIC");
    const scope = qualificationSignal_(reason, "SCOPE", "PASS");
    const timing = qualificationSignal_(reason, "TIMING", "NONE");
    const intent = qualificationSignal_(reason, "INTENT", "NONE");
    const confidence = qualificationSignal_(reason, "CONFIDENCE", "MEDIUM");
    if (scope !== "PASS") {
      setByHeader_(market, index + 1, marketHeaders, "Screen", "REJECT — SCOPE CONFLICT");
      appendByHeader_(market, index + 1, marketHeaders, "Reason", "Materializer refused contact creation because SCOPE did not pass.");
      continue;
    }
    const opportunityId = nextOpportunityId_(opportunities);
    const person = company + " team";
    const role = "Company team";
    const microOffer = "One annotated homepage pass focused on the verified buyer-facing gap.";
    const intervention = "Clarify the strongest buyer-facing gap, surface the most credible proof earlier, and simplify the next step without replacing working operational systems.";
    const consequence = "A prospective buyer has to work harder than necessary to understand the business, trust the proof, or take the next step.";
    const subject = subjectForCompany_(company);
    const experimentArm = assignExperimentArm_(outreach, priority, opportunityId);
    const experimentTag = "REVENUE-SIGNAL | E01-" + experimentArm + " / " + (experimentArm === "A" ? "EVIDENCE-LED" : "DIALOGUE-FIRST");
    const draft = experimentArm === "A"
      ? draftForQualified_(company, gap, business, microOffer)
      : dialogueDraftForQualified_(company, gap, reason);
    const created = todayInSheet_(spreadsheet);
    const contactPath = emailEvidence.email + " — official company inbox published on owned website";

    const oppData = {
      "Opportunity ID": opportunityId,
      "Status": "V10 READY",
      "Company": company,
      "Website": website,
      "Person": person,
      "Role": role,
      "Contact Path": contactPath,
      "Business (FACT)": business,
      "Situation (FACT)": gap,
      "Consequence (INFERENCE)": consequence,
      "UNKNOWN": "Named decision maker not established; using a first-party company inbox published on the owned website.",
      "Service Idea": offerLane,
      "Micro-Offer": microOffer,
      "Offer Lane": offerLane,
      "Access": "VERIFIED BUSINESS INBOX / " + authority,
      "Economics": economicsSignal,
      "Need": pain,
      "Confidence": confidence,
      "Business Strength Evidence": business,
      "Digital Reality / Gap": gap,
      "Mark Intervention Delta": intervention,
      "Economic Justification": economics,
      "Customer Dream Outcome": "Understand the business, trust the proof, and take the next step quickly.",
      "Value Equation Lever": "Increase perceived likelihood and reduce evaluation effort.",
      "Value Gap Gate": "PASS: staged qualification plus owned-site email verification.",
      "Why Now / Booster": "TIMING=" + timing + " | INTENT=" + intent + " — " + reason,
      "Next Action": "Send manually in Zoho after review",
      "Market ID": marketId,
      "Source": "QUEUE MATERIALIZER / OWNED SITE / " + priority,
      "Created": created,
      "Notes": "READY-B. Public inbox independently extracted from " + emailEvidence.url + "."
    };
    const outData = {
      "Opportunity ID": opportunityId,
      "Status": "V10 READY",
      "Company": company,
      "Person": person,
      "Email / Channel": emailEvidence.email,
      "Subject": subject,
      "Observation": gap,
      "Commercial Relevance": consequence,
      "Why Mark": intervention,
      "Micro-Offer": microOffer,
      "Signal / Trigger": "TIMING=" + timing + " | INTENT=" + intent + " — " + reason,
      "Value Gap Hypothesis": gap,
      "Experiment Tag": experimentTag,
      "Founder-Minute Priority": priority,
      "Draft Message": draft,
      "Mark Approved?": "PENDING",
      "Sent At": "",
      "Follow-up Due": "",
      "Reply?": "NO",
      "Reply Type": "",
      "Next Move": "Send manually in Zoho after review",
      "Notes": "READY-B. Public inbox independently extracted from " + emailEvidence.url + "."
    };

    let oppRow = 0;
    let outRow = 0;
    try {
      oppRow = appendObjectRow_(opportunities, oppHeaders, oppData);
      outRow = appendObjectRow_(outreach, outHeaders, outData);
      SpreadsheetApp.flush();
      const verifiedOpportunity = requiredRecord_(spreadsheet, "OPPORTUNITIES", opportunityId);
      const verifiedOutreach = requiredRecord_(spreadsheet, "OUTREACH", opportunityId);
      if (getByHeader_(verifiedOpportunity, "Status") !== "V10 READY" ||
          getByHeader_(verifiedOutreach, "Status") !== "V10 READY" ||
          getByHeader_(verifiedOutreach, "Email / Channel") !== emailEvidence.email ||
          !getByHeader_(verifiedOutreach, "Subject") ||
          !getByHeader_(verifiedOutreach, "Draft Message")) {
        throw new Error("READY readback mismatch");
      }
      setByHeader_(market, index + 1, marketHeaders, "Screen", "PROMOTE");
      setByHeader_(market, index + 1, marketHeaders, "Last Checked", created);
      appendByHeader_(market, index + 1, marketHeaders, "Reason", "Materialized as " + opportunityId + " after owned-site email readback.");
      stats.materialized += 1;
    } catch (error) {
      // Keep a qualified candidate retryable; remove any partial pair created by this attempt.
      if (outRow && outRow === outreach.getLastRow()) outreach.deleteRow(outRow);
      if (oppRow && oppRow === opportunities.getLastRow()) opportunities.deleteRow(oppRow);
      stats.failures.push(marketId + ": " + safeMessage_(error));
    }
  }
  SpreadsheetApp.flush();
  return stats;
}

function appendObjectRow_(sheet, headers, data) {
  const lastColumn = sheet.getLastColumn();
  const headerValues = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const row = headerValues.map(function (header) {
    const key = String(header || "").trim();
    return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : "";
  });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function opportunityIdForMarket_(sheet, marketId) {
  const headers = headerMap_(sheet);
  const marketColumn = requiredColumn_(headers, "Market ID");
  const idColumn = requiredColumn_(headers, "Opportunity ID");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "";
  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
  for (let i = 0; i < values.length; i += 1) {
    if (String(values[i][marketColumn - 1] || "").trim() === marketId) {
      return String(values[i][idColumn - 1] || "").trim();
    }
  }
  return "";
}

function nextOpportunityId_(sheet) {
  const headers = headerMap_(sheet);
  const idColumn = requiredColumn_(headers, "Opportunity ID");
  const lastRow = sheet.getLastRow();
  let max = 0;
  if (lastRow >= 2) {
    const values = sheet.getRange(2, idColumn, lastRow - 1, 1).getDisplayValues();
    values.forEach(function (row) {
      const match = String(row[0] || "").match(/^V10-O(\d+)$/i);
      if (match) max = Math.max(max, Number(match[1]));
    });
  }
  return "V10-O" + ("000" + (max + 1)).slice(-3);
}

function todayInSheet_(spreadsheet) {
  return Utilities.formatDate(new Date(), spreadsheet.getSpreadsheetTimeZone() || "America/Los_Angeles", "yyyy-MM-dd");
}

function subjectForCompany_(company) {
  const clean = String(company || "your company").trim();
  return clean.match(/s$/i) ? "A few things on " + clean + "' site" : "A few things on " + clean + "'s site";
}

function draftForQualified_(company, gap, business, microOffer) {
  const safeCompany = String(company || "").trim();
  // Research fields intentionally use compact internal language. Sanitize them
  // before they ever become prospect-facing copy so source rows cannot claim
  // READY while the dashboard's human-language gate correctly rejects the draft.
  const observation = sentence_(prospectFacingText_(gap));
  const proof = sentence_(prospectFacingText_(business));
  const offer = prospectFacingText_(microOffer || "an annotated homepage pass showing what I'd tighten");
  return [
    "Hi " + safeCompany + " team,",
    "",
    "I was looking through the site and noticed " + observation,
    "",
    proof ? "The business itself looks stronger than that first impression suggests: " + proof : "The business looks stronger than that first impression suggests.",
    "",
    "If useful, I can send " + String(offer).replace(/^[Oo]ne /, "one ").replace(/\.$/, "") + ".",
    "",
    "Mark"
  ].join("\n");
}

function prospectFacingText_(value) {
  let text = String(value || "").trim();
  const replacements = [
    [/first-scroll/gi, "top of the homepage"],
    [/proof map/gi, "project examples"],
    [/buyer[- ]path/gi, "how customers move through the site"],
    [/procurement path/gi, "how procurement teams find what they need"],
    [/procurement-ready/gi, "easier for procurement teams to assess"],
    [/authority system/gi, "credibility"],
    [/conversion architecture/gi, "inquiry flow"],
    [/offer architecture/gi, "service structure"],
    [/intervention delta/gi, "specific improvement"],
    [/value gap/gi, "website gap"],
    [/micro-offer/gi, "useful idea"],
    [/owned experience/gi, "website"],
    [/digital representation/gi, "website"],
    [/proof layer/gi, "project proof"],
    [/qualification story/gi, "how customers assess fit"],
    [/application\/proof/gi, "application examples"],
    [/project-proof/gi, "project examples"],
    [/authority\/procurement/gi, "credibility and procurement information"]
  ];
  replacements.forEach(function (pair) { text = text.replace(pair[0], pair[1]); });
  return text;
}

function sentence_(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : text + ".";
}

function assignExperimentArm_(outreachSheet, priority, opportunityId) {
  const headers = headerMap_(outreachSheet);
  const tagColumn = requiredColumn_(headers, "Experiment Tag") - 1;
  const priorityColumn = requiredColumn_(headers, "Founder-Minute Priority") - 1;
  const targetPriority = String(priority || "").trim().toUpperCase() || "P2";
  let a = 0;
  let b = 0;

  if (outreachSheet.getLastRow() >= 2) {
    const values = outreachSheet.getRange(2, 1, outreachSheet.getLastRow() - 1, outreachSheet.getLastColumn()).getDisplayValues();
    values.forEach(function (row) {
      if (String(row[priorityColumn] || "").trim().toUpperCase() !== targetPriority) return;
      const tag = String(row[tagColumn] || "").toUpperCase();
      if (tag.indexOf("E01-A") !== -1) a += 1;
      if (tag.indexOf("E01-B") !== -1) b += 1;
    });
  }
  if (a < b) return "A";
  if (b < a) return "B";

  // Deterministic tie-breaker keeps retries sticky before the row is persisted.
  const digits = String(opportunityId || "").match(/(\d+)$/);
  return digits && Number(digits[1]) % 2 === 0 ? "A" : "B";
}

function dialogueDraftForQualified_(company, gap, reason) {
  const safeCompany = String(company || "").trim();
  const context = (String(gap || "") + " " + String(reason || "")).toLowerCase();
  let question = "Are you already planning to improve the website?";

  if (/(expansion|new location|new facility|opened|opening)/i.test(context)) {
    question = "Are you already updating the site around the recent expansion?";
  } else if (/(project|portfolio|case stud|finished work|representative work)/i.test(context)) {
    question = "Are you planning to bring more project proof forward on the site?";
  } else if (/(capabil|equipment|quality|rfq|procure|tolerance|inspection)/i.test(context)) {
    question = "Are you planning to strengthen the capability proof on the site?";
  } else if (/(service|commercial|residential|buyer path|estimate path|journey)/i.test(context)) {
    question = "Are you planning to simplify the service paths on the site?";
  }

  return [
    "Hi " + safeCompany + " team,",
    "",
    question,
    "",
    "Mark"
  ].join("\n");
}

function findOwnedSiteEmail_(website) {
  const root = normalizeWebsite_(website);
  if (!root) return { email: "", url: "", rebuildConflict: false };
  const pages = [root];
  const homepage = fetchPublicHtml_(root);
  if (hasActiveRebuildSignal_(homepage)) {
    return { email: "", url: root, rebuildConflict: true };
  }
  const sameSiteLinks = extractCandidateOwnedLinks_(root, homepage);
  sameSiteLinks.forEach(function (url) {
    if (pages.indexOf(url) === -1 && pages.length < 5) pages.push(url);
  });
  ["/contact", "/contact-us", "/about", "/about-us"].forEach(function (path) {
    const candidate = origin_(root) + path;
    if (pages.indexOf(candidate) === -1 && pages.length < 5) pages.push(candidate);
  });

  for (let i = 0; i < pages.length; i += 1) {
    const html = i === 0 ? homepage : fetchPublicHtml_(pages[i]);
    if (hasActiveRebuildSignal_(html)) {
      return { email: "", url: pages[i], rebuildConflict: true };
    }
    const email = extractEmail_(html);
    if (email) return { email: email, url: pages[i], rebuildConflict: false };
  }
  return { email: "", url: "", rebuildConflict: false };
}

function fetchPublicHtml_(url) {
  try {
    const response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: true,
      headers: { "User-Agent": "Mozilla/5.0 ProspectOS/10.0" }
    });
    const status = response.getResponseCode();
    return status >= 200 && status < 400 ? String(response.getContentText() || "") : "";
  } catch (_) {
    return "";
  }
}

function extractEmail_(html) {
  const decoded = String(html || "")
    .replace(/&#64;|&#x40;/gi, "@")
    .replace(/&#46;|&#x2e;/gi, ".");
  const mailto = decoded.match(/href\s*=\s*["'][^"']*mailto:([^"'?\s>]+)/i);
  if (mailto) {
    const safe = safePublicEmail_(mailto[1]);
    if (safe) return safe;
  }
  const visible = decoded
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const matches = visible.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [];
  for (let i = 0; i < matches.length; i += 1) {
    const safe = safePublicEmail_(matches[i]);
    if (safe) return safe;
  }
  return "";
}

function safePublicEmail_(value) {
  const email = String(value || "").trim().replace(/^mailto:/i, "").toLowerCase();
  if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)) return "";
  if (/\.(?:png|jpe?g|gif|svg|webp|css|js)$/i.test(email)) return "";
  if (/example\.(?:com|org|net)$/i.test(email)) return "";
  if (/^(?:no-?reply|do-?not-?reply|postmaster|abuse)@/i.test(email)) return "";
  return email;
}

function hasActiveRebuildSignal_(html) {
  const visible = String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  return /(?:new\s+(?:website|site).{0,50}(?:coming\s+soon|under\s+construction)|(?:website|site).{0,50}(?:coming\s+soon|under\s+construction)|(?:building|launching|developing)\s+(?:our\s+)?new\s+(?:website|site))/i.test(visible);
}

function qualificationSignal_(reason, key, fallback) {
  const pattern = new RegExp("(?:^|\\|\\s*)" + key + "\\s*=\\s*([^|—\\n]+)", "i");
  const match = String(reason || "").match(pattern);
  return match ? String(match[1] || "").trim().toUpperCase() : fallback;
}

function extractCandidateOwnedLinks_(root, html) {
  const links = [];
  const host = host_(root);
  const regex = /href\s*=\s*["']([^"'#]+)["']/ig;
  let match;
  while ((match = regex.exec(String(html || "")))) {
    const href = String(match[1] || "").trim();
    if (!/(contact|about|team|company)/i.test(href)) continue;
    const absolute = absoluteOwnedUrl_(root, href);
    if (absolute && host_(absolute) === host && links.indexOf(absolute) === -1) links.push(absolute);
    if (links.length >= 4) break;
  }
  return links;
}

function normalizeWebsite_(value) {
  let url = String(value || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url.replace(/\/$/, "");
}

function origin_(url) {
  const match = String(url || "").match(/^(https?:\/\/[^/]+)/i);
  return match ? match[1] : "";
}

function host_(url) {
  const match = String(url || "").match(/^https?:\/\/([^/:?#]+)/i);
  return match ? match[1].toLowerCase().replace(/^www\./, "") : "";
}

function absoluteOwnedUrl_(root, href) {
  if (/^https?:\/\//i.test(href)) return href.replace(/\/$/, "");
  const base = origin_(root);
  if (!base) return "";
  if (href.charAt(0) === "/") return base + href.replace(/\/$/, "");
  return base + "/" + href.replace(/^\.\//, "").replace(/\/$/, "");
}
