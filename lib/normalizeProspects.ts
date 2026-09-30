import type { Prospect, ProspectData, ProspectView, RunMetrics } from "@/lib/types";

type UnknownRecord = Record<string, unknown>;

export function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function pick(record: UnknownRecord, ...aliases: string[]): string {
  const entries = new Map(Object.entries(record).map(([key, value]) => [normalizeKey(key), value]));
  for (const alias of aliases) {
    const value = entries.get(normalizeKey(alias));
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function asRecords(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value)) return [];
  if (value.every((item) => item && typeof item === "object" && !Array.isArray(item))) return value as UnknownRecord[];
  if (value.length > 1 && Array.isArray(value[0])) {
    const headers = (value[0] as unknown[]).map((header) => String(header ?? ""));
    return value.slice(1).filter(Array.isArray).map((row) => Object.fromEntries(
      headers.map((header, index) => [header, (row as unknown[])[index] ?? ""]),
    ));
  }
  return [];
}

function collect(payload: unknown): Array<{ source: string; record: UnknownRecord }> {
  const root = payload && typeof payload === "object" ? payload as UnknownRecord : {};
  const data = root.data && typeof root.data === "object" ? root.data as UnknownRecord : root;
  const output: Array<{ source: string; record: UnknownRecord }> = [];
  for (const source of ["MARKET", "OUTREACH", "OPPORTUNITIES"]) {
    const match = Object.entries(data).find(([key]) => normalizeKey(key) === normalizeKey(source));
    for (const record of asRecords(match?.[1])) output.push({ source, record });
  }
  if (!output.length) {
    const generic = data.records ?? data.prospects ?? data.rows ?? root.records ?? root.prospects;
    for (const record of asRecords(generic)) output.push({ source: pick(record, "Source Tab", "Source", "Sheet") || "OPPORTUNITIES", record });
  }
  if (!output.length && Array.isArray(payload)) {
    for (const record of asRecords(payload)) output.push({ source: pick(record, "Source Tab", "Source") || "OPPORTUNITIES", record });
  }
  return output;
}

function prospect(record: UnknownRecord, source: string): Prospect {
  return {
    id: pick(record, "Opportunity ID", "Market ID", "Prospect ID", "ID"),
    source: pick(record, "Source Tab", "Sheet") || source.toUpperCase(),
    version: pick(record, "Conversation Engine", "Engine Version", "Version", "CE Version"),
    status: pick(record, "Status", "Screen", "State", "Outreach Status", "Stage"),
    company: pick(record, "Company", "Company / Person", "Business", "Prospect"),
    person: pick(record, "Person", "Contact Name", "Contact", "Decision Maker"),
    role: pick(record, "Role", "Title", "Person Role"),
    website: pick(record, "Website", "Company URL", "URL"),
    contactPath: pick(record, "Contact Path", "Email / Channel", "Verified Email", "Recipient Email", "Email", "Contact URL", "Contact Method"),
    businessStrength: pick(record, "Business Strength Evidence", "Business Strength", "Business (FACT)", "Business Signal", "Strength"),
    commercialGap: pick(record, "Digital Reality / Gap", "Digital/Commercial Gap", "Digital Commercial Gap", "Digital Signal", "Commercial Gap", "Digital Gap"),
    interventionDelta: pick(record, "Mark Intervention Delta", "Intervention Delta", "Mark Delta"),
    economicJustification: pick(record, "Economic Justification", "Commercial Justification", "Economics Proxy", "Economic Case"),
    whyNow: pick(record, "Why Now / Booster", "Signal / Trigger", "Why Now/Trigger", "Why Now", "Trigger"),
    serviceIdea: pick(record, "Service Idea", "Offer Lane", "Service", "Offer Idea"),
    microOffer: pick(record, "Micro-Offer", "Micro Offer"),
    subjectLine: pick(record, "Subject Line", "Email Subject", "Subject"),
    outreachDraft: pick(record, "Finished Outreach Draft", "Outreach Draft", "Draft Message", "Draft", "Message"),
    experimentTag: pick(record, "Experiment Tag", "Experiment", "Test Variant"),
    zohoUrl: pick(record, "Zoho URL", "Zoho Record URL", "CRM URL"),
    sentAt: pick(record, "Sent At", "Sent Date", "Sent Timestamp"),
    repliedAt: pick(record, "Replied At", "Reply At", "Reply Date"),
    cityState: pick(record, "City / State", "Location"),
    industry: pick(record, "Industry", "Category"),
    signalStrength: pick(record, "Signal Strength", "Priority"),
    screeningReason: pick(record, "Reason", "Screening Reason"),
    notes: pick(record, "Notes"),
  };
}

