# Prospect OS V10 Apps Script backend

The React/Next.js frontend deploys through Vercel. **Google Apps Script is a separate deployment.** A GitHub or Vercel success does NOT mean changes to `apps-script/Code.gs` are live.

## Production behavior

- GET /exec?action=list returns MARKET, OUTREACH, OPPORTUNITIES and RUNS, preserving dashboard views and displaying the latest real hourly production metrics. Create the RUNS tab first using the existing canonical Google Sheet schema.
- MARK_SENT (manually confirmed) updates source statuses, preserves Sent At, checks current recipient/subject/completed draft, assigns follow-up only when no reply/suppression, and upserts PIPELINE. Hidden legacy TODAY is no longer written.
- REJECT blocks previously SENT records and updates both source statuses without changing historical TODAY.
- SYNC_SENT repairs recorded SENT records in PIPELINE and conditional follow-up dates. It does not modify legacy TODAY, create a new send, or overwrite replied/advanced outcomes.
- Web-app writes are serialized under ScriptLock to avoid duplicate pipeline inserts when two actions overlap.
- Missing OPPORTUNITIES/OUTREACH records or required header columns throw a visible error rather than silently resulting in a partial or fictitious success.

## Deployment required after merging

There is currently **no authorized Apps Script deployment connector** available to this chat. An account owner must update the deployed script explicitly:

1. In Vercel project settings locate the **existing** PROSPECT_API_URL (do not paste it or the secret in chat). Open the associated Google Apps Script editor.
2. Replace its Code.gs with the version from this repository after CI passes. Do not overwrite the spreadsheet ID or substitute another project's source.
3. Confirm Project Settings → Script Properties includes PROSPECT_API_SECRET with the exact existing matching Vercel secret. Keep secret values private.
4. Deploy → Manage deployments → Edit current web app → New version → Execute as: Me → Deploy. Preserve the already-authorized server-to-server access setting.
5. Keep the existing /exec URL when editing the current deployment; if it changes, update PROSPECT_API_URL in Vercel and redeploy.
6. Refresh the dashboard and press REPAIR FOLLOW-UPS once. Verify all recorded SENT IDs have PIPELINE records, conditional due dates, and remain excluded from the canonical dashboard SEND NOW. Hidden legacy TODAY is not an acceptance source.
7. On a future real manually sent READY prospect, MARK SENT and verify all five destinations, plus a repeat invocation without duplicate pipeline rows.
8. Verify MARKET still displays its original research records. If the backend responds with an error, leave the front-end action in an error state until fixed; do not change source statuses manually to hide it.

## Outbound/source integrity

No Apps Script action emails anyone or sources new prospects. Automatic hourly creation remains governed by the authorized Google Sheet connector and the canonical V10 PLAYBOOK, with readback before READY is counted. Do not route denied unattended contact writes through this endpoint as a permission workaround.

## Regression tests

`npm test` includes Apps Script behavior tests with a fake in-memory spreadsheet: source tabs returned, MARK_SENT write-through, repeat idempotency, existing SENT repair without losing a real reply, and sent-record rejection protection. Run alongside `npm run typecheck` and `npm run build` through GitHub Actions.

## Source / metrics policy

The current V10 PLAYBOOK in the live Sheet includes the /web offer-match law, five persisted-new-READY-per-hour acceptance target, and TRIAGE's 149-row provisional legacy audit index. RUNS A:S is the separate non-contact production ledger. TRIAGE is never a source of READY prospects until current-site, business, channel, and full outreach are verified and both OPPORTUNITIES + OUTREACH rows are independently read back.

## Retired duplicate view

The former TODAY Sheet remains hidden and preserved for forensic history. The live dashboard derives SEND NOW exclusively from the two canonical operational records; the backend no longer reads, deletes, or renumbers TODAY. If the Apps Script deployment is not updated, it may still attempt old TODAY mutations. A GitHub/Vercel deployment alone does not update the independently deployed Google Apps Script web app.
