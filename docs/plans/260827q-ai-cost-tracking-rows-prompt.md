# Input wanted: finishing AI cost tracking — the database row, the job total, `npm run cost`

You reviewed this plan twice already, and both reviews are in the repo:

- `docs/plans/260827q-ai-cost-tracking-review-sol.md` — the design review, before any code
- `docs/plans/260827q-ai-cost-tracking-code-review-sol.md` — the code review, which opened "Not ready to
  land" and was right on six counts

This is **input on the remaining work, not a review of finished code.** I want decisions, and I want
them decisive: pick one and say why, rather than laying out three options. Where you think I have
the wrong idea, say so plainly.

## Read these first

- `docs/plans/260827q-ai-cost-tracking.md` — the plan. §"What gets built, and in what order" (line ~956) has
  a status block saying what is built and what is not. §"What changes in the schema" (~209) has the
  column list. §"Where the write goes" (~778) has the two ways it must not break anything.
- `src/ai-spend.ts` — the collector, the `SpendRecord` shape, `totalSpend`, `spendFields`
- `src/ai-call.ts` and `src/messages-stream.ts` — the two seams, both metered
- `src/jobs.ts` — `runStep` (~267) opens a collector per step; `endJob` (~458) writes the job's line
- `src/routes.ts` — `handleApi` (~2815) opens one per HTTP request; `logRequest` (~2767) reads it
- `src/db/schema.ts` — `aiCalls` (~1090), the table as declared in the initial migration and never
  written to
- `src/owner.ts` — `currentOwnerId()`, `runInRequest`, `runAsOwner`
- `src/store/index.ts` — the `files` / `postgres` flag and its no-fallback rule

## What is true today

Thirteen call sites, two seams, every call metered, and the totals reach two log lines: one per
pipeline step and one per HTTP request. Nothing is written to the database. Nothing survives the
process.

## What I am proposing to build now

1. **The `ai_calls` row.** The table exists in `drizzle/0000_initial_schema.sql` and nothing has
   ever inserted into it. Its columns predate everything this plan learned.
2. **Phase 4's missing half** — a total for the whole job, not just per step.
3. **Phase 5, `npm run cost`** — spend by day, job, model, article and owner, plus the drift check
   against `GET /api/v1/generation` and the account check against `GET /api/v1/key`.

Phases 6 and 7 (the article's own number on its metadata page; a spend page in the app) I plan to
leave. Tell me if you think that is the wrong cut.

## The decisions I want your input on

### 1. Where the insert happens, given `recordSpend` is synchronous

`recordSpend(record, callId)` returns `void` and is called from a generator's `finally` in
`src/ai-call.ts` and from `streamMessage` in `src/messages-stream.ts`. Neither can await.

The plan says the write **must be awaited** — an un-awaited promise on Vercel dies when the function
is frozen, and the rows that would go missing are exactly the request-path ones, which is the half
Greg asked for.

So the write cannot happen in `recordSpend` and be awaited there. My proposal: **`collectSpend`
flushes at scope close**, one multi-row insert per scope, awaited inside `handleApi`'s frame (which
is still inside the Vercel invocation) and inside `runStep`'s. A call that finishes after its scope
closed is already counted and logged by `lateCalls()` and simply is not written.

Consequences I can see, and want you to check:

- An **unscoped** call (a CLI stage run outside `runStep`, an eval) is written nowhere. It is already
  counted by `unscopedCalls()`. Is "no scope, no row" right, or should there be a process-level
  fallback flush?
- A **long-lived** scope — an ingest step that makes forty calls — holds forty rows in memory and
  writes them at the end. If the process dies mid-step, all forty are lost, where a per-call insert
  would have kept thirty-nine. Is the batched insert worth that?
- `collectSpend` is currently pure and has no IO. Making it write means it needs a store, which means
  a module edge from `ai-spend.ts` into `src/store/`. Should the flush instead be a **callback the
  two call sites supply** (`runStep` and `handleApi` each pass a writer), keeping `ai-spend.ts` free
  of IO and testable as it is now?

### 2. `files` mode — the plan's option 2, and I want a second opinion

`src/store/index.ts` has a hard rule: no fallback, ever, because two stores that disagree is the
failure a parity test cannot see. Default mode is `files`.

The plan offers three options and prefers **(2) always Postgres, degrade to a warn line when there is
no `DATABASE_URL`**, on the grounds that there is no filesystem implementation of `ai_calls` to
diverge from. Option (1) follows the flag and means the default configuration silently records
nothing. Option (3) is a JSONL sidecar, which does not work on Vercel.

Is (2) right? And if it is, what stops "degrade to a warn line" from becoming the state everybody
runs in for a month without noticing?

### 3. The column list

The plan's table (§"The rest of the columns") was written when there were two vendors, and lists
columns nothing currently produces: `reasoning_tokens`, `web_searches`, `service_tier`,
`inference_geo`, `thinking_tokens`, `cost_computed_nanos`, `price_version`, `attempt`, `cost_source`.