const READY_STATES = new Set(["ready", "ready to send", "v10 ready"]);

function isReadyState(value: string): boolean {
  return READY_STATES.has(normalizeKey(value));
}

/**
 * OUTREACH owns lifecycle, delivery channel, subject, draft, and sent timestamp.
 * OPPORTUNITIES owns commercial research and service-fit facts.
 * MARKET stays a separate research view and never overrides either source.
 * Conflicting or duplicate operational rows are visible but NEVER SEND NOW.
 */
function joinOperational(
  input: Array<{ source: string; record: UnknownRecord }>,
): { prospects: Prospect[]; issues: string[] } {
  const groups = new Map<string, { opportunity: Prospect[]; outreach: Prospect[] }>();
  const issues: string[] = [];
  const market: Prospect[] = [];

  input.forEach(({ source, record }) => {
    const item = prospect(record, source);
    if (!item.id) {
      if (Object.values(record).some((value) => String(value ?? "").trim())) {
        issues.push(source.toUpperCase() + ": operational row missing a durable ID");
      }
      return;
    }
    const tab = source.toUpperCase();
    if (tab === "MARKET") {
      market.push(item);
      return;
    }
    const group = groups.get(item.id) ?? { opportunity: [], outreach: [] };
    if (tab === "OUTREACH") group.outreach.push(item);
    else group.opportunity.push(item);
    groups.set(item.id, group);
  });

  const operational: Prospect[] = [];
  groups.forEach((group, id) => {
    const opportunity = group.opportunity[0];
    const outreach = group.outreach[0];
    const entryIssues: string[] = [];
    if (group.opportunity.length > 1) entryIssues.push("duplicate OPPORTUNITIES ID");
    if (group.outreach.length > 1) entryIssues.push("duplicate OUTREACH ID");
    if (!opportunity) entryIssues.push("missing OPPORTUNITIES row");
    // OPPORTUNITIES may legitimately contain research/re-audit backlog before an
    // OUTREACH row exists. Only an operational claim (READY/SENT/REJECTED) without
    // OUTREACH is an integrity fault.
    const opportunityState = normalizeKey(opportunity?.status || "");
    const opportunityClaimsOperational = Boolean(opportunity) && (
      isReadyState(opportunity?.status || "") ||
      opportunityState === "sent"
    );
    if (!outreach && opportunityClaimsOperational) entryIssues.push("missing OUTREACH row");

    const combined: Prospect = {
      ...(opportunity ?? outreach)!,
      source: outreach ? "OUTREACH" : "OPPORTUNITIES",
      id,
      company: opportunity?.company || outreach?.company || "",
      person: outreach?.person || opportunity?.person || "",
      contactPath: outreach?.contactPath || "",
      subjectLine: outreach?.subjectLine || "",
      outreachDraft: outreach?.outreachDraft || "",
      experimentTag: outreach?.experimentTag || "",
      sentAt: outreach?.sentAt || "",
      repliedAt: outreach?.repliedAt || "",
      notes: [opportunity?.notes, outreach?.notes].filter(Boolean).join("\n"),
    };
    const opState = normalizeKey(opportunity?.status || "");
    const outState = normalizeKey(outreach?.status || "");
    // OUTREACH owns lifecycle. OPPORTUNITIES can carry research-stage labels such as
    // NEEDS CHANNEL while OUTREACH is RE-AUDIT/HOLD. Only a READY claim from OUTREACH
    // without matching READY evidence, or a terminal SENT/REJECTED disagreement, is
    // a real cross-source integrity fault.
    const terminalStates = new Set(["sent", "rejected"]);
    const readyConflict = Boolean(outreach && isReadyState(outreach.status) &&
      !isReadyState(opportunity?.status || ""));
    const terminalConflict = Boolean(opportunity && outreach &&
      (terminalStates.has(opState) || terminalStates.has(outState)) &&
      opState !== outState);
    if (readyConflict || terminalConflict) {
      entryIssues.push("OPPORTUNITIES/OUTREACH status disagreement");
    }
    if (opportunity?.company && outreach?.company &&
        normalizeKey(opportunity.company) !== normalizeKey(outreach.company)) {
      entryIssues.push("company name disagreement");
    }
    const states = [opState, outState];
    if (states.some((state) => state === "sent") || combined.sentAt) combined.status = "SENT";
    else if (states.some((state) => state === "rejected")) combined.status = "REJECTED";
    else if (states.some((state) => state.includes("hold"))) combined.status = "V10 HOLD";
    else if (states.some((state) => state.includes("re audit"))) combined.status = "V10 RE-AUDIT";
    else combined.status = outreach?.status || opportunity?.status || "";
    if (combined.status === "SENT" && !combined.sentAt) entryIssues.push("SENT without timestamp");

    // OUTREACH is the lifecycle owner: a legacy OPPORTUNITIES READY label
    // is not a current send request when OUTREACH is deliberately RE-AUDIT/HOLD.
    const wantsReady = Boolean(outreach && isReadyState(outreach.status));
    const readyGate = Boolean(
      opportunity && outreach && group.opportunity.length === 1 && group.outreach.length === 1 &&
      isV10(combined) &&
      isReadyState(opportunity.status) && isReadyState(outreach.status) &&
      !combined.sentAt && extractRecipientEmail(combined.contactPath) &&
      combined.company && opportunity.website && combined.subjectLine.trim() &&
      combined.outreachDraft.trim() && combined.businessStrength &&
      combined.commercialGap && combined.interventionDelta &&
      combined.economicJustification && combined.microOffer &&
      outreachQualityIssues(combined).length === 0 &&
      entryIssues.length === 0
    );
    combined.readyValidated = readyGate;
    if (wantsReady && !readyGate) entryIssues.push("READY claim fails joined-record validation");
    combined.stateIssues = entryIssues;
    entryIssues.forEach((issue) => issues.push(id + ": " + issue));
    operational.push(combined);
  });
  return { prospects: [...market, ...operational], issues };
}

