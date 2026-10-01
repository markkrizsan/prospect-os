import "server-only";

import {
  buildCampaignPayload,
  buildProspectImport,
  reviewBatchKey,
  type ReviewProspect,
} from "@/lib/outboundReview";

type CampaignSummary = {
  id?: number;
  name?: string;
  status?: string;
};

type CampaignProspect = {
  email?: string;
  campaign_status?: string;
};

type CampaignCreateResponse = CampaignSummary & {
  status?: string;
};

function configuration() {
  const apiKey = process.env.WOODPECKER_API_KEY?.trim();
  const mailboxId = Number(process.env.WOODPECKER_MAILBOX_ID);
  const postalAddress = process.env.OUTREACH_POSTAL_ADDRESS?.trim();
  const timezone = process.env.WOODPECKER_TIMEZONE?.trim() || "America/Los_Angeles";
  if (!apiKey || !Number.isInteger(mailboxId) || mailboxId <= 0 || !postalAddress) {
    throw new Error(
      "Woodpecker review bridge is not configured. Set WOODPECKER_API_KEY, WOODPECKER_MAILBOX_ID and OUTREACH_POSTAL_ADDRESS."
    );
  }
  return { apiKey, mailboxId, postalAddress, timezone };
}

export function woodpeckerReviewConfigured(): boolean {
  const mailboxId = Number(process.env.WOODPECKER_MAILBOX_ID);
  return Boolean(
    process.env.WOODPECKER_API_KEY?.trim() &&
    Number.isInteger(mailboxId) &&
    mailboxId > 0 &&
    process.env.OUTREACH_POSTAL_ADDRESS?.trim()
  );
}

async function api(path: string, init: RequestInit = {}): Promise<unknown> {
  const { apiKey } = configuration();
  const response = await fetch(`https://api.woodpecker.co${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "x-api-key": apiKey,
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const status = record.status && typeof record.status === "object"
      ? record.status as Record<string, unknown>
      : {};
    const detail = String(record.details || record.detail || record.message || status.msg || "").trim();
    throw new Error(
      `Woodpecker API returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`
    );
  }
  return payload;
}

async function campaigns(): Promise<CampaignSummary[]> {
  const payload = await api("/rest/v1/campaign_list");
  return Array.isArray(payload) ? payload as CampaignSummary[] : [];
}

async function prospectsInCampaign(campaignId: number): Promise<CampaignProspect[]> {
  const payload = await api(
    `/rest/v1/prospects?campaigns_id=${encodeURIComponent(String(campaignId))}&per_page=1000`
  );
  return Array.isArray(payload) ? payload as CampaignProspect[] : [];
}

async function resolveOrCreateCampaign(prospects: ReviewProspect[]): Promise<{ id: number; name: string }> {
  const { mailboxId, postalAddress, timezone } = configuration();
  const name = reviewBatchKey(prospects);
  const existing = (await campaigns()).find((campaign) => campaign.name === name);

  if (existing) {
    const id = Number(existing.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Existing Woodpecker review batch has no valid campaign ID.");
    if (String(existing.status || "").toUpperCase() !== "DRAFT") {
      throw new Error(
        `Woodpecker review batch already exists with status ${String(existing.status || "UNKNOWN")}. Refresh Prospect OS before preparing it again.`
      );
    }
    return { id, name };
  }

  const payload = await api("/rest/v2/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildCampaignPayload({
      name,
      mailboxId,
      timezone,
      postalAddress,
      prospects,
    })),
  }) as CampaignCreateResponse;

  const id = Number(payload?.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Woodpecker created a campaign but returned no valid campaign ID.");
  if (String(payload.status || "").toUpperCase() !== "DRAFT") {
    throw new Error("Woodpecker campaign creation did not return DRAFT status. Nothing was run by Prospect OS.");
  }
  return { id, name };
}

export async function prepareWoodpeckerReviewBatch(prospects: ReviewProspect[]): Promise<{
  campaignId: number;
  campaignName: string;
  prospectCount: number;
  status: "DRAFT";
}> {
  if (!prospects.length) throw new Error("At least one strict READY prospect is required.");
  if (prospects.length > 10) throw new Error("Review batches are limited to 10 prospects.");

  const uniqueEmails = new Set(prospects.map((prospect) => prospect.email.trim().toLowerCase()));
  if (uniqueEmails.size !== prospects.length) {
    throw new Error("Review batch contains a duplicate recipient email.");
  }

  const campaign = await resolveOrCreateCampaign(prospects);
  const existing = await prospectsInCampaign(campaign.id);
  const existingEmails = new Set(existing.map((prospect) => String(prospect.email || "").trim().toLowerCase()));
  const missing = prospects.filter((prospect) => !existingEmails.has(prospect.email.trim().toLowerCase()));

  if (missing.length) {
    await api("/rest/v1/add_prospects_campaign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildProspectImport(campaign.id, missing, campaign.name)),
    });
  }

  const verified = await prospectsInCampaign(campaign.id);
  const verifiedEmails = new Set(verified.map((prospect) => String(prospect.email || "").trim().toLowerCase()));
  const notPresent = prospects.filter((prospect) => !verifiedEmails.has(prospect.email.trim().toLowerCase()));
  if (notPresent.length) {
    throw new Error(
      `Woodpecker review batch exists but ${notPresent.length} prospect(s) could not be verified in it. Inspect the DRAFT campaign before retrying.`
    );
  }

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    prospectCount: prospects.length,
    status: "DRAFT",
  };
}
