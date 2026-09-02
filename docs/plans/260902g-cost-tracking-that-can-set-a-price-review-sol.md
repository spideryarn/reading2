The plan is directionally right, but I would not build Stage 2 or Stage 3 from it unchanged. Four decisions are still underspecified enough to produce the wrong ledger or report.

## 1. Guidance: mostly understood, with three corrections

### Realtime session row

The slim row is right. Its creation sequence should be explicit:

1. OpenAI successfully mints the client secret.
2. Insert `realtime_sessions`.
3. Return the token and session ID to the browser.

If insertion fails, do not release the usable token.

However, a minted token is only an **issued session**, not proof that a conversation connected. Either call the denominator that, or add a tiny authenticated `connected` event when the data channel opens. Reports can also populate `connected_at` if that event was lost.

Also, “session has not expired” must not mean the ephemeral client-secret expiry. Accept reports until the server-owned 20-minute session limit plus tolerance.

### CHECK constraint

Your interpretation is right, but the SQL must avoid PostgreSQL’s `NULL` escape hatch:

```sql
CHECK (
  byok_upstream_nanos IS NULL
  OR (
    cost_source = 'provider'
    AND is_byok IS TRUE
    AND provider_account = 'openrouter'
  )
)
```

Use `is_byok IS TRUE`, not bare `is_byok`; a PostgreSQL CHECK accepts `UNKNOWN`.

Keep the existing credits/computed exclusivity CHECK in [0023_ai_calls_cost_provenance.sql](/home/greg/code/spideryarn2/drizzle/0023_ai_calls_cost_provenance.sql:48). The new CHECK governs only the BYOK pocket.

The proposed red test is wrong: “compute a total the wrong way and watch the constraint catch it” cannot work because a CHECK does not inspect a `SELECT`. Use three tests:

- Reproduce the current doubled total before normalisation.
- Prove an invalid non-BYOK upstream insert is rejected.
- Prove the obvious SQL sum agrees with `totalRows()` across provider, BYOK, computed and unpriced fixtures.

### Endpoint as seam

You understood the architectural point: a one-caller `realtime-spend.ts` abstraction is unnecessary.

But “the endpoint is the seam” means it is the authenticated trust/accounting boundary. It does not mean all parsing, pricing and persistence should become anonymous inline code in the already-large route dispatcher. Give the handler a named, directly testable parse/validate/price operation, using existing store and pricing machinery.

Nor can every direct-provider allowlist entry disappear. The browser still opens WebRTC directly to OpenAI. That remains a sanctioned provider bypass whose accounting arrives through a different seam. Reclassify the relevant entries in [no-undeclared-spend.test.ts](/home/greg/code/spideryarn2/tests/no-undeclared-spend.test.ts:120); do not simply “retire the ALLOWED-list entry.”

## 2. Stage 1 and the rename

I would keep the rename. `byok_upstream_nanos` makes the safe SQL obvious, while `upstream_inference_nanos` preserves the exact ambiguity that caused the defect. This is the least expensive moment to change it, especially before the Stripe work starts depending on the schema.

Stage 1 can stop cleanly, but it must name every compatibility surface:

- Migration and backfill.
- Drizzle schema.
- `AiCallRow`.
- The central record-to-row projection.
- Both Postgres adapter directions.
- Filesystem validation and historical JSONL compatibility.
- `totalRows()`, report, tests and docs.

The filesystem compatibility point is missing. Existing JSONL contains `upstreamInferenceNanos`; renaming the TypeScript property without a read-time backfill would make the old ledger unreadable. On read, translate the old field to `byokUpstreamNanos` only when `isByok === true`.

There is one deployment caveat: migrations run before new code deploys, so a direct database column rename briefly leaves old code facing the new schema. For strict zero-gap deployability, use expand/contract. For this alpha, I would accept the coordinated rename—but the plan should acknowledge that choice rather than claim unqualified deployability.

Two other Stage 1 decisions need resolving before build:

- Choose the clean cutoff now. Do not leave “either import or cutoff” to the implementer. My choice is **no filesystem import; PostgreSQL authoritative from the Stage 1 deployment timestamp**. The historical data is mostly development evidence and contains no complete ingest anyway.
- Existing fixture deletion should not be in the stage’s completion criterion. Set the cutoff, make deletion optional cleanup requiring Greg’s approval, and let the stage complete without it.

Also print the actual safe database target, not merely `postgres: spideryarn.ai_calls`; local and remote Postgres are different ledgers.

## 3. Split Stage 2 in two

Split at the server/client contract—not between realtime responses and transcription, because that would deliberately deploy a meter known to omit a cost source.

### Stage 2A — server-owned journal and acceptance seam

- Schema and `realtime_sessions`.
- Session creation tied to token minting.
- Authenticated connected/report/close endpoints.
- Usage DTO and validation.
- Effective-dated server pricing.
- Idempotency key and unique constraint.
- Unit/database tests.
- Widen all affected types and inventories.

This is deployable with every issued session visible as zero-reporting until the client starts posting.

### Stage 2B — browser delivery and proof

- Handle `response.done`.
- Handle completed input transcription.
- Track event timestamps and provider outcomes.
- Immediate posting, in-memory retry and teardown hint.
- Browser/component tests.
- One real session demonstrating rows and report output.
- Then update the static bypass register and remove the old “unmetered live conversation” warning.

