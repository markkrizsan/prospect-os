# Prospect OS V10 — Current Production System

Prospect OS is Mark Krizsan's revenue-production conveyor for finding, qualifying and preparing genuinely sendable website prospects. Mark sends manually in Zoho. Prospect OS never sends outreach automatically.

Business offer: https://markkrizsan.com/web/  
Live system of record: https://docs.google.com/spreadsheets/d/1K2nfLH1ZBMJZLg0fiicnTJFBzobb3mCKt6rYsEmwR9M/edit

## Authority

Current operating authority, in order:

1. live Sheet `OPERATING_CONTRACT`
2. synchronized live `PLAYBOOK`
3. Google Doc **Conversation Engine V10 — Current Operating System**, only where consistent with the contract
4. live operational/outcome state
5. repository implementation and deployment documentation

Historical handoffs, disabled canaries, old chats and archived versions are not current policy.

## Production invariant

**Every scheduled hourly Revenue Engine run owes FIVE NEW unique strict SEND NOW prospects, regardless of starting READY inventory or reserve size.**

Candidate attempts, screens, audits, rejections and `QUALIFIED — MATERIALIZE` rows are variable inputs and never completion targets. Existing READY does not count toward the current run's five.

Success requires five NEW independently read-back matching OPPORTUNITIES + OUTREACH records where both are `V10 READY`, the usable channel is verified, subject and complete prospect-facing draft exist, `Sent At` is blank, and joined validation passes. Otherwise the run records a `PRODUCTION MISS` with the real shortfall and blocker.

## One production conveyor

`MARKET → QUALIFY → QUALIFIED — MATERIALIZE → SEND NOW → SENT / REJECTED → REPLIED → MEETING → PROPOSAL → WON / LOST`

Two execution components implement one conveyor:

- **Scheduled ChatGPT Revenue Engine:** discovery, dedupe, current evidence, qualification and NON-CONTACT MARKET persistence.
- **Sheet-owned Apps Script materializer:** first-party contact verification, draft generation, E01 assignment where applicable, matching OPPORTUNITIES + OUTREACH persistence and readback.

The scheduled worker never routes around an unattended contact-write safety boundary. The materializer never guesses a recipient and never sends email.

## Qualification

Hard gates:
- PAIN = HIGH/MEDIUM with concrete commercial consequence
- ECONOMICS = HIGH/MEDIUM with plausible $3K+ engagement economics
- AUTHORITY = DIRECT/REALISTIC
- SCOPE = PASS
- sufficient current first-party evidence

TIMING and INTENT are priority boosters only. P1 includes a meaningful booster; P2 passes without one.

Touched production candidates terminalize to `QUALIFIED — MATERIALIZE` or `REJECT — <specific reason>`. No HOLD/MAYBE/RE-AUDIT resting state is part of the current production loop.

## READY channels

- **READY-A:** verified current decision-maker + verified direct work email.
- **READY-B:** verified official first-party company/team inbox + company/team-addressed outreach.

Both can enter SEND NOW. Guessed or inferred permutations never qualify.

## Data ownership

| Source | Owns |
|---|---|
| OPERATING_CONTRACT | Executable production policy |
| PLAYBOOK | Synchronized durable operating laws |
| MARKET | Discovery + non-contact qualification state |
| OPPORTUNITIES | Business and qualification evidence |
| OUTREACH | Verified channel, subject/draft and operational lifecycle |
| PIPELINE | Actual sent/reply/meeting/proposal/won/lost outcomes |
| RUNS | Hourly production evidence |
| LEARNING | Empirical downstream findings |
| TRIAGE | Historical recovery index only |
| TODAY | Hidden forensic legacy history; not operational truth |

The dashboard derives SEND NOW only from the joined canonical OPPORTUNITIES + OUTREACH records.

## Materializer reliability

Current repository behavior:
- trigger installer creates one `runQualifiedMaterializer` trigger every **1 minute**
- execution is **output-bound**, targeting five successful materializations, not five candidate attempts
- execution also respects a bounded Apps Script time budget
- active rebuild conflict terminalizes
- no verified first-party channel terminalizes `REJECT — NO VERIFIED CHANNEL`
- successful pair is independently read back before MARKET becomes `PROMOTE`
- internal research jargon is sanitized before evidence-led outreach is created
- no email is sent

See `apps-script/README.md` for separate deployment instructions.

## Dashboard send workflow

Browser → private Next.js API → server-side Apps Script transport → canonical Sheet.

- **COPY ALL** copies To, Subject and body.
- Mark sends manually in Zoho.
- **MARK SENT** records one manually sent prospect.
- **MARK ALL N SENT ✓** records an explicit snapshot of the current SEND NOW batch only after Mark confirms he already sent those emails in Zoho. It does not send email and cannot sweep in records materialized after the confirmation snapshot.
- SENT reconciliation is idempotent and preserves advanced outcomes.

## Failure continuity

Tool, connector, authorization, timeout, safety or runtime failures are recovery incidents. Diagnose the exact layer, retry bounded operations when allowed and record a PRODUCTION MISS if the run cannot finish.

**Never pause, disable, delete, reschedule, replace or otherwise stop the recurring Prospect OS Revenue Engine unless Mark explicitly instructs that action.**

## Production configuration

| Key | Required | Rule |
|---|---:|---|
| PROSPECT_API_URL | Yes | Exact active Apps Script `/exec` URL |
| PROSPECT_API_SECRET | Yes | Matches Apps Script Script Property |
| DASHBOARD_KEY | Yes | Private dashboard access key |
| WOODPECKER_API_KEY | For review bridge | Server-side Woodpecker API key |
| WOODPECKER_MAILBOX_ID | For review bridge | Connected outbound SMTP mailbox ID |
| OUTREACH_POSTAL_ADDRESS | For review bridge | Valid commercial-email postal address used in the footer |
| WOODPECKER_TIMEZONE | Optional | Campaign timezone; defaults to America/Los_Angeles |

Never expose these through `NEXT_PUBLIC_`.

The outbound bridge is human-gated: Prospect OS can prepare a Woodpecker **DRAFT** review batch, but it intentionally cannot run the campaign or send email. See `docs/OUTBOUND_REVIEW_BRIDGE.md`.

GitHub/Vercel deployment does **not** deploy Apps Script. Code changes to `apps-script/Code.gs` require a separate Apps Script deployment and live readback.

## Release gate

Every push/PR is verified by GitHub Actions with locked dependency installation, tests, typecheck and production build. A green repository CI run is required before treating repository code as releasable. Apps Script remains a separately deployed runtime and still requires its own live smoke/readback verification.

## Verification

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Passing CI proves repository integrity, not a Google Apps Script deployment. Verify live behavior separately against the canonical Sheet.
