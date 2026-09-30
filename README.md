# Prospect OS — Conversation Engine V10

Prospect OS is a fast execution interface over the Conversation Engine V10 Google Sheet. The Sheet remains the only data store.

## Architecture

- The browser calls `GET/POST /api/prospects` on the Next.js server.
- `lib/prospectApi.ts` reads `PROSPECT_API_URL` and `PROSPECT_API_SECRET` only on the server and calls Apps Script.
- OUTREACH and OPPORTUNITIES are merged by durable Opportunity ID.
- SEND NOW contains only V10 READY records from those two Sheet tabs.
- MARK SENT posts to Apps Script, then re-reads the endpoint and only reports success after the record is confirmed SENT.
- REJECT writes `REJECTED` to the existing Sheet record with a concise rejection reason, then re-reads to confirm the mutation.
- Historical `V9-*` IDs remain durable IDs; current V10 status controls readiness.

No Supabase, Airtable, Prisma, Firebase, cache database, or duplicated prospect store is used.

## Environment

Set these in `.env.local` and in the existing Vercel project:

```text
PROSPECT_API_URL=https://script.google.com/macros/s/.../exec
PROSPECT_API_SECRET=...
DASHBOARD_KEY=optional
```

Never use a `NEXT_PUBLIC_` prefix for the API URL or secret.

## Apps Script contract

The reference Apps Script implementation lives in `apps-script/Code.gs`.

`GET PROSPECT_API_URL?secret=...&action=list&version=V10` returns JSON containing OUTREACH and OPPORTUNITIES as object arrays.

`POST PROSPECT_API_URL?secret=...&action=markSent&version=V10` receives a JSON string containing `secret`, `action: "MARK_SENT"`, `opportunityId`, `id`, `status: "SENT"`, and `sentAt`. The endpoint updates the corresponding existing Sheet row rather than appending a duplicate.

`POST ...&action=reject` receives `action: "REJECT"`, the record ID, and a concise `reason`. It marks the existing OPPORTUNITIES and OUTREACH rows `REJECTED` and records the reason.

Deploy the Apps Script web app as **Execute as: Me**. Set the same `PROSPECT_API_SECRET` value in Apps Script → Project Settings → Script Properties and in Vercel.

## Verification

```bash
npm test
npm run typecheck
npm run build
```
