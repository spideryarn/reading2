# Cost tracking that can set a price

**Status: planned, not built.** Written 2026-09-02. Reviews share the letter `g`.

## Why now

Stripe is arriving — a different agent is building it. The pricing model is not settled, but it is
likely a fixed monthly subscription including some allowance.

> And so I want to know how much cost is being incurred before we, so that we can optimize that
> pricing model.
>
> — Greg, 2026-09-02

That is the whole goal. **This job is measurement and visibility, not enforcement.** Every number
below exists so a price can be set against it.

## What is already true, and it is a lot

Cost tracking was built on 2026-08-27/28 and the design is sound —
[260827q-ai-cost-tracking.md](260827q-ai-cost-tracking.md),
[ai-gateway.md](../project/ai-gateway.md). Two seams, one vendor, a row per call carrying
OpenRouter's own settled figure rather than our arithmetic, `owner_id` on every row, and two
tripwire tests that fail when a new file can reach a provider without declaring itself.

**Nothing here re-litigates that.** The gap is not in the ledger's design; it is in three places:
the ledger has defects that make its numbers wrong in specific, checkable ways; the single most
expensive feature writes no rows at all; and the reporting is developer-shaped rather than
pricing-shaped.

## Decisions taken

**Greg, 2026-09-02:**

- **Spend caps are out of scope.** There is an account-level cap set in OpenRouter. *"Note that we
  have a cap set in OpenRouter, so I'm less worried about setting a cap software-side for now."*
  - **Except that cap cannot see live conversation**, which bills a separate `OPENAI_API_KEY`
    direct from the browser. The fix is a cap in the OpenAI dashboard — Greg's action, not code.
- **Meter live conversation, on browser-reported usage.** *"I thought we had discussed this, and
  concluded that it was a nuisance to do it properly-properly serverside, and that we had actually
  done this, but based for now on browser report (which is unreliable, because the user could mess
  with it, but good enough for a v1)."*
- **Report credits and cash.** Credits stay the stored, reconcilable figure; cash is derived.
- **CLI report plus a spend column on `/admin/users`.** No per-article cost on the metadata page.
- **Stay on `gpt-realtime-2.1`**, 2026-09-02: *"Let's stick with gpt-realtime-2.1 for now - it's
  smarter."* So the ~3x saving from `gpt-realtime-2.1-mini` is declined on quality grounds, knowingly
  — which makes metering voice more important rather than less, since the expensive model is the one
  staying.
- **Approved deleting the 3,888 test-fixture rows** from the local dev Postgres ledger, 2026-09-02.

**A correction that matters, because a plan is read as a record.** The live-conversation metering
was *decided and reviewed* on 2026-08-31 — [realtime-voice-cost-tracking.md](realtime-voice-cost-tracking.md),
headed "Status: decided, not built" — and reaching exactly the conclusion Greg remembers. It was
never built: a repo-wide grep for `realtime_sessions|realtime-spend|usageSource` returns one hit, in
prose. This is [silent-success.md](../reusable/silent-success.md) at the scale of a workstream — a
decision read back later as if it had shipped. The plan is a good design and this job builds from
it; it is not existing code.

## The findings

**All row counts and ledger figures below are a 2026-09-02 snapshot**, not standing facts — they
move every time anyone runs the suite. Marked by how they are known. Everything below was re-checked against the code at today's line
numbers rather than taken from a subagent's report.

### Tier 0 — the numbers are wrong right now

**0.1 A double-count trap aimed at the billing query.** *Proved from the code and measured.*
[`drizzle/0023`](../../drizzle/0023_ai_calls_cost_provenance.sql)'s CHECK makes `credits_used_nanos`
and `computed_cost_nanos` mutually exclusive, and says why: *"a SUM over both would double-count."*
But **`upstream_inference_nanos` is outside that constraint**, and
[`src/ai-call.ts:587`](../../src/ai-call.ts) sets it on every chat-wire call, BYOK or not. 29 of 29
non-BYOK rows carry it equal to `credits_used_nanos`. The rule that makes a total correct — add
`upstream` only when `is_byok` — lives **only in JS**, in `totalRows()`
([`src/store/ai-calls.ts:73`](../../src/store/ai-calls.ts)). An auditor writing the obvious SQL got
$23.54 where the truth was $11.77. The next thing anyone writes against this table is a
per-owner-per-month aggregate in SQL, for Stripe.

**0.2 The test suite writes real rows into the dev Postgres ledger.** *Measured.* 3888 of 3924 rows
are `test-chat-route-fixture` / `test-remember-route-fixture` / `test-candidates-route-fixture`.
The **filesystem** store already separates them — `_ai-calls.test.jsonl`, keyed on `NODE_ENV`
([`src/store/ai-calls-fs.ts:65`](../../src/store/ai-calls-fs.ts)), with a comment about this exact
accident and how it was found. `ai-calls-pg.ts` has no equivalent: `grep NODE_ENV` returns nothing.
So every count, every `By owner` and `By article` line is meaningless, and the permanent "3872 calls
reported no cost" warning masks the one signal that would show a real unpriced problem. A
copy-paste sibling that carried the documented half of a contract and dropped the undocumented half
— the shape [improve-the-codebase.md](../reusable/improve-the-codebase.md) predicts.

