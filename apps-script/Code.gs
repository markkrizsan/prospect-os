const SPREADSHEET_ID = "1K2nfLH1ZBMJZLg0fiicnTJFBzobb3mCKt6rYsEmwR9M";
const READ_TABS = ["OUTREACH", "OPPORTUNITIES"];

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (!authorized_(params, {})) return json_({ ok: false, error: "Unauthorized" });

    const action = String(params.action || "list").toLowerCase();
    if (action !== "list") return json_({ ok: false, error: "Unsupported action" });

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
    const id = String(body.opportunityId || body.id || "").trim();
    if (!id) return json_({ ok: false, error: "Missing opportunity ID" });

    if (action === "MARK_SENT") return markSent_(id, body.sentAt);
    if (action === "REJECT") return reject_(id, body.reason);

    return json_({ ok: false, error: "Unsupported action" });
  } catch (error) {
    return json_({ ok: false, error: safeMessage_(error) });
  }
}

function list_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const data = {};

  READ_TABS.forEach(function (name) {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) throw new Error("Missing sheet: " + name);
    data[name] = sheetToObjects_(sheet);
  });

  return json_({
    ok: true,
    data: data,
    syncedAt: new Date().toISOString()
  });
}

function markSent_(id, sentAt) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const timestamp = sentAt ? new Date(sentAt) : new Date();
  let touched = 0;

  ["OPPORTUNITIES", "OUTREACH"].forEach(function (name) {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) return;
    const row = findOpportunityRow_(sheet, id);
    if (!row) return;

    const headers = headerMap_(sheet);
    setByHeader_(sheet, row, headers, "Status", "SENT");

    if (name === "OUTREACH") {
      setByHeader_(sheet, row, headers, "Sent At", timestamp);
      setByHeader_(sheet, row, headers, "Next Move", "Await reply / follow-up");
    }
    touched += 1;
  });

  if (!touched) throw new Error("Opportunity ID not found: " + id);
  SpreadsheetApp.flush();
  return json_({ ok: true, id: id, status: "SENT" });
}

function reject_(id, reason) {
  const cleanReason = String(reason || "").trim();
  if (!cleanReason) return json_({ ok: false, error: "A rejection reason is required" });

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Etc/GMT", "yyyy-MM-dd");
  let touched = 0;

  ["OPPORTUNITIES", "OUTREACH"].forEach(function (name) {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet) return;
    const row = findOpportunityRow_(sheet, id);
    if (!row) return;

    const headers = headerMap_(sheet);
    setByHeader_(sheet, row, headers, "Status", "REJECTED");

    if (name === "OUTREACH") {
      setByHeader_(sheet, row, headers, "Next Move", "Do not send — " + cleanReason);
    }

    appendByHeader_(
      sheet,
      row,
      headers,
      "Notes",
      "Rejected " + stamp + ": " + cleanReason
    );
    touched += 1;
  });

  if (!touched) throw new Error("Opportunity ID not found: " + id);
  SpreadsheetApp.flush();
  return json_({ ok: true, id: id, status: "REJECTED", reason: cleanReason });
}

function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return [];

  const headers = values[0].map(function (value) { return String(value || "").trim(); });
  return values.slice(1)
    .filter(function (row) { return row.some(function (value) { return String(value || "").trim(); }); })
    .map(function (row) {
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

  const finder = sheet
    .getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(id)
    .matchEntireCell(true)
    .matchCase(true);

  const match = finder.findNext();
  return match ? match.getRow() : null;
}

function headerMap_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (!lastColumn) return {};

  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  const map = {};
  headers.forEach(function (header, index) {
    const key = normalizeHeader_(header);
    if (key) map[key] = index + 1;
  });
  return map;
}

function setByHeader_(sheet, row, headers, header, value) {
  const column = headers[normalizeHeader_(header)];
  if (!column) return;
  sheet.getRange(row, column).setValue(value);
}

function appendByHeader_(sheet, row, headers, header, addition) {
  const column = headers[normalizeHeader_(header)];
  if (!column) return;

  const cell = sheet.getRange(row, column);
  const existing = String(cell.getDisplayValue() || "").trim();
  const next = existing ? existing + " " + addition : addition;
  cell.setValue(next);
}

function normalizeHeader_(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function authorized_(params, body) {
  const expected = configuredSecret_();
  const supplied = [
    params.secret,
    params.token,
    params.key,
    params.apiKey,
    body.secret,
    body.token,
    body.key,
    body.apiKey
  ].map(function (value) { return String(value || ""); });

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
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
