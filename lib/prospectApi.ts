import "server-only";

import { inView, normalizePayload } from "@/lib/normalizeProspects";
import type { ProspectData } from "@/lib/types";
import { assertAppsScriptUrl, fetchAppsScriptResponse } from "@/lib/appsScriptTransport";

function configuration() {
  const url = process.env.PROSPECT_API_URL;
  const secret = process.env.PROSPECT_API_SECRET;
  if (!url || !secret) throw new Error("PROSPECT_API_URL and PROSPECT_API_SECRET must be configured");
  return { url, secret };
}

async function parseResponse(response: Response, secret: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 404) throw new Error(
      "The initial Apps Script /exec request returned HTTP 404. Verify that PROSPECT_API_URL points to the currently active deployed web app with the correct access settings. No successful response was received; inspect Apps Script Executions and the Sheet before retrying."
    );
    throw new Error(`Apps Script returned HTTP ${response.status}. Check the active Web app deployment and execution permissions.`);
  }
  if (/^\s*<(?:!doctype|html)/i.test(text)) throw new Error(
    "Apps Script returned an HTML page instead of JSON. Verify the active Web app /exec URL and access/execute-as settings; do not paste secrets into chat."
  );
  try {
    const payload = JSON.parse(text) as unknown;
    if (payload && typeof payload === "object" && (payload as { ok?: unknown }).ok === false) {
      const upstream = (payload as { error?: unknown }).error;
      throw new Error(`Apps Script rejected the request: ${String(upstream || "unknown error").slice(0, 240).replaceAll(secret, "[redacted]")}`);
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Apps Script rejected")) throw error;
    throw new Error("Apps Script did not return valid JSON");
  }
}

function endpoint(action: string) {
  const { url, secret } = configuration();
  const target = assertAppsScriptUrl(url);
  // Only GET needs the legacy query credential; all writes authenticate via POST body.
  if (action === "list") target.searchParams.set("secret", secret);
  target.searchParams.set("action", action);
  target.searchParams.set("version", "V10");
  return { target, secret };
}

async function readRawProspects(): Promise<unknown> {
  const { target, secret } = endpoint("list");
  const response = await fetchAppsScriptResponse(target, { method: "GET" });
  return parseResponse(response, secret);
}

export async function readProspects(): Promise<ProspectData> {
  return normalizePayload(await readRawProspects());
}

function describeShape(value: unknown, depth = 0): unknown {
  if (depth > 4) return typeof value;
  if (Array.isArray(value)) {
    return { type: "array", length: value.length, item: value.length ? describeShape(value[0], depth + 1) : null };
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, describeShape(child, depth + 1)]));
  }
  return typeof value;
}

export async function diagnoseProspectPayload(): Promise<unknown> {
  return describeShape(await readRawProspects());
}

async function mutateProspect(action: "MARK_SENT" | "REJECT", id: string, reason = ""): Promise<ProspectData> {
  // A direct API caller must never bypass the dashboard's joined-record send gate.
  if (action === "MARK_SENT") {
    const before = await readProspects();
    const item = before.prospects.find((candidate) => candidate.id === id && candidate.source === "OUTREACH");
    if (!item?.readyValidated) {
      throw new Error("This prospect is not fully READY in both source records. Refresh and review before marking SENT.");
    }
  }
  const endpointAction = action === "MARK_SENT" ? "markSent" : "reject";
  const { target, secret } = endpoint(endpointAction);
  const response = await fetchAppsScriptResponse(target, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      secret,
      action,
      opportunityId: id,
      id,
      status: action === "MARK_SENT" ? "SENT" : "REJECTED",
      sentAt: action === "MARK_SENT" ? new Date().toISOString() : undefined,
      reason: reason || undefined,
    }),
  });
  await parseResponse(response, secret);

  const data = await readProspects();
  const updated = data.prospects.find((item) => item.id === id);
  if (!updated) throw new Error("The Apps Script response completed, but the Sheet record could not be re-read");

  if (action === "MARK_SENT" && !inView(updated, "sent")) {
    throw new Error("The Apps Script response completed, but the Sheet record was not confirmed as SENT");
  }
  if (action === "REJECT" && updated.status.trim().toLowerCase() !== "rejected") {
    throw new Error("The Apps Script response completed, but the Sheet record was not confirmed as REJECTED");
  }
  return data;
}

export async function markProspectSent(id: string): Promise<ProspectData> {
  return mutateProspect("MARK_SENT", id);
}

export async function rejectProspect(id: string, reason: string): Promise<ProspectData> {
  return mutateProspect("REJECT", id, reason);
}

/** Reconcile only previously SENT Sheet records. Does not send, approve or create outreach. */
export async function reconcileSentProspects(): Promise<ProspectData> {
  const { target, secret } = endpoint("syncSent");
  const response = await fetchAppsScriptResponse(target, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ secret, action: "SYNC_SENT" }),
  });
  const result = await parseResponse(response, secret) as { ok?: boolean; unmatched?: number; missingTimestamps?: number };
  if ((result.unmatched ?? 0) > 0 || (result.missingTimestamps ?? 0) > 0) {
    throw new Error("Partial reconciliation: some recorded SENT rows have missing corresponding opportunities or timestamps. Inspect OUTREACH and PIPELINE.");
  }
  return readProspects();
}