`SpendRecord` today carries: `job`, `model`, `answeredBy`, `costNanos`, `upstreamCostNanos`,
`generationId`, `upstream`, `isByok`, four token counts, `ms`, `outcome`.

Two questions:

- **Which of the plan's extra columns should exist now?** A column nothing writes is a column that
  reads as zero. But `cache_write_5m_tokens` / `cache_write_1h_tokens` are priced differently and
  adding them later means a migration; `reasoning_tokens` is on the wire and free to capture.
- **`cost_computed_nanos` and the drift check.** The plan's reconciliation diagram is stale: it was
  built on seven Anthropic-SDK calls having no provider figure. Everything goes through OpenRouter
  now and every call carries `usage.cost`. Is the redundant computed column still worth having, or
  does the drift check now belong entirely in `npm run cost` against
  `GET /api/v1/generation?id=…`?

Also: the declared `cost_micros integer` must become nano-dollars in a `bigint` — a query embedding
is ~$0.0000006, which rounds to zero in micro-dollars. Nothing has ever written the column, so this
is free today. Confirm, and tell me whether to alter the existing table or drop and recreate it.

### 4. Attribution — `owner_id`, `article_id`, `job_id`, `step_name`

`owner_id` is ambient (`currentOwnerId()` throws outside a request or a `runAsOwner`), so it is
reachable at flush time. The plan argues it must be `not null` and `on delete restrict`, matching
every other owner FK in `drizzle/0001_auth_fks_and_guards.sql`.

The rest are not ambient. `runStep` knows the job, the step and the slug; `handleApi` knows neither
the article nor which feature the request was. My instinct is that the **flush site supplies the
attribution** — `runStep` passes `{ jobId, stepName, articleId }`, `handleApi` passes nothing and the
`job` field on each record (`chat`, `explain`, `search`, `dictation`) says what it was.

Is that enough for "what did this article cost me"? A reader's chat about an article would have no
`article_id` under that scheme, and the plan's phase 6 wants exactly that number. What is the
cheapest honest way to get the article onto a request-path row — a second `AsyncLocalStorage`, a
field the route sets, or accept that only ingest rows carry an article?

### 5. The job total (phase 4)

A job is not one process run. `advanceJob` runs some steps and returns; the browser calls it again.
So there is no frame that spans the whole job, and a job total has to be accumulated somewhere that
survives — either a running total on the job row (which lives in both `jobs-fs.ts` and `pg-jobs.ts`,
so it is a parity-test change), or a `sum()` over `ai_calls where job_id = …` at `endJob`, which only
works in `postgres` mode.

Which? And if it is the `sum()`, what does the line say in `files` mode — nothing, or a zero that is
a lie?

### 6. Open questions the plan parks, which I have to answer to write a column

Greg has not answered these and has told me to proceed. Give me your recommendation for each; I will
write the answer into the plan as a decision made without him, marked as such.

- **Q3, pruning window for `raw_response`.** 14 days was the straw man. And: should we store the raw
  response at all now, given every call already yields a `generationId` that can be re-fetched from
  `GET /api/v1/generation`? That endpoint did not exist in the plan's thinking when Greg chose
  "always store, with pruning".
- **Q4, do the evals count?** `evals/` spends real money from the CLI, under the dev owner.
- **Q5, what "cost" means.** OpenRouter's margin is a 5.5% fee on buying credits, not a per-token
  markup, so `usage.cost` is *credits consumed* and the cash is ~5.5% more. Three candidate
  meanings; the column gets read as whichever the reader assumed. Which one, and what is the column
  called?
- **Q6, UTC or calendar month.**

## Findings from your last review I did not act on

I fixed the six blockers. These I left, and I want you to tell me which are worth doing now, in this
piece of work, and which are noise:

- **The Messages seam is still breakable** — it exports `meterStream`, the raw SDK stream and the
  meter, and callers may override `model` and `provider`. `src/ai-call.ts` exports nothing between
  send and record. Is closing the Messages seam to match a prerequisite for writing rows, or a
  separate job?
- **Abort classification** — both seams call an error "aborted" when the composite signal is now
  aborted, even when the error was an independent provider failure. This lands in a database column
  now rather than a log line. Does that change the answer?
- **The leaf module** — you suggested moving the job/model/wire/route tables out of `src/models.ts`
  and `src/ai-call.ts` into a leaf, because the import cycle forced duplicated configuration.
- **`explain`'s "no reply" message lost its `— deadline fired` suffix.**
- **The endpoint scan is bypassable** using the exported `OPENROUTER_BASE`, string assembly, or
  another SDK.
- **`openRouterReader` and its transport retries have no end-to-end transport test.**

## What I am asking for

For each numbered decision: your call, one paragraph of why, and the failure mode of the option you
rejected. Plus anything I have not thought to ask that would make this row wrong in a way nobody
notices for six months — that being the failure this whole plan exists to avoid.
