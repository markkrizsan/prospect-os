export type ZohoDraftPayloadInput = {
  fromAddress: string;
  toAddress: string;
  subject: string;
  bodyText: string;
  signatureHtml: string;
};

export type ZohoDraftPayload = {
  mode: "draft";
  fromAddress: string;
  toAddress: string;
  subject: string;
  content: string;
  mailFormat: "html";
  askReceipt: "no";
  encoding: "UTF-8";
};

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

/**
 * Pure payload builder. The invariant is intentionally encoded in the type:
 * this bridge can construct a Zoho draft payload, never a send payload.
 */
export function buildZohoDraftPayload(input: ZohoDraftPayloadInput): ZohoDraftPayload {
  return {
    mode: "draft",
    fromAddress: input.fromAddress.trim(),
    toAddress: input.toAddress.trim(),
    subject: input.subject.trim(),
    content: renderDraftHtml(input.bodyText, input.signatureHtml),
    mailFormat: "html",
    askReceipt: "no",
    encoding: "UTF-8",
  };
}