**0.3 Two disjoint ledgers, and the default reads the one production never writes.** *Reproduced.*
`SPIDERYARN_STORE` defaults to `files`. Bare `npm run cost` reported **$28.67 / 565 calls** from
`data/_ai-calls.jsonl`; `SPIDERYARN_STORE=postgres npm run cost` reported **$2.54 / 3924 calls**
from Postgres. Neither run says the other store exists. `--reconcile` compares only whichever is
live, and reported our $0.66 against OpenRouter's $4.11 for the month — a gap that cannot be driven
to zero, which is what makes reconciliation a check rather than a ritual.

### Tier 1 — cheap, mechanical, evidence in hand

**1.1 `web_searches` is null on 100% of 3908 rows, guarded by a false comment.** *Proved.*
[`src/ai-call.ts:651`](../../src/ai-call.ts) hard-codes it null: *"no caller here uses a server-side
web search."* Four callers do. And the parser is not merely available — it is **already called on
those very calls**: `whereSearchCountCameFrom` runs at
[`src/explain.ts:576`](../../src/explain.ts) and
[`src/referee-criteria-run.ts:613`](../../src/referee-criteria-run.ts) for their own purposes, while
the ledger row for the same call stores `null`. The number is computed and discarded at the ledger
boundary. Per-result search billing is inside `usage.cost`, so the money is right and the
attribution is absent.

**1.2 Unpriced rows are counted as free in every breakdown.** *Proved.* `by()` in
[`scripts/ai-cost.ts:113`](../../scripts/ai-cost.ts) discards the unpriced count, so a day, job,
model, article or owner line cannot show it. Only the top-level "short by an unknown amount"
survives. 16 of 329 product calls.

**1.3 `jobSpend()` drops `computed`.** *Proved.* [`src/jobs.ts:754`](../../src/jobs.ts) —
`aiCostNanos: credits + upstream`. Zero today because computed is eval-only, and a latent
under-report on the single line that says what an ingest cost.

**1.4 The register claims more completeness than it has.** *Proved.* `evals/live/*.mts` (which also
calls `/v1/audio/speech`) and `scripts/run-codex.ts` spend real money and are in neither
`DECLARATIONS` nor printed by `npm run cost` — they sit in the ALLOWED map, which prints nothing.
`OPENAI_API_KEY` is required by [`src/live.ts:522`](../../src/live.ts) but is in neither
`.env.example` nor the health report's EXPECTED list: the one credential whose spend nothing can see
is also the one nothing documents. And [ai-gateway.md](../project/ai-gateway.md)'s "thirteen call
sites" is 20 in `src/`.

### Tier 2 — the hole

**2.1 Live conversation writes no rows at all.** *Proved.* `gpt-realtime-2.1` plus a separately
billed `gpt-live-transcribe`; audio in **$32/Mtok**, audio out **$64/Mtok**. Roughly
**$0.06–$0.11/min cached, $0.18–$0.46/min uncached**, and
[`src/live.ts:591`](../../src/live.ts) notes the article is re-sent per session with the cache
belonging to the session — so hang-up-and-restart pays full uncached price again, pushing real use
toward the upper band. At the 20-minute browser cap that is **$1.20–$9 a session**, with no limit
on sessions. For scale, a whole default article ingest is **$0.52**.

The browser already receives the numbers and drops them:
[`useLiveConversation.ts:724`](../../src/web/live/useLiveConversation.ts) handles `response.done` and
reads only `output` for function calls. Input transcription is billed separately and arrives on
`conversation.item.input_audio_transcription.completed`, so a `response.done`-only meter still
misses a cost line.

### Tier 3 — the reporting cannot answer the question

**3.1 No SQL aggregate exists anywhere.** `CostStore.read(since, until)` fetches every row in a
window and sums in JS. Fine at 4k rows, not at 400k, and Stripe will want this monthly.
**3.2 No owner filter, no name.** No `--owner` flag; raw UUIDs with no join to `auth.users`, and
accounts come from the Supabase Auth service over HTTP
([`src/store/admin-accounts.ts`](../../src/store/admin-accounts.ts)), not a table — so it is not a
single SQL join.
**3.3 No cost categories — and `scope_kind` is not the split it looks like.** *Proved; this
corrects an earlier draft of this plan.* A reader asking for an optional stage does it with
`POST /api/jobs { slug, steps: ["glossary"] }` ([`src/routes.ts:5710`](../../src/routes.ts)), which
creates a **job** and is recorded as `scope_kind: "job_step"`
([`src/jobs.ts:580`](../../src/jobs.ts)). So reader-triggered enrichment is indistinguishable from
base ingest by scope. The categories have to be derived from the job and step name. GPT Sol caught
this, 2026-09-02.
**3.4 No cost anywhere in the UI.** `/admin/users` shows counts and dates
([`src/web/admin-columns.tsx:67`](../../src/web/admin-columns.tsx)); `src/admin.ts` never mentions
`ai_calls`.
**3.5 No article has ever been fully ingested in either ledger.** Every job is a dev re-run of one
or two steps; the most complete covers 6 of 13 steps for $0.909. A full ingest is *extrapolated* at
$1.50–$3. **We do not have the number this whole job exists to produce.**

