export type ProspectView = "send-now" | "queue" | "rejected" | "sent" | "replied";

export interface Prospect {
  id: string;
  source: string;
  version: string;
  status: string;
  company: string;
  person: string;
  role: string;
  website: string;
  contactPath: string;
  businessStrength: string;
  commercialGap: string;
  interventionDelta: string;
  economicJustification: string;
  whyNow: string;
  serviceIdea: string;
  microOffer: string;
  subjectLine: string;
  outreachDraft: string;
  zohoUrl: string;
  sentAt: string;
  repliedAt: string;
  cityState: string;
  industry: string;
  signalStrength: string;
  screeningReason: string;
  notes: string;
  /** Structural readiness after joining both authoritative records; never inferred from one status cell. */
  readyValidated?: boolean;
  /** State inconsistencies contain IDs/statuses only, never contact data. */
  stateIssues?: string[];
}

export interface RunMetrics {
  id: string;
  localTime: string;
  mode: string;
  readyStart: number | null;
  screened: number | null;
  audited: number | null;
  passed: number | null;
  contactsVerified: number | null;
  readyAdded: number | null;
  readyEnd: number | null;
  gap: number | null;
  blocker: string;
  persistence: string;
}

export interface ProspectData {
  latestRun: RunMetrics | null;
  syncedAt: string;
  prospects: Prospect[];
  consistencyIssues: string[];
  counts: Record<ProspectView, number>;
}
