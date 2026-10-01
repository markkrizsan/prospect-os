# Outbound Review Bridge

## Why this exists

Prospect OS should eliminate repetitive copy/paste work without becoming an autonomous email sender.

The production workflow is:

```
strict SEND NOW
  -> PREPARE NEXT 5 FOR REVIEW
  -> Woodpecker DRAFT campaign
  -> human preview/review
  -> human presses RUN in Woodpecker
  -> sent-event sync (separate release)
```

Prospect OS intentionally has **no campaign-run API call**.

## Why Woodpecker, not Zoho Mail

Zoho Mail's current Usage Policy prohibits promotional, marketing, bulk/mass and automated email use. Prospect OS therefore treats normal mailbox software as the wrong execution layer for cold outreach, even when the operator keeps a human review gate.

Woodpecker is designed for cold outreach and its API supports campaign creation in `DRAFT` state, per-prospect snippets, sender signatures, unsubscribe handling and later send-event webhooks.

## Configuration

Required Vercel server variables:

```
WOODPECKER_API_KEY
WOODPECKER_MAILBOX_ID
OUTREACH_POSTAL_ADDRESS
```

Optional:

```
WOODPECKER_TIMEZONE=America/Los_Angeles
```

No value may be exposed through `NEXT_PUBLIC_`.

The bridge remains capability-gated until all required values exist.

### Mailbox setup

Connect a dedicated outbound mailbox in Woodpecker and use its SMTP mailbox ID for `WOODPECKER_MAILBOX_ID`.

Configure the sender signature in Woodpecker. That is where Mark's visual signature belongs. The campaign uses `signature: SENDER`.

Prefer a dedicated outbound domain/mailbox rather than the primary business mailbox so experimentation does not unnecessarily concentrate reputation risk on the primary domain.

## Compliance footer

Every generated campaign template includes:

- a plain `Business outreach from Mark Krizsan.` disclosure
- `OUTREACH_POSTAL_ADDRESS`
- Woodpecker's `{{UNSUBSCRIBE}}` link
- List-Unsubscribe enabled
- open tracking disabled

`OUTREACH_POSTAL_ADDRESS` must be a real address Mark is entitled to use for commercial email, such as an appropriate business street address, registered PO box, or registered commercial mailbox. Do not put a placeholder into production.

This implementation is an engineering control, not legal advice.

## Canonical data gates

The browser submits only Prospect OS IDs.

Before creating or reconciling a review batch, the server re-reads the canonical Sheet and requires for every record:

- current joined strict V10 READY
- blank Sent At
- verified recipient email
- subject present
- finished draft present
- outreach quality validation passes

The browser cannot submit alternate recipient, subject or body text.

## Batch behavior

The dashboard prepares up to five strict READY prospects at a time.

The campaign name is deterministic from the exact sorted Prospect OS IDs:

```
Prospect OS Review · V10-O120 · V10-O121 · ...
```

Before creating anything, the bridge lists existing campaigns:

- same name + DRAFT: reuse it and add only missing prospects
- same name + any non-DRAFT status: fail closed
- no match: create a complete DRAFT campaign

After import, the bridge reads the campaign prospect list back and verifies every expected recipient exists.

This makes ordinary retries idempotent and avoids duplicate draft campaigns after a timeout.

## Campaign defaults

The generated campaign has one email step and no automatic follow-ups.

- Monday-Friday
- 08:00-17:00 campaign-local window
- campaign timezone defaults to America/Los_Angeles
- daily enroll equals the batch size
- per-prospect subject = `{{SNIPPET_1}}`
- per-prospect body = `{{SNIPPET_2}}`
- Prospect OS ID = `{{SNIPPET_3}}`
- sender signature = `SENDER`
- open tracking = off
- catch-all verification = ONLY_VERIFY
- same-domain prospects auto-pause after REPLIED or BOUNCED
- GDPR unsubscribe and List-Unsubscribe flags enabled
- no follow-up step

## Human release gate

The operator must inspect the Woodpecker DRAFT and press RUN there.

Do not add a Woodpecker `/run` call to Prospect OS unless the product model is intentionally changed by the user.

## Future sent-state sync

Woodpecker publishes a `campaign_sent` webhook whenever a campaign email is actually sent. A later release can use that event to mark the matching Prospect OS opportunity SENT automatically using the Prospect OS ID stored in snippet/tag metadata.

That webhook should not be added until the live Woodpecker account is connected and the inbound endpoint can be protected and acceptance-tested.