export function isV10(item: Prospect): boolean {
  const version = normalizeKey(item.version);
  return version === "v10" || version === "10" || item.id.toLowerCase().startsWith("v10") || normalizeKey(item.status).startsWith("v10 ");
}

const PROSPECT_FACING_JARGON = [
  "first-scroll",
  "proof map",
  "buyer path",
  "buyer-path",
  "procurement path",
  "procurement-ready",
  "authority system",
  "conversion architecture",
  "offer architecture",
  "intervention delta",
  "value gap",
  "micro-offer",
  "owned experience",
  "digital representation",
  "proof layer",
  "qualification story",
  "application/proof",
  "project-proof",
  "authority/procurement",
];

export function outreachQualityIssues(item: Pick<Prospect, "subjectLine" | "outreachDraft">): string[] {
  const text = `${item.subjectLine}\n${item.outreachDraft}`.toLowerCase();
  return PROSPECT_FACING_JARGON.filter((phrase) => text.includes(phrase));
}

/** Extract an actual email from a verified Sheet contact field, preserving annotations outside the clipboard. */
export function extractRecipientEmail(contactPath: string): string {
  if (/\b(guessed|unverified|not verified|inferred|hypothetical|unconfirmed|needs verification)\b/i.test(contactPath)) return "";
  return contactPath.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
}

