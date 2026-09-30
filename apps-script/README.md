# Prospect OS V10 Apps Script backend

The React/Next.js frontend deploys through Vercel. **Google Apps Script is a separate deployment.** A GitHub or Vercel success does NOT mean changes to `apps-script/Code.gs` are live.

## Production behavior

- GET /exec?action=list returns MARKET, OUTREACH, OPPORTUNITIES and RUNS, preserving dashboard views and displaying the latest real hourly production metrics. Create the RUNS tab first using the existing canonical Google Sheet schema.
- MARK_SENT (manual, explicitly confirmed) updates both source statuses; preserves an existing Sent At, sets Mark Approved? to SENT BY MARK, assigns a follow-up four business days after the actual send unless a reply exists, idempotently upserts PIPELINE, and removes matching already-sent cards from TODAY.
- REJECT blocks prior SENT records, updates both statuses and removes obsolete TODAY rows.
- SYNC_SENT is the new explicit dashboard button. It backfills the *already recorded* SENT records into PIPELINE/follow-up/TODAY without creating new sends, new recipients or new READY records. It preserves a later pipeline stage such as REPLIED, proposal or deposit.
- Web-app writes are serialized under ScriptLock to avoid duplicate pipeline inserts when two actions overlap.
- Missing OPPORTUNITIES/OUTREACH records or required header columns throw a visible error rather than silently resulting in a partial or fictitious success.

## Deployment required after merging

There is currently **no authorized Apps Script deployment connector** available to this chat. An account owner must update the deployed script explicitly:

1. In Vercel project settings locate the **existing** PROSPECT_API_URL (do not paste it or the secret in chat). Open the associated Google Apps Script editor.
2. Replace its Code.gs with the version from this repository after CI passes. Do not overwrite the spreadsheet ID or substitute another project's source.
3. Confirm Project Settings → Script Properties includes PROSPECT_API_SECRET with the exact existing matching Vercel secret. Keep secret values private.
4. Deploy → Manage deployments → Edit current web app → New version → Execute as: Me → Deploy. Preserve the already-authorized server-to-server access setting.
5. Keep the existing /exec URL when editing the current deployment; if it changes, update PROSPECT_API_URL in Vercel and redeploy.
6. Refresh the dashboard and press **RECONCILE SENT** once. Verify the three Sep 30 SENT records appear in PIPELINE, have conditional follow-up dates, and vanish from TODAY without changing their original SENT timestamps.
7. On a future real manually sent READY prospect, MARK SENT and verify all five destinations, plus a repeat invocation without duplicate pipeline rows.
8. Verify MARKET still displays its original research records. If the backend responds with an error, leave the front-end action in an error state until fixed; do not change source statuses manually to hide it.

## Outbound/source integrity

No Apps Script action emails anyone or sources new prospects. Automatic hourly creation remains governed by the authorized Google Sheet connector and the canonical V10 PLAYBOOK, with readback before READY is counted. Do not route denied unattended contact writes through this endpoint as a permission workaround.

## Regression tests

`npm test` includes Apps Script behavior tests with a fake in-memory spreadsheet: source tabs returned, MARK_SENT write-through, repeat idempotency, existing SENT repair without losing a real reply, and sent-record rejection protection. Run alongside `npm run typecheck` and `npm run build` through GitHub Actions.

## Source / metrics policy

The current V10 PLAYBOOK in the live Sheet includes the /web offer-match law, five persisted-new-READY-per-hour acceptance target, and TRIAGE's 149-row provisional legacy audit index. RUNS A:S is the separate non-contact production ledger. TRIAGE is never a source of READY prospects until current-site, business, channel, and full outreach are verified and both OPPORTUNITIES + OUTREACH rows are independently read back.
