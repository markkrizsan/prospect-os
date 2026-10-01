# Prospect OS V10 — Apps Script Materializer

Google Apps Script is the Sheet-owned contact/draft/materialization component of the Prospect OS production conveyor. It is deployed separately from GitHub/Vercel.

## Current authority

The live Sheet `OPERATING_CONTRACT` is executable policy. This README describes the repository implementation and must remain consistent with it.

## Responsibilities

Apps Script:
- returns MARKET, OPPORTUNITIES, OUTREACH and RUNS to the dashboard
- materializes already-qualified `QUALIFIED — MATERIALIZE` MARKET rows
- verifies an explicit public first-party recipient channel from the owned website
- rechecks active rebuild conflict before contact creation
- creates matching OPPORTUNITIES + OUTREACH records
- assigns E01 arm where applicable
- independently verifies the persisted pair before promoting MARKET
- records manually confirmed SENT state, follow-up and PIPELINE bookkeeping
- supports idempotent SENT reconciliation and outcome progression

Apps Script does **not** discover prospects, decide initial qualification, guess email addresses, or send email.

## Materializer contract

`installProspectMaterializerTrigger()` removes duplicate triggers for the handler and installs one time-driven `runQualifiedMaterializer` trigger every **1 minute**.

Each execution is **output-bound**:
- target = five successful materializations
- candidate attempts are variable
- bounded execution time prevents runaway execution
- P1 is considered before P2
- existing materialized IDs are reconciled rather than duplicated
- active rebuild evidence terminalizes `REJECT — ACTIVE REBUILD CONFLICT`
- no verified usable first-party channel terminalizes `REJECT — NO VERIFIED CHANNEL`
- terminal failures do not remain at the head of the queue
- successful matching OPPORTUNITIES + OUTREACH rows are read back before MARKET changes to `PROMOTE`

This fixes the former starvation bug where the oldest five failures could consume every run.

## Contact integrity

The materializer checks owned-site pages only and accepts an explicit mailto address or human-visible published company address that passes safety filtering.

READY-B company/team inboxes are written as company/team outreach. The materializer does not pretend a generic inbox belongs to a named decision-maker.

No guessed or inferred email permutation becomes READY.

## Prospect-facing copy

Research fields may contain compact internal framework language. Evidence-led draft generation sanitizes internal terms before they become prospect-facing copy so the materializer and dashboard human-language validator cannot disagree on phrases such as `buyer path`, `proof layer`, `value gap` or `micro-offer`.

Dialogue-first E01 copy is generated in plain prospect-facing language.

## Manual send mutations

`MARK_SENT`:
- validates matching source records and recipient/subject/draft before mutation
- preserves an existing Sent At timestamp on retry
- updates OPPORTUNITIES + OUTREACH to SENT
- upserts PIPELINE
- creates a conditional follow-up only when no reply/suppression is present
- is idempotent

`SYNC_SENT` reconciles records already marked SENT. It never creates a send.

The dashboard's bulk MARK ALL SENT action intentionally reuses this verified MARK_SENT path for an explicit snapshot of IDs. No email is sent by the backend.

Hidden legacy TODAY is not an operational state owner and is not written by the current backend.

## Deploying Code.gs

GitHub/Vercel success does **not** update the Apps Script Web app.

After a `Code.gs` change:

1. Open the existing production Apps Script project associated with the server-side `PROSPECT_API_URL`.
2. Replace its `Code.gs` with the current repository version.
3. Save.
4. Preserve the existing private `PROSPECT_API_SECRET` Script Property.
5. Deploy → Manage deployments → edit the existing Web app → create a new version.
6. Preserve the existing execution/access settings and production `/exec` endpoint when possible.
7. Run `installProspectMaterializerTrigger` once if the deployed trigger logic/cadence changed or trigger state must be repaired.
8. Verify exactly one `runQualifiedMaterializer` time-driven trigger exists and is scheduled every 1 minute.
9. Verify live Sheet evidence: terminal failures advance, a legitimate staged row produces one complete matching V10 READY pair, readback passes, MARKET promotes, and no email is sent.

Do not create multiple materializer triggers.

## Regression verification

Repository verification:

```bash
npm test
npm run typecheck
npm run build
```

Tests cover SENT bookkeeping/idempotency, schema failure, outcome progression, contact extraction, active rebuild detection, materializer qualification behavior, E01 assignment and prospect-facing jargon sanitation.

Live deployment must still be verified separately through the canonical Sheet. Passing repository tests is not deployment proof.