That is a much cleaner review surface and failure boundary.

## 4. Missing entirely

The largest omission is **how realtime usage fits into `ai_calls`**. The existing row has generic input/output/cache totals, a mandatory duration and only three outcomes ([schema](/home/greg/code/spideryarn2/src/db/schema.ts:2051), [row type](/home/greg/code/spideryarn2/src/ai-spend.ts:327)). Realtime pricing requires modality detail:

- Input text/audio/image.
- Cached text/audio/image.
- Output text/audio.
- Transcription audio seconds or milliseconds.
- Provider event ID.
- Provider status/outcome.

Without these, the server can compute a snapshot cost but the stored facts cannot audit or reprice it. Prefer explicit nullable columns over JSON, consistent with the repository’s database rule.

Also missing:

- A concrete uniqueness rule, such as `(realtime_session_id, provider_event_id, event_kind)`.
- Whether `started_at` is provider event time or receipt time. Preserve both event time and `created_at`; do not substitute session duration or zero for per-response latency.
- Mapping `completed`, `failed`, `cancelled` and `incomplete` into the ledger. Current `"ok" | "error" | "aborted"` is insufficient.
- The model/type ripple beyond the three unions named. `Provider`, `AI_JOB_WIRE`, `NON_TASK_MODELS` and the profile’s model inventory embody the old “every app call is OpenRouter” assertion in [models.ts](/home/greg/code/spideryarn2/src/models.ts:510).

Stage 3 has two structural omissions:

1. **The five categories are not currently derivable as claimed.** `ai_calls` retains `job_id` and `step_name`, but finished jobs may be deleted ([schema](/home/greg/code/spideryarn2/src/db/schema.ts:2026)), and a `hierarchy` row alone cannot say whether it came from initial upload or a reader-triggered rerun. Define and durably record the initiating job kind, or rename the category to something honestly derivable, such as “default-step work.” Include an exhaustive `unknown` category and assert that classified rows equal total rows.

2. **Per-owner distributions need zero-spend owners.** A `GROUP BY ai_calls.owner_id` silently excludes subscribers who made no calls. Merge the SQL aggregate with the Stripe subscriber set when available; until then, use all Auth accounts and label that denominator clearly. Non-product spend must stay outside the subscriber distribution.

The reconciliation gap also needs qualification. The current OpenRouter endpoint reconciles the current key/month, not arbitrary billing periods. Report it as “current credential/current UTC month/as of now,” or omit it when those conditions do not hold.

## 5. Cut aggressively

I would cut:

- The generic “computed fallback widening” from Stage 1. No named current row requires it; keep unknown calls honestly unpriced.
- Importing the filesystem history. Use the cutoff.
- p90. Median, p95, max and sample size are enough at alpha scale.
- Generic unit-cost machinery in Stage 3. Controlled unit costs belong to Stage 4 and should be selected by known run/session IDs.
- A reusable scenario/gross-margin engine. Put the four scenarios and candidate-price arithmetic in the measured plan document. Call it **model-cost contribution margin** unless Stripe fees and other variable costs are included.
- Any attempt to meter `scripts/run-codex.ts` through the app ledger. Document it as unmetered non-product external spend.
- Replacing “thirteen call sites” with another count. Remove the volatile count and point at the enforced register.

I would not argue against the admin column. Greg made the product choice explicitly, and it can cheaply reuse the aggregate. It does need a defined period—e.g. “current UTC month”—and a visible partial/unpriced marker. A bare currency number would overclaim.

## 6. Stale or wrong now

The shared working tree already contains uncommitted implementations for:

- `web_searches` capture.
- Unpriced counts per breakdown.
- `jobSpend()` including computed cost.
- Expanded unmetered-spend registration.
- `OPENAI_API_KEY` health checking.

For example, [ai-cost.ts](/home/greg/code/spideryarn2/scripts/ai-cost.ts:113) now carries `unpriced` per group. Stage 1 should say “absorb and verify the in-flight changes” rather than independently rebuilding 1.1–1.4. `.env.example` still appears to need the credential addition.

The realtime prices are no longer merely “Sol’s unverified web figures.” OpenAI’s current official pages confirm:

- `gpt-realtime-2.1`: $32/M audio input and $64/M audio output tokens. [Official model page](https://developers.openai.com/api/docs/models/gpt-realtime-2.1)
- `gpt-realtime-2.1-mini`: $10/M and $20/M respectively. [Official model page](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini)
- `gpt-live-transcribe`: $0.017/audio minute. [Official model page](https://developers.openai.com/api/docs/models/gpt-live-transcribe)

OpenAI also documents the modality-level usage shape and repeated conversation-context billing in its [Realtime cost guide](https://developers.openai.com/api/docs/guides/realtime-costs). Replace the “unverified” caveat with those primary sources, while retaining the warning that the plan’s per-minute bands are estimates.

Finally, the measured row counts and “no article ever fully ingested” are useful dated evidence, but volatile. Mark them as a 2026-09-02 snapshot rather than facts the eventual implementation should assume.

My verdict: approve after these revisions. The core design—normalised BYOK rows, slim session journal, browser-reported usage, PostgreSQL aggregation and distribution-shaped reporting—is still the right one.