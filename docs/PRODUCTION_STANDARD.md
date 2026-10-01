# Prospect OS V10 — Production Standard

Prospect OS is a revenue-critical conveyor, not a research archive.

## Hourly acceptance

Every scheduled hourly Revenue Engine run must produce **FIVE NEW unique strict SEND NOW prospects** regardless of starting READY inventory or reserve size.

Existing READY, MARKET additions, research completed, rejections, `QUALIFIED — MATERIALIZE`, `PROMOTE`, unsaved drafts and unverified channels do not count.

A strict new READY requires independent readback of a unique matching OPPORTUNITIES + OUTREACH pair where both are `V10 READY`, verified usable first-party channel exists, subject and complete human-language draft exist, `Sent At` is blank and joined validation passes.

Five = PRODUCTION SUCCESS. Fewer than five when execution ends = PRODUCTION MISS with exact gap and the single real blocker.

## Canonical flow

`MARKET → QUALIFY → QUALIFIED — MATERIALIZE → SEND NOW → SENT / REJECTED → REPLIED → MEETING → PROPOSAL → WON / LOST`

The scheduled worker and Sheet-owned materializer are two execution components of one production conveyor, not independent goals.

## Qualification

Hard gates:
- meaningful PAIN with concrete buyer consequence
- plausible $3K+ ECONOMICS
- realistic AUTHORITY
- SCOPE=PASS
- sufficient current first-party evidence

TIMING and INTENT are prioritization boosters, not mandatory gates.

Touched production candidates terminalize to `QUALIFIED — MATERIALIZE` or `REJECT — <specific reason>`. No HOLD/MAYBE/RE-AUDIT resting state.

## Materialization

- output target is five successful materializations, not five attempts
- candidate attempts expand through failures
- no verified first-party channel terminalizes rather than starving the queue
- active rebuild conflict terminalizes
- matching rows are independently read back before MARKET promotion
- internal research jargon is sanitized before evidence-led prospect-facing copy
- no auto-send

## Reliability standard

- The durable Sheet queue is the handoff boundary between qualification and contact materialization.
- One materializer layer owns retry/continuation behavior; do not stack independent retry loops across worker, API and Apps Script.
- Materializer mutations must remain idempotent and lock-protected so a repeated/overlapping execution cannot create duplicate operational records.
- Permanent candidate failures terminalize and create replacement demand; transient runtime failures may be retried only within a bounded execution/recovery policy.
- The one-minute materializer trigger is a queue consumer/recovery mechanism, not proof of completion. Hourly success still requires independent READY readback.


- Last-known-good dashboard state may remain visible while an upstream dependency is slow, but freshness is explicit.
- Older cached data never overwrites a newer live/post-mutation result.
- READY/SENT integrity mismatches fail closed.
- Mutations read back after writes and are idempotent where retries are expected.
- GitHub CI is not Apps Script deployment proof.
- Tool/connector/auth/runtime failure triggers diagnosis and bounded recovery, never automatic shutdown of the recurring Revenue Engine.
- The recurring Revenue Engine may only be stopped when Mark explicitly instructs it.

## Operator surface

SEND NOW, QUEUE, REJECTED, SENT, REPLIED.

SEND NOW is derived from joined canonical truth.
COPY ALL supports manual Zoho sending.
MARK SENT records one send.
MARK ALL SENT records only the explicitly confirmed current SEND NOW snapshot and never sends email.

## Learning loop

Measure real downstream events: sent → positive reply → meeting → proposal → win → revenue.
E01 may test evidence-led vs dialogue-first first-message strategy while qualification, verified recipient standard, manual sending and follow-up rules stay fixed.
Do not optimize on opens or tiny samples.

## Change control

Normal hourly production runs do not invent lanes, canaries, buffers, counters, states or architecture.

For actual code/release changes:
observe → reproduce → patch → regression tests → typecheck → build → CI gate → deploy the relevant runtime → smoke test → verify live readback → observe the first real production run. If an invariant breaks, roll back to the last known-good version rather than layering another speculative fix.

A release-level smoke test is not a production-run completion condition and never replaces the five-new-READY invariant.
