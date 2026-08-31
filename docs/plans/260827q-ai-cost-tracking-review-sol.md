Verdict: do not build this plan as written. The two cache-token formulas are correct, but the price table, embedding diagnosis, failure accounting, store behavior, and future-cap story need revision first.

## Findings, ranked by cost if missed

1. **BLOCKER — Certain: the Sonnet price table expires in five days.**

The plan freezes Sonnet 5 at `$2/$10` ([plan:229](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827q-ai-cost-tracking.md:229)). Anthropic’s current table says those rates end on 2026-08-31; from 2026-09-01 they become `$3/$15`, with cache rates `$3.75/$6/$0.30`. That makes every direct-SDK cost recorded under the proposed table one-third below the bill. [Anthropic’s pricing table](https://platform.claude.com/docs/en/build-with-claude/prompt-caching?939688b5_page=2)

Phase 0 must encode both effective-date rows now, with a UTC boundary test. Store `call_started_at` and define which side of a price boundary owns a call. A “checked on” comment and `price_version` are insufficient.

The same section is internally incomplete: the app’s three actual model families are Sonnet, GPT-5.6 Luna, and Voyage ([models.ts:186](/Users/greg/Dropbox/dev/experim/spideryarn2/src/models.ts:186), [models.ts:212](/Users/greg/Dropbox/dev/experim/spideryarn2/src/models.ts:212), [models.ts:238](/Users/greg/Dropbox/dev/experim/spideryarn2/src/models.ts:238)), but the proposed table contains Sonnet, Opus, and Haiku. It cannot perform the promised OpenRouter reconciliation for Luna or Voyage.

2. **BLOCKER — Certain: the design loses exactly the failed, cancelled, and cut-off calls most likely to escape accounting.**

The plan describes a final `recordAiCall()` insert ([plan:469](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827q-ai-cost-tracking.md:469)). That works only after a usable final response exists. OpenRouter delivers usage in the last SSE frame; an abort, broken stream, provider error, function termination, or parser failure may be billed while never reaching that frame. “Raw response always” is therefore impossible under the proposed lifecycle.

The old app explicitly had `pending | success | failed` and a correlation id ([llm-plumbing.md:129](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/original-version/llm-plumbing.md:129)); the new plan has dropped both without explaining why.

Required shape:

- Mint a stable `call_id` before network I/O.
- Record `started_at`, `finished_at`, `status`, nullable usage fields, provider request/generation id, and an idempotency key.
- Record from `finally`, not only success.
- Preserve unknown as `NULL`, never zero.
- Define whether you accept crash-before-final-insert loss or reintroduce a pending-row write. Write down that trade.
- For OpenRouter, retain the generation id and implement or explicitly defer `/api/v1/generation` recovery; OpenRouter documents that endpoint for post-call usage retrieval. [OpenRouter generation API](https://openrouter.ai/docs/api/api-reference/generations/get-generation)

A future cap also needs a synchronous reservation ledger. `sum(cost)` plus `(owner_id, created_at)` ([plan:489](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827q-ai-cost-tracking.md:489)) has a concurrency race: several calls can all observe remaining budget and start together. Reserve a worst-case amount atomically, then settle actual cost and expire abandoned reservations.

3. **BLOCKER — Certain: the claimed embedding bug is false, and the proposed fix conflates two different costs.**

The research already corrected itself at [research:264](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/research/260827d-ai-cost-tracking-options.md:264): the BYOK-only limitation applies to the asynchronous generation lookup, not the inline usage object. It then contradicts itself again at [research:634](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/research/260827d-ai-cost-tracking-options.md:634), and the plan adopted the stale conclusion ([plan:326](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827q-ai-cost-tracking.md:326)).

The committed eval is stronger evidence than the inference: `embedBatch()` obtains cost only from `upstream_inference_cost` ([embeddings.ts:207](/Users/greg/Dropbox/dev/experim/spideryarn2/src/embeddings.ts:207)), yet non-BYOK Voyage produced `$0.00219` ([embedding result:55](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/results/embedding-retrieval-2026-08-26.md:55)). It is not silently zero.

OpenRouter defines:

- `usage.cost`: credits charged to the OpenRouter account.
- `upstream_inference_cost`: inference cost charged by the upstream provider. [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting)

Therefore “prefer whichever is non-zero” is wrong. Both may exist and mean different things. Store both. For current non-BYOK Voyage, `usage.cost` answers “what OpenRouter deducted.” For BYOK, total business cost may include the upstream charge plus any OpenRouter BYOK fee. The existing comment is appropriate for the cross-provider eval; it is not necessarily the correct ledger definition.

4. **HIGH — Certain: “always Postgres, warn on failure” breaks the normal local CLI path.**

The default store is `files` ([store/index.ts:4](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/index.ts:4)). If `.env.local` contains a local `DATABASE_URL` but Supabase is stopped, an awaited insert opens a pool, waits for connection failure, warns, and leaves the pool alive. The DB client explicitly says an open pool prevents CLI exit ([db/client.ts:128](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/client.ts:128)). Repeating this per batch could add several timeouts to a model run.

It also cannot reliably populate `article_id`: in files mode the article may have no Postgres row.

This is not technically a fallback violation—the cost record is a separate subsystem—but it makes the explicit durability requirement best-effort and breaks developer ergonomics. Use an explicit cost-store adapter:

- `postgres` mode → DB row.
- `files` mode → JSONL sidecar, with later idempotent import if wanted.
- Never retry one backend against the other.

If Postgres-only is chosen instead, make Supabase a stated prerequisite, add pool shutdown to every CLI, add an article slug snapshot, and fail health/startup visibly rather than warning once per expensive call.

5. **HIGH — Certain: the plan does not implement the requested success log line.**

The owner asked for every call in both a log line and a database row. The plan explicitly leaves existing logs unchanged ([plan:75](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827q-ai-cost-tracking.md:75)) and only logs when recording fails ([plan:362](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827q-ai-cost-tracking.md:362)).

Existing pipeline lines are per-step aggregates, not per-call rows, and do not contain dollar cost. Add one safe structured success line per recorded call: call/run id, owner-safe identifier, purpose, model, usage, provider/computed cost, status and latency—never raw response.

6. **HIGH — Certain: `owner_id` belongs on `ai_calls`, but the deletion analysis is wrong.**

The plan is right that `article_id ON DELETE SET NULL` ([schema.ts:968](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:968)) cannot preserve owner attribution, and some calls have no article. Direct `owner_id` is necessary.

But “every other owned table cascades” ([plan:522](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827q-ai-cost-tracking.md:522)) is false. The custom migration deliberately uses `ON DELETE RESTRICT` for Auth owners so deleting an account cannot silently delete data ([migration:50](/Users/greg/Dropbox/dev/experim/spideryarn2/drizzle/0001_auth_fks_and_guards.sql:50)).

For now, use `ON DELETE RESTRICT`, consistent with the existing decision. If Auth users must be deletable while billing history survives, introduce an application-owned billing-account/tombstone table whose Auth reference can be nulled; point `ai_calls` at that. Do not use cascade, and do not leave this undecided until after the migration.

Also store an article identifier snapshot; otherwise article deletion preserves the owner’s total but destroys the requested per-article history.

7. **HIGH — Certain: the proposed twelve-site recorder is the wrong enforcement seam.**

The count is currently correct: seven Anthropic SDK entry modules and five OpenRouter entry modules. The grep test is still weak: a new provider, Responses API, changed URL, or SDK method evades it.

Use provider gateways:

- One module is allowed to import `@anthropic-ai/sdk`.
- One module owns OpenRouter URLs, streaming and JSON responses.
- Embeddings go through the OpenRouter JSON gateway.
- Call sites provide metadata and consume the stream; the gateway owns timing, lifecycle, usage extraction, raw capture, status and recording.

Then enforce “no direct SDK import/OpenRouter endpoint outside these files.” This also respects stage ownership better than editing twelve independent stages; architecture explicitly says cross-cutting work should stay at seams ([architecture.md:120](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/architecture.md:120)).

Pilot one of each transport, not only ToC: Anthropic stream, OpenRouter SSE, OpenRouter JSON/PDF, and embeddings.

8. **HIGH — Certain: reconciliation is worth storing, but it is not proof that the price table is stale.**

Only the three request-path Sonnet calls exercise the same model as the direct SDK. PDF uses Luna and embeddings use Voyage. Environment overrides can separate them further. OpenRouter routing permits fallback ([models.ts:94](/Users/greg/Dropbox/dev/experim/spideryarn2/src/models.ts:94)), and provider cost may also differ because of BYOK, routing, tool fees, credits, discounts or pricing modifiers.

Keep the second number, but call it a drift signal, not a diagnosis. Store:

- canonical pricing key, separately from wire model spelling;
- OpenRouter account cost;
- upstream inference cost;
- locally computed cost;
- actual upstream/provider name where available;
- all cost components and a defined absolute/relative tolerance.

OpenRouter’s `usage.cost` is credits charged, not necessarily cash spent: credit purchases carry a fee. [OpenRouter billing FAQ](https://openrouter.ai/docs/faq) The plan must define whether “cost” means list-price inference, credits consumed, or cash COGS.

9. **HIGH — Certain: `pg_cron` is viable, but the proposed SQL will likely fail silently.**

Supabase supports `pg_cron`, schedules can be created with SQL, and it runs inside Postgres—not through the application transaction pooler. The migration already uses a session connection ([db-migrate.ts:16](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/db-migrate.ts:16)), so the pooler warning is irrelevant here. [Supabase Cron](https://supabase.com/docs/guides/cron)

But `ai_calls` lives in schema `spideryarn` ([schema.ts:80](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:80)); the plan schedules unqualified `update ai_calls` ([plan:427](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827q-ai-cost-tracking.md:427)). The cron worker’s search path should not be assumed to include it.

The migration must:

- install `pg_cron` explicitly, or document and test its prerequisite;
- create a schema-qualified pruning function with a fixed empty search path;
- schedule `SELECT spideryarn.prune_ai_call_raw_responses()`;
- verify the job after `db:reset`;
- report `cron.job_run_details` last success/failure.

Table size is not a reliable prune alarm because updates create dead tuples and do not necessarily shrink the relation. Oldest surviving raw response and last successful run are the useful checks.

10. **MEDIUM — Certain: fire-and-forget is unsafe, but awaiting every interactive insert is not the only pattern.**

The Vercel premise is correct: an unmanaged promise may be frozen after the response. Vercel provides `waitUntil()` specifically for logging and analytics, including plain Node functions. [Vercel `waitUntil`](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package)

Use:

- awaited writes for pipeline/job calls whose immediate end-of-run total must be exact;
- `waitUntil(recordPromise)` for interactive request-path telemetry if insert latency matters;
- an explicit flush before any total is queried.

`waitUntil` remains bound by the function’s duration, so it is not a completeness guarantee. Future spend reservations must be synchronous.

11. **MEDIUM — Certain: nano-dollars in `bigint` is the right choice, but the implementation hazards are omitted.**

A small query embedding can be below one micro-dollar, so micro-dollars genuinely turn paid calls into zero. Nano-dollars are justified.

The plan must still specify:

- integer/`bigint` arithmetic rather than floating multiplication;
- `pg`/Drizzle decoding—`bigint` and `sum(bigint)` do not naturally arrive as ordinary JS numbers;
- JSON serialization, since JS `BigInt` cannot be serialized directly;
- explicit currency, preferably `currency = 'USD'` or names such as `cost_usd_nanos`;
- overflow rules for aggregate conversion.

12. **MEDIUM — Certain: there is no universal run identity, so “total at the end of every run” is underspecified.**

`job_id` works for queued jobs but not bare CLI stages, evals, or request-path calls. `attempt` is ambiguous between job claim `attempt_id`, provider retry, and semantic repair retry. `revisionStepRuns` already has a UUID `attemptId` with precise meaning ([schema.ts:913](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:913)).

Add a universal `run_id`, plus separate `job_attempt_id`, `provider_attempt`, and optional `parent_call_id`. Otherwise two concurrent CLI runs cannot calculate “my run” without a time-range race.

## Token-accounting verdict

Both load-bearing formulas are correct.

- Anthropic: `input_tokens` excludes cache-read and cache-created tokens; add all three. [Anthropic documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching?939688b5_page=2)
- OpenRouter: its normalized `prompt_tokens` includes the cache subdivisions. The committed arithmetic is correct:

  - Cold: `$0.1194495 → $0.11945`.
  - Warm: `$0.0096478 → $0.00965`.
  - Combined: `$0.1290973 → $0.12910`.

One research sentence has the direction backwards: [research:66](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/research/260827d-ai-cost-tracking-options.md:66) calls applying Anthropic’s additive rule to OpenRouter an undercount; it is an overcount.

Do not copy the eval’s `Math.max(0, fresh)` into billing code ([eval:71](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/prompt-caching.ts:71)). Negative fresh tokens should mark accounting invalid, not silently clamp the discrepancy away.

## Missing from the plan

Before implementation, add explicit decisions for:

- nullable unknown usage versus reported zero;
- failed/cancelled/partial calls and process crashes;
- provider/generation/request ids and recovery;
- idempotent writes after ambiguous DB timeouts;
- raw-response definition for SSE—final normalized message versus every raw frame;
- start time, completion time, pricing boundary and monthly attribution;
- UTC versus account-local calendar months, using half-open intervals;
- currency and OpenRouter credit-purchase fees;
- page authorization: current user view versus operator-wide view;
- no-backfill policy—the source grep does not prove the live table is empty;
- cron installation, ownership and failure monitoring;
- tests for formula fixtures, TTL breakdown checksums, missing usage, aborts, retries, owner isolation, BigInt conversion, schema FKs, cron execution and gateway enforcement.

## Phase order

Phase 0 should not be only another embedding call. The committed eval already disproves the proposed bug. Phase 0 should settle:

1. cost definition and effective-dated prices, including the 2026-09-01 change;
2. embedding field semantics;
3. owner deletion and store-mode policy;
4. call lifecycle, statuses, identifiers and cap reservations;
5. provider fixtures and invariants.

Then build the gateway and schema, instrument one example of each transport, expand coverage, and only then add totals and reporting. The CLI/article/app surfaces can remain last.