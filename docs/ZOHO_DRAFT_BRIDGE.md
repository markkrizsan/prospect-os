# Zoho Draft Bridge

## Purpose

Remove manual copy/paste friction without automating the final send.

Canonical flow:

```
strict SEND NOW
  -> CREATE ZOHO DRAFT
  -> Zoho Drafts
  -> human review
  -> human clicks Send
  -> MARK SENT in Prospect OS
```

Prospect OS never sends email through this bridge. The server module intentionally exposes draft creation only.

## Zoho OAuth

Register a Zoho **Server-based Application** and authorize with offline access so a refresh token is issued.

Required scopes:

```
ZohoMail.messages.CREATE,ZohoMail.accounts.READ
```

Why:

- `ZohoMail.messages.CREATE` saves the email as a Zoho draft.
- `ZohoMail.accounts.READ` resolves the authenticated mailbox and the signature assigned to the configured From address.

The backend refreshes short-lived access tokens server-side. Client ID, client secret and refresh token must never be exposed to the browser or committed to Git.

## Vercel environment variables

Required:

```
ZOHO_CLIENT_ID
ZOHO_CLIENT_SECRET
ZOHO_REFRESH_TOKEN
ZOHO_FROM_ADDRESS
```

Optional:

```
ZOHO_SIGNATURE_ID
ZOHO_ACCOUNTS_BASE_URL
ZOHO_MAIL_BASE_URL
```

The regional URLs default to the US Zoho domains:

```
https://accounts.zoho.com
https://mail.zoho.com
```

Set the regional URLs explicitly for non-US Zoho accounts.

Normally Prospect OS discovers the signature assigned to `ZOHO_FROM_ADDRESS` from Zoho account metadata. Use `ZOHO_SIGNATURE_ID` only when the assigned signature cannot be resolved automatically.

## Runtime gates

A draft can be created only when the server re-reads the canonical Sheet and confirms:

- matching joined record remains strict V10 READY
- recipient is a verified email
- subject is present
- finished outreach draft is present
- copy-quality validation passes
- `Sent At` remains blank

The client cannot bypass these checks by posting arbitrary email content.

## Signature handling

The bridge fetches the currently assigned Zoho signature and appends its HTML to the prospect message. Zoho-relative signature asset URLs are made absolute before saving the draft.

This preserves the existing linked signature while keeping signature ownership inside Zoho.

## Rate limits and failure behavior

Zoho Mail documents a general API limit of 30 requests per minute. Mailbox/signature metadata is cached for five minutes so normal draft creation is typically one Zoho Mail API request per prospect after warm-up.

Authentication receives one bounded refresh retry on HTTP 401. Rate-limit and other provider failures fail closed and do not create Sheet state changes.

If a draft request times out, inspect Zoho Drafts before retrying to avoid a duplicate.

## UI

In SEND NOW focus mode:

- `D` creates the Zoho draft.
- `Z` opens Zoho Mail.
- `C` retains the old Copy All fallback.
- `MARK SENT` remains a separate explicit action used only after the human has actually sent the email.

No lifecycle state is added for draft creation.
