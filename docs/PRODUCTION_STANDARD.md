# Prospect OS production standard

Prospect OS is a revenue-critical conveyor, not a research archive.

## Canonical flow
MARKET -> QUALIFIED — MATERIALIZE -> SEND NOW -> SENT / REJECTED -> REPLIED -> MEETING -> PROPOSAL -> WON/LOST

Research and contact materialization are separate workers so a failure in one cannot stop the other.

## Reliability standard
- Last-known-good dashboard state remains available when an upstream dependency is slow.
- Freshness is explicit; stale data is never presented as fresh.
- An older cache response never overwrites a newer live or post-mutation response.
- Zero unresolved READY/SENT integrity mismatches.
- Mutations fail closed, read back after writes, and are idempotent where retries are possible.
- Every touched research candidate ends as QUALIFIED — MATERIALIZE or REJECT.
- GitHub CI is not deployment proof. Verify the production build through /api/health. Apps Script is verified separately.
- Monitor user-visible latency, traffic, errors, and queue/materialization depth. Alert on current symptoms, not historical causes.

## Revenue qualification
Hard gates: meaningful PAIN, plausible $3K+ ECONOMICS, realistic AUTHORITY, SCOPE=PASS, sufficient current first-party evidence.
TIMING and INTENT are prioritization boosters, not mandatory gates.
P1 = hard gates + meaningful timing/intent booster.
P2 = hard gates without a meaningful public timing/intent booster.
No blended predictive score is authoritative before outcome data exists.

## Learning loop
Preserve source and qualification signals through the funnel. Measure positive replies/sent, meetings/sent, proposals/sent, wins/sent, and revenue/100 sends.
Use early results directionally after roughly 25 sends. Recalibrate more seriously after 50–100 sends or once downstream events are numerous enough to compare cohorts.

## Operator surface
SEND NOW, QUEUE, REJECTED, SENT, REPLIED. Internal mechanics do not become operator tabs unless they require a human decision.

## Change control
Observe -> reproduce -> test -> canary -> CI -> deploy -> verify live -> promote.
Never turn one run's failure into a persistent cross-run latch.


## Outreach experiment E01

E01 tests one variable only: first-message strategy.

- A = EVIDENCE-LED: current researched 50–100 word outreach.
- B = DIALOGUE-FIRST: a short, research-informed question designed to start a purposeful reply.
- Subject-line methodology, sender, qualification gates, recipient verification, timing and follow-up policy remain unchanged.
- Assignment is sticky and approximately 50/50 within Founder-Minute Priority strata.
- Experiment Tag is the canonical arm record and is carried into PIPELINE Source when SENT.
- Primary outcome: positive reply / sent.
- Downstream outcomes: meetings / sent, proposals / sent, wins / sent, revenue / 100 sends.
- Guardrails: negative replies, opt-outs, bounces and deliverability issues.
- First 4+4 sends are a safety canary only. Do not select a winner from the initial eight.
- Review directionally at 30 per arm; treat 50 per arm as an early signal, not automatic proof.
- Do not introduce a C arm until E01 has accumulated enough traffic to justify another split.
