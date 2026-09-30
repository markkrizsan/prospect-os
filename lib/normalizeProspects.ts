import type { Prospect, ProspectData, ProspectView } from "@/lib/types";

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

function merge(items: Prospect[]): Prospect[] {
  const result = new Map<string, Prospect>();
  items.forEach((item, index) => {
    const key = item.id || `${item.company}|${item.person}` || `row-${index}`;
    const current = result.get(key);
    if (!current) return void result.set(key, item);
    const next = { ...current };
    for (const field of Object.keys(item) as Array<keyof Prospect>) if (item[field]) next[field] = item[field];
    result.set(key, next);
  });
  return [...result.values()];
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

export function inView(item: Prospect, view: ProspectView): boolean {
  const status = normalizeKey(item.status);
  if (view === "send-now") return isV10(item) && ["outreach", "opportunities"].includes(item.source.toLowerCase()) && ["ready", "ready to send", "v10 ready"].includes(status) && !item.sentAt;
  if (view === "market") return item.source.toLowerCase() === "market";
  if (view === "research") return status.includes("research");
  if (view === "hold") return status.includes("hold");
  if (view === "sent") return Boolean(item.sentAt) || status === "sent";
  if (view === "replied") return Boolean(item.repliedAt) || status.includes("replied") || status === "reply";
  return true;
}

export function normalizePayload(payload: unknown, syncedAt = new Date().toISOString()): ProspectData {
  const prospects = merge(collect(payload).map(({ source, record }) => prospect(record, source)));
  const views: ProspectView[] = ["send-now", "market", "research", "hold", "sent", "replied", "all"];
  return {
    syncedAt,
    prospects,
    counts: Object.fromEntries(views.map((view) => [view, prospects.filter((item) => inView(item, view)).length])) as Record<ProspectView, number>,
  };
}
