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

export async function markProspectSent(id: string): Promise<ProspectData> {
  const { target, secret } = endpoint("markSent");
  const response = await fetch(target, {
    method: "POST",
    cache: "no-store",
    redirect: "follow",
    headers: { ...secretHeaders(secret), "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ secret, token: secret, key: secret, apiKey: secret, action: "MARK_SENT", opportunityId: id, id, status: "SENT", sentAt: new Date().toISOString() }),
  });
  await parseResponse(response, secret);
  const data = await readProspects();
  const updated = data.prospects.find((item) => item.id === id);
  if (!updated || !inView(updated, "sent")) throw new Error("The Apps Script response completed, but the Sheet record was not confirmed as SENT");
  return data;
}
