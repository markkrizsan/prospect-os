const SPREADSHEET_ID = "1K2nfLH1ZBMJZLg0fiicnTJFBzobb3mCKt6rYsEmwR9M";
// Do not drop MARKET from this payload: the live dashboard needs research and backlog views.
const READ_TABS = ["MARKET", "OUTREACH", "OPPORTUNITIES"];

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

    const id = String(body.opportunityId || body.id || "").trim();
    if (!id) return json_({ ok: false, error: "Missing opportunity ID" });
    if (action === "MARK_SENT") return withLock_(function () { return markSent_(id, body.sentAt); });
    if (action === "REJECT") return withLock_(function () { return reject_(id, body.reason); });
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
  return json_({ ok: true, data: data, syncedAt: new Date().toISOString() });
}

function markSent_(id, sentAt) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
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
  const sheet = requiredSheet_(spreadsheet, "OUTREACH");
  const headers = headerMap_(sheet);
  const values = sheet.getDataRange().getDisplayValues();
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
    const stamp = parseDate_(record[sentColumn]);
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
  const replied = /^(YES|TRUE|REPLIED|POSITIVE|NEGATIVE)$/i.test(getByHeader_(outreach, "Reply?"));
  if (!replied && !getByHeader_(outreach, "Follow-up Due")) {
    setByHeader_(outreach.sheet, outreach.row, outreach.headers, "Follow-up Due", due);
  }
  upsertPipeline_(spreadsheet, opportunity, outreach, stamp, due, replied);
  // TODAY is a convenience list, not the source of truth. Remove obsolete displayed READY cards.
  removeToday_(spreadsheet, getByHeader_(outreach, "Opportunity ID"));
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
    setIfBlank_(existing, "Source", "V10 / USER SEND");
    setIfBlank_(existing, "Message Angle", getByHeader_(outreach, "Subject Line"));
  }
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
  removeToday_(spreadsheet, id);
  SpreadsheetApp.flush();
  return json_({ ok: true, id: id, status: "REJECTED" });
}

function removeToday_(spreadsheet, id) {
  const sheet = requiredSheet_(spreadsheet, "TODAY");
  if (sheet.getLastRow() < 8) return;
  const headers = sheet.getRange(7, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const idColumn = headers.findIndex(function (value) { return normalizeHeader_(value) === normalizeHeader_("Opportunity ID"); }) + 1;
  if (!idColumn) throw new Error("TODAY Opportunity ID header missing");
  const values = sheet.getRange(8, idColumn, sheet.getLastRow() - 7, 1).getDisplayValues();
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (String(values[i][0] || "").trim() === id) sheet.deleteRow(i + 8);
  }
  // Re-number only live READY cards, retaining HOLD / RESEARCH labels.
  if (sheet.getLastRow() < 8) return;
  const rows = sheet.getRange(8, 1, sheet.getLastRow() - 7, Math.max(9, sheet.getLastColumn())).getDisplayValues();
  let priority = 0;
  rows.forEach(function (record, index) {
    if (String(record[8] || "").trim().toUpperCase() === "V10 READY") {
      sheet.getRange(index + 8, 1).setValue(String(++priority));
    }
  });
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
  const stamp = value instanceof Date ? value : new Date(value);
  return Number.isNaN(stamp.getTime()) ? null : stamp;
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
