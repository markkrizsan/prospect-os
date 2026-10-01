import "server-only";

type ZohoTokenResponse = {
  access_token?: string;
  expires_in?: number;
};

type ZohoAccount = {
  accountId?: string;
  primaryEmailAddress?: string;
  mailboxAddress?: string;
  incomingUserName?: string;
  enabled?: boolean;
  sendMailDetails?: Array<{
    fromAddress?: string;
    signatureId?: string | null;
    status?: boolean;
  }>;
};

type ZohoEnvelope<T> = {
  data?: T;
  status?: { code?: number; description?: string };
};

export type ZohoDraftInput = {
  toAddress: string;
  subject: string;
  bodyText: string;
};

export type ZohoDraftResult = {
  draftId: string;
};

type MailboxContext = {
  accountId: string;
  signatureHtml: string;
};

let tokenCache: { value: string; expiresAt: number } | null = null;
let mailboxCache: { value: MailboxContext; expiresAt: number } | null = null;

function configuration() {
  const clientId = process.env.ZOHO_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOHO_CLIENT_SECRET?.trim();
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN?.trim();
  const fromAddress = process.env.ZOHO_FROM_ADDRESS?.trim().toLowerCase();
  if (!clientId || !clientSecret || !refreshToken || !fromAddress) {
    throw new Error(
      "Zoho draft integration is not configured. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN and ZOHO_FROM_ADDRESS in Vercel."
    );
  }
  return {
    clientId,
    clientSecret,
    refreshToken,
    fromAddress,
    accountsBase: (process.env.ZOHO_ACCOUNTS_BASE_URL?.trim() || "https://accounts.zoho.com").replace(/\/$/, ""),
    mailBase: (process.env.ZOHO_MAIL_BASE_URL?.trim() || "https://mail.zoho.com").replace(/\/$/, ""),
    signatureId: process.env.ZOHO_SIGNATURE_ID?.trim() || "",
  };
}

function providerError(status: number, payload: unknown): Error {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const providerStatus = record.status && typeof record.status === "object"
    ? record.status as Record<string, unknown>
    : {};
  const data = record.data && typeof record.data === "object"
    ? record.data as Record<string, unknown>
    : {};
  const detail = String(data.moreInfo || providerStatus.description || "").trim();
  return new Error(`Zoho Mail API returned HTTP ${status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
}

async function accessToken(force = false): Promise<string> {
  if (!force && tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const { clientId, clientSecret, refreshToken, accountsBase } = configuration();
  const response = await fetch(`${accountsBase}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({})) as ZohoTokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new Error("Zoho OAuth refresh failed. Re-authorize the Prospect OS Zoho connection.");
  }
  tokenCache = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(300, Number(payload.expires_in) || 3600) * 1000,
  };
  return payload.access_token;
}

async function zohoFetch(path: string, init: RequestInit = {}, retryAuth = true): Promise<unknown> {
  const { mailBase } = configuration();
  const token = await accessToken();
  const response = await fetch(`${mailBase}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init.headers,
      Authorization: `Zoho-oauthtoken ${token}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });

  if (response.status === 401 && retryAuth) {
    tokenCache = null;
    await accessToken(true);
    return zohoFetch(path, init, false);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw providerError(response.status, payload);
  return payload;
}

function matchesAddress(account: ZohoAccount, address: string): boolean {
  const own = [account.primaryEmailAddress, account.mailboxAddress, account.incomingUserName]
    .map((value) => value?.toLowerCase())
    .filter(Boolean);
  if (own.includes(address)) return true;
  return Boolean(account.sendMailDetails?.some(
    (detail) => detail.fromAddress?.toLowerCase() === address && detail.status !== false
  ));
}

function signatureIdFor(account: ZohoAccount, fromAddress: string, override: string): string {
  if (override) return override;
  const detail = account.sendMailDetails?.find(
    (candidate) => candidate.fromAddress?.toLowerCase() === fromAddress && candidate.status !== false
  );
  const id = String(detail?.signatureId || "").trim();
  return id && id.toLowerCase() !== "null" ? id : "";
}

export function absolutizeSignatureHtml(html: string, mailBase: string): string {
  const base = mailBase.replace(/\/$/, "");
  return html.replace(/\b(src|href)=(["'])\/(?!\/)/gi, (_match, attr: string, quote: string) =>
    `${attr}=${quote}${base}/`
  );
}

export function renderDraftHtml(bodyText: string, signatureHtml: string): string {
  const escaped = bodyText
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r?\n/g, "<br />");
  return `<div>${escaped}</div><br /><br />${signatureHtml}`;
}

async function mailboxContext(): Promise<MailboxContext> {
  if (mailboxCache && mailboxCache.expiresAt > Date.now()) return mailboxCache.value;
  const { fromAddress, mailBase, signatureId: configuredSignatureId } = configuration();

  const accountsPayload = await zohoFetch("/api/accounts") as ZohoEnvelope<ZohoAccount[]>;
  const accounts = Array.isArray(accountsPayload.data) ? accountsPayload.data : [];
  const account = accounts.find((candidate) => candidate.enabled !== false && matchesAddress(candidate, fromAddress));
  const accountId = String(account?.accountId || "").trim();
  if (!account || !accountId) {
    throw new Error("Zoho Mail account for ZOHO_FROM_ADDRESS was not found.");
  }

  const signatureId = signatureIdFor(account, fromAddress, configuredSignatureId);
  if (!signatureId) {
    throw new Error(
      "No Zoho signature is assigned to ZOHO_FROM_ADDRESS. Assign it in Zoho Mail or set ZOHO_SIGNATURE_ID."
    );
  }

  const signaturePayload = await zohoFetch(
    `/api/accounts/signature?id=${encodeURIComponent(signatureId)}`
  ) as ZohoEnvelope<{ content?: string }>;
  const signature = String(signaturePayload.data?.content || "").trim();
  if (!signature) throw new Error("The assigned Zoho signature was found but its content is empty.");

  const value = {
    accountId,
    signatureHtml: absolutizeSignatureHtml(signature, mailBase),
  };
  mailboxCache = { value, expiresAt: Date.now() + 5 * 60_000 };
  return value;
}

/**
 * Creates a Zoho draft only. There is intentionally no send operation here.
 * Human review in Zoho remains the final release gate.
 */
export async function createZohoDraft(input: ZohoDraftInput): Promise<ZohoDraftResult> {
  const { fromAddress } = configuration();
  if (!input.toAddress.trim() || !input.subject.trim() || !input.bodyText.trim()) {
    throw new Error("Zoho draft requires recipient, subject and body.");
  }

  const mailbox = await mailboxContext();
  const payload = await zohoFetch(
    `/api/accounts/${encodeURIComponent(mailbox.accountId)}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "draft",
        fromAddress,
        toAddress: input.toAddress.trim(),
        subject: input.subject.trim(),
        content: renderDraftHtml(input.bodyText, mailbox.signatureHtml),
        mailFormat: "html",
        askReceipt: "no",
        encoding: "UTF-8",
      }),
    }
  ) as ZohoEnvelope<Record<string, unknown>>;

  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  return {
    draftId: String(data.messageId || data.mailId || data.id || ""),
  };
}

export function resetZohoCachesForTests(): void {
  tokenCache = null;
  mailboxCache = null;
}