## The pricing-structure finding

[`src/pipeline.ts:235`](../../src/pipeline.ts) `DEFAULT_INGEST_STEPS` is five steps — fetch,
extract, blocks, hierarchy, assets — of which only `hierarchy` buys a model call (~$0.52). The other
eight in `STEP_ORDER` are deliberately off the default, each with a comment saying *"it costs a model
call"*, and are triggered on demand. Add chat, explain, search, quiz-mark, referee, dictation,
embeddings and live conversation, all reader-triggered.

**So an article's cost is not fixed at upload; the driver is engagement, not uploads.** A reader who
uploads three articles and talks to them for an hour costs far more than one who uploads fifty and
reads them plainly. That is worth deciding deliberately rather than inheriting, and it is a product
call for Greg once Stage 4 has produced real numbers.

## Stages

Each ends green, committable and deployable. **Revised 2026-09-02 after GPT Sol's plan review**
([review](260902g-cost-tracking-that-can-set-a-price-review-sol.md), verdict: *approve after these
revisions*).

### Stage 1 — make the existing numbers trustworthy

Nothing downstream is worth computing until this lands, and Stripe is being built against this table
now. Sol's framing: *"the individual OpenRouter `usage.cost` values are not wrong. The current
aggregate is wrong because its population and total expression are wrong."*

**1a — the Tier-1 fixes. ✅ Done, 2026-09-02.** `web_searches` populated from the parser that was
already running on those very calls; every breakdown line carries its unpriced count; `jobSpend()`
routed through `totalRows()` so it picks up `computed` without inventing a second sum; `src/live.ts`,
`evals/live/*.mts` and `scripts/run-codex.ts` named in a new `UNMETERED_SPEND` table that
`npm run cost` prints every run; `OPENAI_API_KEY` added to `.env.example`, the health report and
`setup-dev.md`. Red-then-green test for each.

The call-site count in [ai-gateway.md](../project/ai-gateway.md) was first "corrected" from thirteen
to twenty — *"the same bug with a fresher number"*, Sol — and is now removed in favour of the grep
and the enforced register.

**1b — the schema and the population. ✅ Built, 2026-09-02; one step outstanding.**
`upstream_inference_nanos` is `byok_upstream_nanos`, written only on BYOK rows, backfilled to null
elsewhere, and governed by `ai_calls_byok_upstream_only`
([the migration](../../drizzle/20260902141103_byok_upstream_nanos.sql)); the JSONL reader translates
the old field under the same condition; `costStore` hands the disposable filesystem ledger to
anything under the test harness; `npm run cost` names its database. Red-then-green for each.

**Outstanding, and not mine to clear:** `npm run db:migrate` refuses in the main tree, because the
shared local Postgres carries a ledger row for `0052_per_article_job_queue` — a peer's migration,
applied to the shared database from the `article-job-queue` worktree and not yet pushed, so it is in
no journal here. The guard is right to refuse (an unknown row could be the same DDL renumbered) and
`scripts/migration-ledger.ts` says deliberately that another branch's row must not be "forgotten".
It clears itself the moment that work lands. Until then the four Postgres tests in
`tests/store-ai-calls.test.ts` skip loudly, because the suite's `pgReady` probe now names
`byok_upstream_nanos`. Deleting the 4,714 fixture rows waits on the same unblocking.

- **The double-count trap — normalise the row.** Write the upstream figure only on BYOK rows, null
  it elsewhere, backfill existing non-BYOK values to null, and **rename it `byok_upstream_nanos`**
  so the name carries the condition. Sol kept the rename: `upstream_inference_nanos` *"preserves the
  exact ambiguity that caused the defect"*, and this is the cheapest moment, before Stripe depends
  on the schema. The CHECK, with the `NULL` escape hatch closed:

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

  `is_byok IS TRUE`, not bare `is_byok` — a Postgres CHECK accepts `UNKNOWN`. The existing
  credits/computed exclusivity CHECK in `0023` stays; this one governs only the BYOK pocket.

  **My proposed red test was wrong** and Sol said so: *"'compute a total the wrong way and watch the
  constraint catch it' cannot work because a CHECK does not inspect a `SELECT`."* Three tests
  instead — reproduce the doubled total before normalisation; prove an invalid non-BYOK upstream
  insert is rejected; prove the obvious SQL sum agrees with `totalRows()` across provider, BYOK,
  computed and unpriced fixtures.

