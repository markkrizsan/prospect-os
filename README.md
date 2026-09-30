# Prospect OS V10: execution interface

Prospect OS delivers researched, genuinely sendable website opportunities to Mark's manual Zoho workflow. It does not send email.

Business brief: https://markkrizsan.com/web/
Live source of truth: https://docs.google.com/spreadsheets/d/1K2nfLH1ZBMJZLg0fiicnTJFBzobb3mCKt6rYsEmwR9M/edit
The OPERATING_CONTRACT first tab is the short current policy. The long PLAYBOOK and older Google Doc are reference history, not additional instructions when inconsistent.

## Data ownership

| Source | Owns |
|---|---|
| MARKET | Cheap-screened business universe; never creates a sendable by itself |
| OPPORTUNITIES | Business proof, actual website mismatch, specific intervention and economics |
| OUTREACH | Operational lifecycle/status, contact channel, subject, finished draft and send timestamp |
| PIPELINE | Actual replies and commercial outcomes, not another READY source |
| RUNS | Observed production, with missing evidence marked UNKNOWN |
| TODAY | Legacy convenience view, not authoritative for the live queue |

The dashboard joins OPPORTUNITIES and OUTREACH by exact durable ID. SEND NOW requires both matching unique rows explicitly READY, all required research and outreach fields, no conflict, and blank Sent At. Every disagreement fails closed and is surfaced as a non-sensitive integrity notice. SENT stays SENT even if a legacy opportunity row disagrees. MARKET never overrides operational rows.

## Architecture

Browser to private Next.js API to server-side Apps Script transport to existing Sheet.

- GET reads MARKET, OPPORTUNITIES, OUTREACH and RUNS.
- COPY ALL copies the recipient, subject and complete body. Zoho sending is manual. Check the active Zoho signature/required footer and opt-out before sending.
- MARK SENT is human-confirmed. Server rechecks joined READY before asking Apps Script to update the existing source rows.
- The deployed Apps Script is independent of Vercel and currently maintains legacy TODAY/PIPELINE/follow-ups until a planned derived-view transition is verified.
- An expressly denied scheduled contact-bearing Google Sheet write must NOT be redirected through dashboard/Apps Script as a workaround. Hourly production records PERSISTENCE BLOCKED, preserves non-contact research and stops expensive downstream work until properly authorized.

## Server-side production configuration

| Key | Required | Rule |
|---|---:|---|
| PROSPECT_API_URL | Yes | Exact active Apps Script /exec URL, not /dev or editor |
| PROSPECT_API_SECRET | Yes | Matches Apps Script Project Settings > Script Properties |
| DASHBOARD_KEY | Yes | Private access key; missing config now fails closed with HTTP 503 |

Never use NEXT_PUBLIC_ for these. Keep all credentials private. The legacy GET Apps Script contract takes one query credential; POST mutations authenticate with the body only. Remove the last query credential only as a coordinated, tested backend rollout.

Release order: CI > confirm Vercel deployment > separately deploy a changed Apps Script Code.gs via an existing Web app version > verify live read and one authorized idempotent mutation with independent Sheet readback. Passing CI does not mean an Apps Script deployment happened.

## Production acceptance

Five NEW unique fully verified, persisted and independently read-back READY per hour when buffer <10; restore 10-15 rolling reserve, stop at 15. The hourly task reads OPERATING_CONTRACT, not the accumulated long PLAYBOOK. Each RUNS heartbeat is updated with actual output, shortfall and blocker. MARKET candidates, unpersisted drafts, guessed addresses and denied writes count zero. No auto-send.

## Checks

npm ci; npm test; npm run typecheck; npm run build

GitHub CI: https://github.com/markkrizsan/prospect-os/actions
Separate Apps Script deployment: apps-script/README.md
Run actual desktop/mobile browser QA before declaring interface changes fully verified.