/** A single clipboard packet that can be split into the Zoho To, Subject and message fields. */
export function composeOutboundPacket(item: Pick<Prospect, "contactPath" | "subjectLine" | "outreachDraft">): string {
  const recipient = extractRecipientEmail(item.contactPath);
  const subject = item.subjectLine.trim();
  const body = item.outreachDraft.trim();
  if (!recipient || !subject || !body) return "";
  return `To: ${recipient}\nSubject: ${subject}\n\n${body}`;
}

export function outreachCopyIssues(item: Pick<Prospect, "contactPath" | "subjectLine" | "outreachDraft">): string[] {
  const issues = outreachQualityIssues(item);
  if (!extractRecipientEmail(item.contactPath)) issues.push("verified recipient email missing");
  if (!item.subjectLine.trim()) issues.push("subject line missing");
  if (!item.outreachDraft.trim()) issues.push("draft message missing");
  return issues;
}

function isRejectedState(status: string): boolean {
  return status.includes("reject") || status.includes("opt out") || status.includes("suppressed");
}

function isPromotedMarketState(status: string): boolean {
  return status === "promote" || status === "promoted";
}

/**
 * The operator UI intentionally exposes only meaningful lifecycle views.
 * QUEUE is the entire non-terminal backlog: discovery/research/hold/re-audit and
 * any incomplete operational record. Internal source-stage labels remain visible
 * inside cards but never become separate dashboard tabs.
 */
export function inView(item: Prospect, view: ProspectView): boolean {
  const status = normalizeKey(item.status);
  const sent = Boolean(item.sentAt) || status === "sent";
  const replied = Boolean(item.repliedAt) || status.includes("replied") || status === "reply";
  const rejected = isRejectedState(status);
  const ready = item.readyValidated === true && !item.sentAt;

  if (view === "send-now") return ready;
  if (view === "sent") return sent;
  if (view === "replied") return replied;
  if (view === "rejected") return rejected;
  if (view === "queue") {
    if (ready || sent || replied || rejected) return false;
    if (item.source.toLowerCase() === "market" && isPromotedMarketState(status)) return false;
    return true;
  }
  return false;
}

function runNumber(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** RUNS is an acceptance ledger, not a source of prospects. Missing metrics never imply zero. */
function latestRun(payload: unknown): RunMetrics | null {
  const root = payload && typeof payload === "object" ? payload as UnknownRecord : {};
  const data = root.data && typeof root.data === "object" ? root.data as UnknownRecord : root;
  const pair = Object.entries(data).find(([key]) => normalizeKey(key) === "runs");
  const records = asRecords(pair?.[1]).filter((record) => pick(record, "Run ID (UTC)"));
  const last = records.at(-1);
  if (!last) return null;
  const n = (key: string) => runNumber(pick(last, key));
  return {
    id: pick(last, "Run ID (UTC)"),
    localTime: pick(last, "Local Run Time"),
    mode: pick(last, "Mode"),
    readyStart: n("READY Start"),
    screened: n("Cheap Screened"),
    audited: n("Deep Audited"),
    passed: n("Substantive PASS"),
    contactsVerified: n("Contacts Verified"),
    readyAdded: n("READY Persisted"),
    readyEnd: n("READY End"),
    gap: n("Gap To Five"),
    blocker: pick(last, "Primary Blocker"),
    persistence: pick(last, "Persistence + Evidence"),
  };
}

export function normalizePayload(payload: unknown, syncedAt = new Date().toISOString()): ProspectData {
  const { prospects, issues: consistencyIssues } = joinOperational(collect(payload));
  const views: ProspectView[] = ["send-now", "queue", "rejected", "sent", "replied"];
  const root = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as UnknownRecord : {};
  return {
    latestRun: latestRun(payload),
    syncedAt,
    prospects,
    consistencyIssues,
    capabilities: Array.isArray(root.capabilities) ? root.capabilities.map((value) => String(value ?? "").trim()).filter(Boolean) : [],
    counts: Object.fromEntries(views.map((view) => [view, prospects.filter((item) => inView(item, view)).length])) as Record<ProspectView, number>,
  };
}