- **Every compatibility surface, named**: the migration and backfill, the Drizzle schema,
  `AiCallRow`, the record-to-row projection, both Postgres adapter directions, filesystem validation,
  `totalRows()`, the report, tests and docs. **The one I had missed**: existing JSONL carries
  `upstreamInferenceNanos`, so the fs reader needs a read-time translation to `byokUpstreamNanos`
  *only when `isByok === true`*, or the old ledger becomes unreadable.

- **Deployability, honestly stated.** Migrations run before code deploys, so a direct column rename
  briefly leaves old code facing the new schema. Expand/contract would close that; for this alpha we
  accept the coordinated rename — recorded as a choice rather than claimed as unqualified
  deployability.

- **Test pollution — reuse the answer that already exists.** Under the test harness, make the
  selected `costStore` write to the disposable filesystem test ledger even when the app store is
  Postgres. Keep focused `pgCostStore` tests against Postgres with explicit cleanup. Sol rejected
  `is_test`, a synthetic `scope_kind`, and refusing writes (which would stop route tests exercising
  the metering lifecycle at all).

- **The cutoff, decided rather than left to the implementer.** Sol's call, taken: **no filesystem
  import; Postgres authoritative from the Stage 1 deployment timestamp.** The filesystem history is
  development evidence and contains no complete ingest anyway.

- **Deleting the fixture rows is optional cleanup, not a completion criterion.** Greg approved it on
  2026-09-02; it happens after the test redirect lands, because before that the next `npm test`
  refills them. They grew 3,888 → 4,081 during the session that found them.

- **The report prints the actual database target**, not just `postgres: spideryarn.ai_calls` — local
  and remote Postgres are different ledgers, and this repo has a whole doc section about commands
  reaching a database other than the one on their command line.

**Cut from this stage** (Sol): widening the computed-cost fallback. No named current row requires it,
and an estimate in a column built to hold settled figures is the thing `0023` exists to prevent.
Unpriceable rows stay honestly `none`.

**Done:** `npm test`, `npm run typecheck`, `npm run check` green. The obvious SQL sum over the ledger
agrees with `totalRows()`. `npm run cost` names its store and its database.

#### The migration is committed and **not yet applied locally**, and that is a peer collision

`npm run db:migrate` on this box refuses:

```
✗ the journal and this database's migration ledger do not reconcile
  • 1 ledger row(s) belong to no migration in this journal: 1788351034981
No migration has been applied and nothing has changed.
```

