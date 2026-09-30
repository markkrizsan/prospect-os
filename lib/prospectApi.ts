import "server-only";

import { inView, normalizePayload } from "@/lib/normalizeProspects";
import type { ProspectData } from "@/lib/types";

function configuration() {
  const url = process.env.PROSPECT_API_URL;
  const secret = process.env.PROSPECT_API_SECRET;
  if (!url || !secret) throw new Error("PROSPECT_API_URL and PROSPECT_API_SECRET must be configured");
  return { url, secret };
}

async function parseResponse(response: Response, secret: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) throw new Error(`Apps Script returned ${response.status}: ${text.slice(0, 180).replaceAll(secret, "[redacted]")}`);
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
  const target = new URL(url);
  target.searchParams.set("secret", secret);
  target.searchParams.set("token", secret);
  target.searchParams.set("key", secret);
  target.searchParams.set("apiKey", secret);
  target.searchParams.set("action", action);
  target.searchParams.set("version", "V10");
  return { target, secret };
}

function secretHeaders(secret: string): HeadersInit {
  return { Authorization: `Bearer ${secret}`, "x-api-secret": secret, "x-api-key": secret };
}

async function readRawProspects(): Promise<unknown> {
  const { target, secret } = endpoint("list");
  const response = await fetch(target, { method: "GET", cache: "no-store", redirect: "follow", headers: secretHeaders(secret) });
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
  const endpointAction = action === "MARK_SENT" ? "markSent" : "reject";
  const { target, secret } = endpoint(endpointAction);
  const response = await fetch(target, {
    method: "POST",
    cache: "no-store",
    redirect: "follow",
    headers: { ...secretHeaders(secret), "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      secret,
      token: secret,
      key: secret,
      apiKey: secret,
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