That row is **`0052_per_article_job_queue`**, a peer's migration living in
`.claude/worktrees/article-job-queue/`, applied to the shared local Postgres and not yet on `dev`
(origin's `drizzle/` stops at `0051`). The guard is right to refuse — `scripts/migration-ledger.ts`
says deleting such a row *"destroys the one piece of evidence that would explain the refusal"* — and
`scripts/db-repair-migration-ledger.ts` is for a different fault (drizzle's watermark), reporting
*"Nothing to reconcile"* here.

**What this does and does not affect.** Production is unaffected: the remote ledger has no foreign
row, so this migration applies in order on deploy. **The shared dev box is affected** — until the
peer lands `0052`, any agent here sees four `db-schema-drift` failures naming
`ai_calls.byok_upstream_nanos`, which is the drift detector working correctly.

The four Postgres tests for the CHECK **skip loudly** rather than failing confusingly
(*"spideryarn.ai_calls.byok_upstream_nanos is missing — run npm run db:migrate"*). **Run
`npm run db:migrate` and then `npx vitest run tests/store-ai-calls.test.ts` once `0052` lands** —
that is the outstanding verification for this stage, and it is the only part of 1b not proved.

### Stage 2A — the server-owned journal and the acceptance seam

**✅ Built, 2026-09-02; one step outstanding.** `spideryarn.realtime_sessions` and thirteen nullable
realtime columns on `ai_calls`
([the migration](../../drizzle/20260902150952_realtime_sessions_and_usage.sql)); the session row
written between minting the secret and returning the token; `connected` / `usage` / `close` under
`/api/live/:sessionId/`; `parseRealtimeUsage` and `acceptRealtimeUsage` in
[`src/live.ts`](../../src/live.ts), pure and tested without HTTP; `REALTIME_PRICES` and
`TRANSCRIPTION_PRICES` in [`src/pricing.ts`](../../src/pricing.ts), effective-dated; `Wire`,
`Provider`, `ProviderAccount`, `AiJob`, `AI_JOB_WIRE` and `ChatJob` all widened. 63 new tests, each
guard watched to fail first.

**Four decisions taken in the build that the plan left open, and one thing left out:**

- **`AiJob` gains `live_conversation` as its own category, not a fourth `NonTaskAiJob`.** Those three
  each have one fixed model that the profile page lists; a live session buys two on two rate cards,
  and their ids live in `src/live.ts`, which imports `src/converse.ts`, which imports
  `src/models.ts` — so naming them there would close an import cycle and `npm run cycles` is a gate.
- **`ai_calls.duration_ms` loses its `NOT NULL`**, narrowed straight back by
  `ai_calls_duration_known_off_realtime`. A transcription event has no matching start event, and both
  alternatives were invisible lies: a `0` reads as an instant call, and the session's wall-clock is
  the length of a conversation rather than of a call.
- **A report carrying image tokens is refused**, not priced. `liveSession` configures no image input
  and there is no image rate; inventing one is what `src/pricing.ts` spends four paragraphs
  forbidding.
- **The session journal gets both store adapters, not a filesystem refusal.** `AdminStore`,
  `VisibilityStore` and `FeedbackStore` refuse on files because there is genuinely nothing on a
  filesystem to hold them; a session journal is a file quite happily, and refusing would have turned
  off a working feature on every default checkout — including the suite that covers the ticket route.
- **No `usageSource` column.** The design proposed `"client_report" | "sideband"`; today
  `wire = 'realtime'` *is* "a browser reported this", so it would carry one value. An additive
  migration on the day a sideband exists is cheaper than a column nothing distinguishes.

**This is a laptop problem, not a shipping one.** The `.sql`, its snapshot and its journal entry are
on `dev`, and `npm run deploy` applies every pending migration to the remote and **refuses to ship
while any is still pending** — `--skip-migrations` included
([deployment.md § Deploying](../project/deployment.md#deploying)). So production gets this at the
next deploy without anybody doing anything, and the one way it could go wrong announces itself: if a
later-stamped migration ever reached the remote first, the preflight would refuse out loud rather
than skip in silence. Deploying `dev` as a whole cannot hit that, because drizzle reads its watermark
once and then applies every pending entry in journal order in the same run.

**Outstanding on the shared box, and not mine to clear — the same peer collision as 1b, twice over.**
The migration has been applied nowhere, and the reason changed under it on 2026-09-02. First `npm run db:migrate`
refused on one orphan ledger row, `1788351034981`, which was `0052_per_article_job_queue` applied to
the shared local Postgres from a worktree whose journal entry had not been pushed. That cleared when
`0052` landed. What refuses now is worse and is the defect
[database.md § A watermark is not a ledger](../project/database.md#a-watermark-is-not-a-ledger)
exists to catch:

```
✗ 1 migration(s) can never be applied: the newest ledger row is stamped 1788365753441,
  and drizzle only applies entries stamped after it —
  20260902150952_realtime_sessions_and_usage (1788361792046)
✗ 2 ledger row(s) belong to no migration in this journal: 1788365729661, 1788365753441
```

Both orphan rows are stamped **later** than this migration, so even once they are accounted for,
drizzle's single-watermark loop would skip `20260902150952` for ever in silence. **The remedy is not
to delete this file and regenerate**, tempting as the table in database.md makes it look, until
somebody has worked out what those two rows did — they are the feedback/privacy work applied under
numbers that have since been regenerated, and a regeneration now merely chases their stamps. Whoever
clears them should then check that this entry still clears the new watermark before running
`npm run db:migrate`.

Until it runs, `tests/store-realtime-sessions.test.ts` skips its Postgres half loudly
(*"spideryarn.realtime_sessions is not there — run npm run db:migrate"*) and the filesystem half of
the same parity suite runs; `tests/store-ai-calls.test.ts`, `tests/db-schema.test.ts` and
`tests/db-schema-drift.test.ts` fail on the missing realtime columns. **Run `npm run db:migrate` and
then
`npx vitest run tests/store-realtime-sessions.test.ts tests/store-ai-calls.test.ts tests/db-schema.test.ts tests/db-schema-drift.test.ts`**
— that is the whole of what is unverified here. Everything that does not need a database passes.

Sol split Stage 2 in two, **at the server/client contract** — deliberately not between responses and
transcription, because that would ship a meter known to omit a cost source.

- Schema: `realtime_sessions`, plus the realtime columns on `ai_calls`.
- **The session row is created when the client secret is minted**, in this order: OpenAI mints the
  secret → insert the session → return token and session id. *If the insert fails, the usable token
  is not released.*
- **A minted token is an issued session, not a conversation.** Either call the denominator that
  honestly, or add a tiny authenticated `connected` event when the data channel opens.
- **"Not expired" means the server-owned 20-minute session limit plus tolerance**, not the ephemeral
  client-secret expiry — those are different clocks and using the wrong one silently drops the
  reports that matter most.
- Authenticated connected / report / close endpoints; the usage DTO and its validation;
  effective-dated server-side pricing; the idempotency key and its unique constraint.
- **The seam is the trust boundary, not an excuse for inline code.** Sol: it *"does not mean all
  parsing, pricing and persistence should become anonymous inline code in the already-large route
  dispatcher."* A named, directly testable parse/validate/price operation, using the existing store
  and pricing machinery.
- Widen the types — and it is more than the three unions I listed. `Provider`, `AI_JOB_WIRE`,
  `NON_TASK_MODELS` and the profile's model inventory all encode "every app call is OpenRouter"
  ([`src/models.ts`](../../src/models.ts)).

**The largest thing my draft omitted: how realtime usage actually fits in `ai_calls`.** The row has
generic input/output/cache totals, a mandatory duration and three outcomes. Realtime pricing needs
modality detail — input text/audio/image, cached text/audio/image, output text/audio, transcription
seconds, the provider event id, the provider status. **Explicit nullable columns, not JSON**, per
[sql.md](../project/sql.md). Without them the server can compute a cost but the stored facts cannot
audit or reprice it. Also: a uniqueness rule of `(realtime_session_id, provider_event_id,
event_kind)`; event time and receipt time both kept, never substituting session duration for
per-response latency; and a mapping for `completed`/`failed`/`cancelled`/`incomplete`, which
`"ok" | "error" | "aborted"` cannot express.

#### The realtime row shape, decided

The usage OpenAI emits on `response.done`, from
[realtime-voice-cost-tracking-web.md](../research/realtime-voice-cost-tracking-web.md):

```json
"usage": {
  "total_tokens": 253, "input_tokens": 132, "output_tokens": 121,
  "input_token_details": {
    "text_tokens": 119, "audio_tokens": 13, "image_tokens": 0, "cached_tokens": 64,
    "cached_tokens_details": { "text_tokens": …, "audio_tokens": … }
  },
  "output_token_details": { "text_tokens": 30, "audio_tokens": 91 }
}
```

**Audio and text are priced an order of magnitude apart** — $32/Mtok audio in against $4 text in,
$64 against $24 out — so a row that keeps only the totals cannot be repriced or audited. The splits
are the whole point.

So: new **nullable columns** on `ai_calls` for the modality detail — input text/audio/image, cached
text/audio, output text/audio, transcription seconds, the provider event id and the provider status
— with `reported_input_tokens`/`output_tokens` still carrying the totals.

**Not JSON, and not a sibling table.** [sql.md](../project/sql.md) says columns over JSON; and a
sibling table was the tempting alternative until the precedent settled it. `ai_calls` **already**
carries wire-specific columns that are null on most rows: `cache_write_5m_tokens` and
`cache_write_1h_tokens` are Messages-wire only, `service_tier` and `inference_geo` are Anthropic's
own fields, and `web_searches` is chat-wire only. Realtime columns are the same pattern, not a new
one — so this follows the table's existing design rather than introducing a second shape beside it.

**Keep `cached_tokens_details`.** It was missing from `openai-node`'s types for a while
([openai-node#1600](https://github.com/openai/openai-node/issues/1600)), so hand-rolled types tend
to drop it — and it is the field that says how much of the cache saving was on the expensive
modality.

**Done:** deployable on its own, with every issued session visible as zero-reporting until the
client starts posting.

### Stage 2B — browser delivery, and proof

**✅ Built, 2026-09-02; the end-to-end run is outstanding and cannot happen on this box.**
[`src/web/live/meter.ts`](../../src/web/live/meter.ts) is the whole of the browser half — the two
projections and the queue — driven from `useLiveConversation.ts`, which now records
`response.created` times, reports `response.done` and the completed transcription event, posts
`connected` when the data channel opens, and posts `close` with the browser's own word for why the
conversation ended (twelve reasons, from `reader` to `idle-cap` to `pagehide`). The three accounting
calls are **required** methods on `LiveWiring`, not optional ones: an optional method is one a new
wiring forgets, and the failure would be a session that silently meters nothing.
[`tests/live-meter.test.ts`](../../tests/live-meter.test.ts) hands what the client builds to the
server's real `parseRealtimeUsage` and `acceptRealtimeUsage` — imported, never mocked, because that
seam is the point — and six new tests in `tests/live-session-flow.test.tsx` cover what only the hook
can get wrong. Each guard was watched to fail first.

**Three decisions taken in the build:**

- **An event whose numbers cannot be read is not reported, and is counted.** `response.done` without
  its modality split (openai-agents-js#538) would, if the gaps were filled with zeros, produce a
  report the server *accepts* and prices at approximately nothing — a turn that cost real money
  landing in the ledger as free, with nothing red anywhere. The two counts that are allowed to be
  missing are the cached ones and image tokens, and both can only bias the figure up.
- **The transcription is priced from `usage.seconds` only.** That event's `usage` comes in a
  `duration` shape and a `tokens` shape, and there is no per-token rate for the transcriber; a
  conversion factor would be a made-up number in a table built to hold settled ones. A token-shaped
  usage is counted and said out loud instead. **Which shape `gpt-live-transcribe` actually sends is
  the first thing a real session will settle.**
- **`sendBeacon` is not used at all.** It cannot set an `Authorization` header and every route under
  `/api/` takes a bearer token and no cookie, so a beacon would be a 401 that looks like a send.
  `keepalive` on the last pass is the hint, and it is a hint rather than the path.

**Outstanding, and the same peer collision as 1b and 2A:** `npm run db:migrate` still refuses, so
`spideryarn.realtime_sessions` exists in no database and **no real conversation has produced a real
Postgres row**. The plan's "Done" below is therefore half-met. What *is* proved is everything
between: `tests/live-session-routes.test.ts` now takes a raw provider event through the client's own
projection, over the HTTP route as JSON, and out as a priced row in the filesystem ledger — for the
spoken turn and the transcription both. What is left is a browser and a database. Run a real live session once `0052` lands, and check `npm run cost` shows
`computed` spend on `gpt-realtime-2.1` **and** on `gpt-live-transcribe` — two rate cards, not one.

- Handle `response.done` and the completed input-transcription event; track event timestamps and
  provider outcomes.
- Immediate posting, a small in-memory retry queue while the tab lives, `keepalive`/`sendBeacon` on
  teardown as a hint only. Session close best-effort.
- **The usage projection is a discriminated union — token detail *or* seconds.** `gpt-live-transcribe`
  is billed **per audio minute**, so "token counts only" would have failed to price half the feature.
- **Never a client-supplied dollar amount.** The server prices it.
- Validation, rejecting rather than clamping: session belongs to the authenticated owner; ids
  non-empty and bounded; counts non-negative safe integers; detail counts within their parents;
  per-response input within the model context and output within the configured max; transcription
  duration within session wall-clock plus tolerance. **Not** a cumulative tokens-per-minute ceiling —
  realtime rebills conversation context each turn, so cumulative input legitimately outgrows
  wall-clock.
- **Reclassify the bypass register; do not retire it.** The browser still opens WebRTC straight to
  OpenAI, so that remains a sanctioned provider bypass whose *accounting* now arrives through a
  different seam. Only then does the "unmetered live conversation" warning come out of
  `npm run cost`.

**Done:** one real browser session produces rows, and `npm run cost` shows live spend.

**Known loss, accepted:** the final turn can vanish on a crash or instant tab close. The aggregate is
biased low by a probably small unknown. Sol: *"Add the durable outbox before usage affects an
allowance, an invoice, or a promise made to users."*

### Stage 3 — a report that answers the pricing question

A total is not an answer; a **distribution** is.

- **Cost categories — but named honestly.** Sol found my five categories are *not currently
  derivable*: finished jobs may be deleted, and a `hierarchy` row alone cannot say whether it came
  from an upload or a reader-triggered rerun. So either durably record the initiating job kind, or
  call the category what it actually is — "default-step work" rather than "base upload". Either way,
  an exhaustive `unknown` bucket, and an assertion that classified rows equal total rows.
- **A coverage header**: authoritative store and database, credential, settled/computed/unpriced
  counts, the reconciliation gap, and realtime sessions that reported nothing.
- **Per-owner cost over an arbitrary half-open `[start, end)`** — Stripe billing periods are not
  calendar months.
- **Median, p95, max and sample size** per category. Sol cut p90 as surplus at alpha scale.
- **Zero-spend owners included.** `GROUP BY ai_calls.owner_id` silently excludes subscribers who
  made no calls, which biases every average upward. Until Stripe's subscriber set exists, use all
  Auth accounts and label the denominator. Non-product spend stays outside the distribution.
- **The reconciliation gap needs its conditions printed** — it reconciles the *current* key for the
  *current UTC month, as of now*, and must say so or be omitted.
- **Cash beside credits**, allocated in the report. Settled row costs are never rewritten. Call it
  **model-cost contribution margin** unless Stripe fees and infrastructure are in it.
- Postgres-specific `GROUP BY`. Do **not** widen `CostStore` for filesystem parity on a query whose
  source of truth is Postgres.
- **A spend column on `/admin/users`** — Greg asked for it explicitly and Sol withdrew its objection,
  with two conditions: a **defined period** (current UTC month) and a **visible partial/unpriced
  marker**. *"A bare currency number would overclaim."*

**Cut** (Sol): generic unit-cost machinery here, and a reusable scenario/gross-margin engine. The
scenarios and candidate-price arithmetic belong in a measured document, not in code.

**Done:** one command answers "what did each owner cost over this period, by category, with the
spread" — and says how much of itself it could not see.

### Stage 4 — handed to the plan that is already doing it

**Not this job.** A peer agent has a twice-Sol-reviewed plan covering exactly this —
[260902g-estimate-article-ingestion-and-mode-generation-costs.md](260902g-estimate-article-ingestion-and-mode-generation-costs.md)
— building a repeatable eval harness across three article shapes, ranking the expensive stages, and
proposing cost reductions with their product tradeoffs. It states the boundary itself: *"Other
agents are concurrently building payments machinery and cost-tracking; this work reads the
cost-tracking machinery and must not modify it."*

So the division is clean, and duplicating it would mean paying twice for the same measurements:

| | owns |
|---|---|
| **This plan** | the ledger's integrity, metering live conversation, and the reporting |
| **That plan** | driving articles through the pipeline and reading the numbers back |

Two things from it that bear on this plan. It found a **duplicate-execution defect** — one job
running eleven concurrent `hierarchy` calls with distinct run ids, which is where the alarming
`$5.43` figure came from — already being root-caused by another agent. And its measured
hierarchy+labels figures are **$0.047–0.078** on a 468-word article and **$0.36** on a
13,476-word one, which is the range the `$0.52` quoted earlier in this doc sits at the top of.
**Take its numbers over this doc's**, which are incidental observations rather than measurements.

## The simpler option passed over

**Do only Stage 4 — measure what we have and price off that.** Rejected: 0.2 and 0.3 mean the
numbers currently in the ledger cannot be read, and 2.1 means the most expensive feature contributes
zero. Measuring on top of that produces a confident wrong answer, which is worse for a pricing
decision than no answer.

**Do only Stages 1 and 4, skipping live metering.** Tempting, and rejected because a live minute can
cost most of an article and a session can cost twenty. Any allowance set without that number is set
blind on the largest term.

## Scope — what this job does not look at

Spend caps, quotas and reservations (Greg's call above). Stripe itself. The `evals/` spend, beyond
naming it honestly in the register. Anything about *reducing* cost — prompt-cache tuning, cheaper
models, fewer stages — which is a separate job that this one produces the evidence for.

## What the Stripe agent needs to know

Handed over rather than discovered later. All from GPT Sol, 2026-09-02.

- **`ai_calls` is COGS attribution, not a customer billing ledger.** A fixed subscription invoice
  reconciles against Stripe subscription state. Do not derive invoices from model calls.
- **Billing periods are not calendar months.** Every query must take an arbitrary half-open
  `[period_start, period_end)`.
- **The denominator comes from subscriptions, not from this table.** `ai_calls` cannot show a
  subscriber who spent nothing, so an average over ledger owners is biased upward.
- **Event time and insert time must stay distinct** — a late client report can cross a period
  boundary.
- **`owner_id` is `ON DELETE RESTRICT`**, deliberately, so billing history survives. Customer
  deletion will force that policy question sooner than expected.
- **An advertised allowance with no enforcement is unlimited.** Caps are out of scope here; before
  real users, voice either gets excluded, labelled limited-beta/fair-use, or enforced.
- **Raw tokens are a poor customer-facing unit.** Audio, cached audio, text, search and
  transcription tokens have radically different economics and mean nothing to a reader. **Voice
  minutes** are a far better product unit if an allowance is needed.

## The thing that may matter more than any of this

Sol's closing point, and it is a product call for Greg rather than an engineering one:

> run a quality bake-off against `gpt-realtime-2.1-mini` before freezing the plan. Its published
> audio rates are $10 input and $20 output per million, versus $32/$64 for the current model. If the
> reading conversation remains good enough, that product choice will move the price more than most
> ledger refinements.

That is roughly a **3x cut** on the most expensive thing the app does. **Greg declined it on
2026-09-02** — *"Let's stick with gpt-realtime-2.1 for now - it's smarter."* Recorded rather than
dropped, because it is the largest single lever on the price and the decision may want revisiting
once Stage 4 says what voice actually costs. Sol's figures are now confirmed against OpenAI's own model pages:
`gpt-realtime-2.1` at $32/$64 per Mtok audio in/out, `gpt-realtime-2.1-mini` at $10/$20, and
`gpt-live-transcribe` at **$0.017 per audio minute** — the last of which is why the usage projection
has to accept seconds as well as tokens. The per-minute bands remain estimates.

Sol's own recommendation on the model, for the record: *"price the core text-reading subscription
from base upload plus engaged-text p95, and treat voice as a separate explicit allowance or beta
feature. 'N articles per month' can remain a secondary abuse boundary, but it should not be the
headline economic model."*

## Handoff from the duplicate-execution fix, 2026-09-02

The Vite-restart bug behind the ledger's duplicate hierarchy spend is fixed
([260902c-the-truncation-retry-cost-storm.md](../postmortems/260902c-the-truncation-retry-cost-storm.md);
`src/process-state.ts` is the mechanism). Two findings from that work belong to this plan, per its
Sol review:

- **`src/store/ai-calls-fs.ts`'s `writing` mutex is the same bug class** — a module-scope mutex
  that a dev-server restart forgets, so two module copies can interleave writes and **corrupt the
  files-mode ledger** this very incident was diagnosed from. It was out of that fix's scope by
  instruction; `src/process-state.ts` is the ready-made home.
- **The ledger's `outcome` field cannot see waste**: it means "the HTTP call completed"
  (`ok | error | aborted`), so a wasted-but-successful call is indistinguishable from a useful
  one. Worth deciding here whether the step/job outcome should be recorded beside spend.

## See also

- [ai-gateway.md](../project/ai-gateway.md) — the two seams, and the four things that fail silently
- [260827q-ai-cost-tracking.md](260827q-ai-cost-tracking.md) — the original design
- [realtime-voice-cost-tracking.md](realtime-voice-cost-tracking.md) — the live-conversation design,
  decided and unbuilt
- [live-conversation.md](../project/live-conversation.md) — the feature itself
