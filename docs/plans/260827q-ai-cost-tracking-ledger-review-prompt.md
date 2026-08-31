# Review: the AI ledger — the row, the attribution, the job total, `npm run cost`

This is the code built from your input in
[`docs/plans/260827q-ai-cost-tracking-rows-sol.md`](260827q-ai-cost-tracking-rows-sol.md), which you wrote this
morning. Read that first: it is the specification I was working to, and where I departed from it I
have said so below.

Weight this review higher than the plan-stage one. A plan-stage review cannot find a `PATCH` that
writes one field and then rejects the request.

## What to read

- The scoped diff and the new files are at the path given at the end of this prompt. Everything else
  in the working tree belongs to other agents and is not mine to answer for — in particular
  `src/api.ts` and `src/store/pg.ts` have someone else's half-finished work in them and fail
  typecheck for reasons unrelated to this.
- [`docs/plans/260827q-ai-cost-tracking.md`](260827q-ai-cost-tracking.md) — the plan, with a 2026-08-28 status block
  and a new section, *The decisions taken without Greg*.
- [`docs/project/ai-gateway.md`](../project/ai-gateway.md) — the doc a future reader lands on.

## What was built

1. **A row per finished call**, in whichever store is live — `ai_calls` under `postgres`
   ([migration 0021](../../drizzle/0021_ai_calls_ledger.sql)), an append-only
   `data/_ai-calls.jsonl` under `files`. Written by an **injected sink**, so `src/ai-spend.ts` still
   imports no store; one write per finished call, started immediately with its rejection handler
   attached, and all of them awaited before `collectSpend` returns.
2. **Attribution** the gateways cannot know: `runStep` supplies owner/job/step/article;
   `handleApi` supplies only `scopeKind: "request"` and the owner is resolved at record time,
   because the gate that fills the owner box runs *inside* the collector; four article routes add
   their slug with `withSpendAttribution`, which overlays the open collector rather than nesting a
   second one.
3. **The job total** (phase 4's missing half) — `endJob` queries the ledger by `job_id`, and says
   `aiCostStatus: "unavailable"` rather than printing a zero it cannot stand behind.
4. **`npm run cost`** — [`scripts/ai-cost.ts`](../../scripts/ai-cost.ts). UTC, half-open ranges;
   breakdowns by day, job, model, article, owner and scope; BYOK kept as a separate pocket; the
   unpriced count; what was spent on calls that failed; `--reconcile` against `GET /api/v1/key`.
5. **Four of your earlier findings**, which you said had to land before the schema hardened: the
   Messages seam closed (`MeteredCall` is `onText`/`finalMessage`/`aborted`; `meterStream`, the
   stream and the meter are private; `model` and `provider` are typed `never`), abort classified by
   causality on both wires, and the endpoint/model injection moved after the body spread.

## Where I departed from your input, and why

- **No CLI or eval scopes.** You said to wrap them. I built it — a one-line `withLedger` at each
  stage's `isMain` — and then took it out, because it closes an import cycle: a stage reaching
  `src/store/ai-calls.ts` reaches `store/pg.ts` → `api.ts` → `glossary.ts` → `arc.ts`, which is a
  stage. `npm run cycles` is a gate here, and biome counts a dynamic import as an edge too. It bites
  three of the seven stages and not the other four, and half a mechanism seemed worse than none. The
  gap is loud rather than silent: an unscoped call now writes a warn line as well as incrementing
  `unscopedCalls()`, and `npm run cost` prints a line saying stage CLIs and evals are not in it. The
  fix is written into the plan: `ai-calls-pg.ts` needs exactly one symbol from `store/pg.ts`
  (`ownedSlug`), so moving that to a leaf and adjusting the exemption in
  `tests/owner-isolation.test.ts` would break the edge. **Tell me if you think that is the wrong
  call**, or if you see a cheaper way.
- **No `credential_fingerprint` reconciliation baseline.** The fingerprint is on every row and
  `--reconcile` excludes and counts rows written under a different key, but there is no stored
  per-key baseline, so the comparison is a gap to watch rather than an equality. Is that enough for
  now?
- **I kept `article_id` as well as `article_slug`**, resolved once per row through `ownedSlug`.

## Specific things to attack

- **Cardinality, again.** One finished call must produce exactly one row, and a call that never
  finishes must produce none. Is there a path through `recordSpend` → `write` → sink that writes
  twice, or that loses a row that should exist?
- **`withSpendAttribution` shares a mutable box across an overlay.** Is there a concurrency hole in
  that — two async branches of one request, a route that overlays and then awaits something that
  overlays again?
- **The owner resolved at record time.** `ownerFor` calls `currentOwnerId()` inside a try/catch. Is
  there a case where that returns the *wrong* owner rather than throwing — a pipeline pump, a job
  that outlives its request, a route that sets the owner after the first model call?
- **The `files` adapter is append-only with no lock.** Two concurrent writers on one machine, and a
  line longer than a pipe buffer. Is `appendFile` enough, and is skipping a malformed line the right
  failure?
- **Migration 0021 drops ten columns.** The guard refuses if the table has rows. Is the guard
  correct, and is anything else about that migration going to fail on a database that is not this
  laptop?
- **`bigint` with `mode: "number"`.** This file's own comments warn twice that node-pg returns
  `int8` as a string. I believe Drizzle maps it back through `Number()`, and there is a round-trip
  test asserting the type. Is there a path that bypasses that mapping?
- **Tests that are green against broken code.** I mutated ten things and each went red, and I found
  one test of my own that claimed to prove the write was awaited and did not (the comment now says
  so). Find the others.
- **Anything that will read wrong in six months** — a column whose name promises more than it holds,
  a breakdown that double-counts, a total that is short without saying so.

## Evidence

- Full suite: 232 of 236 files pass. The four failures — `fixture-ids`, `library-log-volume`,
  `store-carry-forward`, `store-jobs-parity` — are other agents' and fail without my changes.
- `npm run typecheck` clean for every file in this diff; `npm run cycles` clean; biome lint clean on
  the new files.
- **Proved live on 2026-08-28, both stores.** One real embeddings call: `$0.00000018`, `upstream:
  "VoyageAI by MongoDB"`, fingerprint present, row in the JSONL and row in Postgres.
  `npm run cost -- --reconcile` answered against the live key.
- That probe also caught two real bugs, both now fixed: `formatNanos` printed `$0.0000` for money
  that was really spent — putting the lie back at the last step that nano-dollars existed to avoid —
  and a full `npm test` had written four hundred fixture calls into the developer's own ledger.

## The diff

The scoped diff and the full text of every new file:

```diff
=== git diff (tracked files I changed) ===
diff --git a/docs/plans/260827q-ai-cost-tracking.md b/docs/plans/260827q-ai-cost-tracking.md
index 9982dd6..4d61d3f 100644
--- a/docs/plans/260827q-ai-cost-tracking.md
+++ b/docs/plans/260827q-ai-cost-tracking.md
@@ -982,7 +982,7 @@ the twelve wirings are not finished until both are done.
 > - **A total on every step's log line and every request's** — `aiCalls`, `aiCost`, and the three
 >   ways it can be wrong: `aiUnpriced`, `aiPending`, `aiPendingJobs`.
 >
-> **Not built:**
+> **Not built, as of that day:**
 >
 > - ❌ No database row, no `npm run cost`, no per-article number, no spend page.
 > - ❌ **No spend limit, and the collector is not one.** It is accounting: it says what a request
@@ -990,6 +990,53 @@ the twelve wirings are not finished until both are done.
 >   after, because final usage arrives when the money has already gone, and two simultaneous
 >   requests both pass a `SUM(cost)` check. GPT Sol's design review said so plainly and it is worth
 >   repeating here rather than discovering later.
+
+> **Status, 2026-08-28.** The row and the report exist. What a call costs now survives the process
+> it was made in.
+>
+> **Built the next day:**
+>
+> - **A row per call**, in whichever store is live: `ai_calls` under `postgres`
+>   ([migration 0021](../../drizzle/0021_ai_calls_ledger.sql)), `data/_ai-calls.jsonl` under `files`.
+>   Written by an **injected sink** — [`src/ai-spend.ts`](../../src/ai-spend.ts) still imports no
+>   store — one insert per finished call, **awaited before the collector closes**.
+> - **Attribution the gateways cannot know**: `runStep` supplies the owner, the job, the step and the
+>   article; article routes add their slug with `withSpendAttribution`, which overlays the collector
+>   already open rather than starting a second one.
+> - **A total for the whole job** on the line that ends it, queried from the ledger rather than
+>   accumulated — a job spans several `advanceJob` calls, so there is no frame that could carry one.
+> - **`npm run cost`** — [`scripts/ai-cost.ts`](../../scripts/ai-cost.ts). Spend by day, job, model,
+>   article, owner and scope; the BYOK pocket separately; the unpriced count; what was spent on calls
+>   that failed; and `--reconcile`, which asks `GET /api/v1/key` what OpenRouter thinks the key has
+>   spent.
+> - **Four review findings that had to land before the schema hardened** — the Messages seam closed
+>   (no more `call.stream.finalMessage()`, `model` and `provider` typed `never`), aborts classified
+>   by cause rather than by coincidence, the `provider` injection moved *after* the body spread (it
+>   was before, and a body built at run time could override it), and `formatNanos` no longer printing
+>   `$0.0000` for money that was really spent.
+>
+> **Still not built:** the article's own number on its metadata page (phase 6), the spend page (phase
+> 7), and any cap. And **the evals still call models outside the two seams**, so their spend is not
+> in the ledger — see question 4.
+>
+> **Nor is a CLI stage run.** `npm run toc` opens no collector, so its calls are counted by
+> `unscopedCalls()` and each writes a warn line saying it is in no total — visible, and not in the
+> ledger. It was built and then taken out again, because the one-line `withLedger` wrapper at each
+> stage's `isMain` closes an import cycle: a stage reaching `src/store/ai-calls.ts` reaches
+> `store/pg.ts` → `api.ts` → `glossary.ts` → `arc.ts`, which is a stage. `npm run cycles` is a gate,
+> and a dynamic import does not get past it either. It bites three of the seven stages and not the
+> other four, and half a mechanism is worse than none.
+>
+> **The fix, for whoever wants it:** `ai-calls-pg.ts` needs exactly one thing from `store/pg.ts` —
+> `ownedSlug`, four tokens of Drizzle — and that import is the whole edge. Move it to a leaf of its
+> own, re-export it from `pg.ts`, and add the new file to the exemption in
+> [`tests/owner-isolation.test.ts`](../../tests/owner-isolation.test.ts), which greps this directory
+> for the unfiltered spelling. That was not done today only because `store/pg.ts` has another agent's
+> work in flight in it.
+>
+> Proved live on 2026-08-28, both stores: one real embeddings call at **$0.00000018**, which is the
+> number micro-dollars would have rounded to zero and four decimal places did round to `$0.0000`
+> until it was caught.
 >
 > **What the migration deletes from the phases below**: the price table stops being the source of
 > truth and becomes the *check* on one; the Anthropic Admin Cost API reconciliation goes entirely
@@ -1086,13 +1133,28 @@ stripped first, since several files' *comments* warn about exactly those. It is
 than the guarantee — the lifecycle is what makes metering unforgettable; this is what makes the
 lifecycle unavoidable.
 
-**Phase 4 — a total at the end of every run.** 🟡 **Half built.** Each *step* logs its own cost and
+**Phase 4 — a total at the end of every run.** ✅ **Built, 2026-08-28.** The job total was the
+missing half, and it could not be a running figure carried on the job: a job is not one process run —
+`advanceJob` runs some steps and returns, the browser calls it again — so there is no frame that
+spans one. A second ledger on the job row would have to be updated identically in both job stores and
+would be free to diverge after an ambiguous write. `endJob` asks the rows instead, which is what the
+rows are for, and prints `aiCostStatus: "unavailable"` rather than a zero when it cannot read them: a
+ledger that is down and a job that spent nothing must not look the same.
+
+*What follows was true the day before.*
+
+🟡 **Half built.** Each *step* logs its own cost and
 so does each *request* — `aiCalls`, `aiCostNanos`, `aiCost`, plus `aiUnpriced` and
 `aiPending`/`aiPendingJobs` when something went wrong — on success, failure and cancel
 ([logging.md § What a step cost, in money](../project/logging.md)). What does not exist is the *job*
 total: one line at the end saying what the whole ingest cost. Cheap, and unblocked now.
 
-**Phase 5 — `npm run cost`.** Spend by day, stage, model, article and owner; the cache-saving
+**Phase 5 — `npm run cost`.** ✅ **Built, 2026-08-28** —
+[`scripts/ai-cost.ts`](../../scripts/ai-cost.ts), and it does what the paragraph below asks for
+except the two things that turned out not to exist: there is no raw response to age, and no pruner to
+have stopped. `--reconcile` was run live against `GET /api/v1/key` the same day.
+
+*The original text, which is still the specification:* Spend by day, stage, model, article and owner; the cache-saving
 figure; the unpriced count; the aborted-spend line; the oldest surviving raw response and the
 pruner's last successful run. And it must print **both** floor-sweeping counters when they are not
 zero — `unscopedCalls()` for calls made with no collector open, `lateCalls()` for calls that
@@ -1302,8 +1364,59 @@ is here so the day it arrives is not the day somebody discovers the race. And **
 grep proving nothing writes `ai_calls` is evidence about the source, not about the live table, so
 the first migration checks the table is empty rather than assuming it.
 
+## The decisions taken without Greg, 2026-08-28
+
+He asked for the work to be finished and for GPT Sol's input where it was needed, which is what
+these are. Each one had to be settled to write a column. **They are decisions, not guesses**, and
+each is here so it can be overruled cheaply rather than discovered later as a fact about the schema.
+
+**The raw response is not stored at all.** Greg had chosen *always store, with automatic pruning*,
+over the recommendation of failure-only. That choice was made before `generation_id` existed on
+every row — and the cheaper half of it, "keep the response so a call can be understood later", is now
+answered by asking OpenRouter about the id. What is left is the expensive half: a raw response for
+`toc`, `glossary` or `summarise` is model output derived from the reader's article, and a dictation
+response is their voice. Storing it turns a small financial ledger into the project's largest and
+most sensitive store, kept alive by a pruner that can quietly stop — the failure Greg himself named
+as his worry about the pruning option. So: **no column, no pruner, no window.** One correction to my
+own reasoning, from Sol: `GET /api/v1/generation` returns *metadata*, not content; content needs a
+management key and retention that is off by default. So this is a real loss of debuggability, small,
+and named rather than argued away.
+
+**"Cost" means credits, and the column says so: `credits_used_nanos`.** OpenRouter's margin is a fee
+on *buying* credits — about 5.5%, with a minimum, and different again for crypto and BYOK — not a
+per-token markup. Multiplying each row by 1.055 would invent a precision that could never match a
+bank statement. Cash belongs to a credit-purchase ledger that does not exist. `upstream_inference_nanos`
+stays beside it as the other pocket, which is the only honest way to read a BYOK call.
+
+**Evals count, and are marked.** `scope_kind` separates `request`, `job_step`, `cli` and `eval`, and
+`npm run cost` breaks down by it. But **`evals/` still calls models outside the two seams**, so
+"evals count" is not yet *true* — it is only possible. Written down here rather than implied by a
+column that reads empty.
+
+**UTC, half-open.** `[2026-08-01T00:00Z, 2026-09-01T00:00Z)`. OpenRouter's key limits reset at
+midnight UTC, so it is also the only boundary the reconciliation can share; and a range that is
+closed at both ends lets two adjacent months claim the same call.
+
+**A deleted user's history: `restrict`, following the existing rule.** Every owner FK in
+[`drizzle/0001_auth_fks_and_guards.sql`](../../drizzle/0001_auth_fks_and_guards.sql) is
+`ON DELETE RESTRICT`, and deleting an account is already something this schema refuses to do quietly.
+The day somebody wants to delete an account *and* keep its billing history, the answer is a
+billing-account row that outlives `auth.users`, not a weaker constraint here.
+
+**`files` mode gets a real ledger, not a warning.** The plan preferred *always Postgres, degrade to a
+warn line without a `DATABASE_URL`*. Sol rejected it and was right: the default store is `files`, so
+that would make the **default** configuration the untracked one, with a warn line that becomes
+background noise inside a week. It is an append-only JSONL file instead — not a fallback, since the
+flag picks one adapter at boot and the other is never consulted.
+
 ## Questions for Greg
 
+**Six of these were answered on 2026-08-28 without you**, because you asked for the work to be
+finished and every one of them had to be settled to write a column. What they were decided to is
+[in the section above](#the-decisions-taken-without-greg-2026-08-28), each with the failure of the
+option it rejected, so any of them can be overruled by saying so rather than by re-deriving it. What
+follows is the record of the question as it stood.
+
 **Nothing here blocks the next piece of work.** Phase 3 — metering the five reader-facing calls — is
 decided by your own stated goal (*"so we can define a spend limit per user"*) and needs no answer
 from you. These are the definitions that have to be settled before the shape hardens into a database
diff --git a/docs/project/ai-gateway.md b/docs/project/ai-gateway.md
index 737c628..96b8758 100644
--- a/docs/project/ai-gateway.md
+++ b/docs/project/ai-gateway.md
@@ -9,6 +9,9 @@ having happened with a cost of `null`, and counted as unpriced rather than as fr
 is the whole point and an earlier version of this sentence lost it by saying "every one of them
 records what it cost" — which is the claim a spend report would then be built on.
 
+Since 2026-08-28 "recorded" also means **kept** — a row per call, in Postgres or in a JSONL file, and
+`npm run cost` reads them back. See [what every call is written down as](#what-every-call-is-written-down-as).
+
 > Presumably we want to do this in a way that's reusable (i.e. whenever we make an AI call, we do it
 > in the same way, which takes care of cost-tracking etc)?
 >
@@ -77,12 +80,21 @@ The chat gateway makes **the request and its accounting a single indivisible ope
 `openRouterStream` is a *lazy async generator*, so nothing is sent until the first `next()`, and from
 then the same `finally` owns the call.
 
-**The Messages gateway is not that, and the difference is worth knowing.** It wraps the Anthropic
-SDK, so the call belongs to the SDK's stream object; `streamMessage` hands that object back, and a
-stage that awaited `call.stream.finalMessage()` instead of `call.finalMessage()` would work and
-record nothing. What guards it there is a test that scans `src/`, not the shape of the API. That is a
-weaker guarantee, honestly stated: the two seams are not equally hard to misuse. Early `break`, a throw, an abort, a
-missing `[DONE]`, a 429, a body that will not read — all of them cross it.
+Early `break`, a throw, an abort, a missing `[DONE]`, a 429, a body that will not read — all of them
+cross it.
+
+**The Messages gateway was not that until 2026-08-28.** It wraps the Anthropic SDK, so the call
+belongs to the SDK's stream object — and `streamMessage` used to hand that object back, so a stage
+that awaited `call.stream.finalMessage()` instead of `call.finalMessage()` worked and recorded
+nothing. What guarded it was a test that scans `src/`, not the shape of the API. That was written
+down here as "a weaker guarantee, honestly stated", and it stopped being good enough the day the
+numbers became database rows: a documented bypass under a ledger is a ledger that looks complete.
+
+So the seam is closed. `MeteredCall` is three things — `onText`, `finalMessage`, `aborted` — and the
+stream, the meter and `meterStream` are all private now. `model` and `provider` are typed `never`, so
+a stage cannot pass either; both are injected **after** the body spread, and the test that proved the
+spread order was wrong went red on the old code. GPT Sol asked for all of this before the schema
+hardened.
 
 The first draft handed the caller three things instead: open the call, parse the chunks, finish the
 meter. A GPT Sol review found the hole in about a page, and it is the hole every such design has:
@@ -239,6 +251,37 @@ purpose was to be able to see the bill.
 Same rule as [setup-dev.md § the third spelling](setup-dev.md): a provider prefix is an address, not
 a name.
 
+## What every call is written down as
+
+Since 2026-08-28 a finished call is not only reported, it is **kept**: one row in `ai_calls`
+(Postgres) or one line of `data/_ai-calls.jsonl` (`files` mode), written by an injected sink and
+awaited before the collector closes. [`src/store/ai-calls.ts`](../../src/store/ai-calls.ts) picks the
+adapter; `npm run cost` reads it back. The reasoning, the column list, and the four decisions taken
+in Greg's absence are in [260827q-ai-cost-tracking.md](../plans/260827q-ai-cost-tracking.md).
+
+Three properties of that write are load-bearing and none of them is obvious:
+
+- **The write is awaited, not fired and forgotten.** On Vercel a function can be frozen the moment
+  its response is sent, and an un-awaited promise then never runs — so the rows that would go missing
+  are exactly the request-path ones, which is the half a per-user total is made of.
+- **One insert per finished call, not one batch per scope.** A batch loses forty finished calls to
+  one mid-step crash; a write each loses only what was genuinely still in flight.
+- **A failing sink cannot fail the feature.** It logs and returns. The old app rethrew, which meant a
+  Postgres hiccup could take down a reader-facing feature — [logging.md](logging.md) quotes it as the
+  thing not to copy.
+
+### Aborted is a cause, not a coincidence
+
+Both wires used to record *any* failure raised while a signal happened to be aborted as `"aborted"`.
+A provider dying at the moment a reader presses Stop is not far-fetched — a stall on their side is
+exactly what makes somebody press it — and `"aborted"` is the outcome nobody investigates, so the one
+event that could explain the failure went into the bin marked *the reader did that*.
+
+Both now ask whether the error **is** the abort: the signal's own `reason` by identity, or an
+`AbortError` where no reason was given. [`openrouter-stream.ts`](../../src/openrouter-stream.ts)'s
+`stoppedByReader` had been making the same distinction for the reader-facing message since before
+this; the bill was still using the weaker question.
+
 ## The one thing still open
 
 OpenRouter's own Messages reference contradicts itself about refusals: its example shows
@@ -258,7 +301,11 @@ clause.
 - [`src/messages-stream.ts`](../../src/messages-stream.ts) — the Messages gateway, and the longest
   version of the reasoning above
 - [`src/ai-call.ts`](../../src/ai-call.ts) — the chat gateway, and `AI_JOB_ROUTE`
-- [`src/ai-spend.ts`](../../src/ai-spend.ts) — the ambient spend collector
+- [`src/ai-spend.ts`](../../src/ai-spend.ts) — the ambient spend collector, the row it builds, and
+  `withSpendAttribution`
+- [`src/store/ai-calls.ts`](../../src/store/ai-calls.ts) — which ledger is live, and the one place
+  the totals are computed
+- [`scripts/ai-cost.ts`](../../scripts/ai-cost.ts) — `npm run cost`
 - [260827q-ai-cost-tracking.md](../plans/260827q-ai-cost-tracking.md) — the plan this came out of, including the
   three probes that changed its mind
 - [260827f-openrouter-as-sole-gateway.md](../research/260827f-openrouter-as-sole-gateway.md) — the research, with the
diff --git a/docs/project/dev-and-deployment-overview.md b/docs/project/dev-and-deployment-overview.md
index 27722cf..7309e00 100644
--- a/docs/project/dev-and-deployment-overview.md
+++ b/docs/project/dev-and-deployment-overview.md
@@ -22,6 +22,7 @@ serves the client *and* the API as Vite middleware — and one Vercel project fe
 | `npm run build` | production bundle into `dist/` |
 | `npm run db:start` · `db:status` · `db:stop` · `db:reset` | the local Supabase stack in Docker. Engine first: `open -a OrbStack` |
 | `npm run db:migrate` · `db:generate` | apply `drizzle/`; regenerate after a schema edit. **Migrate after every reset** |
+| `npm run cost` | what the model calls have cost — this UTC month by default; `-- --month 2026-07`, `-- --all`, `-- --reconcile` |
 
 Secrets are one gitignored `.env.local`, and **it beats what your shell exported** — so
 `FOO=… npm run dev` does not do what it looks like. Copy `.env.example` and edit the file.
@@ -47,6 +48,8 @@ is the one worth knowing unprompted: a bad tree draws a *wrong article* rather t
 - **[deployment.md](deployment.md)** — Vercel: the domain move that never touched the registrar, the
   build that reports success and ships a function failing on every request, and who can reach the
   app today (more people than you would think).
+- **[ai-gateway.md](ai-gateway.md)** — every paid call goes through one of two seams, and each one
+  leaves a row behind. `npm run cost` is how you read them back.
 - **[logging.md](logging.md)** — why Pino, what the levels mean here, why path-based redaction makes
   the message string a rule, and why the CLI's `console.log` is not logging and is staying.
 
diff --git a/docs/project/logging.md b/docs/project/logging.md
index 6ccc2f9..f6304e8 100644
--- a/docs/project/logging.md
+++ b/docs/project/logging.md
@@ -205,9 +205,22 @@ two can be added up together:
 | `aiUnpriced` | how many of those calls came back with no cost at all. **Present only when it is not zero** |
 | `aiPending` | calls started and never recorded — always a bug. **Present only when it is not zero** |
 | `aiPendingJobs` | which jobs those were, because a bare count says something leaked without saying where |
+| `aiRunId` | the id every ledger row from this step or request carries, so the line and the rows can be joined |
 
 A line with none of these made no model call at all, which is most of them.
 
+**`aiRunId` is the join, and it exists because the fields above are a summary.** Since 2026-08-28
+each call is also a row — in `ai_calls` or in `data/_ai-calls.jsonl`
+([ai-gateway.md](ai-gateway.md)) — and the question a surprising `aiCost` provokes is *which calls*.
+Without an id on both sides, answering it means guessing at a timestamp range.
+
+**A third line carries a total, and it is a different kind of total.** `endJob` in
+[`src/jobs.ts`](../../src/jobs.ts) reports what the *whole ingest* cost, and it does not come from a
+collector at all — a job spans several `advanceJob` calls with no frame in common, so the number is
+queried back out of the ledger by `job_id`. That line can also say `aiCostStatus: "unavailable"`,
+which is the one thing it must be able to say: a ledger that could not be read and a job that spent
+nothing must not print the same number.
+
 **Several fields rather than one number, because a bare total cannot be checked.** `aiCalls` is the
 thing nobody can guess from outside — one step is often several calls, since `summarise` batches per
 parent and `labels` fans out — so a total of $0.30 over nine calls and a total of $0.30 over one are
@@ -223,9 +236,15 @@ a zero is indistinguishable from a free call and understates a bill for as long
 was forgotten: a call that finishes *after* its step or request has already reported. By definition
 that arrives after the line is written, so no field on it could ever be non-zero — a first draft
 added one and it was a counter nobody could read. It is counted process-wide by `lateCalls()`
-instead, beside `unscopedCalls()`, and `npm run cost` is where both belong.
+instead, beside `unscopedCalls()`, and each increment writes its own `warn` line — the counter alone
+lives in one process's memory where nobody reads it, and the line is the part that reaches a person.
+
+**`npm run cost` deliberately does not print either counter.** It is a different process and would
+start them both at zero, so the pair of noughts would be reassuring and mean nothing. What it asks
+instead is the question the rows can answer: how many reported no cost, and how much went on calls
+that failed.
 
-All four are omitted together when a step made no calls. Most steps in most jobs are cached or free,
+All of them are omitted together when a step made no calls. Most steps in most jobs are cached or free,
 and four zeroes on every line is noise that makes the lines that matter harder to find.
 
 **Logged from `jobs.ts`, which is the same rule as the section above** — log at the seam the queue
diff --git a/drizzle/meta/_journal.json b/drizzle/meta/_journal.json
index b14b687..008d218 100644
--- a/drizzle/meta/_journal.json
+++ b/drizzle/meta/_journal.json
@@ -148,6 +148,20 @@
       "when": 1787865824815,
       "tag": "0020_comment_body",
       "breakpoints": true
+    },
+    {
+      "idx": 21,
+      "version": "7",
+      "when": 1787865825815,
+      "tag": "0021_ai_calls_ledger",
+      "breakpoints": true
+    },
+    {
+      "idx": 22,
+      "version": "7",
+      "when": 1787867857885,
+      "tag": "0022_raw_provenance_columns",
+      "breakpoints": true
     }
   ]
 }
\ No newline at end of file
diff --git a/package.json b/package.json
index 07ce2bf..2e0e36d 100644
--- a/package.json
+++ b/package.json
@@ -14,6 +14,7 @@
     "check": "tsx scripts/check.ts",
     "deploy": "tsx scripts/deploy.ts",
     "count-lines": "tsx scripts/count-lines.ts",
+    "cost": "tsx scripts/ai-cost.ts",
     "fetch": "tsx src/fetch.ts",
     "extract": "tsx src/extract.ts",
     "pdf": "tsx src/pdf-read.ts",
diff --git a/src/ai-call.ts b/src/ai-call.ts
index da6ddc6..530654a 100644
--- a/src/ai-call.ts
+++ b/src/ai-call.ts
@@ -54,7 +54,12 @@
  * job cannot be added without somebody deciding, and injected *after* the
  * caller's body so it cannot be overridden by accident.
  */
-import { type SpendRecord, beginSpend, recordSpend } from "./ai-spend.js";
+import {
+  type SpendRecord,
+  beginSpend,
+  keyFingerprint,
+  recordSpend,
+} from "./ai-spend.js";
 import { NOT_CONFIGURED, providerHttpFailure } from "./messages.js";
 /* **A type-only import, and that is load-bearing rather than tidy.** A value
    import here closes a cycle: `models.ts` imports `EMBEDDING_MODEL` from
@@ -66,7 +71,7 @@ import { NOT_CONFIGURED, providerHttpFailure } from "./messages.js";
    other order, which is a thing nothing in the app happens to do today and
    something the next file to import embeddings might. `import type` is erased,
    so it creates no edge at all. */
-import type { AiJob } from "./models.js";
+import type { AiJob, Wire } from "./models.js";
 import {
   type StreamChunk,
   type StreamEnd,
@@ -257,6 +262,8 @@ interface WireUsage {
     cache_write_tokens?: unknown;
   };
   cache_write_tokens?: unknown;
+  /** Thinking, on this wire's spelling. Inside `completion_tokens`, not additional. */
+  completion_tokens_details?: { reasoning_tokens?: unknown };
 }
 
 /**
@@ -279,10 +286,14 @@ class Meter {
   outputTokens: number | null = null;
   cacheReadTokens: number | null = null;
   cacheWriteTokens: number | null = null;
+  reasoningTokens: number | null = null;
+  upstream: string | null = null;
 
   constructor(
     private readonly job: AiJob,
     private readonly model: string,
+    private readonly wire: Wire,
+    private readonly credentialFingerprint: string,
   ) {
     /* Registered *before* the network call, so a request that never comes back
        leaves a trace. See `PendingCall` in ai-spend.ts. */
@@ -306,12 +317,20 @@ class Meter {
       num(u.prompt_tokens_details?.cache_write_tokens) ??
       num(u.cache_write_tokens) ??
       this.cacheWriteTokens;
+    this.reasoningTokens =
+      num(u.completion_tokens_details?.reasoning_tokens) ?? this.reasoningTokens;
   }
 
   sawModel(model: unknown): void {
     if (typeof model === "string" && model.length > 0) this.answeredBy = model;
   }
 
+  /** Which upstream answered, when the frame says. The Messages wire gets this free. */
+  sawUpstream(provider: unknown): void {
+    if (typeof provider === "string" && provider.length > 0)
+      this.upstream = provider;
+  }
+
   /**
    * Record the call. **Idempotent**, because the alternative double-counts: a
    * caller that finishes in a `finally` and again on an error path is an
@@ -326,17 +345,32 @@ class Meter {
     recordSpend(
       {
         job: this.job,
+        wire: this.wire,
         model: this.model,
         answeredBy: this.answeredBy,
         costNanos: this.costNanos,
         upstreamCostNanos: this.upstreamCostNanos,
         generationId: this.generationId,
-        upstream: null,
+        upstream: this.upstream,
+        credentialFingerprint: this.credentialFingerprint,
         isByok: this.isByok,
         inputTokens: this.inputTokens,
         outputTokens: this.outputTokens,
         cacheReadTokens: this.cacheReadTokens,
         cacheWriteTokens: this.cacheWriteTokens,
+        /* **Null rather than zero on this wire.** OpenAI's shape reports one
+           cache-write total and does not split it by TTL, so a `0` here would be
+           a claim that no one-hour write happened — which is a different thing
+           from not being told. The Messages wire fills these in. */
+        cacheWrite5mTokens: null,
+        cacheWrite1hTokens: null,
+        reasoningTokens: this.reasoningTokens,
+        /* Neither is reported on this wire: no caller here uses a server-side
+           web search, and `service_tier` and `inference_geo` are Anthropic's own
+           fields on the Messages shape. */
+        webSearches: null,
+        serviceTier: null,
+        inferenceGeo: null,
         ms: Date.now() - this.startedAt,
         outcome,
       },
@@ -463,14 +497,28 @@ function prepare(
   body: AiRequestBody,
   streaming: boolean,
   key0: string | undefined,
-): { key: string; payload: string; url: string } {
+): { key: string; payload: string; url: string; fingerprint: string } {
+  const key = apiKey(key0);
   return {
-    key: apiKey(key0),
+    key,
     payload: outgoing(job, body, streaming),
     url: `${OPENROUTER_BASE}${pathFor(job)}`,
+    /* Named, never carried. See `keyFingerprint` — the reconciliation is per
+       key, and `src/embeddings.ts` legitimately passes a different one. */
+    fingerprint: keyFingerprint(key),
   };
 }
 
+/**
+ * Which shape this job's request goes out in.
+ *
+ * Read off the routing table rather than kept as a second list, so a seventh job
+ * cannot be given a path and forget to be given a wire.
+ */
+function wireFor(job: ChatJob): Wire {
+  return routeFor(job).path === "/v1/embeddings" ? "embeddings" : "chat";
+}
+
 function send(
   prepared: { key: string; payload: string; url: string },
   signal: AbortSignal | undefined,
@@ -507,6 +555,25 @@ function generationIdOf(response: Response): string | null {
   return response.headers?.get("x-generation-id") ?? null;
 }
 
+/**
+ * **Did this error come from the abort, or merely arrive while one was set?**
+ *
+ * The two are not the same and the first version treated them as the same: any
+ * failure raised while `signal.aborted` was true got recorded as `"aborted"`,
+ * so a provider dying at the moment a reader pressed Stop went into the ledger
+ * as a cancel — and a cancel is the one outcome nobody investigates.
+ *
+ * Aborting rejects with the signal's own `reason`, so identity is the strong
+ * test; the name check covers an abort raised with no reason given.
+ * `stoppedByReader` in [`openrouter-stream.ts`](openrouter-stream.ts) makes the
+ * same distinction for the reader-facing message, and a GPT Sol review pointed
+ * out that the bill was still using the weaker question.
+ */
+function abortedBy(err: unknown, signal: AbortSignal | undefined): boolean {
+  if (!signal?.aborted) return false;
+  return err === signal.reason || (err as Error | undefined)?.name === "AbortError";
+}
+
 /**
  * Drain a failed response and throw the status, never the words.
  *
@@ -555,7 +622,7 @@ export async function* openRouterStream(
 ): AsyncGenerator<StreamChunk> {
   /* Before the meter — see `prepare`: no attempt, no record. */
   const prepared = prepare(job, body, true, options.apiKey);
-  const meter = new Meter(job, body.model);
+  const meter = new Meter(job, body.model, wireFor(job), prepared.fingerprint);
   let outcome: SpendRecord["outcome"] = "ok";
   /**
    * Whether the loop below ran to its own end.
@@ -594,6 +661,7 @@ export async function* openRouterStream(
       },
     )) {
       meter.sawModel(chunk.model);
+      meter.sawUpstream(chunk.provider);
       /* **Every chunk that has one, not just the last.** The usage chunk is
          normally the final one and carries no choices — but "normally" is doing
          work in that sentence, and overwriting with each one costs nothing and
@@ -603,7 +671,7 @@ export async function* openRouterStream(
     }
     ranToEnd = true;
   } catch (err) {
-    outcome = options.signal.aborted ? "aborted" : "error";
+    outcome = abortedBy(err, options.signal) ? "aborted" : "error";
     throw err;
   } finally {
     if (outcome === "ok") {
@@ -662,7 +730,7 @@ export async function openRouterJson(
 ): Promise<JsonCall> {
   /* Before the meter — see `prepare`: no attempt, no record. */
   const prepared = prepare(job, body, false, options?.apiKey);
-  const meter = new Meter(job, body.model);
+  const meter = new Meter(job, body.model, wireFor(job), prepared.fingerprint);
   let outcome: SpendRecord["outcome"] = "ok";
   try {
     const response = await send(prepared, options?.signal);
@@ -684,9 +752,12 @@ export async function openRouterJson(
          which on this wire is an article, a reader's question, or their voice.
          See `providerSpokeNonsense` in openrouter-stream.ts. */
     }
-    const record = json as { usage?: unknown; model?: unknown } | null;
+    const record = json as
+      | { usage?: unknown; model?: unknown; provider?: unknown }
+      | null;
     if (record?.usage) meter.saw(record.usage);
     meter.sawModel(record?.model);
+    meter.sawUpstream(record?.provider);
     return {
       json,
       answeredBy: meter.answeredBy,
@@ -694,7 +765,7 @@ export async function openRouterJson(
     };
   } catch (err) {
     if (outcome === "ok")
-      outcome = options?.signal?.aborted === true ? "aborted" : "error";
+      outcome = abortedBy(err, options?.signal) ? "aborted" : "error";
     throw err;
   } finally {
     meter.finish(outcome);
diff --git a/src/ai-spend.ts b/src/ai-spend.ts
index 4ee91a6..7e12934 100644
--- a/src/ai-spend.ts
+++ b/src/ai-spend.ts
@@ -26,9 +26,17 @@
  * [silent-success.md](../docs/reusable/silent-success.md).
  */
 import { AsyncLocalStorage } from "node:async_hooks";
+import { createHash, randomUUID } from "node:crypto";
 import { log } from "./log.js";
 import type { Nanos } from "./pricing.js";
-import type { AiJob } from "./models.js";
+/* **Type-only, and it has to stay type-only.** `src/models.ts` reaches
+   `src/embeddings.ts`, which reaches `src/ai-call.ts`, which reaches this file —
+   so a value import here closes a runtime cycle, and entering it from the wrong
+   end throws `Cannot access 'EMBEDDING_MODEL' before initialization`. A `type`
+   import is erased and adds no edge. That is also why `wire` is a field the two
+   gateways fill in rather than something looked up from `AI_JOB_WIRE` here. */
+import type { AiJob, Wire } from "./models.js";
+import { currentOwnerId } from "./owner.js";
 
 /**
  * One paid model call, as it actually happened.
@@ -48,6 +56,14 @@ export interface SpendRecord {
    * three real calls with nowhere to be recorded.
    */
   job: AiJob;
+  /**
+   * Which shape of API this went over, said by the gateway that sent it.
+   *
+   * Filled in here rather than looked up from `AI_JOB_WIRE`, for the import
+   * reason at the top of this file — and it is the more honest place anyway,
+   * since the gateway is the thing that knows what it actually sent.
+   */
+  wire: Wire;
   /** The model id as sent, in OpenRouter's spelling. */
   model: string;
   /**
@@ -74,6 +90,11 @@ export interface SpendRecord {
   generationId: string | null;
   /** Which upstream answered: `"Anthropic"`, `"Claude Platform on AWS"`, … */
   upstream: string | null;
+  /**
+   * A short, safe fingerprint of the key that paid — see `AiCallRow`, which is
+   * where it matters. `null` when the gateway did not say.
+   */
+  credentialFingerprint: string | null;
   /**
    * Whether OpenRouter billed this to somebody else's key.
    *
@@ -89,6 +110,33 @@ export interface SpendRecord {
   outputTokens: number | null;
   cacheReadTokens: number | null;
   cacheWriteTokens: number | null;
+  /**
+   * The cache write split by TTL, when the wire gives it.
+   *
+   * **Not decoration: the two are priced differently** — a 5-minute write is
+   * 1.25x the input rate and a one-hour write is 2x — so a single total cannot
+   * be priced correctly once both are in play, and this app uses both. Absent on
+   * the chat wire, which reports one number.
+   */
+  cacheWrite5mTokens: number | null;
+  cacheWrite1hTokens: number | null;
+  /**
+   * Thinking tokens, under whichever name the wire used.
+   *
+   * **Inside `outputTokens`, not additional** — so this is never added to a
+   * total. It is what answers "did that call spend its whole budget thinking",
+   * which is the question a cost report gets asked when a number jumps.
+   */
+  reasoningTokens: number | null;
+  /**
+   * Server-side web searches, which are **billed per search and invisible to
+   * token arithmetic** — a call can cost ten cents more than its tokens say.
+   */
+  webSearches: number | null;
+  /** Anthropic's `service_tier`. Batch is half price; priced as standard it is 2x wrong. */
+  serviceTier: string | null;
+  /** Anthropic's `inference_geo`. `"us"` is a documented 1.1x on every category. */
+  inferenceGeo: string | null;
   /** Wall-clock milliseconds for the call. */
   ms: number;
   /** How it ended — `"ok"`, or the failure that stopped it. */
@@ -114,6 +162,162 @@ export interface PendingCall {
   /** The model as requested — the answer is not known yet, that being the point. */
   model: string;
   startedAt: number;
+  /**
+   * The row's id, **minted before the request goes out** rather than when it
+   * comes back.
+   *
+   * So that the identifier for a call exists even for the calls that never
+   * return one. GPT Sol asked for this: an id minted at record time is an id a
+   * lost call never gets, and a lost call is the one you most want to be able to
+   * name.
+   */
+  rowId: string;
+}
+
+/* ------------------------------------------------------- who it was for -- */
+
+/**
+ * **What kind of work opened this collector.** Written on every row, because a
+ * report that adds a reader's chat to an eval sweep is a report nobody can act
+ * on. `npm run cost` shows product spend and eval spend apart.
+ */
+export type ScopeKind = "request" | "job_step" | "cli" | "eval";
+
+/**
+ * Who and what a call should be billed to, supplied by whoever opened the
+ * collector rather than discovered at the call.
+ *
+ * None of this is knowable from inside a gateway: `src/ai-call.ts` sees a model
+ * id and a body. `runStep` knows the job, the step and the article; a route
+ * knows the article it just parsed a slug for. So the frame that knows says so,
+ * once, and every call inside it inherits it.
+ */
+export interface SpendAttribution {
+  scopeKind: ScopeKind;
+  /**
+   * Whose money it is. Optional here and resolved at record time when omitted —
+   * an HTTP request does not know its owner when the collector opens, because
+   * the gate that fills the box runs inside it.
+   */
+  ownerId?: string;
+  /**
+   * The article, **by slug rather than by id**, and kept even where an id is
+   * also stored.
+   *
+   * `ai_calls.article_id` is `on delete set null` on purpose, so an article that
+   * goes away takes the link with it. The slug is the historical fact and cannot
+   * be revoked by a later delete, which is what a billing row needs.
+   */
+  articleSlug?: string | null;
+  jobId?: string | null;
+  stepName?: string | null;
+}
+
+/**
+ * One finished call, flattened for storage — the shape the ledger keeps.
+ *
+ * Separate from `SpendRecord` because they answer different questions.
+ * `SpendRecord` is what the gateway saw; this is that plus who it was for, plus
+ * the identifiers that make it findable afterwards. Building it here rather than
+ * in the store means the two store implementations cannot disagree about what a
+ * row is.
+ */
+export interface AiCallRow {
+  /** Minted before the request went out. See `PendingCall.rowId`. */
+  id: string;
+  /**
+   * The collector this call was made inside, so one invocation's calls can be
+   * grouped without inventing a second identifier for a retry. GPT Sol's
+   * suggestion, in place of an `attempt` counter: a retry is a separate call and
+   * already has its own id.
+   */
+  runId: string;
+  generationId: string | null;
+  scopeKind: ScopeKind;
+  ownerId: string;
+  articleSlug: string | null;
+  jobId: string | null;
+  stepName: string | null;
+  /**
+   * Which shape of API this went over.
+   *
+   * On the row rather than derived later, because **the two wires do not mean
+   * the same thing by "input tokens"** — the Messages wire reports cache reads
+   * and writes *outside* `input_tokens`, and the chat wire reports them inside
+   * `prompt_tokens`. A column called `input_tokens` summed across both is a
+   * number with no meaning, and this is what stops somebody summing it.
+   */
+  wire: Wire;
+  /** Which job made the call — `toc`, `chat`, `embeddings`, … */
+  job: AiJob;
+  requestedModel: string;
+  answeredModel: string | null;
+  upstream: string | null;
+  /**
+   * A short, safe fingerprint of the credential that paid — never the key.
+   *
+   * The reconciliation against OpenRouter's `GET /api/v1/key` is per key, and
+   * this repo already uses more than one. Without this, a rotation or a second
+   * account shows up as a permanent unexplained difference, which is a check
+   * everybody learns to ignore. GPT Sol raised it as the thing that separates a
+   * ledger from a plausible table.
+   */
+  credentialFingerprint: string | null;
+  startedAt: string;
+  finishedAt: string;
+  durationMs: number;
+  outcome: SpendRecord["outcome"];
+  /**
+   * **Credits OpenRouter deducted**, in nano-dollars — not cash, and the name
+   * says so.
+   *
+   * OpenRouter's margin is a fee on *buying* credits (about 5.5%, with a
+   * minimum, and different again for crypto), not a per-token markup — so
+   * multiplying each row by 1.055 would invent a precision that can never match
+   * a bank statement. Cash belongs to a credit-purchase ledger that does not
+   * exist yet. Decided with GPT Sol, 2026-08-28, in Greg's absence; see
+   * docs/plans/260827q-ai-cost-tracking.md § Questions for Greg, Q5.
+   */
+  creditsUsedNanos: Nanos | null;
+  upstreamInferenceNanos: Nanos | null;
+  isByok: boolean | null;
+  inputTokens: number | null;
+  outputTokens: number | null;
+  cacheReadTokens: number | null;
+  cacheWriteTokens: number | null;
+  cacheWrite5mTokens: number | null;
+  cacheWrite1hTokens: number | null;
+  reasoningTokens: number | null;
+  webSearches: number | null;
+  serviceTier: string | null;
+  inferenceGeo: string | null;
+}
+
+/**
+ * Where a finished row goes. Supplied by whoever opened the collector.
+ *
+ * **An injected function rather than an import**, so this file keeps having no
+ * IO in it and stays testable without a database. It is also what keeps the
+ * module graph acyclic: `src/store/` imports plenty, and an edge from here into
+ * it would be a cycle waiting for its second edge. GPT Sol's call, and the
+ * reason the leaf-module refactor it suggested earlier is not needed.
+ */
+export type SpendSink = (row: AiCallRow) => Promise<void>;
+
+/**
+ * **A key's name, never the key.** The first twelve hex characters of its
+ * SHA-256, which is enough to tell two OpenRouter accounts apart and to notice a
+ * rotation, and is not enough to be a credential.
+ *
+ * Why it is on every row: the account-level reconciliation asks
+ * `GET /api/v1/key` what OpenRouter thinks the key has spent, and that question
+ * only has an answer per key. This repo already runs more than one — evals have
+ * their own — so without a fingerprint the check produces a permanent
+ * unexplained difference, and a check that is always wrong for a known reason is
+ * one nobody reads. GPT Sol, 2026-08-28.
+ */
+export function keyFingerprint(key: string): string {
+  return createHash("sha256").update(key).digest("hex").slice(0, 12);
 }
 
 /**
@@ -127,13 +331,34 @@ export interface PendingCall {
  * exactly one honest reading — *this piece of work finished with a call still
  * open* — which is a bug every time.
  */
-interface SpendScope {
+interface SpendBox {
   calls: SpendRecord[];
   active: Map<number, PendingCall>;
+  /**
+   * Every write this collector has started. Awaited before `collectSpend`
+   * returns — see the comment there, which is the whole reason they are kept.
+   */
+  writes: Promise<void>[];
+  sink: SpendSink | null;
+  runId: string;
   /** Set when `collectSpend` returns. A record arriving after this is a late finish. */
   closed: boolean;
 }
 
+/**
+ * What is in scope: one shared box, and this frame's view of who it is for.
+ *
+ * Split in two so that `withSpendAttribution` can overlay an article onto an
+ * open collector **without starting a second one**. It re-enters with the same
+ * `box` object and a different `attribution`, so the calls, the sink and the
+ * `closed` flag are all still the one set — which a copied scope object would
+ * not be, and the bug would have been a `closed` that never arrived.
+ */
+interface SpendScope {
+  box: SpendBox;
+  attribution: SpendAttribution;
+}
+
 const store = new AsyncLocalStorage<SpendScope>();
 
 let dropped = 0;
@@ -184,10 +409,42 @@ export function beginSpend(job: AiJob, model: string): number | null {
   const scope = store.getStore();
   if (!scope) return null;
   const id = nextCallId++;
-  scope.active.set(id, { job, model, startedAt: Date.now() });
+  scope.box.active.set(id, {
+    job,
+    model,
+    startedAt: Date.now(),
+    rowId: randomUUID(),
+  });
   return id;
 }
 
+/**
+ * **Overlay an article (or a job, or a step) onto the collector already open.**
+ *
+ * For the frame that knows something the collector did not when it opened. A
+ * route opens no collector of its own — `handleApi` did that before the router
+ * ran — but it is the only place that knows which article the reader is asking
+ * about, and without this the answer to *"what has this article cost me"* would
+ * cover the ingest and none of the questions asked about it afterwards.
+ *
+ * The same box, a different view of it. Not a nested `collectSpend`, which would
+ * hide the calls from the outer one; not a mutable field on the scope, which two
+ * concurrent async branches would overwrite for each other. GPT Sol's shape.
+ *
+ * A no-op outside a collector, like everything else here.
+ */
+export function withSpendAttribution<T>(
+  patch: Partial<SpendAttribution>,
+  fn: () => T,
+): T {
+  const scope = store.getStore();
+  if (!scope) return fn();
+  return store.run(
+    { box: scope.box, attribution: { ...scope.attribution, ...patch } },
+    fn,
+  );
+}
+
 /**
  * What a finished piece of work spent — and everything about it that is not
  * simply a total.
@@ -199,6 +456,33 @@ export interface SpendReport {
    * which job and how old, so it can be chased rather than merely noticed.
    */
   pending: PendingCall[];
+  /** The id every row from this collector carries, so a log line and a row can be joined. */
+  runId: string;
+}
+
+/**
+ * A report of nothing, for a caller that has to have one before its collector
+ * has run — `runStep`'s `catch` reads the spend, and a step can throw before
+ * `onDone` has fired.
+ */
+export function emptySpend(): SpendReport {
+  return { calls: [], pending: [], runId: "" };
+}
+
+/** What the frame opening a collector tells it. All optional; all better supplied. */
+export interface CollectOptions {
+  /** Who and what to bill. Defaults to an unattributed CLI scope. */
+  attribution?: SpendAttribution;
+  /** Where finished rows go. Without one, nothing is written down. */
+  sink?: SpendSink;
+  /**
+   * Called with the report on **both** paths, success and throw.
+   *
+   * Because a run that failed is precisely the one worth knowing the cost of:
+   * the model call that blew up had usually already been paid for, and the retry
+   * after it pays again. A caller reading only the resolved value loses that.
+   */
+  onDone?: (report: SpendReport) => void;
 }
 
 /**
@@ -218,12 +502,25 @@ export interface SpendReport {
  */
 export async function collectSpend<T>(
   fn: () => Promise<T>,
-  onDone?: (report: SpendReport) => void,
+  options?: CollectOptions,
 ): Promise<{ result: T; report: SpendReport }> {
-  const scope: SpendScope = { calls: [], active: new Map(), closed: false };
+  const onDone = options?.onDone;
+  const box: SpendBox = {
+    calls: [],
+    active: new Map(),
+    writes: [],
+    sink: options?.sink ?? null,
+    runId: randomUUID(),
+    closed: false,
+  };
+  const scope: SpendScope = {
+    box,
+    attribution: options?.attribution ?? { scopeKind: "cli" },
+  };
   const report = (): SpendReport => ({
-    calls: scope.calls,
-    pending: [...scope.active.values()],
+    calls: box.calls,
+    pending: [...box.active.values()],
+    runId: box.runId,
   });
   try {
     const result = await store.run(scope, fn);
@@ -237,9 +534,20 @@ export async function collectSpend<T>(
        for, and a retry pays again. Called in a `finally` so it fires on both
        paths. */
     onDone?.(report());
+    /* **Every row is on disk before this function returns.**
+
+       The instinct is to let the writes float — do not make a reader wait on a
+       metrics insert. That is wrong on Vercel: a serverless function can be
+       frozen the moment its response is sent, and an un-awaited promise then
+       simply never runs. The rows that would go missing are exactly the
+       request-path ones, which is the half a per-user total is made of.
+
+       `allSettled`, because a sink that rejects has already logged and must not
+       turn a working model call into a failed request. */
+    await Promise.allSettled(box.writes);
     /* Closed *after* the report, so the report is of the scope as it was, and
        anything arriving from here on counts as late rather than vanishing. */
-    scope.closed = true;
+    box.closed = true;
   }
 }
 
@@ -257,10 +565,21 @@ export function recordSpend(record: SpendRecord, callId?: number | null): void {
   const scope = store.getStore();
   if (!scope) {
     dropped += 1;
+    /* **Said out loud, not merely counted.** A counter lives in one process's
+       memory and no later `npm run cost` can read it, so on its own it is an
+       anomaly nobody sees. A call made outside every collector is money spent
+       that will never appear in any total, and the line is what reaches a
+       person. It names the job and the model and no more: nothing about a
+       prompt, an answer or an article goes near a log. */
+    log("model").warn(
+      { job: record.job, model: record.model, outcome: record.outcome },
+      "a model call was made with no spend collector open — it is in no total",
+    );
     return;
   }
-  if (callId != null) scope.active.delete(callId);
-  if (scope.closed) {
+  const started = callId != null ? scope.box.active.get(callId) : undefined;
+  if (callId != null) scope.box.active.delete(callId);
+  if (scope.box.closed) {
     /* **Counted and said out loud, not just counted.** A bare counter loses the
        job, the model and the money, and lives in one process's memory where no
        later `npm run cost` can read it — so on its own it is an anomaly nobody
@@ -280,7 +599,109 @@ export function recordSpend(record: SpendRecord, callId?: number | null): void {
     );
     return;
   }
-  scope.calls.push(record);
+  scope.box.calls.push(record);
+  write(scope, record, started);
+}
+
+/**
+ * Start the row's journey to the ledger, and hold on to the promise.
+ *
+ * **Started here and awaited at scope close**, rather than batched into one
+ * insert at the end. A batch loses everything on a mid-step crash — forty
+ * finished calls for one process death — where a write per finished call loses
+ * only what was genuinely still in flight. GPT Sol's call, 2026-08-28.
+ *
+ * The rejection handler is attached **immediately**, in the same tick as the
+ * promise is made, so a slow sink that fails can never surface as an unhandled
+ * rejection while the box waits its turn.
+ */
+function write(
+  scope: SpendScope,
+  record: SpendRecord,
+  started: PendingCall | undefined,
+): void {
+  const sink = scope.box.sink;
+  if (!sink) return;
+  const owner = ownerFor(scope, record);
+  /* **No owner, no row.** `owner_id` is `not null` and `on delete restrict`,
+     like every other owned table here, so there is no honest row to write for a
+     call whose owner cannot be named. Loud rather than quiet: the money is real
+     and this is the only trace of it. */
+  if (!owner) return;
+  const finishedAt = Date.now();
+  const startedAt = finishedAt - record.ms;
+  const row: AiCallRow = {
+    id: started?.rowId ?? randomUUID(),
+    runId: scope.box.runId,
+    generationId: record.generationId,
+    scopeKind: scope.attribution.scopeKind,
+    ownerId: owner,
+    articleSlug: scope.attribution.articleSlug ?? null,
+    jobId: scope.attribution.jobId ?? null,
+    stepName: scope.attribution.stepName ?? null,
+    wire: record.wire,
+    job: record.job,
+    requestedModel: record.model,
+    answeredModel: record.answeredBy,
+    upstream: record.upstream,
+    credentialFingerprint: record.credentialFingerprint,
+    startedAt: new Date(startedAt).toISOString(),
+    finishedAt: new Date(finishedAt).toISOString(),
+    durationMs: record.ms,
+    outcome: record.outcome,
+    creditsUsedNanos: record.costNanos,
+    upstreamInferenceNanos: record.upstreamCostNanos,
+    isByok: record.isByok,
+    inputTokens: record.inputTokens,
+    outputTokens: record.outputTokens,
+    cacheReadTokens: record.cacheReadTokens,
+    cacheWriteTokens: record.cacheWriteTokens,
+    cacheWrite5mTokens: record.cacheWrite5mTokens,
+    cacheWrite1hTokens: record.cacheWrite1hTokens,
+    reasoningTokens: record.reasoningTokens,
+    webSearches: record.webSearches,
+    serviceTier: record.serviceTier,
+    inferenceGeo: record.inferenceGeo,
+  };
+  const promise = sink(row).catch((err: Error) => {
+    /* **A metrics write must never kill a model call.** The old app rethrew
+       here, which meant a Postgres hiccup could take down a reader-facing
+       feature — logging.md quotes it as the thing not to copy. But a recorder
+       that has silently stopped recording is the same class of bug as a cache
+       that has silently stopped caching, so it says so. */
+    log("model").warn(
+      { job: row.job, model: row.requestedModel, id: row.id, err: err.message },
+      "could not write the ai_calls row — this call is in no ledger",
+    );
+  });
+  scope.box.writes.push(promise);
+}
+
+/**
+ * Whose money this was.
+ *
+ * The frame that opened the collector says so when it knows — `runStep` does,
+ * because a job carries its owner across the request that made it. An HTTP
+ * request does **not** know at the moment its collector opens: the gate that
+ * fills the owner box runs inside `serveApi`, which is inside the collector. So
+ * the fallback is asked at record time, by which point the gate has long since
+ * run, and `currentOwnerId()` will answer.
+ *
+ * It can still throw — a model call in a request that was never authenticated —
+ * and that is caught rather than propagated, because this is the accounting
+ * path and it may not be the thing that fails a reader's request.
+ */
+function ownerFor(scope: SpendScope, record: SpendRecord): string | null {
+  if (scope.attribution.ownerId) return scope.attribution.ownerId;
+  try {
+    return currentOwnerId();
+  } catch {
+    log("model").warn(
+      { job: record.job, model: record.model },
+      "a model call had no owner to bill — no ledger row was written",
+    );
+    return null;
+  }
 }
 
 /** True while a collector is open. Lets a caller decide whether to bother. */
@@ -304,7 +725,11 @@ export function collectingSpend(): boolean {
 export function currentSpend(): SpendReport | null {
   const scope = store.getStore();
   if (!scope) return null;
-  return { calls: [...scope.calls], pending: [...scope.active.values()] };
+  return {
+    calls: [...scope.box.calls],
+    pending: [...scope.box.active.values()],
+    runId: scope.box.runId,
+  };
 }
 
 /**
@@ -336,6 +761,10 @@ export function spendFields(spend: SpendReport): Record<string, unknown> {
     aiCalls: spend.calls.length,
     aiCostNanos: nanos,
     aiCost: formatNanos(nanos),
+    /* The join between this line and the rows it is a total of. Without it,
+       finding the calls behind a surprising number means guessing at a
+       timestamp range. */
+    aiRunId: spend.runId,
     ...(unpriced > 0 ? { aiUnpriced: unpriced } : {}),
     ...(spend.pending.length > 0
       ? {
@@ -397,7 +826,21 @@ export function totalSpend(calls: readonly SpendRecord[]): {
   return { nanos, unpriced };
 }
 
-/** Nano-dollars as a short human string: `$0.0142`. For logs and the CLI. */
+/**
+ * Nano-dollars as a short human string: `$0.0142`.
+ *
+ * **Four decimals, except when four decimals would say `$0.0000` about money
+ * that was really spent.** A query embedding costs about $0.00000018 — the
+ * reason this ledger counts in nano-dollars at all — and rounding it to `$0.0000`
+ * puts back at the last step the exact lie the column type was chosen to avoid.
+ * Seen doing it, on a live probe, five minutes after the column was proved
+ * right.
+ *
+ * A true zero still prints `$0.0000`, because a free call and a very cheap one
+ * are different things and only one of them wants seven decimals.
+ */
 export function formatNanos(nanos: Nanos): string {
-  return `$${(nanos / 1e9).toFixed(4)}`;
+  const dollars = nanos / 1e9;
+  if (nanos !== 0 && Math.abs(dollars) < 0.0001) return `$${dollars.toFixed(8)}`;
+  return `$${dollars.toFixed(4)}`;
 }
diff --git a/src/arc.ts b/src/arc.ts
index f716e90..e6bbfb2 100644
--- a/src/arc.ts
+++ b/src/arc.ts
@@ -308,10 +308,7 @@ export async function generateArc(opts: {
       const report = opts.onProgress;
       let chars = 0;
       let last = 0;
-      /* `delta: string` spelled out because `MeteredCall.stream` is typed as
-         `ReturnType<…messages.stream>`, which instantiates that method's generic at
-         its constraint and loses `on`'s per-event listener types. */
-      call.stream.on("text", (delta: string) => {
+      call.onText((delta) => {
         chars += delta.length;
         const now = Date.now();
         if (now - last < 500) return;
diff --git a/src/db/schema.ts b/src/db/schema.ts
index c8cac5b..e710658 100644
--- a/src/db/schema.ts
+++ b/src/db/schema.ts
@@ -44,6 +44,7 @@
 
 import { sql, type SQL } from "drizzle-orm";
 import {
+  bigint,
   boolean,
   check,
   customType,
@@ -263,6 +264,36 @@ export const articleRevisions = spideryarn.table(
      * question convincingly. docs/project/fetching.md § `RawManifest`.
      */
     rawSha256: text("raw_sha256"),
+    /**
+     * **How many bytes the origin sent** — `RawManifest.bytes`, and not the size
+     * of anything we kept.
+     *
+     * A column rather than `length(raw_bytes)`, because `raw_bytes` is dropped
+     * at the end of docs/plans/260827aa-delete-the-importer.md and this number has to
+     * outlive it. `raw_sources.bytes` is not a substitute: that describes the
+     * object at `raw_source_sha256`, which for any page that was not already
+     * UTF-8 is a *different byte string* — `writeRaw` stores the decoded text,
+     * so the stored size and the network size differ for exactly the reason the
+     * two hashes do. GPT Sol, 2026-08-28, reviewing that plan.
+     *
+     * Null for every revision written before this existed, and for one whose
+     * manifest never recorded it.
+     */
+    rawByteCount: integer("raw_byte_count"),
+    /**
+     * **The reader's own name for an uploaded file** — `RawManifest.filename`.
+     *
+     * Not `RawManifest.file`, which is `raw.html` or `raw.pdf` and is derived
+     * from the kind rather than stored. This is the name the file had on the
+     * reader's disk, and it is the name an uploaded PDF should download as, so
+     * it is reader-facing and there is nowhere else for it: `origin` is
+     * derivable from the two URLs being null and `uploadId` is already on
+     * `jobs.upload_id`, but this is homeless.
+     * docs/plans/260827aa-delete-the-importer.md § The raw provenance has nowhere to go.
+     *
+     * Null for a fetched document, which never had one.
+     */
+    rawFilename: text("raw_filename"),
 
     /**
      * **Which object in the `sources` bucket this revision's document is.**
@@ -1108,33 +1139,135 @@ export const rawSources = spideryarn.table(
 /* ------------------------------------------------------------- ai calls -- */
 
 /**
- * One row per model call. Borrowed wholesale from the old app, which is the one
- * idea from it worth taking — see
- * docs/project/original-version/llm-plumbing.md. Their table was overkill for
- * their app; it is not overkill once there is a database anyway.
+ * **One row per model call — the ledger.** Written when a call finishes, by the
+ * sink in [`src/ai-spend.ts`](../ai-spend.ts), and never amended afterwards: a
+ * finished call is a fact about the past.
+ *
+ * The shape is borrowed from the old app — see
+ * docs/project/original-version/llm-plumbing.md — with three of its columns
+ * deliberately not taken.
  *
- * `rawResponse` is why: in the old project `ai_calls` was 31 MB and dominated
- * the entire database. Worth keeping, worth pruning on a schedule, and worth
- * knowing about before it surprises someone.
+ * - **`raw_response` is gone.** In the old project it was 31 MB over 306 rows
+ *   and dominated their entire database — and, worse here, it would hold model
+ *   output derived from the reader's article, their chat, or their dictated
+ *   voice. That turns a small financial ledger into the project's largest and
+ *   most sensitive store, kept alive by a pruner that can quietly stop. Every
+ *   row carries `generation_id` instead, which is the handle to ask OpenRouter
+ *   about the call afterwards. GPT Sol's call, 2026-08-28, reversing Greg's
+ *   earlier "always store, with pruning" — written up in
+ *   docs/plans/260827q-ai-cost-tracking.md rather than merely done.
+ * - **`cost_micros` is gone**, in favour of nano-dollars in a `bigint`. A single
+ *   query embedding costs about $0.0000006, which is **less than one
+ *   micro-dollar** and rounded to zero — the row read as free.
+ * - **No `attempt` column.** A retry is a separate call and gets its own row and
+ *   its own id; `run_id` is what groups the calls one piece of work made.
+ *
+ * ## `owner_id` is here, and src/owner.ts's rule says it should not be
+ *
+ * That file lists the tables that deliberately do not carry an owner, because
+ * each belongs to a row that does. Good rule, and this is its exception, for two
+ * reasons: `article_id` is `on delete set null`, so an article going away would
+ * strip a billing row of its person, permanently and without erroring; and not
+ * every call has an article at all — library search, and an ordinary chat with
+ * nothing open. `on delete restrict`, like every other owner FK here
+ * (drizzle/0001_auth_fks_and_guards.sql): deleting an account is already a thing
+ * this schema refuses to do quietly.
  */
-export const aiCalls = spideryarn.table("ai_calls", {
-  id: uuid("id").primaryKey().defaultRandom(),
-  articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
-  revisionId: uuid("revision_id").references(() => articleRevisions.id, { onDelete: "set null" }),
-  /** `toc`, `arc`, `tweets`, `glossary`, or `explain` for a reader's question. */
-  purpose: text("purpose").notNull(),
-  provider: text("provider").notNull(),
-  model: text("model").notNull(),
-  promptTokens: integer("prompt_tokens"),
-  completionTokens: integer("completion_tokens"),
-  /** Micro-dollars, so this stays an integer and never a drifting float. */
-  costMicros: integer("cost_micros"),
-  latencyMs: integer("latency_ms"),
-  finishReason: text("finish_reason"),
-  error: text("error"),
-  rawResponse: jsonb("raw_response"),
-  createdAt: createdAt(),
-});
+export const aiCalls = spideryarn.table(
+  "ai_calls",
+  {
+    /**
+     * **Minted before the request goes out**, not when it comes back — so a call
+     * that never returns still has a name. Hence no `defaultRandom()`: the
+     * value comes from the process that made the call.
+     */
+    id: uuid("id").primaryKey(),
+    /** Every call one collector saw, so a log line and its rows can be joined. */
+    runId: uuid("run_id").notNull(),
+    /** `x-generation-id` — the key to `GET /api/v1/generation?id=…` afterwards. */
+    generationId: text("generation_id"),
+    /** `request`, `job_step`, `cli` or `eval`. Eval spend is real and is not product spend. */
+    scopeKind: text("scope_kind").notNull(),
+    ownerId: uuid("owner_id").notNull(),
+    articleId: uuid("article_id").references(() => articles.id, { onDelete: "set null" }),
+    /**
+     * The article as it was called at the time.
+     *
+     * Kept **beside** `article_id` rather than instead of it, because the id is
+     * `on delete set null` on purpose and the slug is the historical fact a
+     * later delete cannot revoke.
+     */
+    articleSlug: text("article_slug"),
+    /**
+     * Which ingest job, as text rather than a foreign key: finished jobs are
+     * trimmed on a retention sweep, and a billing row must not be deletable by
+     * housekeeping.
+     */
+    jobId: text("job_id"),
+    stepName: text("step_name"),
+    /**
+     * `messages`, `chat` or `embeddings`.
+     *
+     * **On the row because the two wires do not mean the same thing by "input
+     * tokens"** — the Messages shape reports cache reads and writes *outside*
+     * `input_tokens`, and the chat shape reports them inside `prompt_tokens`. A
+     * column summed across both without this is a number with no meaning.
+     */
+    wire: text("wire").notNull(),
+    /** Which job made the call: `toc`, `chat`, `embeddings`, … */
+    purpose: text("purpose").notNull(),
+    requestedModel: text("requested_model").notNull(),
+    /** Which model answered, when the response said. Not always the one asked for. */
+    answeredModel: text("answered_model"),
+    /** Which upstream answered: `"Anthropic"`, `"Google"`, … */
+    upstream: text("upstream"),
+    /** The first 12 hex of the key's SHA-256. Never the key. See src/ai-spend.ts. */
+    credentialFingerprint: text("credential_fingerprint"),
+    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
+    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
+    durationMs: integer("duration_ms").notNull(),
+    /** `ok`, `error` or `aborted`. A non-`ok` row's cost is a lower bound. */
+    outcome: text("outcome").notNull(),
+    /**
+     * **Credits OpenRouter deducted**, in nano-dollars — and the name says
+     * credits rather than cash on purpose. Their margin is a fee on *buying*
+     * credits, not a per-token markup, so a per-row x1.055 would invent a
+     * precision that can never match a bank statement.
+     */
+    /* **`bigint`, against this file's own two warnings about `int8`.** Those are
+       right — node-pg hands `int8` back as a *string* — and the reason it is
+       safe here is specific rather than general: `mode: "number"` makes Drizzle
+       map it back through `Number()` on the way out, where `uploads.bytes` and
+       `raw_sources.bytes` are read raw. `integer` is not an option either way:
+       nano-dollars overflow `int4` at $2.15. `tests/store-ai-calls.test.ts`
+       asserts a round-trip comes back a `number`, because "it should" is exactly
+       the assumption those two comments exist to distrust. */
+    creditsUsedNanos: bigint("credits_used_nanos", { mode: "number" }),
+    /** What the inference itself was worth. Under BYOK this is real and the above is 0. */
+    upstreamInferenceNanos: bigint("upstream_inference_nanos", { mode: "number" }),
+    isByok: boolean("is_byok"),
+    inputTokens: integer("input_tokens"),
+    outputTokens: integer("output_tokens"),
+    cacheReadTokens: integer("cache_read_tokens"),
+    cacheWriteTokens: integer("cache_write_tokens"),
+    /** Priced at 1.25x and 2x input respectively, which is why one total will not do. */
+    cacheWrite5mTokens: integer("cache_write_5m_tokens"),
+    cacheWrite1hTokens: integer("cache_write_1h_tokens"),
+    /** Inside `output_tokens`, never added to it. */
+    reasoningTokens: integer("reasoning_tokens"),
+    /** Billed per search and invisible to token arithmetic. */
+    webSearches: integer("web_searches"),
+    serviceTier: text("service_tier"),
+    inferenceGeo: text("inference_geo"),
+    createdAt: createdAt(),
+  },
+  (t) => [
+    /** "What did this owner spend in August" — the query a spend limit would need. */
+    index("ai_calls_owner_started").on(t.ownerId, t.startedAt.desc()),
+    /** "What did this ingest cost", asked once per job at the end of it. */
+    index("ai_calls_job").on(t.jobId),
+  ],
+);
 
 /* ------------------------------------------------------------------ chat -- */
 
diff --git a/src/glossary.ts b/src/glossary.ts
index aca0742..8b1edc0 100644
--- a/src/glossary.ts
+++ b/src/glossary.ts
@@ -1211,10 +1211,7 @@ export async function generateGlossary(opts: {
       const verb = existing ? "more terms" : "terms";
       let chars = 0;
       let last = 0;
-      /* `delta: string` spelled out because `MeteredCall.stream` is typed as
-         `ReturnType<…messages.stream>`, which instantiates that method's generic at
-         its constraint and loses `on`'s per-event listener types. */
-      call.stream.on("text", (delta: string) => {
+      call.onText((delta) => {
         chars += delta.length;
         // Throttled: the model emits deltas far faster than anyone can read them,
         // and every one of these is a write the job poller may pick up.
diff --git a/src/ideas.ts b/src/ideas.ts
index 846e8a0..0bf3cca 100644
--- a/src/ideas.ts
+++ b/src/ideas.ts
@@ -825,10 +825,7 @@ export async function generateIdeas(opts: {
       const report = opts.onProgress;
       let chars = 0;
       let last = 0;
-      /* `delta: string` spelled out because `MeteredCall.stream` is typed as
-         `ReturnType<…messages.stream>`, which instantiates that method's generic at
-         its constraint and loses `on`'s per-event listener types. */
-      call.stream.on("text", (delta: string) => {
+      call.onText((delta) => {
         chars += delta.length;
         // Throttled: the model emits deltas far faster than anyone reads them,
         // and each of these is a write the job poller may pick up.
diff --git a/src/jobs.ts b/src/jobs.ts
index 948b5c9..fc9b666 100644
--- a/src/jobs.ts
+++ b/src/jobs.ts
@@ -38,7 +38,13 @@
  * version of this apart.
  */
 import { createHash } from "node:crypto";
-import { type SpendReport, collectSpend, spendFields } from "./ai-spend.js";
+import {
+  type SpendReport,
+  collectSpend,
+  emptySpend,
+  formatNanos,
+  spendFields,
+} from "./ai-spend.js";
 import { mintId } from "./ids.js";
 /* The store the pipeline reads and writes through. Named for the role rather
    than imported under its own name, because the role is what changes: the
@@ -47,6 +53,7 @@ import { mintId } from "./ids.js";
    single line that picks Postgres instead. Deliberately not routed through
    src/store/index.ts — that file is the *reader's* store, and switching the
    pipeline over is a separate decision from switching reads over. */
+import { costStore, totalRows } from "./store/ai-calls.js";
 import { fsArtifacts as pipelineStore } from "./store/artifacts-fs.js";
 import { fsJobStore } from "./store/jobs-fs.js";
 import { pgJobStore } from "./store/pg-jobs.js";
@@ -331,7 +338,7 @@ async function runStep(
 
   /* Filled by `collectSpend`'s `onDone` below, which fires on both paths — so
      this is readable from the `catch` as well as from the success path. */
-  let spend: SpendReport = { calls: [], pending: [] };
+  let spend: SpendReport = emptySpend();
 
   try {
     /* Bracketing the run, not decorating it. A step that dies between two of
@@ -348,15 +355,31 @@ async function runStep(
        seven of them. `collectSpend` is ambient (src/ai-spend.ts), so the stages
        say nothing and this still gets the whole bill.
 
-       `onDone` rather than the resolved value, because it fires on the failure
-       path too: a step that threw had usually already paid for the call that
-       threw, and the retry after it pays again. */
-    const { result } = await collectSpend(
-      () => STEPS[step.name].run(ctx),
-      (report) => {
+       What it is told about the work is below rather than here. */
+    const { result } = await collectSpend(() => STEPS[step.name].run(ctx), {
+      /* **Everything the ledger cannot work out for itself.** A gateway sees a
+         model id and a body; this is the frame that knows whose article it is,
+         which job, and which step — so it says so once and every call inside
+         inherits it. `job.ownerId` rather than `currentOwnerId()`, because a job
+         outlives the request that made it and carries its owner deliberately
+         (src/owner.ts § `runAsOwner`). */
+      attribution: {
+        scopeKind: "job_step",
+        ownerId: job.ownerId,
+        articleSlug: job.slug,
+        jobId: job.id,
+        stepName: step.name,
+      },
+      /* An arrow rather than `costStore.record`, because the filesystem adapter's
+         methods call each other through `this`. */
+      sink: (row) => costStore.record(row),
+      /* `onDone` rather than the resolved value, because it fires on the failure
+         path too: a step that threw had usually already paid for the call that
+         threw, and the retry after it pays again. */
+      onDone: (report) => {
         spend = report;
       },
-    );
+    });
     step.detail = result;
     await assertProduced(STEPS[step.name], ctx, pipelineStore);
     /* **Before the abort check, not after.** A cancel here is about the job,
@@ -455,6 +478,43 @@ async function runStep(
  * process's memory, and a store cannot enumerate owners without reading every
  * row it has.
  */
+/**
+ * **What the whole ingest cost**, for the line that says the job is over.
+ *
+ * Asked of the ledger rather than accumulated on the job, and that is the
+ * decision worth writing down. A job is not one process run: `advanceJob` runs
+ * some steps and returns, and the browser calls it again, so there is no frame
+ * that spans a job and no total that could simply be carried. The two options
+ * were a running figure on the job row — which is a second ledger, kept in both
+ * job stores, free to diverge after an ambiguous write — or a query over the
+ * rows, which is what the rows are for. GPT Sol's call, 2026-08-28.
+ *
+ * **It reports zero calls, never a zero cost.** A ledger that cannot be read is
+ * a different thing from a job that spent nothing, and `aiCostStatus` is what
+ * separates them: without it, a database that was down all afternoon reports
+ * every ingest as free.
+ */
+async function jobSpend(job: Job, jlog: Log): Promise<Record<string, unknown>> {
+  let rows: Awaited<ReturnType<typeof costStore.forJob>>;
+  try {
+    rows = await costStore.forJob(job.id);
+  } catch (err) {
+    jlog.warn({ ...errorFields(err) }, "could not read what this job cost");
+    return { aiCostStatus: "unavailable" };
+  }
+  if (rows.length === 0) return {};
+  const { credits, upstream, unpriced } = totalRows(rows);
+  return {
+    aiCalls: rows.length,
+    aiCostNanos: credits + upstream,
+    aiCost: formatNanos(credits + upstream),
+    /* Only when it is not zero, so an ordinary line stays short and an unusual
+       one says why. Each of these is a claim that the number above is wrong.  */
+    ...(upstream > 0 ? { aiUpstreamNanos: upstream } : {}),
+    ...(unpriced > 0 ? { aiUnpriced: unpriced } : {}),
+  };
+}
+
 async function endJob(
   job: Job,
   attempt: string,
@@ -463,7 +523,7 @@ async function endJob(
   startedMs: number,
 ): Promise<Job> {
   const after = await store.finish(job.id, attempt, ending);
-  const line = { ms: since(startedMs), status: ending.status };
+  const line = { ms: since(startedMs), status: ending.status, ...(await jobSpend(job, jlog)) };
   /* `warn` for a cancel, because the reader chose it and it is neither a fault
      nor a clean finish. An `error` outcome stays at `info` — the step that
      failed has already logged the stack at `error`, and repeating it would
diff --git a/src/messages-stream.ts b/src/messages-stream.ts
index a3f968e..2d792b8 100644
--- a/src/messages-stream.ts
+++ b/src/messages-stream.ts
@@ -57,7 +57,12 @@
  * response proves anything.
  */
 import Anthropic from "@anthropic-ai/sdk";
-import { type SpendRecord, beginSpend, recordSpend } from "./ai-spend.js";
+import {
+  type SpendRecord,
+  beginSpend,
+  keyFingerprint,
+  recordSpend,
+} from "./ai-spend.js";
 import { NOT_CONFIGURED } from "./messages.js";
 import { type Task, modelFor } from "./models.js";
 import { type Nanos, providerCostToNanos } from "./pricing.js";
@@ -193,6 +198,26 @@ export interface CallMeter {
    * shape hardened into a database column.
    */
   isByok: boolean | null;
+  /** Which key paid, by name and never by value. `keyFingerprint` in ai-spend.ts. */
+  credentialFingerprint: string | null;
+  /**
+   * **The pricing inputs, off the raw `message_delta` rather than off
+   * `finalMessage()`.**
+   *
+   * Not a stylistic choice: the SDK merges the delta's usage into the message it
+   * hands back and **drops the fields its own `Usage` type does not name** — the
+   * TTL split, the tier and the geography among them. Read from the message they
+   * are all `null`, which is the shape of a cost report that is quietly missing
+   * the reason its number moved. Found by driving a real canned stream through
+   * this file and watching `cacheWrite5mTokens` come back null with the number
+   * plainly in the fixture.
+   */
+  cacheWrite5mTokens: number | null;
+  cacheWrite1hTokens: number | null;
+  reasoningTokens: number | null;
+  webSearches: number | null;
+  serviceTier: string | null;
+  inferenceGeo: string | null;
 }
 
 /**
@@ -203,11 +228,14 @@ export interface CallMeter {
  * `message_delta`, and populated afterwards. **Read it after awaiting
  * `finalMessage()`**, never before.
  *
- * Exported separately from `streamMessage` so a caller that already holds a
- * stream — a test, or a stage doing something unusual — can meter it without
- * going through the wrapper.
+ * **Not exported, since 2026-08-28.** It used to be, "so a caller that already
+ * holds a stream can meter it without going through the wrapper" — which is a
+ * description of the bypass this seam exists to remove. A caller that holds a
+ * stream and a meter is a caller that can decide not to finish either, and once
+ * the numbers reach a database that is a bypass with a ledger behind it looking
+ * confident. GPT Sol asked for it to close before the schema hardened.
  */
-export function meterStream(stream: MessageStream): CallMeter {
+function meterStream(stream: MessageStream): CallMeter {
   const meter: CallMeter = {
     costNanos: null,
     costUsd: null,
@@ -215,6 +243,13 @@ export function meterStream(stream: MessageStream): CallMeter {
     generationId: null,
     upstream: null,
     isByok: null,
+    credentialFingerprint: null,
+    cacheWrite5mTokens: null,
+    cacheWrite1hTokens: null,
+    reasoningTokens: null,
+    webSearches: null,
+    serviceTier: null,
+    inferenceGeo: null,
   };
   stream.on("streamEvent", (event: { type: string }) => {
     /* Deliberately reading through a cast rather than the SDK's types. The
@@ -226,6 +261,14 @@ export function meterStream(stream: MessageStream): CallMeter {
         cost?: unknown;
         is_byok?: unknown;
         cost_details?: { upstream_inference_cost?: unknown };
+        cache_creation?: {
+          ephemeral_5m_input_tokens?: unknown;
+          ephemeral_1h_input_tokens?: unknown;
+        };
+        output_tokens_details?: { thinking_tokens?: unknown };
+        server_tool_use?: { web_search_requests?: unknown };
+        service_tier?: unknown;
+        inference_geo?: unknown;
       };
     };
     if (event.type === "message_start") {
@@ -243,6 +286,23 @@ export function meterStream(stream: MessageStream): CallMeter {
       }
       if (typeof raw.usage?.is_byok === "boolean")
         meter.isByok = raw.usage.is_byok;
+      const num = (v: unknown): number | null =>
+        typeof v === "number" && Number.isFinite(v) ? v : null;
+      const str = (v: unknown): string | null =>
+        typeof v === "string" && v.length > 0 ? v : null;
+      meter.cacheWrite5mTokens =
+        num(raw.usage?.cache_creation?.ephemeral_5m_input_tokens) ??
+        meter.cacheWrite5mTokens;
+      meter.cacheWrite1hTokens =
+        num(raw.usage?.cache_creation?.ephemeral_1h_input_tokens) ??
+        meter.cacheWrite1hTokens;
+      meter.reasoningTokens =
+        num(raw.usage?.output_tokens_details?.thinking_tokens) ??
+        meter.reasoningTokens;
+      meter.webSearches =
+        num(raw.usage?.server_tool_use?.web_search_requests) ?? meter.webSearches;
+      meter.serviceTier = str(raw.usage?.service_tier) ?? meter.serviceTier;
+      meter.inferenceGeo = str(raw.usage?.inference_geo) ?? meter.inferenceGeo;
     }
   });
   return meter;
@@ -291,29 +351,42 @@ export function wasRefused(message: Anthropic.Message): boolean {
  * nothing.
  */
 export type MessagesBody = Omit<Anthropic.MessageStreamParams, "model"> & {
-  provider?: typeof MESSAGES_PROVIDER;
   /**
-   * Optional, and normally omitted — `streamMessage` derives it from the task.
+   * **Both are this file's to set, and passing either is a compile error.**
+   *
+   * They were optional overrides until 2026-08-28, and each had its own way of
+   * being wrong quietly. A stage that passed its own `model` could be switched
+   * back to the unprefixed `CAPABLE_MODEL` — a 404 on every call — and
+   * `tests/models.test.ts` would stay green, because it only ever asked
+   * `modelFor()` what it *would* return, never what a stage actually sent. A
+   * stage that passed its own `provider` could drop the cache pin, which does
+   * not fail: it just costs several times more.
    *
-   * **Left to the caller until a GPT Sol review pointed out what that allowed.**
-   * Each of the seven stages passed `CAPABLE_MODEL_OPENROUTER` itself, so a stage
-   * could be switched back to the unprefixed `CAPABLE_MODEL` — a 404 on every
-   * call — and `tests/models.test.ts` would stay green, because it only ever
-   * asked `modelFor()` what it *would* return, never what a stage actually sent.
-   * One source for the id closes that: `modelFor(task)` is now what goes on the
-   * wire, and the outgoing bodies are asserted.
+   * Typed `never` rather than merely overwritten, so the mistake is caught where
+   * it is made. They are overwritten after the spread as well, because a body
+   * can be assembled at run time out of something the type system never saw.
    */
-  model?: Anthropic.MessageStreamParams["model"];
+  provider?: never;
+  model?: never;
 };
 
-/** What `streamMessage` hands back: the SDK's stream, and a `finalMessage` that keeps accounts. */
+/**
+ * What `streamMessage` hands back.
+ *
+ * **Three things, and deliberately not the stream.** A stage used to get the
+ * SDK's own `MessageStream`, which has its own `finalMessage()` on it — so the
+ * ordinary-looking `await call.stream.finalMessage()` was a working call that
+ * recorded nothing, and nothing counted it. That was fine while the numbers only
+ * reached a log line; with a ledger behind them it is a bypass that makes the
+ * ledger look complete. GPT Sol asked for it closed before the schema hardened.
+ */
 export interface MeteredCall {
-  /** The SDK's own stream. Subscribe to `"text"` for progress exactly as before. */
-  stream: MessageStream;
-  /** Populated by the time `finalMessage()` resolves; `null` before that. */
-  meter: CallMeter;
-  /** `stream.finalMessage()`, plus the spend record. Await this, not the stream's own. */
+  /** Progress, exactly as `stream.on("text", …)` gave it. */
+  onText: (listener: (delta: string) => void) => void;
+  /** `stream.finalMessage()`, plus the spend record. The only way to get the answer. */
   finalMessage: () => Promise<Anthropic.Message>;
+  /** Whether the stream ended because somebody aborted it. */
+  readonly aborted: () => boolean;
 }
 
 /**
@@ -352,15 +425,24 @@ export function streamMessage(
 ): MeteredCall {
   const client = messagesClient();
   const startedAt = Date.now();
-  const model = body.model ?? modelFor(task);
+  const model = modelFor(task);
   /* Registered before the stream opens, so a call that never comes back leaves a
      trace rather than simply not appearing. See `PendingCall` in ai-spend.ts. */
   const callId = beginSpend(task, model);
   const stream = client.messages.stream(
-    { provider: MESSAGES_PROVIDER, ...body, model } as Anthropic.MessageStreamParams,
+    /* **After the spread, not before it.** It was before until 2026-08-28, so a
+       body assembled at run time — out of something the type system never saw —
+       could carry its own `provider` and win. Nothing did; the test that proved
+       it possible was written the same hour, and it went red on the old order.
+       `model` was already after, which is why only one of the two was wrong. */
+    { ...body, provider: MESSAGES_PROVIDER, model } as Anthropic.MessageStreamParams,
     options,
   );
   const meter = meterStream(stream);
+  /* Off the client rather than out of the environment a second time: the key the
+     call actually went out with is the one the reconciliation has to ask about,
+     and a second read of `process.env` is a second chance to disagree. */
+  meter.credentialFingerprint = keyFingerprint(client.apiKey ?? "");
 
   /* **Memoised, because `finalMessage()` may be awaited more than once.** The
      SDK's own is idempotent — it resolves the same message every time — so a
@@ -403,8 +485,15 @@ export function streamMessage(
            *this stream* ended, where the external signal answers a different
            question and gets two cases wrong — `stream.abort()` with no signal
            reads as an error, and a provider failure racing a later signal abort
-           reads as a cancel. Both found by a GPT Sol review. */
-        const aborted = stream.aborted || options?.signal?.aborted === true;
+           reads as a cancel. Both found by a GPT Sol review.
+
+           **And then it OR-ed the signal back in anyway**, one line under the
+           paragraph explaining why that is wrong, which a second Sol review
+           caught. What is left is causal on both halves: either the stream says
+           it was aborted, or the error *is* the abort — the signal's own reason,
+           or an `AbortError` where none was given. "The signal happens to be
+           aborted now" is not one of the two. */
+        const aborted = stream.aborted || isAbort(err, options?.signal);
         record(
           task,
           model,
@@ -421,7 +510,24 @@ export function streamMessage(
     return settled;
   };
 
-  return { stream, meter, finalMessage };
+  return {
+    onText: (listener) => {
+      stream.on("text", listener);
+    },
+    finalMessage,
+    aborted: () => stream.aborted,
+  };
+}
+
+/**
+ * **Was this error the abort itself?** — the same question
+ * [`ai-call.ts`](ai-call.ts) asks, and for the same reason: a provider dying at
+ * the moment a reader presses Stop is not a cancel, and recording it as one puts
+ * it in the outcome nobody investigates.
+ */
+function isAbort(err: unknown, signal: AbortSignal | undefined): boolean {
+  if (!signal?.aborted) return false;
+  return err === signal.reason || (err as Error | undefined)?.name === "AbortError";
 }
 
 /** Turn a finished call into a `SpendRecord`. Absent numbers stay absent. */
@@ -439,17 +545,29 @@ function record(
   recordSpend(
     {
       job: task,
+      wire: "messages",
       model,
       answeredBy,
       costNanos: meter.costNanos,
       upstreamCostNanos: meter.upstreamCostNanos,
       generationId: meter.generationId,
       upstream: meter.upstream,
+      credentialFingerprint: meter.credentialFingerprint,
       isByok: meter.isByok,
       inputTokens: num(usage?.input_tokens),
       outputTokens: num(usage?.output_tokens),
       cacheReadTokens: num(usage?.cache_read_input_tokens),
       cacheWriteTokens: num(usage?.cache_creation_input_tokens),
+      cacheWrite5mTokens: meter.cacheWrite5mTokens,
+      cacheWrite1hTokens: meter.cacheWrite1hTokens,
+      /* Thinking is billed as output and is *inside* `output_tokens`, so this is
+         never added to anything — it is the answer to "did that call spend its
+         whole budget thinking", which is what a jump in the bill turns out to be
+         about more often than a price change. */
+      reasoningTokens: meter.reasoningTokens,
+      webSearches: meter.webSearches,
+      serviceTier: meter.serviceTier,
+      inferenceGeo: meter.inferenceGeo,
       ms: Date.now() - startedAt,
       outcome,
     },
diff --git a/src/openrouter-stream.ts b/src/openrouter-stream.ts
index 27317c2..29c5b87 100644
--- a/src/openrouter-stream.ts
+++ b/src/openrouter-stream.ts
@@ -361,6 +361,13 @@ export interface ToolCallDelta {
 
 export interface StreamChunk {
   model?: string;
+  /**
+   * Which upstream answered — OpenRouter puts it on every chunk of a chat
+   * completion, and it is not always the one the routing table asked for. A
+   * report that shows only the requested provider attributes the money to
+   * somebody who never ran the call.
+   */
+  provider?: string;
   error?: { message: string };
   usage?: Usage;
   choices?: {
diff --git a/src/routes.ts b/src/routes.ts
index 7fbb1cf..da712ed 100644
--- a/src/routes.ts
+++ b/src/routes.ts
@@ -87,6 +87,7 @@ import {
    turns into a 409. Nothing here touches a file, so nothing here has to know
    which store is live. Every write goes through `chatStore` above. */
 import { ChatConflict, withEdit, withRetry } from "./chat.js";
+import { CommentIdTaken, NotAnExplanation } from "./comments.js";
 import { findPassagesStream, SEARCH_TIMEOUT_MS } from "./search.js";
 /* A pure predicate, so importing it here does not drag the filesystem store
    into a file that must work with either one — the same rule the `withEdit` /
@@ -113,7 +114,14 @@ import { describeAdminMiss, isAdmin } from "./admin.js";
 import { requireUser, type Verifier } from "./auth.js";
 import { UPLOAD_MISSING, UPLOAD_UNAVAILABLE } from "./messages.js";
 import { currentOwnerId, runInRequest, setRequestOwner } from "./owner.js";
-import { collectSpend, currentSpend, spendFields } from "./ai-spend.js";
+import {
+  collectSpend,
+  currentSpend,
+  emptySpend,
+  spendFields,
+  withSpendAttribution,
+} from "./ai-spend.js";
+import { costStore } from "./store/ai-calls.js";
 import { stagingKey } from "./source.js";
 import { uploadGrants } from "./store/blobs.js";
 import { uploadProblem } from "./uploads.js";
@@ -453,7 +461,134 @@ function sse(res: ServerResponse): {
 }
 
 /**
- * Create a comment, answer it a few words at a time, and store the answer.
+ * The reader's own words, as the store may hold them: trimmed, or nothing.
+ *
+ * **One place, so `""` and absent cannot both mean "wrote nothing".** The
+ * database has a check constraint saying the same thing and the type has
+ * `body?: string` saying it a third time; this is the function that makes all
+ * three agree, and it is the only thing that may build the value.
+ */
+function tidyBody(body: unknown): string | null {
+  /* **Absent and `null` mean "no body"; anything else is a bad request.**
+     Coercing a number, an array or an object to `null` made `{ body: {…} }`
+     silently mean "bookmark this" — a client bug stored as a deliberate act,
+     with nothing anywhere disagreeing. GPT Sol, reviewing the built code. */
+  if (body === undefined || body === null) return null;
+  if (typeof body !== "string") throw httpError(400, "body must be a string or null [cmt-type]");
+  const trimmed = body.trim();
+  if (!trimmed) return null;
+  /* A limit, because this is the reader's own text going into a `text` column
+     and a JSON file and every archive of both. Generous enough that nobody
+     writing a note about a paragraph meets it. The message says the limit and
+     **never the text** — an `httpError` message is logged as `reason`, and
+     redaction here is path-based and cannot reach a string. */
+  if (trimmed.length > MAX_BODY_CHARS) {
+    throw httpError(400, `A comment can be at most ${MAX_BODY_CHARS} characters [cmt-long]`);
+  }
+  return trimmed;
+}
+
+/** Room for a few paragraphs of thinking about one passage, and no more. */
+const MAX_BODY_CHARS = 4000;
+
+/**
+ * Store a **free** comment — the reader's mark on a passage. No model call.
+ *
+ * This is what selecting text does since 2026-08-28. Until then, selecting text
+ * bought an explanation, and this route was `answer` below; the two split
+ * because a colliding id means opposite things to them (a retry to one,
+ * somebody else's comment to the other) and one function could not safely be
+ * both. docs/plans/260828a-comments-and-bookmarks.md.
+ *
+ * ## The anchor is checked against the article, here
+ *
+ * `checkAnchor` exists for chat and is **weaker than it looks**: it verifies the
+ * quote is *somewhere* in the block, not that it is at the offset given, and on
+ * its own it would accept an empty quote because every string contains `""`.
+ * GPT Sol pointed that out reviewing this plan. So the checks are written out
+ * rather than borrowed, and `start` is bounded as well as non-negative — a
+ * `start` past the end of the block draws the mark in the wrong place, which
+ * reads as a styling glitch rather than as bad data.
+ *
+ * **No message built here may contain the quote or the body.** Both are the
+ * reader's, `httpError` messages are logged as `reason`, and redaction matches
+ * key names rather than values, so the only thing keeping prose out of the log
+ * is not putting it in. Same rule as the top of src/comments.ts.
+ */
+async function createFree(slug: string, body: unknown): Promise<Comment> {
+  const {
+    id,
+    blockId,
+    quote,
+    start,
+    body: text,
+  } = (body ?? {}) as Record<string, unknown>;
+
+  if (typeof blockId !== "string" || typeof quote !== "string" || typeof start !== "number") {
+    throw httpError(400, "Expected { blockId, quote, start }");
+  }
+  if (!isSpideryarnId(blockId)) throw httpError(400, "blockId must be a block id");
+  if (id !== undefined && (typeof id !== "string" || !isSpideryarnId(id))) {
+    throw httpError(400, "id must be a block id");
+  }
+  if (!quote.trim()) throw httpError(400, "quote must not be empty");
+  if (quote.length > MAX_QUOTE_CHARS) {
+    throw httpError(400, `A quote can be at most ${MAX_QUOTE_CHARS} characters [cmt-quote]`);
+  }
+  if (!Number.isInteger(start) || start < 0) {
+    throw httpError(400, `start must be a non-negative integer, got ${start}`);
+  }
+  const tidied = tidyBody(text);
+
+  // Before anything is written, so a slug that is not an article is a clean 404
+  // with nothing left behind.
+  const article = await loadArticle(slug);
+  const block = article.blocks.find((b) => b.id === blockId);
+  if (!block) throw httpError(400, "blockId is not a block of this article");
+  if (start > block.text.length) throw httpError(400, "start is past the end of that block");
+  /* Folded, because `quote` came from a DOM selection and `block.text` from the
+     extractor, and the two disagree about runs of whitespace — the same fold
+     `checkAnchor` uses, for the same reason. */
+  if (!foldSpace(block.text).includes(foldSpace(quote))) {
+    throw httpError(400, "quote is not in that block");
+  }
+
+  return commentStore.create(slug, {
+    blockId,
+    quote,
+    start,
+    ...(tidied === null ? {} : { body: tidied }),
+    ...(typeof id === "string" ? { id } : {}),
+  });
+}
+
+/** A selection, not an essay. Long enough for a run-on sentence and no more. */
+const MAX_QUOTE_CHARS = 2000;
+
+/**
+ * Collapse runs of whitespace, for comparing a selection against a block.
+ *
+ * **One of these, used by both anchor checks.** A quote comes from a DOM
+ * selection and `block.text` comes from the extractor, and the two disagree
+ * about runs of whitespace — see the note in src/blocks.ts. `checkAnchor` had
+ * its own copy of this line; two copies of a normaliser is how a chat anchor
+ * and a comment anchor end up disagreeing about the same passage.
+ */
+const foldSpace = (t: string) => t.replace(/\s+/g, " ").trim();
+
+/**
+ * Answer a **legacy explanation** a few words at a time, and store the answer.
+ *
+ * Reached only as `POST /api/comments/:slug/:id/answer`, and only by *Try
+ * again* and *Search the web properly* on a comment that already has an answer
+ * or an error. Since 2026-08-26 a selection opens a conversation rather than
+ * buying one of these, and since 2026-08-28 it makes a free comment; nothing
+ * creates a new explanation, and this route cannot.
+ *
+ * **It takes an id and no anchor.** `beginAnswer` reads the stored passage
+ * rather than accepting one, which closes the hole where a retry could quietly
+ * move a comment to different words — and it refuses a `status: "none"` row,
+ * so a bookmark cannot be dragged into the retired path.
  *
  * **Validation happens before a single header is written**, so a bad request is
  * still an ordinary JSON 400 — the thrown `httpError` never reaches a
@@ -463,78 +598,37 @@ function sse(res: ServerResponse): {
  * leaves evidence, and the terminal state is written before the last frame so
  * the disk and the reader can never disagree. A model failure is a `done` frame
  * carrying a comment whose status is `error` — the request *did* succeed at what
- * it was for, which was recording the question; the dialog shows the failure and
- * offers a retry.
+ * it was for; the dialog shows the failure and offers a retry.
  *
  * Frames: one `begin`, then any number of `delta`, then exactly one `done`.
- *
- * **`begin` carries the whole comment, and that is the point of it.**
- * `commentStore.create` re-mints the id when the client's is malformed or
- * collides, and with a stream there is no response body to carry the real one
- * back. Without this frame the client would stream an answer into a row the
- * server has never heard of, and a reload would show a different comment.
- * src/web/useChat.ts § Begun is the write-up of that exact bug happening in
- * chat, weeks after the ids stopped matching.
  */
-async function answer(slug: string, body: unknown, res: ServerResponse): Promise<void> {
-  const { id, blockId, quote, start, deep, useProfile } = (body ?? {}) as Record<
-    string,
-    unknown
-  >;
-  if (typeof blockId !== "string" || typeof quote !== "string" || typeof start !== "number") {
-    throw httpError(400, "Expected { blockId, quote, start }");
-  }
-  // `start` indexes into the block's rendered text, so anything that is not a
-  // whole non-negative number is meaningless. A negative one is worse than
-  // meaningless: `resolveMark`'s fast path returns it unchanged, and the mark is
-  // drawn a few characters to the left of the words it belongs to — wrong, and
-  // wrong in a way that looks like a styling glitch rather than bad data.
-  if (!Number.isInteger(start) || start < 0) {
-    throw httpError(400, `start must be a non-negative integer, got ${start}`);
-  }
+async function answer(
+  slug: string,
+  id: string,
+  body: unknown,
+  res: ServerResponse,
+): Promise<void> {
+  const { deep, useProfile } = (body ?? {}) as Record<string, unknown>;
   /* Anything other than `true` is not deep. A 400 here would be a validation
      message built from the request body, which is the one thing `httpError`
      messages must never be — they are logged as `reason`, and redaction is
-     path-based and cannot reach a string. See the note on `httpError` below. */
+     path-based and cannot reach a string. */
   const deeper = deep === true;
   /* `!== false`, the mirror of the line above and deliberately not the same
-     rule. Deep search is an extra the reader asks for, so absent means no;
-     the profile is the default this app now writes with, so absent means yes
-     and only an explicit refusal turns it off. */
+     rule. Deep search is an extra the reader asks for, so absent means no; the
+     profile is the default this app now writes with, so absent means yes and
+     only an explicit refusal turns it off. */
   const wantsProfile = useProfile !== false;
 
-  // Before the comment is created, so a slug that is not an article is a clean
-  // 404 with nothing written, rather than a stored comment whose only content is
-  // the error we could have known about first.
+  // Before the row is touched, so a slug that is not an article is a clean 404.
   const article = await loadArticle(slug);
+  if (!isSpideryarnId(id)) throw httpError(400, "id must be a comment id");
 
-  /* **This route no longer creates explanations.**
-   *
-   * Since 2026-08-26 a selection opens a chat rather than buying an answer
-   * (docs/plans/260826ab-chat-as-gateway.md), and Greg's call was that the explanation
-   * panel becomes a museum: it can show the ones you already made, and retry
-   * and deepen them, but there is no way to make a new one.
-   *
-   * Deleting `useComments.ask` closes the React path and **nothing else**. A
-   * stale tab left open in another window, or a direct request, would still
-   * land here and `create` would happily mint a row. "There is no way to make a
-   * new one" is then a fact about the current build rather than a rule, which
-   * is the kind of thing that quietly stops being true. So the rule lives here,
-   * where the writing happens.
-   *
-   * Retry and deepen both send the id they already have, so requiring one costs
-   * them nothing. `create` stays idempotent on that id and is still what resets
-   * the row — see the note on `CommentStore.create`. */
-  if (typeof id !== "string") throw httpError(400, "Expected { id }");
-  const known = (await commentStore.load(slug)).some((c) => c.id === id);
-  if (!known) {
-    throw httpError(
-      404,
-      "Selecting text starts a conversation now; there is no explanation to answer",
-    );
-  }
-
-  const comment = await commentStore.create(slug, { blockId, quote, start, id });
+  /* Throws `NotAnExplanation` for an unknown id and for a bookmark, which
+     `serveApi`'s error mapping turns into a 404 and a 409. The anchor comes
+     back off the stored row — the request never gets to name one. */
+  const comment = await commentStore.beginAnswer(slug, id);
+  const { blockId, quote } = comment;
   const key = `${slug}/${comment.id}`;
   const release = beganAnswering(key);
 
@@ -923,8 +1017,19 @@ function sweepChat(slug: string): Promise<ChatThread[]> {
  *    error on it rather than discarded. See the note in `sweepChat`.
  */
 async function streamChat(slug: string, body: unknown, res: ServerResponse): Promise<void> {
-  const { threadId, question, at, retry, edit, expectedTailId, useProfile, anchor, kind, stance } =
-    (body ?? {}) as Record<string, unknown>;
+  const {
+    threadId,
+    question,
+    at,
+    retry,
+    edit,
+    expectedTailId,
+    useProfile,
+    anchor,
+    kind,
+    stance,
+    sourceCommentId,
+  } = (body ?? {}) as Record<string, unknown>;
   if (typeof threadId !== "string") throw httpError(400, "Expected { threadId, … }");
   /* **Validated, never coerced.** An unknown value is a 400 rather than a
      silent fall back to the default: a client that sends `stance: "socratik"`
@@ -1011,6 +1116,19 @@ async function streamChat(slug: string, body: unknown, res: ServerResponse): Pro
      anchor sent with either would be dropped without a word — and the reader
      would have a conversation the database says is about a passage they never
      chose. Refused rather than ignored. */
+  /* **The comment this conversation was started from, if it was.**
+     Travels with the anchor and under the same rule, because it means the same
+     kind of thing: a fact about the turn that *creates* a thread. It exists so
+     the link can be written **server-side, with the real thread id** — the
+     client mints an optimistic one and only finds out it was overruled if it
+     was, so a client-side link is a race it cannot see it has lost.
+     docs/plans/260828a-comments-and-bookmarks.md § the Save & ask choreography. */
+  if (sourceCommentId !== undefined && !isSpideryarnId(String(sourceCommentId))) {
+    throw httpError(400, "sourceCommentId must be a comment id");
+  }
+  if (sourceCommentId !== undefined && (wantsRetry || wantsEdit)) {
+    throw httpError(400, "A source comment can only be sent with a new question");
+  }
   if (anchor !== undefined && (wantsRetry || wantsEdit)) {
     throw httpError(400, "An anchor can only be sent with a new question");
   }
@@ -1207,6 +1325,34 @@ async function streamChat(slug: string, body: unknown, res: ServerResponse): Pro
     res.flushHeaders?.();
     stopBeating = heartbeat(res, alive);
 
+    /* **The link is written here, with the id the server settled on.**
+       This is the first moment a real thread id exists, and it is the only
+       place that has one — which is the whole reason this is not done from the
+       browser. A failure is logged and swallowed: the comment is stored and the
+       conversation is stored, and all that is missing is the arrow between
+       them, so failing the request would throw away work that plainly
+       succeeded. `linkThread` is compare-and-set from absent, so a repeat of
+       the same link is a no-op and a *different* one is refused. */
+    if (typeof sourceCommentId === "string" && wanted && "quote" in wanted) {
+      try {
+        /* **The anchor goes with it**, so the store can refuse a
+           `sourceCommentId` that names one of this reader's *other* comments —
+           a stale id from another tab, or a made-up one. Only a selection
+           anchor can carry a link: a block-only chat has no passage to match,
+           and a comment always has one. */
+        await commentStore.linkThread(slug, sourceCommentId, thread.id, {
+          blockId: wanted.blockId,
+          quote: wanted.quote,
+          start: wanted.start,
+        });
+      } catch (err) {
+        log("store").warn(
+          { slug, id: sourceCommentId, threadId: thread.id, ...errorFields(err) },
+          "could not link the comment to its conversation",
+        );
+      }
+    }
+
     /* The ids first, before a single word of the answer. The client minted the
        thread id optimistically and beginTurn may have overruled it (a collision,
        or an id that was not one of ours), so this frame is what the client
@@ -1654,8 +1800,7 @@ function checkAnchor(anchor: ChatAnchor, blocks: Block[]): void {
   /* Whitespace-folded on both sides, because the rendered text the client
      measured collapses runs of space that `block.text` may keep. Comparing them
      literally rejected perfectly good selections. */
-  const fold = (t: string) => t.replace(/\s+/g, " ").trim();
-  if (!fold(block.text).includes(fold(anchor.quote))) {
+  if (!foldSpace(block.text).includes(foldSpace(anchor.quote))) {
     throw httpError(400, "anchor.quote is not in that block");
   }
 }
@@ -2362,15 +2507,55 @@ async function jobForSlug(slug: string): Promise<Job | null> {
  * against the piece, and this one is a property of the artefact against the
  * person.
  */
+/**
+ * An artefact, and whether the reader has changed since it was written.
+ *
+ * ## It takes a thunk, and that is the whole design
+ *
+ * `resolveProfile` is two queries of its own and has nothing to do with the
+ * artefact read. They used to run one after the other — the route awaited the
+ * artefact, then called this, which then went to the database again — so a
+ * reader waiting on a panel waited for both in series.
+ *
+ * A **thunk** rather than the value, and rather than a promise. A promise
+ * parameter would make the overlap a caller convention: every route could go on
+ * writing `const found = await loadGlossary(at)` and hand over an
+ * already-settled promise, and a test of this function would still pass. GPT
+ * Sol's fifth finding on docs/plans/260828c-library-read-latency.md. Taking the thunk
+ * moves the responsibility in here, where it can be proved.
+ *
+ * ## `allSettled`, and why not `all`
+ *
+ * `Promise.all` rejects with whichever failed *first*, so a reader asking for an
+ * article that does not exist could be told about a profile failure instead of
+ * getting a 404 — a real change in behaviour, and a confusing one, because the
+ * error would name the wrong thing. Settling both and rethrowing the artefact's
+ * rejection first preserves exactly the order the serial version had.
+ *
+ * The profile's rejection is rethrown after, rather than swallowed: a profile
+ * that could not be read is not the same as a profile that has not changed, and
+ * reporting `profileChanged: false` for it would be a silent wrong answer.
+ * Attaching `allSettled` immediately is also what keeps the losing rejection
+ * from surfacing as an unhandled one.
+ *
+ * Starting `resolveProfile` for a slug that turns out not to exist is harmless:
+ * its shelf read already catches, and the global half still counts.
+ */
 async function withProfileChanged<R extends { profileChanged: boolean }>(
   slug: string,
-  found: Omit<R, "profileChanged">,
-  artefact: { profileHash?: string | null },
+  load: () => Promise<Omit<R, "profileChanged">>,
+  stampOf: (found: Omit<R, "profileChanged">) => { profileHash?: string | null },
 ): Promise<R> {
-  const now = await resolveProfile(slug);
+  /* Both started before either is awaited — that is the point of the thunk. */
+  const settled = await Promise.allSettled([load(), resolveProfile(slug)] as const);
+  const [artefact, profile] = settled;
+  if (artefact.status === "rejected") throw artefact.reason;
+  if (profile.status === "rejected") throw profile.reason;
+  const found = artefact.value as Omit<R, "profileChanged">;
+  const now = profile.value as string | null;
   return {
     ...found,
-    profileChanged: profileIsStale(artefact.profileHash, now ? hashProfile(now) : null),
+    profileChanged: profileIsStale(stampOf(found).profileHash, now ? hashProfile(now) : null),
   } as R;
 }
 
@@ -2762,10 +2947,7 @@ function logRequest(
      opened. Read here rather than returned, because this line is written in
      `serveApi`'s own `finally` — inside the scope, before it closes. An ordinary
      request that called no model gets no extra fields at all. */
-  Object.assign(
-    fields,
-    spendFields(currentSpend() ?? { calls: [], pending: [] }),
-  );
+  Object.assign(fields, spendFields(currentSpend() ?? emptySpend()));
   if (status >= 500) line.error(fields, msg);
   else if (status >= 400) line.warn(fields, msg);
   else line.info(fields, msg);
@@ -2813,7 +2995,21 @@ export function handleApi(
      it already writes — see `logRequest`, which reads `currentSpend()` from
      inside the scope. */
   return runInRequest(
-    async () => (await collectSpend(() => serveApi(req, res, verify))).result,
+    async () =>
+      (
+        await collectSpend(() => serveApi(req, res, verify), {
+          /* **No owner here, and that is not an omission.** The gate that fills
+             the owner box runs *inside* `serveApi`, which is inside this
+             collector — so at this instant nobody knows who is asking. The sink
+             resolves it at record time, by which point the gate has long since
+             run. src/ai-spend.ts § `ownerFor`.
+
+             No article either: a route knows which one, and says so with
+             `withSpendAttribution`. */
+          attribution: { scopeKind: "request" },
+          sink: (row) => costStore.record(row),
+        })
+      ).result,
   );
 }
 
@@ -2944,6 +3140,12 @@ async function serveApi(
   const source = /^\/api\/source\/([\w.%-]+)$/.exec(url);
   const comments = /^\/api\/comments\/([\w.%-]+)$/.exec(url);
   const one = /^\/api\/comments\/([\w.%-]+)\/([\w.%-]+)$/.exec(url);
+  /* Answering is its own sub-path rather than a field on the POST, because it
+     is the one thing a comment can do that spends money and streams. **There is
+     deliberately no route for linking a comment to its conversation**: the only
+     place that knows the real thread id is the chat stream itself, so the link
+     is written there. See docs/plans/260828a-comments-and-bookmarks.md. */
+  const commentAnswer = /^\/api\/comments\/([\w.%-]+)\/([\w.%-]+)\/answer$/.exec(url);
   const chat = /^\/api\/chat\/([\w.%-]+)$/.exec(url);
   const oneThread = /^\/api\/chat\/([\w.%-]+)\/([\w.%-]+)$/.exec(url);
   const chatStop = /^\/api\/chat\/([\w.%-]+)\/([\w.%-]+)\/stop$/.exec(url);
@@ -3118,16 +3320,14 @@ async function serveApi(
     if (tweets && req.method === "GET") {
       {
         const at = slugPart(tweets, 1);
-        const found = await loadTweets(at);
-        send(res, 200, await withProfileChanged<ThreadResponse>(at, found, found.thread));
+        send(res, 200, await withProfileChanged<ThreadResponse>(at, () => loadTweets(at), (found) => found.thread));
       }
       return true;
     }
     if (glossary && req.method === "GET") {
       {
         const at = slugPart(glossary, 1);
-        const found = await loadGlossary(at);
-        send(res, 200, await withProfileChanged<GlossaryResponse>(at, found, found.glossary));
+        send(res, 200, await withProfileChanged<GlossaryResponse>(at, () => loadGlossary(at), (found) => found.glossary));
       }
       return true;
     }
@@ -3136,7 +3336,13 @@ async function serveApi(
       return true;
     }
     if (lookup && req.method === "POST") {
-      send(res, 200, await lookUpTerm(slugPart(lookup, 1), slugPart(lookup, 2)));
+      send(
+        res,
+        200,
+        await withSpendAttribution({ articleSlug: slugPart(lookup, 1) }, () =>
+          lookUpTerm(slugPart(lookup, 1), slugPart(lookup, 2)),
+        ),
+      );
       return true;
     }
     /* Read only. There is no DELETE beside this one, unlike the glossary's:
@@ -3148,16 +3354,14 @@ async function serveApi(
     if (summary && req.method === "GET") {
       {
         const at = slugPart(summary, 1);
-        const found = await loadSummaries(at);
-        send(res, 200, await withProfileChanged<SummariesResponse>(at, found, found.summaries));
+        send(res, 200, await withProfileChanged<SummariesResponse>(at, () => loadSummaries(at), (found) => found.summaries));
       }
       return true;
     }
     if (ideas && req.method === "GET") {
       {
         const at = slugPart(ideas, 1);
-        const found = await loadIdeas(at);
-        send(res, 200, await withProfileChanged<IdeasResponse>(at, found, found.ideas));
+        send(res, 200, await withProfileChanged<IdeasResponse>(at, () => loadIdeas(at), (found) => found.ideas));
       }
       return true;
     }
@@ -3246,11 +3450,32 @@ async function serveApi(
       return true;
     }
     if (comments && req.method === "POST") {
-      /* The second endpoint in this file that does not answer with JSON — see
-         `answer`, which writes its own headers and ends the response. It is
-         still reached through `send` for its *failures*: validation throws
-         before a header is written, so a bad request is an ordinary 400. */
-      await answer(slugPart(comments, 1), await readBody(req), res);
+      /* **Making a comment is free and answers with JSON.** Until 2026-08-28
+         this path was `answer`, which spends a model call and streams; the two
+         meanings now have two routes, because a colliding id means opposite
+         things to them — a retry to one, somebody else's comment to the other.
+         docs/plans/260828a-comments-and-bookmarks.md § the store contract. */
+      send(res, 201, { comment: await createFree(slugPart(comments, 1), await readBody(req)) });
+      return true;
+    }
+    if (commentAnswer && req.method === "POST") {
+      /* The one endpoint here that does not answer with JSON — it writes its
+         own headers and ends the response. It is still reached through `send`
+         for its *failures*: validation throws before a header is written, so a
+         bad request is an ordinary 400. */
+      const [slug, id] = [slugPart(commentAnswer, 1), part(commentAnswer, 2)];
+      const answerBody = await readBody(req);
+      await withSpendAttribution({ articleSlug: slug }, () =>
+        answer(slug, id, answerBody, res),
+      );
+      return true;
+    }
+    if (one && req.method === "PATCH") {
+      const [slug, id] = [slugPart(one, 1), part(one, 2)];
+      const { body } = (await readBody(req) ?? {}) as Record<string, unknown>;
+      // `tidyBody` is the one place that decides what a body may be, so the
+      // route no longer keeps a second, slightly different copy of that rule.
+      send(res, 200, { comment: await commentStore.patchBody(slug, id, tidyBody(body)) });
       return true;
     }
     if (one && req.method === "DELETE") {
@@ -3288,7 +3513,14 @@ async function serveApi(
          reads. A stream that fails *before* the headers go out throws, and the
          catch below answers it as ordinary JSON; after that, the failure is an
          `error` frame inside a 200, because the status line is long gone. */
-      await streamChat(slugPart(chat, 1), await readBody(req), res);
+      /* **The article goes on every row this request writes.** Without it,
+         "what has this piece cost me" would cover the ingest and none of the
+         questions asked about it afterwards — which is the half a reader
+         actually generates. src/ai-spend.ts § `withSpendAttribution`. */
+      const chatBody = await readBody(req);
+      await withSpendAttribution({ articleSlug: slugPart(chat, 1) }, () =>
+        streamChat(slugPart(chat, 1), chatBody, res),
+      );
       return true;
     }
     if (chatCancel && req.method === "POST") {
@@ -3332,7 +3564,10 @@ async function serveApi(
          `answer`, which writes its own headers and ends the response. It is
          still reached through `send` for its *failures*: validation throws
          before a header is written, so a bad request is an ordinary 400. */
-      await search(slugPart(searches, 1), await readBody(req), res);
+      const searchBody = await readBody(req);
+      await withSpendAttribution({ articleSlug: slugPart(searches, 1) }, () =>
+        search(slugPart(searches, 1), searchBody, res),
+      );
       return true;
     }
     if (oneRun && req.method === "PATCH") {
@@ -3494,6 +3729,17 @@ async function serveApi(
          nothing here is broken and the client's job is to reload and look
          again. See `ChatConflict` in src/chat.ts. */
       (err instanceof ChatConflict ? 409 : null) ??
+      /* Somebody else's comment already has that id, or that comment already
+         started a different conversation. 409 for the same reason as above:
+         nothing is broken, the client asked for something the stored state will
+         not allow, and reloading is the answer. `CommentIdTaken` in
+         src/comments.ts. */
+      (err instanceof CommentIdTaken ? 409 : null) ??
+      /* Two different failures under one class, and they must not share a code:
+         `missing` is a comment that is not there (404), `free` is a bookmark
+         being pushed down the retired explanation path (409). Guessing one for
+         both would make a deleted comment read as "you cannot answer that". */
+      (err instanceof NotAnExplanation ? (err.why === "missing" ? 404 : 409) : null) ??
       ((err as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500);
     // Handed to `logRequest`, which decides how much of it to write down — the
     // message for a failure this file chose, the whole stack for one it did
diff --git a/src/store/contracts.ts b/src/store/contracts.ts
index a2e6770..df8ccf6 100644
--- a/src/store/contracts.ts
+++ b/src/store/contracts.ts
@@ -39,8 +39,9 @@
  */
 
 import type { AdminUser } from "../admin.js";
+import type { AiCallRow } from "../ai-spend.js";
 import type { LookupsByTerm } from "../glossary-lookups.js";
-import type { NewComment } from "../comments.js";
+import type { AnswerPatch, NewComment } from "../comments.js";
 import type {
   Article,
   ArticleMetadata,
@@ -125,30 +126,52 @@ export interface GlossaryStore {
 }
 
 /**
- * A reader's questions about one article.
+ * A reader's marks on one article — their bookmarks, their notes, and the
+ * explanations the model wrote for them before 2026-08-28.
  *
  * **Anchored to the block identity, never to the current revision's rows.** A
- * re-extraction that drops a paragraph must not destroy the question about it —
+ * re-extraction that drops a paragraph must not destroy the mark on it —
  * `src/web/comment-nav.ts` already sorts such a comment to the end rather than
- * dropping it, because "it is still the reader's question". The Postgres
- * adapter gets this for free from the `comments_identity_fk` foreign key; the
- * filesystem one gets it for free from having no referential integrity at all.
- * Both must behave the same, and there is a test for it.
+ * dropping it, because "it is still the reader's". The Postgres adapter gets
+ * this for free from the `comments_identity_fk` foreign key; the filesystem one
+ * gets it for free from having no referential integrity at all. Both must
+ * behave the same, and there is a test for it.
+ *
+ * ## Four operations, because four fields have four different lifetimes
+ *
+ * There used to be one writer for everything — `create`, which meant both "make
+ * this" and "redo this". That was safe only while making one cost a model call
+ * and the only caller was a retry. Now that a comment is free, a colliding id
+ * is an *ordinary* event rather than a retry, and one reset would silently
+ * overwrite somebody's anchor. So the allowed writes are named:
+ *
+ * | field                                | may be written by      |
+ * |--------------------------------------|------------------------|
+ * | `blockId`, `quote`, `start`, `createdAt` | `create` only       |
+ * | `body`                               | `create`, `patchBody`  |
+ * | `updatedAt`                          | `patchBody`, server-set |
+ * | `threadId`                           | `linkThread`, once, from absent |
+ * | `status`, `answer`, `citations`, `searches`, `model`, `error` | `beginAnswer` and `patch` |
+ *
+ * Every operation writes a **named allowlist**, never a spread of whatever it
+ * was handed. GPT Sol's review of docs/plans/260828a-comments-and-bookmarks.md, which
+ * found that "insert-only" was too blunt a rule to describe three of these.
  */
 export interface CommentStore {
   load(slug: string): Promise<Comment[]>;
 
   /**
-   * Store a comment as `pending`, **before** the model is called, so a crash
-   * leaves a question that never got answered rather than a selection that
-   * quietly evaporated.
+   * Store a **free** comment — the reader's mark on a passage. No model call.
    *
-   * **Idempotent on `input.id`.** The client mints the id so the dialog and
-   * `?note=` have a real one from the first frame; a retry sends the id it
-   * already has, and that must RESET the existing comment rather than append a
-   * second one. A second row would leave the failed original behind, drawing a
-   * second mark over the same words that nothing can clear — and would make a
-   * double-clicked POST a way to spend two model calls and orphan one.
+   * `status: "none"`, which is what keeps it out of `sweepOrphaned`: a bookmark
+   * is not an answer that never arrived.
+   *
+   * **Idempotent on `input.id`, and idempotent means *return the one you have*.**
+   * The client mints the id so the dialog and `?note=` have a real one from the
+   * first frame. Same id with the same anchor and the same body ⇒ the stored
+   * row comes back, which makes a double-clicked Save and a retried POST
+   * harmless. Anything else under that id ⇒ throws `CommentIdTaken`, because
+   * the alternative is overwriting a comment the reader made in another tab.
    *
    * Returns the one comment. `patch` and `remove` return the whole list. That
    * asymmetry is inherited from src/comments.ts rather than tidied: changing it
@@ -157,6 +180,53 @@ export interface CommentStore {
    */
   create(slug: string, input: NewComment): Promise<Comment>;
 
+  /**
+   * Reset a legacy explanation for another attempt at the model call.
+   *
+   * **Takes an id and nothing else.** The anchor comes from the stored row
+   * rather than from the request, which closes the hole where a retry could
+   * quietly move a comment to a different passage. `body`, `updatedAt`,
+   * `threadId`, the anchor and `createdAt` all survive; only the answer fields
+   * go, because they belong to the attempt being replaced.
+   *
+   * Throws `NotAnExplanation` for an unknown id, and for a `none` comment — a
+   * bookmark was never a question, and the retired explanation path must not be
+   * reachable from one.
+   */
+  beginAnswer(slug: string, id: string): Promise<Comment>;
+
+  /**
+   * The reader edited their words. Writes `body` and `updatedAt`, nothing else.
+   *
+   * `null` clears the body, turning a comment back into a bare bookmark. `""`
+   * never reaches here: the route trims once and turns an empty string into
+   * `null`, so "wrote nothing" has one representation across both stores.
+   */
+  patchBody(slug: string, id: string, body: string | null): Promise<Comment>;
+
+  /**
+   * Point a comment at the conversation it started. Compare-and-set from absent.
+   *
+   * A second call with the same thread id is a no-op; a different one throws.
+   * The id must be the one the **server** confirmed — `useChat.send` mints an
+   * optimistic id and may be handed a different one back, and linking the guess
+   * is a link to a thread that does not exist.
+   */
+  linkThread(
+    slug: string,
+    id: string,
+    threadId: string,
+    /**
+     * The passage the conversation is about, which the comment must match.
+     *
+     * `sourceCommentId` arrives on a request, so on its own it names *any*
+     * comment this reader owns on this article. Passing the anchor makes the
+     * link a compare-and-set on the passage as well as on the thread, in one
+     * statement rather than a read-check-write with a gap in it.
+     */
+    expect: { blockId: string; quote: string; start: number },
+  ): Promise<Comment>;
+
   /**
    * Fill in the answer, or the error.
    *
@@ -167,7 +237,7 @@ export interface CommentStore {
   patch(
     slug: string,
     id: string,
-    patch: Partial<Comment>,
+    patch: AnswerPatch,
     opts?: { quiet?: boolean },
   ): Promise<Comment[]>;
 
@@ -657,3 +727,51 @@ export interface AdminStore {
    */
   listUsersAcrossOwners(): Promise<AdminUser[]>;
 }
+
+/* -------------------------------------------------------- the AI ledger -- */
+
+/**
+ * What a read of the ledger came back with — the rows, **and how many lines it
+ * could not read**.
+ *
+ * Two fields rather than one because a total nobody can tell is short is worse
+ * than no total. A truncated JSONL tail or a row that will not parse has to
+ * reach the report rather than quietly reduce it.
+ */
+export interface LedgerRead {
+  rows: AiCallRow[];
+  unreadable: number;
+}
+
+/**
+ * **Every model call this app has paid for.** One row per call, written when the
+ * call finishes and never amended.
+ *
+ * A contract with two implementations for the reason
+ * [ai-calls-fs.ts](ai-calls-fs.ts) gives at length: the default configuration is
+ * `files`, and a cost tracker that records nothing in the default configuration
+ * is the worst property on offer. Neither adapter ever falls back to the other.
+ *
+ * The queries are deliberately thin — read a range, read one job — and every
+ * total is computed in TypeScript on the way out. **One implementation of the
+ * arithmetic**, rather than a `group by` in one store and a `reduce` in the
+ * other quietly disagreeing about what a BYOK call is worth. The table is small
+ * enough that this is not a performance question yet, and
+ * docs/plans/260827q-ai-cost-tracking.md says so out loud so the day it stops being true
+ * is a decision rather than a surprise.
+ */
+export interface CostStore {
+  /** Where the rows are, for `npm run cost` to print. A path, or the table's name. */
+  describe(): string;
+  /** Write one finished call. Called by the spend collector's sink, never directly. */
+  record(row: AiCallRow): Promise<void>;
+  /**
+   * Every call started in `[since, until)`. Both bounds optional, both ISO,
+   * **half-open** — so two adjacent months cannot both claim the same call.
+   */
+  read(since?: string, until?: string): Promise<LedgerRead>;
+  /** Every call made by one pipeline job, across all the advances that ran it. */
+  forJob(jobId: string): Promise<AiCallRow[]>;
+  /** How big the ledger has got, in bytes, or `null` where that is not a question. */
+  size(): Promise<number | null>;
+}
diff --git a/src/store/index.ts b/src/store/index.ts
index f34a9fa..1b24b4d 100644
--- a/src/store/index.ts
+++ b/src/store/index.ts
@@ -331,3 +331,24 @@ const adminOnFiles: AdminStore = {
 
 export const adminStore: AdminStore =
   STORE === "postgres" ? guardDbStore("admin", pgAdminStore) : adminOnFiles;
+
+/* -------------------------------------------------------- the AI ledger -- */
+
+/**
+ * **Every model call this app has paid for**, in whichever store is live.
+ *
+ * Selected and guarded in [ai-calls.ts](ai-calls.ts) rather than here, because
+ * `src/jobs.ts` needs it too and cannot import this file without closing a
+ * cycle — the same reason `live.ts` is its own file. Re-exported so that a route
+ * does not have to know where it lives.
+ *
+ * The one thing worth saying that is not obvious from the line: **this is a
+ * genuine second implementation, not the fallback the header forbids.** Nothing
+ * catches a Postgres error and writes a file instead; the flag chooses at boot
+ * and the other adapter is never consulted. The alternative — always Postgres,
+ * warn and carry on when there is no `DATABASE_URL` — would have made the
+ * **default** configuration the one that records nothing, with a warn line that
+ * becomes background noise inside a week. GPT Sol's call, 2026-08-28; it
+ * reversed docs/plans/260827q-ai-cost-tracking.md's own recommendation.
+ */
+export { costStore } from "./ai-calls.js";
diff --git a/src/toc.ts b/src/toc.ts
index c77b955..b1a5643 100644
--- a/src/toc.ts
+++ b/src/toc.ts
@@ -662,10 +662,7 @@ export async function generateToc(opts: {
       const report = opts.onProgress;
       let chars = 0;
       let last = 0;
-      /* `delta: string` spelled out because `MeteredCall.stream` is typed as
-         `ReturnType<…messages.stream>`, which instantiates that method's generic at
-         its constraint and loses `on`'s per-event listener types. */
-      call.stream.on("text", (delta: string) => {
+      call.onText((delta) => {
         chars += delta.length;
         // Throttled, because the model emits deltas far faster than anyone can
         // read them and every one of these is a write the poller may pick up.
diff --git a/src/tweets.ts b/src/tweets.ts
index f7c73f1..83345e2 100644
--- a/src/tweets.ts
+++ b/src/tweets.ts
@@ -492,10 +492,7 @@ export async function generateTweets(opts: {
       const report = opts.onProgress;
       let chars = 0;
       let last = 0;
-      /* `delta: string` spelled out because `MeteredCall.stream` is typed as
-         `ReturnType<…messages.stream>`, which instantiates that method's generic at
-         its constraint and loses `on`'s per-event listener types. */
-      call.stream.on("text", (delta: string) => {
+      call.onText((delta) => {
         chars += delta.length;
         // Throttled: the model emits deltas far faster than anyone can read them,
         // and every one of these is a write the job poller may pick up.
diff --git a/tests/ai-call.test.ts b/tests/ai-call.test.ts
index 2babb15..dc25714 100644
--- a/tests/ai-call.test.ts
+++ b/tests/ai-call.test.ts
@@ -477,6 +477,61 @@ describe("one record per call, however the call ends", () => {
     expect(report.calls[0]?.outcome).toBe("aborted");
   });
 
+  it("does not call a provider failure a cancel merely because a signal fired", async () => {
+    /* **The distinction the ledger made expensive.** Any error raised while the
+       signal happened to be aborted used to be recorded as `"aborted"` — and a
+       provider dying at the moment a reader presses Stop is not far-fetched, a
+       stall on their side being exactly what makes somebody press it. A cancel
+       is the outcome nobody investigates, so the one event that could explain
+       what went wrong went into the bin marked "the reader did that".
+
+       Aborting rejects with the signal's own reason, so identity is the test.
+       Here the signal is aborted *and* the failure is something else. Raised by
+       a GPT Sol review of the code. */
+    const controller = new AbortController();
+    const { report } = await collectSpend(async () => {
+      stubTransport(() => {
+        controller.abort();
+        throw new Error("the upstream fell over");
+      });
+      await expect(
+        (async () => {
+          for await (const _ of openRouterStream(
+            "chat",
+            { model: "m", messages: [] },
+            { signal: controller.signal, onActivity: noop, end: end() },
+          ))
+            void _;
+        })(),
+      ).rejects.toThrow("the upstream fell over");
+    });
+    expect(report.calls).toHaveLength(1);
+    expect(report.calls[0]?.outcome).toBe("error");
+  });
+
+  it("still calls a real abort a cancel, which is the other half of that", async () => {
+    /* The rule has to keep working in the direction it was already right about,
+       or "never say aborted" would pass the test above. */
+    const controller = new AbortController();
+    const { report } = await collectSpend(async () => {
+      stubTransport(() => {
+        controller.abort();
+        throw controller.signal.reason;
+      });
+      await expect(
+        (async () => {
+          for await (const _ of openRouterStream(
+            "chat",
+            { model: "m", messages: [] },
+            { signal: controller.signal, onActivity: noop, end: end() },
+          ))
+            void _;
+        })(),
+      ).rejects.toThrow();
+    });
+    expect(report.calls[0]?.outcome).toBe("aborted");
+  });
+
   it("records a stream that stopped without saying it had finished as an error", async () => {
     /* `[DONE]` is the only clean end there is, and every caller already treats
        its absence as a failure. Recording it as `"ok"` made the spend row and
diff --git a/tests/ai-spend.test.ts b/tests/ai-spend.test.ts
index f17bb37..599c7d8 100644
--- a/tests/ai-spend.test.ts
+++ b/tests/ai-spend.test.ts
@@ -19,6 +19,8 @@ import {
   beginSpend,
   collectSpend,
   collectingSpend,
+  currentSpend,
+  emptySpend,
   formatNanos,
   recordSpend,
   lateCalls,
@@ -40,10 +42,18 @@ function call(over: Partial<SpendRecord> = {}): SpendRecord {
     generationId: "gen-1787844432-JKwGQebcNXfkCfTX5mUq",
     upstream: "Anthropic",
     isByok: false,
+    credentialFingerprint: "abcdef012345",
+    wire: "messages",
     inputTokens: 13,
     outputTokens: 4,
     cacheReadTokens: 0,
     cacheWriteTokens: 8583,
+    cacheWrite5mTokens: 8583,
+    cacheWrite1hTokens: 0,
+    reasoningTokens: 0,
+    webSearches: null,
+    serviceTier: "standard",
+    inferenceGeo: null,
     ms: 1200,
     outcome: "ok",
     ...over,
@@ -107,8 +117,10 @@ describe("collectSpend", () => {
           recordSpend(call({ outcome: "error", costNanos: 4_200_000 }));
           throw new Error("stage blew up");
         },
-        (r) => {
-          seen.push(r);
+        {
+          onDone: (r) => {
+            seen.push(r);
+          },
         },
       ),
     ).rejects.toThrow("stage blew up");
@@ -127,8 +139,10 @@ describe("collectSpend", () => {
       async () => {
         recordSpend(call({ job: "arc" }));
       },
-      (r) => {
-        seen.push(r);
+      {
+        onDone: (r) => {
+          seen.push(r);
+        },
       },
     );
     expect(seen).toHaveLength(1);
@@ -274,7 +288,7 @@ describe("totalSpend", () => {
 
 describe("spendFields", () => {
   it("says nothing at all about a piece of work that called no model", () => {
-    expect(spendFields({ calls: [], pending: [] })).toEqual({});
+    expect(spendFields(emptySpend())).toEqual({});
   });
 
   it("still writes a line when a call went missing and none completed", () => {
@@ -283,8 +297,8 @@ describe("spendFields", () => {
        request ends in — so the one symptom was hidden by the guard written for
        the ordinary case. Raised by a GPT Sol review. */
     const fields = spendFields({
-      calls: [],
-      pending: [{ job: "chat", model: "m", startedAt: 0 }],
+      ...emptySpend(),
+      pending: [{ job: "chat", model: "m", startedAt: 0, rowId: "r1" }],
     });
     expect(fields.aiPending).toBe(1);
     expect(fields.aiPendingJobs).toBe("chat");
@@ -292,8 +306,9 @@ describe("spendFields", () => {
 
   it("names the two problems separately, because they are two problems", () => {
     const fields = spendFields({
+      ...emptySpend(),
       calls: [call({ costNanos: 100 }), call({ costNanos: null })],
-      pending: [{ job: "search", model: "m", startedAt: 0 }],
+      pending: [{ job: "search", model: "m", startedAt: 0, rowId: "r1" }],
     });
     expect(fields.aiCalls).toBe(2);
     expect(fields.aiUnpriced).toBe(1);
@@ -302,7 +317,7 @@ describe("spendFields", () => {
   });
 
   it("leaves the two out when there is nothing to say", () => {
-    const fields = spendFields({ calls: [call()], pending: [] });
+    const fields = spendFields({ ...emptySpend(), calls: [call()] });
     expect(fields).not.toHaveProperty("aiUnpriced");
     expect(fields).not.toHaveProperty("aiPending");
   });
@@ -313,4 +328,312 @@ describe("formatNanos", () => {
     expect(formatNanos(21_523_500)).toBe("$0.0215");
     expect(formatNanos(0)).toBe("$0.0000");
   });
+
+  it("does not round a real cost down to nothing", () => {
+    /* One query embedding is about $0.00000018 — which is the reason the column
+       counts in nano-dollars, and which four decimals would print as `$0.0000`.
+       Putting the lie back at the last step is worse than never having avoided
+       it, because by then there is a correct number in the database to disagree
+       with. Caught on a live probe. */
+    expect(formatNanos(180)).toBe("$0.00000018");
+    expect(formatNanos(180)).not.toBe("$0.0000");
+    /* And a real zero stays short: a free call and a very cheap one are
+       different things, and only one of them wants eight decimals. */
+    expect(formatNanos(0)).toBe("$0.0000");
+  });
 });
+
+/* ==================================================== the write to the ledger ==
+   Everything above tests what the collector *reports*. These test what it
+   *keeps*, which is a different question and the one a bill is made of. */
+
+import { environmentOwnerId, runAsOwner, runInRequest, setRequestOwner } from "../src/owner.js";
+import { type AiCallRow, withSpendAttribution } from "../src/ai-spend.js";
+
+/** Record one call inside a collector with a capturing sink, and hand back the rows. */
+async function rowsFrom(
+  options: Parameters<typeof collectSpend>[1] = {},
+  body: () => void = () => {
+    const id = beginSpend("toc", "anthropic/claude-sonnet-5");
+    recordSpend(call(), id);
+  },
+): Promise<AiCallRow[]> {
+  const rows: AiCallRow[] = [];
+  await collectSpend(
+    async () => {
+      body();
+    },
+    {
+      ...options,
+      sink: async (row) => {
+        rows.push(row);
+      },
+    },
+  );
+  return rows;
+}
+
+describe("the sink", () => {
+  it("gets one row per recorded call, with the collector's attribution on it", async () => {
+    const rows = await rowsFrom({
+      attribution: {
+        scopeKind: "job_step",
+        ownerId: "00000000-0000-4000-8000-00000000ac02",
+        articleSlug: "some-article",
+        jobId: "job-7",
+        stepName: "toc",
+      },
+    });
+    expect(rows).toHaveLength(1);
+    expect(rows[0]?.scopeKind).toBe("job_step");
+    expect(rows[0]?.articleSlug).toBe("some-article");
+    expect(rows[0]?.jobId).toBe("job-7");
+    expect(rows[0]?.stepName).toBe("toc");
+    expect(rows[0]?.job).toBe("toc");
+    expect(rows[0]?.creditsUsedNanos).toBe(21_523_500);
+    /* Named `credits`, not `cost`. The rename is the decision — see
+       docs/plans/260827q-ai-cost-tracking.md Q5 — and a test that only checked the
+       number would let it drift back to a name that promises cash. */
+    expect("creditsUsedNanos" in (rows[0] ?? {})).toBe(true);
+  });
+
+  it("uses the id minted before the call, not one invented at the end", async () => {
+    /* The point of minting early is that a call which never returns still has a
+       name. Nothing asserts that directly — there is no row for it — so what is
+       checked is that the id on the row is the one `beginSpend` reserved. */
+    const rows: AiCallRow[] = [];
+    let pendingId: string | undefined;
+    await collectSpend(
+      async () => {
+        const id = beginSpend("toc", "anthropic/claude-sonnet-5");
+        pendingId = currentSpend()?.pending[0]?.rowId;
+        recordSpend(call(), id);
+      },
+      {
+        attribution: { scopeKind: "cli", ownerId: environmentOwnerId() },
+        sink: async (row) => {
+          rows.push(row);
+        },
+      },
+    );
+    expect(pendingId).toBeTruthy();
+    expect(rows[0]?.id).toBe(pendingId);
+  });
+
+  it("is awaited before collectSpend returns, because Vercel freezes the process", async () => {
+    /* **The failure this prevents is invisible on a laptop.** An un-awaited
+       insert finishes fine here and never runs on a serverless function, whose
+       instance can be frozen the moment the response goes out — so the rows
+       that go missing are exactly the request-path ones. */
+    let settled = false;
+    await collectSpend(
+      async () => {
+        const id = beginSpend("toc", "m");
+        recordSpend(call(), id);
+      },
+      {
+        attribution: { scopeKind: "request", ownerId: environmentOwnerId() },
+        sink: async () => {
+          await new Promise((r) => setTimeout(r, 20));
+          settled = true;
+        },
+      },
+    );
+    expect(settled).toBe(true);
+  });
+
+  it("does not let a failing sink fail the work — a metrics write is not the feature", async () => {
+    const { result } = await collectSpend(
+      async () => {
+        const id = beginSpend("toc", "m");
+        recordSpend(call(), id);
+        return "the answer";
+      },
+      {
+        attribution: { scopeKind: "cli", ownerId: environmentOwnerId() },
+        sink: async () => {
+          throw new Error("the database is on fire");
+        },
+      },
+    );
+    expect(result).toBe("the answer");
+  });
+
+  it("writes nothing for a call that finished after its collector reported", async () => {
+    /* A late call is already counted and logged. Writing it would be worse than
+       dropping it: the row would land under a run that had already reported a
+       total without it, so two records of the same work would disagree. */
+    const rows: AiCallRow[] = [];
+    let release: (() => void) | undefined;
+    const gate = new Promise<void>((r) => {
+      release = r;
+    });
+    /* **A continuation started inside the scope, not a callback invoked from
+       outside it.** That distinction is the test: a function called after
+       `collectSpend` returns runs with no scope at all and is counted as
+       *unscoped*, which is a different bug. `gate.then` captures the context, so
+       what arrives here is genuinely a call that finished late. */
+    let finishing: Promise<void> | undefined;
+    await collectSpend(
+      async () => {
+        const id = beginSpend("toc", "m");
+        finishing = gate.then(() => {
+          recordSpend(call(), id);
+        });
+      },
+      {
+        attribution: { scopeKind: "cli", ownerId: environmentOwnerId() },
+        sink: async (row) => {
+          rows.push(row);
+        },
+      },
+    );
+    release?.();
+    await finishing;
+    expect(rows).toEqual([]);
+    expect(lateCalls()).toBe(1);
+  });
+
+  it("writes no row when there is no owner to bill", async () => {
+    /* `owner_id` is `not null` and `on delete restrict`, so there is no honest
+       row for a call whose owner cannot be named. A request that reached a model
+       before it was authenticated is the shape that gets here. */
+    const rows: AiCallRow[] = [];
+    await runInRequest(() =>
+      collectSpend(
+        async () => {
+          const id = beginSpend("chat", "m");
+          recordSpend(call({ job: "chat" }), id);
+        },
+        {
+          attribution: { scopeKind: "request" },
+          sink: async (row) => {
+            rows.push(row);
+          },
+        },
+      ),
+    );
+    expect(rows).toEqual([]);
+  });
+
+  it("takes the owner from the request when the collector opened before the gate ran", async () => {
+    /* `handleApi` opens the collector outside the gate, deliberately — so at
+       that instant nobody knows who is asking, and the owner has to be resolved
+       when the call is recorded rather than when the box was opened. */
+    const rows: AiCallRow[] = [];
+    const alice = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
+    await runInRequest(() =>
+      collectSpend(
+        async () => {
+          setRequestOwner(alice as ReturnType<typeof environmentOwnerId>);
+          const id = beginSpend("chat", "m");
+          recordSpend(call({ job: "chat" }), id);
+        },
+        {
+          attribution: { scopeKind: "request" },
+          sink: async (row) => {
+            rows.push(row);
+          },
+        },
+      ),
+    );
+    expect(rows[0]?.ownerId).toBe(alice);
+  });
+});
+
+describe("withSpendAttribution", () => {
+  it("adds the article without starting a second collector", async () => {
+    /* A nested `collectSpend` would hide these calls from the outer one, and the
+       request's own log line would then report a cost of zero for a request that
+       spent money. Same box, different view of it. */
+    const rows: AiCallRow[] = [];
+    const { report } = await collectSpend(
+      async () => {
+        await withSpendAttribution({ articleSlug: "on-writing" }, async () => {
+          const id = beginSpend("chat", "m");
+          recordSpend(call({ job: "chat" }), id);
+        });
+      },
+      {
+        attribution: { scopeKind: "request", ownerId: environmentOwnerId() },
+        sink: async (row) => {
+          rows.push(row);
+        },
+      },
+    );
+    expect(rows[0]?.articleSlug).toBe("on-writing");
+    expect(rows[0]?.scopeKind).toBe("request");
+    /* The outer report sees it too — which is the half a nested collector loses. */
+    expect(report.calls).toHaveLength(1);
+  });
+
+  it("does not leak the article to a sibling branch", async () => {
+    const rows: AiCallRow[] = [];
+    await collectSpend(
+      async () => {
+        await withSpendAttribution({ articleSlug: "one" }, async () => {
+          recordSpend(call({ job: "chat" }), beginSpend("chat", "m"));
+        });
+        recordSpend(call({ job: "dictation" }), beginSpend("dictation", "m"));
+      },
+      {
+        attribution: { scopeKind: "request", ownerId: environmentOwnerId() },
+        sink: async (row) => {
+          rows.push(row);
+        },
+      },
+    );
+    expect(rows.map((r) => r.articleSlug)).toEqual(["one", null]);
+  });
+
+  it("is a no-op outside a collector, like everything else here", async () => {
+    let ran = false;
+    withSpendAttribution({ articleSlug: "x" }, () => {
+      ran = true;
+    });
+    expect(ran).toBe(true);
+  });
+});
+
+describe("a run id", () => {
+  it("is on the report and on every row it produced, so the two can be joined", async () => {
+    const rows: AiCallRow[] = [];
+    const { report } = await collectSpend(
+      async () => {
+        recordSpend(call(), beginSpend("toc", "m"));
+        recordSpend(call({ job: "arc" }), beginSpend("arc", "m"));
+      },
+      {
+        attribution: { scopeKind: "cli", ownerId: environmentOwnerId() },
+        sink: async (row) => {
+          rows.push(row);
+        },
+      },
+    );
+    expect(report.runId).toBeTruthy();
+    expect(rows.map((r) => r.runId)).toEqual([report.runId, report.runId]);
+    expect(spendFields(report).aiRunId).toBe(report.runId);
+  });
+
+  it("is different for two pieces of work, so their rows do not merge", async () => {
+    const one = await rowsFrom({ attribution: { scopeKind: "cli", ownerId: environmentOwnerId() } });
+    const two = await rowsFrom({ attribution: { scopeKind: "cli", ownerId: environmentOwnerId() } });
+    expect(one[0]?.runId).not.toBe(two[0]?.runId);
+  });
+});
+
+describe("keyFingerprint", () => {
+  it("names a key without carrying it", async () => {
+    const { keyFingerprint } = await import("../src/ai-spend.js");
+    const fp = keyFingerprint("sk-or-v1-something-secret");
+    expect(fp).toHaveLength(12);
+    expect(fp).toMatch(/^[0-9a-f]{12}$/);
+    expect("sk-or-v1-something-secret").not.toContain(fp);
+    /* Two keys, two names — otherwise the per-key reconciliation is meaningless. */
+    expect(keyFingerprint("sk-or-v1-another")).not.toBe(fp);
+  });
+});
+
+/* `runAsOwner` is imported so a reader can see the pipeline's case is covered
+   by `attribution.ownerId` rather than by ambient state. */
+void runAsOwner;
diff --git a/tests/messages-stream.test.ts b/tests/messages-stream.test.ts
index c76bd54..6ce802a 100644
--- a/tests/messages-stream.test.ts
+++ b/tests/messages-stream.test.ts
@@ -20,23 +20,10 @@ import {
   MESSAGES_BASE_URL,
   MESSAGES_PROVIDER,
   messagesClient,
-  meterStream,
   streamMessage,
   wasRefused,
 } from "../src/messages-stream.js";
 
-/**
- * The smallest thing `meterStream` accepts: it subscribes to `"streamEvent"`
- * and nothing else. `emit` plays events at it in order.
- */
-function fakeStream() {
-  const listeners: ((event: unknown) => void)[] = [];
-  return {
-    stream: { on: (name: string, cb: (event: unknown) => void) => { if (name === "streamEvent") listeners.push(cb); } },
-    emit: (event: unknown) => { for (const cb of listeners) cb(event); },
-  };
-}
-
 /* Captured from a live streamed call through https://openrouter.ai/api/v1/messages,
    2026-08-27. Trimmed only of the content blocks. */
 const MESSAGE_START = {
@@ -71,63 +58,6 @@ const MESSAGE_DELTA = {
   },
 };
 
-/** `meterStream` types its argument as the SDK's stream; the fake is structurally enough. */
-// biome-ignore lint/suspicious/noExplicitAny: the fake implements only the one method under test
-const meter = (s: { on: (n: string, cb: (e: unknown) => void) => void }) => meterStream(s as any);
-
-describe("meterStream", () => {
-  it("takes the cost off the wire, where finalMessage() would have dropped it", () => {
-    const f = fakeStream();
-    const m = meter(f.stream);
-    f.emit(MESSAGE_START);
-    f.emit(MESSAGE_DELTA);
-    expect(m.costUsd).toBe(0.0215235);
-    /* Nano-dollars, per src/pricing.ts — an integer, so no float drift in a sum. */
-    expect(m.costNanos).toBe(21_523_500);
-  });
-
-  it("records which upstream answered, and the id to look the call up by later", () => {
-    const f = fakeStream();
-    const m = meter(f.stream);
-    f.emit(MESSAGE_START);
-    expect(m.upstream).toBe("Claude Platform on AWS");
-    expect(m.generationId).toBe("gen-1787844432-JKwGQebcNXfkCfTX5mUq");
-  });
-
-  /* ------------------------------------------------------------------ the point */
-
-  it("leaves cost NULL, not zero, when the field stops arriving", () => {
-    const f = fakeStream();
-    const m = meter(f.stream);
-    f.emit(MESSAGE_START);
-    const { cost: _dropped, ...usageWithoutCost } = MESSAGE_DELTA.usage;
-    f.emit({ ...MESSAGE_DELTA, usage: usageWithoutCost });
-
-    /* `null` is a thing a report can count and complain about. `0` is
-       indistinguishable from a free call, and would understate the bill for as
-       long as nobody happened to look. */
-    expect(m.costNanos).toBeNull();
-    expect(m.costUsd).toBeNull();
-    expect(m.costNanos).not.toBe(0);
-  });
-
-  it("refuses a cost that is not a finite number rather than coercing it", () => {
-    for (const bad of [null, "0.02", undefined, Number.NaN, -1]) {
-      const f = fakeStream();
-      const m = meter(f.stream);
-      f.emit({ ...MESSAGE_DELTA, usage: { ...MESSAGE_DELTA.usage, cost: bad } });
-      expect(m.costNanos, `cost: ${String(bad)}`).toBeNull();
-    }
-  });
-
-  it("is null before the delta arrives, so reading it early cannot look like a free call", () => {
-    const f = fakeStream();
-    const m = meter(f.stream);
-    f.emit(MESSAGE_START);
-    expect(m.costNanos).toBeNull();
-  });
-});
-
 describe("MESSAGES_PROVIDER", () => {
   /* These three are pinned because each one fails *silently* if it changes —
      see the header of src/messages-stream.ts. A diff that flips one should have
@@ -237,11 +167,24 @@ function stubTransport(body: string | { fail: true }) {
 }
 
 const A_BODY = {
-  model: "anthropic/claude-sonnet-5",
   max_tokens: 16,
   messages: [{ role: "user" as const, content: "irrelevant" }],
 };
 
+/** Drive one whole call and hand back the single row it recorded. */
+async function recordOne(usage: Record<string, unknown> = {}) {
+  const t = stubTransport(cannedStream(usage));
+  try {
+    const { report } = await collectSpend(async () => {
+      await streamMessage("toc", A_BODY).finalMessage();
+    });
+    expect(report.calls).toHaveLength(1);
+    return report.calls[0]!;
+  } finally {
+    t.restore();
+  }
+}
+
 describe("streamMessage — the recording lifecycle", () => {
   const savedKey = process.env.OPENROUTER_API_KEY;
   beforeEach(() => { process.env.OPENROUTER_API_KEY = "sk-or-test-not-a-real-key"; });
@@ -316,24 +259,84 @@ describe("streamMessage — the recording lifecycle", () => {
     }
   });
 
-  it("lets a caller override the provider, so the injection is not a wall", async () => {
+  it("overrides a caller's provider and model rather than honouring them", async () => {
+    /* **This test used to assert the opposite** — that an override worked, "so
+       the injection is not a wall". A GPT Sol review pointed out what that
+       allowed once the numbers reached a ledger: a caller could drop the cache
+       pin, which does not fail, it just costs several times more, and could send
+       a model the row would then misattribute the money to.
+
+       Both fields are typed `never` now, so this is a cast rather than something
+       anybody could write by accident — and the cast is exactly the shape of a
+       body assembled at run time out of something the type system never saw,
+       which is what the overwrite-after-spread is for. */
     const t = stubTransport(cannedStream());
     try {
       await streamMessage("toc", {
         ...A_BODY,
-        /* The shape is `typeof MESSAGES_PROVIDER`, whose `order` is a readonly
-           tuple of literals — so an override has to be cast rather than merely
-           written. That the type is this tight is the point: it is what stops a
-           typo'd provider key compiling. */
-        provider: { order: ["something-else"], allow_fallbacks: false, require_parameters: true } as unknown as typeof MESSAGES_PROVIDER,
-      }).finalMessage();
-      const sentProvider = t.seenRequests[0]?.body.provider as { order?: string[] } | undefined;
-      expect(sentProvider?.order).toEqual(["something-else"]);
+        provider: { order: ["something-else"] },
+        model: "openai/gpt-4o",
+      } as unknown as typeof A_BODY).finalMessage();
+      const sent = t.seenRequests[0]?.body;
+      expect((sent?.provider as { order?: string[] })?.order).toEqual(["anthropic"]);
+      expect(sent?.model).toBe(modelFor("toc"));
     } finally {
       t.restore();
     }
   });
 
+  /* ============================================ what came off the wire ====
+     These used to drive `meterStream` directly, which is private now — a caller
+     holding a meter is a caller that can decline to finish it, and that mattered
+     more once the numbers became rows. They assert the same facts through the
+     only door there is. */
+
+  it("takes the cost off the wire, where finalMessage() would have dropped it", async () => {
+    const row = await recordOne();
+    /* Nano-dollars, per src/pricing.ts — an integer, so no float drift in a sum. */
+    expect(row.costNanos).toBe(21_523_500);
+    expect(row.upstreamCostNanos).toBe(21_523_500);
+    expect(row.isByok).toBe(false);
+  });
+
+  it("leaves cost NULL, not zero, when the field stops arriving", async () => {
+    /* **The one assertion this file is really for.** A dropped `cost` produces a
+       perfectly good article, a perfectly good log line, and a cost column that
+       quietly reads as free. `null` is a thing a report can count and complain
+       about; `0` is indistinguishable from a free call. */
+    const row = await recordOne({ cost: undefined, cost_details: undefined });
+    expect(row.costNanos).toBeNull();
+    expect(row.costNanos).not.toBe(0);
+  });
+
+  it("refuses a cost that is not a finite number rather than coercing it", async () => {
+    for (const bad of [null, "0.02", Number.NaN, -1]) {
+      const row = await recordOne({ cost: bad, cost_details: undefined });
+      expect(row.costNanos, `cost: ${String(bad)}`).toBeNull();
+    }
+  });
+
+  it("keeps the pricing inputs a token count cannot supply", async () => {
+    /* Each of these changes what a call is *worth* rather than what it did: the
+       two cache TTLs are priced at 1.25x and 2x, batch is half price, and a US
+       geo is a documented 1.1x. A ledger without them can record the tokens
+       exactly and still be unable to say whether its own total is right. */
+    const row = await recordOne();
+    expect(row.cacheWrite5mTokens).toBe(8583);
+    expect(row.cacheWrite1hTokens).toBe(0);
+    expect(row.serviceTier).toBe("standard");
+    expect(row.reasoningTokens).toBe(0);
+    expect(row.wire).toBe("messages");
+  });
+
+  it("names the key that paid, and never carries it", async () => {
+    const row = await recordOne();
+    const { keyFingerprint } = await import("../src/ai-spend.js");
+    expect(row.credentialFingerprint).toBe(keyFingerprint("sk-or-test-not-a-real-key"));
+    expect(row.credentialFingerprint).not.toContain("sk-or");
+    expect(row.credentialFingerprint).toHaveLength(12);
+  });
+
   it("records once, not twice, when finalMessage is awaited again", async () => {
     /* `finalMessage()` is idempotent on the SDK's side, so awaiting it twice is
        legal — and used to append a second row. Double-counting is worse than
diff --git a/tests/request-spend.test.ts b/tests/request-spend.test.ts
index 7873704..60ba605 100644
--- a/tests/request-spend.test.ts
+++ b/tests/request-spend.test.ts
@@ -30,6 +30,8 @@
  * it is worth writing down.
  */
 import { spawnSync } from "node:child_process";
+import { readFileSync, rmSync } from "node:fs";
+import { tmpdir } from "node:os";
 import path from "node:path";
 import { fileURLToPath } from "node:url";
 import { beforeAll, describe, expect, it } from "vitest";
@@ -46,6 +48,7 @@ const AUDIO = `${"A".repeat(3000)}AA==`;
 const COST = 0.000123;
 
 let stdout = "";
+let ledger = "";
 let stderr = "";
 
 beforeAll(() => {
@@ -123,12 +126,19 @@ beforeAll(() => {
     await request({ audio: "not base64!" });
   })();`;
 
+  /* A path per run, removed below — so nothing accumulates and two runs cannot
+     read each other's rows. */
+  const ledgerPath = path.join(tmpdir(), `spya-ledger-${process.pid}-${Date.now()}.jsonl`);
   const env: NodeJS.ProcessEnv = { ...process.env };
   /* Neither the suite's LOG_LEVEL nor NODE_ENV=test may decide what this
      measures: "test" makes the logger silent, and every assertion below would
      then be satisfied by a child that printed nothing. */
   delete env.LOG_LEVEL;
   env.NODE_ENV = "development";
+  /* And the ledger goes somewhere disposable. `NODE_ENV=development` is what
+     makes the logger speak, and it is also what would send four fixture requests
+     into the developer's own `data/_ai-calls.jsonl` — src/store/ai-calls-fs.ts. */
+  env.SPIDERYARN_LEDGER = ledgerPath;
   /* The gateway refuses without a key, and that refusal would look exactly like
      the failure under test. Nothing is sent anywhere — `fetch` is replaced. */
   env.OPENROUTER_API_KEY = "test-key-not-a-real-one";
@@ -140,8 +150,55 @@ beforeAll(() => {
   });
   stdout = child.stdout ?? "";
   stderr = child.stderr ?? "";
+  ledger = readFileSync(ledgerPath, "utf8");
+  rmSync(ledgerPath, { force: true });
 }, 120_000);
 
+/** The rows the child's requests actually left behind. */
+function ledgerRows(): Record<string, unknown>[] {
+  return ledger
+    .split("\n")
+    .filter((l) => l.trim() !== "")
+    .map((l) => JSON.parse(l) as Record<string, unknown>);
+}
+
+describe("the ledger a request leaves behind", () => {
+  it("has a row per call, written before the request finished", () => {
+    /* **The end-to-end half.** Everything else in this file reads a log line,
+       which is a summary the same process wrote from memory. This reads a file
+       that a different process left on disk, so the sink, the attribution and
+       the write are all exercised rather than described.
+
+       **It does not prove the write was awaited**, and it was written claiming
+       to. Removing the `await` in `collectSpend` leaves this green: Node drains
+       pending I/O before exiting, so a floating append still lands. The thing
+       that would not land is a Vercel freeze, which a child process cannot
+       simulate. The ordering is pinned one level down, in
+       tests/ai-spend.test.ts, where a slow sink is checked to have finished
+       before `collectSpend` returned — and that one does go red. Found by
+       mutating the code and watching this test not notice. */
+    const rows = ledgerRows();
+    expect(rows).toHaveLength(3);
+    expect(rows.every((r) => r.scopeKind === "request")).toBe(true);
+    expect(rows.every((r) => r.job === "dictation")).toBe(true);
+    expect(rows.every((r) => r.wire === "chat")).toBe(true);
+  });
+
+  it("names an owner on every row, because the column cannot be null", () => {
+    /* The collector opens *outside* the gate that fills the owner box, so the
+       owner has to be resolved when the call is recorded rather than when the
+       box was opened. If that ever regresses, these rows do not exist at all —
+       which is why the count above is asserted too. */
+    for (const r of ledgerRows()) expect(typeof r.ownerId).toBe("string");
+  });
+
+  it("gives the three requests three different run ids", () => {
+    /* One collector per request. If `handleApi` ever opened one per process,
+       every reader's spend would land under whoever's request came first. */
+    expect(new Set(ledgerRows().map((r) => r.runId)).size).toBe(3);
+  });
+});
+
 /** The child's `http` lines, in the order they were written. */
 function httpLines(): Record<string, unknown>[] {
   const found = stdout
diff --git a/tests/stop-details.test.ts b/tests/stop-details.test.ts
index a45f206..61ffcb5 100644
--- a/tests/stop-details.test.ts
+++ b/tests/stop-details.test.ts
@@ -197,6 +197,7 @@ beforeAll(async () => {
     const { generateSummaries } = await import(${src("summarise.ts")});
     const { generateLabels } = await import(${src("labels.ts")});
     const { default: Anthropic } = await import("@anthropic-ai/sdk");
+    const { collectSpend } = await import(${src("ai-spend.ts")});
 
     const fs = await import("node:fs/promises");
     const nodePath = await import("node:path");
@@ -209,7 +210,11 @@ beforeAll(async () => {
     const step = async (name, run) => {
       sentinel = LEAK[name];
       try {
-        await run();
+        /* Inside a spend collector, because src/jobs.ts runs every step inside
+           one — and a model call made outside one now says so on its own warn
+           line, which would be six extra lines here and a failed count. Opening
+           it makes the simulation truer as well as quieter. */
+        await collectSpend(() => run());
         jobs.info({ step: name }, "step did not fail: " + name);
       } catch (err) {
         jobs.error({ ...errorFields(err), step: name }, "step failed: " + name);

=== new files ===
--- src/store/ai-calls.ts ---
/**
 * Which ledger is live — the one place that decides, and a **leaf**.
 *
 * Its own file rather than a line in [index.ts](index.ts), for the reason
 * [live.ts](live.ts) gives about itself: `index.ts` imports [fs.ts](fs.ts),
 * which imports `src/chat.ts` and `src/searches.ts`, so anything the *pipeline*
 * needs cannot come from there without closing an import cycle — and
 * `src/jobs.ts` needs this, because a pipeline step is where most of the money
 * goes. `npm run cycles` is a gate rather than advice, so that would be a red
 * build.
 *
 * `index.ts` re-exports it, so a route does not have to know it moved house.
 *
 * **Not a fallback.** The flag picks one adapter at boot and the other is never
 * consulted — see [ai-calls-fs.ts](ai-calls-fs.ts) for why there is a
 * filesystem one at all, given that `files` is the default and a cost tracker
 * that records nothing by default is worse than none.
 */

import type { AiCallRow } from "../ai-spend.js";
import { fsCostStore } from "./ai-calls-fs.js";
import { pgCostStore } from "./ai-calls-pg.js";
import type { CostStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { STORE } from "./live.js";

/**
 * Guarded on the Postgres side only, like `guarded()` in `index.ts` and for the
 * same reason: a failed Drizzle query puts every bound parameter into
 * `Error.message`, and the filesystem one binds nothing.
 */
export const costStore: CostStore =
  STORE === "postgres" ? guardDbStore("ai-calls", pgCostStore) : fsCostStore;

/**
 * **What a set of ledger rows cost**, and the three ways the answer can be
 * short. One implementation, so the two stores cannot disagree.
 *
 * `credits` and `upstream` are two different pockets and are kept apart: under
 * BYOK OpenRouter's charge is legitimately zero while the inference was billed
 * to somebody else's key, so a report that adds them into one number cannot say
 * what it is a number *of*. `unpriced` is the count of calls that reported no
 * money at all — the total is short by an unknown amount, which is a different
 * statement from "it cost nothing".
 */
export function totalRows(rows: readonly AiCallRow[]): {
  credits: number;
  upstream: number;
  unpriced: number;
} {
  let credits = 0;
  let upstream = 0;
  let unpriced = 0;
  for (const r of rows) {
    if (r.isByok === true) {
      if (r.upstreamInferenceNanos === null) unpriced += 1;
      else upstream += r.upstreamInferenceNanos;
      credits += r.creditsUsedNanos ?? 0;
      continue;
    }
    if (r.creditsUsedNanos === null) unpriced += 1;
    else credits += r.creditsUsedNanos;
  }
  return { credits, upstream, unpriced };
}

--- src/store/ai-calls-fs.ts ---
/**
 * The ledger as a file — one JSON object per line, appended and never rewritten.
 *
 * ## Why this exists at all, given the no-fallback rule
 *
 * [`index.ts`](index.ts) forbids catching a Postgres error and retrying against
 * the filesystem, because two stores that disagree is the divergence a parity
 * test cannot see. **This is not that.** Nothing here is a fallback: the flag
 * chooses one adapter at boot and the other is never consulted.
 *
 * The alternative considered and rejected was *always Postgres, warn and carry
 * on when there is no `DATABASE_URL`* — which sounds harmless and makes the
 * **default** configuration the untracked one. Every local run, every CLI stage,
 * every eval would spend real money and write a warn line that becomes
 * background noise within a week. GPT Sol's call, 2026-08-28, and it changed the
 * plan's own recommendation.
 *
 * ## Append-only, and why that is enough
 *
 * A finished call is a fact about the past. Nothing amends a row, so there is no
 * read-modify-write and no lock: `appendFile` with a single `write()` of a line
 * under the pipe buffer is atomic enough for concurrent writers on one machine,
 * which is the only place `files` mode ever runs — production refuses it
 * outright ([index.ts](index.ts)).
 *
 * A malformed line is skipped on read rather than thrown, and **counted**, so a
 * truncated tail cannot make the whole ledger unreadable and cannot go
 * unmentioned either. `npm run cost` prints the count.
 */

import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { AiCallRow } from "../ai-spend.js";
import type { CostStore, LedgerRead } from "./contracts.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * Underscore-prefixed like `data/_jobs/`, so it can never collide with a slug.
 *
 * **A different file under test, and that is not tidiness.** Several suites
 * drive real requests through `handleApi`, which opens a collector with this
 * store behind it — so a full `npm test` wrote four hundred fixture calls into
 * the developer's own ledger, and `npm run cost` then reported eleven hundredths
 * of a cent that nobody had spent. Caught by running the report after the suite.
 * A ledger a test can write to is a ledger nobody can trust.
 */
const LEDGER =
  process.env.SPIDERYARN_LEDGER ??
  path.join(
    ROOT,
    "data",
    process.env.NODE_ENV === "test" ? "_ai-calls.test.jsonl" : "_ai-calls.jsonl",
  );

export const fsCostStore: CostStore = {
  describe: () => LEDGER,

  async record(row: AiCallRow): Promise<void> {
    await mkdir(path.dirname(LEDGER), { recursive: true });
    await appendFile(LEDGER, `${JSON.stringify(row)}\n`, "utf8");
  },

  async read(since?: string, until?: string): Promise<LedgerRead> {
    let text: string;
    try {
      text = await readFile(LEDGER, "utf8");
    } catch (err) {
      /* No file yet is no spend yet, which is an answer rather than a failure —
         a fresh checkout has to be able to run the report. Any other error is
         real and is not swallowed. */
      if ((err as NodeJS.ErrnoException).code === "ENOENT")
        return { rows: [], unreadable: 0 };
      throw err;
    }
    const rows: AiCallRow[] = [];
    let unreadable = 0;
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let row: AiCallRow;
      try {
        row = JSON.parse(line) as AiCallRow;
      } catch {
        unreadable += 1;
        continue;
      }
      if (since && row.startedAt < since) continue;
      /* Half-open, like every range in this ledger: `until` is the first instant
         *not* included, so two adjacent months cannot both claim a call. */
      if (until && row.startedAt >= until) continue;
      rows.push(row);
    }
    return { rows, unreadable };
  },

  async forJob(jobId: string): Promise<AiCallRow[]> {
    const { rows } = await this.read();
    return rows.filter((r) => r.jobId === jobId);
  },

  async size(): Promise<number | null> {
    try {
      return (await stat(LEDGER)).size;
    } catch {
      return null;
    }
  },
};

--- src/store/ai-calls-pg.ts ---
/**
 * The ledger in Postgres — one row per model call, inserted and never amended.
 *
 * The filesystem half is [ai-calls-fs.ts](ai-calls-fs.ts), and it is a genuine
 * second implementation rather than a fallback: the store flag picks one at
 * boot and the other is never consulted. [index.ts](index.ts) explains why that
 * distinction matters everywhere else in this directory.
 *
 * ## What may be logged from this file
 *
 * Ids, models, counts, money. **Nothing else, ever** — and there is very little
 * here that could go wrong that way, because the row carries no prose: no
 * prompt, no answer, no article text, and deliberately no raw response. That is
 * a schema decision rather than a discipline one, which is the stronger kind.
 * See `aiCalls` in [../db/schema.ts](../db/schema.ts).
 *
 * The insert still goes through `guardDbStore` like every other store here, for
 * the reason [db-errors.ts](db-errors.ts) gives: a failed Drizzle query puts
 * every bound parameter into `Error.message`, and a slug and an owner id are
 * bound parameters.
 */

import { and, asc, eq, gte, lt } from "drizzle-orm";

import type { AiCallRow } from "../ai-spend.js";
import { getDb } from "../db/client.js";
import { aiCalls, articles } from "../db/schema.js";
import type { CostStore, LedgerRead } from "./contracts.js";
import { ownedSlug } from "./pg.js";

type Row = typeof aiCalls.$inferSelect;

/**
 * The article's uuid for a slug, or `null`.
 *
 * **Never throws, and that is the point.** This runs on the accounting path,
 * after a model call the reader is waiting on has already returned. A slug that
 * no longer resolves — a deleted article, a race, a scope with nobody
 * authenticated — must cost the row its `article_id` and nothing else:
 * `article_slug` is still written, and it is the historical fact anyway.
 */
async function articleIdFor(slug: string): Promise<string | null> {
  try {
    const rows = await getDb()
      .select({ id: articles.id })
      .from(articles)
      /* `ownedSlug`, never a bare slug match: the column is globally unique, so
         an unfiltered lookup finds anybody's article. `tests/owner-isolation.ts`
         greps this directory for the unsanctioned spelling and it caught this
         file writing one. */
      .where(ownedSlug(slug))
      .limit(1);
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

function toRow(r: Row): AiCallRow {
  return {
    id: r.id,
    runId: r.runId,
    generationId: r.generationId,
    scopeKind: r.scopeKind as AiCallRow["scopeKind"],
    ownerId: r.ownerId,
    articleSlug: r.articleSlug,
    jobId: r.jobId,
    stepName: r.stepName,
    wire: r.wire as AiCallRow["wire"],
    job: r.purpose as AiCallRow["job"],
    requestedModel: r.requestedModel,
    answeredModel: r.answeredModel,
    upstream: r.upstream,
    credentialFingerprint: r.credentialFingerprint,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt.toISOString(),
    durationMs: r.durationMs,
    outcome: r.outcome as AiCallRow["outcome"],
    creditsUsedNanos: r.creditsUsedNanos,
    upstreamInferenceNanos: r.upstreamInferenceNanos,
    isByok: r.isByok,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheReadTokens: r.cacheReadTokens,
    cacheWriteTokens: r.cacheWriteTokens,
    cacheWrite5mTokens: r.cacheWrite5mTokens,
    cacheWrite1hTokens: r.cacheWrite1hTokens,
    reasoningTokens: r.reasoningTokens,
    webSearches: r.webSearches,
    serviceTier: r.serviceTier,
    inferenceGeo: r.inferenceGeo,
  };
}

export const pgCostStore: CostStore = {
  describe: () => "postgres: spideryarn.ai_calls",

  async record(row: AiCallRow): Promise<void> {
    const articleId = row.articleSlug
      ? await articleIdFor(row.articleSlug)
      : null;
    await getDb()
      .insert(aiCalls)
      .values({
        id: row.id,
        runId: row.runId,
        generationId: row.generationId,
        scopeKind: row.scopeKind,
        ownerId: row.ownerId,
        articleId,
        articleSlug: row.articleSlug,
        jobId: row.jobId,
        stepName: row.stepName,
        wire: row.wire,
        purpose: row.job,
        requestedModel: row.requestedModel,
        answeredModel: row.answeredModel,
        upstream: row.upstream,
        credentialFingerprint: row.credentialFingerprint,
        startedAt: new Date(row.startedAt),
        finishedAt: new Date(row.finishedAt),
        durationMs: row.durationMs,
        outcome: row.outcome,
        creditsUsedNanos: row.creditsUsedNanos,
        upstreamInferenceNanos: row.upstreamInferenceNanos,
        isByok: row.isByok,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        cacheWrite5mTokens: row.cacheWrite5mTokens,
        cacheWrite1hTokens: row.cacheWrite1hTokens,
        reasoningTokens: row.reasoningTokens,
        webSearches: row.webSearches,
        serviceTier: row.serviceTier,
        inferenceGeo: row.inferenceGeo,
      })
      /* **The same call must not produce two rows.** The id is minted before the
         request goes out, so a retry of the *insert* — not of the call — has a
         key to collide on, and a ledger that double-counts is wrong in the
         direction that looks like the thing you were measuring. */
      .onConflictDoNothing({ target: aiCalls.id });
  },

  async read(since?: string, until?: string): Promise<LedgerRead> {
    /* Half-open, and the same rule as the filesystem half: `until` is the first
       instant *not* included, so two adjacent months cannot both claim a call. */
    const bounds = [
      ...(since ? [gte(aiCalls.startedAt, new Date(since))] : []),
      ...(until ? [lt(aiCalls.startedAt, new Date(until))] : []),
    ];
    const rows = await getDb()
      .select()
      .from(aiCalls)
      .where(bounds.length > 0 ? and(...bounds) : undefined)
      .orderBy(asc(aiCalls.startedAt));
    /* Nothing can be unreadable here — a row either parsed on the way in or was
       never written. The field exists so that the two stores answer the same
       question in the same shape. */
    return { rows: rows.map(toRow), unreadable: 0 };
  },

  async forJob(jobId: string): Promise<AiCallRow[]> {
    const rows = await getDb()
      .select()
      .from(aiCalls)
      .where(eq(aiCalls.jobId, jobId))
      .orderBy(asc(aiCalls.startedAt));
    return rows.map(toRow);
  },

  /** Not a question a table answers cheaply, and nothing needs it to. */
  size: async () => null,
};

--- scripts/ai-cost.ts ---
#!/usr/bin/env -S npx tsx
/**
 * What the model calls have cost — read out of the ledger.
 *
 *     npm run cost                      the current UTC month
 *     npm run cost -- --month 2026-07   one month
 *     npm run cost -- --since 2026-08-01 --until 2026-08-15
 *     npm run cost -- --all             everything there is
 *     npm run cost -- --reconcile       ask OpenRouter what it thinks (network, free)
 *
 * ## UTC, and half-open
 *
 * "What did August cost" needs a timezone, and a call at 00:30 BST on 1
 * September is an August call in UTC. This picks **UTC** and says so on every
 * line, for a reason beyond consistency: OpenRouter's own key limits reset at
 * midnight UTC, so it is the only boundary the reconciliation below can share.
 * Ranges are `[since, until)` — the end is the first instant *not* counted — so
 * two adjacent months can never both claim the same call.
 *
 * ## The two counters this cannot print, and what stands in for them
 *
 * `unscopedCalls()` and `lateCalls()` in [src/ai-spend.ts](../src/ai-spend.ts)
 * count the calls that fell outside a collector or finished after one closed.
 * Both live in **one server process's memory**, and this is a different process
 * that starts them at zero — so printing them here would be a reassuring pair of
 * noughts with nothing behind them. GPT Sol pointed that out.
 *
 * They are a *server-side* signal: the warn line beside each one is what reaches
 * a person. What this report asks instead is the question the rows can answer —
 * how many of them reported no money, and how much was spent on calls that
 * failed — which is the same worry from the other end.
 */

import { formatNanos } from "../src/ai-spend.js";
import type { AiCallRow } from "../src/ai-spend.js";
import { loadEnvLocal } from "../src/env.js";
import { costStore, totalRows } from "../src/store/ai-calls.js";

interface Args {
  since?: string;
  until?: string;
  all: boolean;
  reconcile: boolean;
  label: string;
}

/** The first instant of a UTC month, and of the one after it. */
function monthRange(month: string): { since: string; until: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`--month wants YYYY-MM, got ${JSON.stringify(month)}`);
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const since = new Date(Date.UTC(year, mon - 1, 1));
  const until = new Date(Date.UTC(mon === 12 ? year + 1 : year, mon % 12, 1));
  return { since: since.toISOString(), until: until.toISOString() };
}

function thisMonth(): { since: string; until: string; label: string } {
  const now = new Date();
  const label = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return { ...monthRange(label), label };
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { all: false, reconcile: false, label: "" };
  const rest = [...argv];
  const value = (flag: string): string => {
    const v = rest.shift();
    if (v === undefined) throw new Error(`${flag} needs a value`);
    return v;
  };
  while (rest.length > 0) {
    const flag = rest.shift() as string;
    switch (flag) {
      case "--month": {
        const label = value("--month");
        Object.assign(out, monthRange(label), { label });
        break;
      }
      case "--since":
        out.since = new Date(value("--since")).toISOString();
        break;
      case "--until":
        out.until = new Date(value("--until")).toISOString();
        break;
      case "--all":
        out.all = true;
        break;
      case "--reconcile":
        out.reconcile = true;
        break;
      default:
        throw new Error(`Unknown flag ${JSON.stringify(flag)}`);
    }
  }
  if (out.all) return { all: true, reconcile: out.reconcile, label: "all time" };
  if (!out.since && !out.until) {
    const m = thisMonth();
    return { ...out, since: m.since, until: m.until, label: `${m.label} (UTC)` };
  }
  return { ...out, label: out.label || `${out.since ?? "the beginning"} → ${out.until ?? "now"}` };
}

/** Sum by one facet, biggest first. One implementation for every breakdown. */
function by(
  rows: readonly AiCallRow[],
  key: (r: AiCallRow) => string | null,
): { name: string; calls: number; nanos: number }[] {
  const groups = new Map<string, AiCallRow[]>();
  for (const r of rows) {
    const name = key(r) ?? "—";
    const list = groups.get(name);
    if (list) list.push(r);
    else groups.set(name, [r]);
  }
  return [...groups.entries()]
    .map(([name, list]) => {
      const { credits, upstream } = totalRows(list);
      return { name, calls: list.length, nanos: credits + upstream };
    })
    .sort((a, b) => b.nanos - a.nanos);
}

function table(title: string, rows: { name: string; calls: number; nanos: number }[]): void {
  if (rows.length === 0) return;
  console.log(`\n${title}`);
  const width = Math.min(44, Math.max(...rows.map((r) => r.name.length)));
  for (const r of rows) {
    const name = r.name.length > width ? `${r.name.slice(0, width - 1)}…` : r.name.padEnd(width);
    console.log(`  ${name}  ${formatNanos(r.nanos).padStart(10)}  ${String(r.calls).padStart(5)} call(s)`);
  }
}

/**
 * **What OpenRouter thinks this key has spent**, next to what we recorded for
 * it.
 *
 * Per key, because that is the only granularity `/api/v1/key` has — and the
 * reason every row carries a `credential_fingerprint`. Rows written under a
 * *different* key are excluded and counted, rather than quietly widening the
 * difference: a discrepancy that is always non-zero for a reason nobody names is
 * a check everybody learns to ignore.
 *
 * It is still not an exact equality, and the report says so. OpenRouter's
 * monthly figure covers everything spent on that key, including a `curl` and any
 * run made before this ledger existed.
 */
async function reconcile(rows: readonly AiCallRow[]): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.log("\nNo OPENROUTER_API_KEY, so nothing to reconcile against.");
    return;
  }
  const { keyFingerprint } = await import("../src/ai-spend.js");
  const fingerprint = keyFingerprint(key);
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) {
    console.log(`\nOpenRouter answered ${response.status} — no reconciliation this run.`);
    return;
  }
  const body = (await response.json()) as { data?: Record<string, unknown> };
  const mine = rows.filter((r) => r.credentialFingerprint === fingerprint);
  const others = rows.length - mine.length;
  const { credits } = totalRows(mine);
  console.log(`\nAgainst OpenRouter, for key ${fingerprint}:`);
  console.log(`  our rows      ${formatNanos(credits).padStart(10)}  (${mine.length} call(s))`);
  const usage = body.data?.usage;
  if (typeof usage === "number")
    console.log(`  their usage   ${`$${usage.toFixed(4)}`.padStart(10)}  (this key, all time)`);
  const limit = body.data?.limit_remaining;
  if (typeof limit === "number") console.log(`  remaining     ${`$${limit.toFixed(4)}`.padStart(10)}`);
  if (others > 0)
    console.log(
      `  ${others} row(s) in this range were paid for with a different key, and are not in the first figure.`,
    );
  console.log(
    "  These will not be equal: theirs counts every call ever made on the key,\n" +
      "  including any made before this ledger existed. Watch the gap, not the number.",
  );
}

async function main(): Promise<void> {
  loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));
  const { rows, unreadable } = await costStore.read(args.since, args.until);

  console.log(`AI spend — ${args.label}`);
  console.log(`Ledger: ${costStore.describe()}`);
  const bytes = await costStore.size();
  if (bytes !== null) console.log(`        ${(bytes / 1024).toFixed(0)} KB`);

  if (rows.length === 0) {
    console.log("\nNo calls recorded in this range.");
    /* **Not the same as "nothing was spent", and it must not read as it.** An
       empty ledger is what a misconfigured store looks like too. */
    console.log("(An empty range and an unwired ledger look identical from here.)");
    return;
  }

  const { credits, upstream, unpriced } = totalRows(rows);
  console.log(`\nTotal:  ${formatNanos(credits + upstream)} over ${rows.length} call(s)`);
  console.log(`  credits consumed   ${formatNanos(credits)}`);
  if (upstream > 0) console.log(`  billed upstream    ${formatNanos(upstream)}  (BYOK — a different pocket)`);
  if (unpriced > 0)
    console.log(`  ${unpriced} call(s) reported no cost, so the total above is short by an unknown amount.`);
  if (unreadable > 0)
    console.log(`  ${unreadable} line(s) of the ledger could not be read, and are in no total.`);

  const failed = rows.filter((r) => r.outcome !== "ok");
  if (failed.length > 0) {
    const { credits: wasted } = totalRows(failed);
    console.log(
      `  ${failed.length} call(s) ended in error or a cancel, having spent at least ${formatNanos(wasted)}.`,
    );
  }

  table("By day (UTC)", by(rows, (r) => r.startedAt.slice(0, 10)));
  table("By job", by(rows, (r) => r.job));
  table("By model answered", by(rows, (r) => r.answeredModel ?? r.requestedModel));
  table("By article", by(rows.filter((r) => r.articleSlug), (r) => r.articleSlug));
  table("By owner", by(rows, (r) => r.ownerId));
  table("By scope", by(rows, (r) => r.scopeKind));

  const cacheRead = rows.reduce((n, r) => n + (r.cacheReadTokens ?? 0), 0);
  const cacheWrite = rows.reduce((n, r) => n + (r.cacheWriteTokens ?? 0), 0);
  if (cacheRead > 0 || cacheWrite > 0)
    console.log(
      `\nPrompt cache: ${cacheRead.toLocaleString()} tokens read, ${cacheWrite.toLocaleString()} written.` +
        "\n  A read that falls to zero is the cache silently switching off — docs/project/prompt-caching.md.",
    );

  /* Said every time rather than only when it looks wrong: a CLI stage run opens
     no collector, so `npm run toc` spends money that is in none of the numbers
     above. It says so on its own warn line when it happens, and this is the
     other end of that. docs/plans/260827q-ai-cost-tracking.md. */
  console.log("\nNot counted here: `npm run toc` and the other stage CLIs, and evals.");

  if (args.reconcile) await reconcile(rows);
  else console.log("\n(--reconcile asks OpenRouter what it thinks this key has spent.)");
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;
if (isMain) void main();

--- drizzle/0021_ai_calls_ledger.sql ---
-- Reshape `ai_calls` into the ledger that `src/ai-spend.ts` actually writes.
--
-- The table has existed since 0000 and nothing has ever inserted into it: its
-- columns were designed for two vendors and for costs we would compute
-- ourselves, and both of those stopped being true on 2026-08-27 when every call
-- started going through OpenRouter and carrying its own figure.
--
-- Altered rather than dropped and recreated, so that a database which somehow
-- does hold rows keeps them rather than losing them to a convenience. The guard
-- below is the other half of that: reading the source and concluding the table
-- is empty is not the same as the table being empty.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "spideryarn"."ai_calls" LIMIT 1) THEN
    RAISE EXCEPTION
      'ai_calls is not empty. This migration drops columns (provider, cost_micros, raw_response, ...) that were never written by any released code. Migrate the rows by hand, or empty the table deliberately, before running it.';
  END IF;
END $$;--> statement-breakpoint

-- The old shape. `cost_micros` in particular had to go: a query embedding costs
-- about $0.0000006, which is less than one micro-dollar and rounded to zero, so
-- the row read as free. `raw_response` had to go for a different reason — it
-- would have held model output derived from the reader's article.
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "revision_id";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "provider";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "model";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "prompt_tokens";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "completion_tokens";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "cost_micros";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "latency_ms";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "finish_reason";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "error";--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" DROP COLUMN "raw_response";--> statement-breakpoint

-- The id is minted before the request goes out, so that a call which never comes
-- back still has a name. A default would hide a caller that forgot to supply one.
ALTER TABLE "spideryarn"."ai_calls" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint

ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "run_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "generation_id" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "scope_kind" text NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "owner_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "article_slug" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "job_id" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "step_name" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "wire" text NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "requested_model" text NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "answered_model" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "upstream" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "credential_fingerprint" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "started_at" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "finished_at" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "duration_ms" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "outcome" text NOT NULL;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "credits_used_nanos" bigint;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "upstream_inference_nanos" bigint;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "is_byok" boolean;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "cache_read_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "cache_write_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "cache_write_5m_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "cache_write_1h_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "reasoning_tokens" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "web_searches" integer;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "service_tier" text;--> statement-breakpoint
ALTER TABLE "spideryarn"."ai_calls" ADD COLUMN "inference_geo" text;--> statement-breakpoint

-- `RESTRICT`, following the rule 0001 set for every other owner FK: deleting an
-- account must not silently delete the data. A billing history is the last thing
-- that should vanish on a cascade — and the day somebody genuinely wants to
-- delete an account while keeping its spend, the answer is a billing-account row
-- that outlives `auth.users`, not a weaker constraint here.
ALTER TABLE "spideryarn"."ai_calls" ADD CONSTRAINT "ai_calls_owner_id_users_id_fk"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users" ("id") ON DELETE RESTRICT;--> statement-breakpoint

-- What a spend limit would have to ask, and the one query `endJob` makes.
CREATE INDEX IF NOT EXISTS "ai_calls_owner_started"
  ON "spideryarn"."ai_calls" ("owner_id", "started_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_calls_job" ON "spideryarn"."ai_calls" ("job_id");

--- tests/store-ai-calls.test.ts ---
/**
 * The ledger's two stores — [ai-calls-fs.ts](../src/store/ai-calls-fs.ts) and
 * [ai-calls-pg.ts](../src/store/ai-calls-pg.ts).
 *
 * **What this file is really for is the round trip**, and one assertion inside
 * it. `credits_used_nanos` is an `int8`, and `node-pg` hands `int8` back as a
 * *string* — src/db/schema.ts warns about that twice, in two other columns'
 * comments, because it has bitten this project before. A `"21523500"` where a
 * number belongs does not throw: it concatenates in the next `+`, and the total
 * is wrong in a way that looks like a very expensive month. So the check is that
 * what comes back is a `number`, not merely that it is truthy.
 *
 * The Postgres half skips loudly when there is no database, like every other
 * `*-pg` test here.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AiCallRow } from "../src/ai-spend.js";
import { loadEnvLocal } from "../src/env.js";
import { totalRows } from "../src/store/ai-calls.js";

loadEnvLocal();

/** A plausible finished call. Override whatever the test is about. */
function row(over: Partial<AiCallRow> = {}): AiCallRow {
  return {
    id: "00000000-0000-4000-8000-00000000a001",
    runId: "00000000-0000-4000-8000-00000000b001",
    generationId: "gen-1787844432-JKwGQebcNXfkCfTX5mUq",
    scopeKind: "job_step",
    ownerId: "00000000-0000-4000-8000-00000000ac01",
    articleSlug: "a-slug",
    jobId: "job-7",
    stepName: "toc",
    wire: "messages",
    job: "toc",
    requestedModel: "anthropic/claude-sonnet-5",
    answeredModel: "anthropic/claude-sonnet-5",
    upstream: "Anthropic",
    credentialFingerprint: "abcdef012345",
    startedAt: "2026-08-15T10:00:00.000Z",
    finishedAt: "2026-08-15T10:00:01.200Z",
    durationMs: 1200,
    outcome: "ok",
    creditsUsedNanos: 21_523_500,
    upstreamInferenceNanos: 21_523_500,
    isByok: false,
    inputTokens: 13,
    outputTokens: 4,
    cacheReadTokens: 0,
    cacheWriteTokens: 8583,
    cacheWrite5mTokens: 8583,
    cacheWrite1hTokens: 0,
    reasoningTokens: 0,
    webSearches: null,
    serviceTier: "standard",
    inferenceGeo: null,
    ...over,
  };
}

/* ------------------------------------------------------------ the sums -- */

describe("totalRows", () => {
  it("counts a call that reported nothing as unpriced rather than as free", () => {
    const t = totalRows([row(), row({ creditsUsedNanos: null })]);
    expect(t.credits).toBe(21_523_500);
    expect(t.unpriced).toBe(1);
  });

  it("keeps BYOK money, which is a zero that is not free", () => {
    /* Under somebody else's key OpenRouter's own charge is legitimately `0`
       while the inference was billed upstream. Summed naively that call
       contributes nothing and `unpriced` stays zero, so the total reads correct
       while missing real money. */
    const t = totalRows([
      row({ isByok: true, creditsUsedNanos: 0, upstreamInferenceNanos: 9_000_000 }),
    ]);
    expect(t.upstream).toBe(9_000_000);
    expect(t.unpriced).toBe(0);
    expect(t.credits).toBe(0);
  });

  it("counts a BYOK call with no upstream figure as unpriced, not as zero", () => {
    const t = totalRows([
      row({ isByok: true, creditsUsedNanos: 0, upstreamInferenceNanos: null }),
    ]);
    expect(t.unpriced).toBe(1);
    expect(t.upstream).toBe(0);
  });

  it("does not add the two pockets together on an ordinary call", () => {
    /* On a non-BYOK call `cost` and `upstream_inference_cost` are the same money
       — measured equal to seven decimal places on 2026-08-27 — so adding both
       would double every bill. */
    const t = totalRows([row()]);
    expect(t.credits + t.upstream).toBe(21_523_500);
  });
});

/* ------------------------------------------------------ the JSONL store -- */

describe("the filesystem ledger", () => {
  let dir = "";
  let store: typeof import("../src/store/ai-calls-fs.js").fsCostStore;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "spya-ledger-"));
    /* The module resolves its path from `import.meta.dirname` at load, so the
       test writes to the real one and cleans up after itself rather than
       pointing it somewhere else. The file is under `data/`, which is
       gitignored, and the rows are fixtures. */
    store = (await import("../src/store/ai-calls-fs.js")).fsCostStore;
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    /* Remove only the rows this file wrote, by run id — the ledger is a real
       file and a developer's own local spend may be in it. */
    const p = store.describe();
    const text = await readFile(p, "utf8").catch(() => "");
    if (text === "") return;
    const kept = text
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.includes("00000000-0000-4000-8000-00000000b0"));
    await writeFile(p, kept.length > 0 ? `${kept.join("\n")}\n` : "", "utf8");
  });

  it("writes a row and reads back exactly what it wrote", async () => {
    const written = row({ id: "00000000-0000-4000-8000-00000000a0f1" });
    await store.record(written);
    const { rows } = await store.read();
    const found = rows.find((r) => r.id === written.id);
    expect(found).toEqual(written);
  });

  it("filters a range half-open, so two months cannot both claim one call", async () => {
    const july = row({
      id: "00000000-0000-4000-8000-00000000a0f2",
      startedAt: "2026-07-31T23:59:59.000Z",
    });
    const august = row({
      id: "00000000-0000-4000-8000-00000000a0f3",
      startedAt: "2026-08-01T00:00:00.000Z",
    });
    await store.record(july);
    await store.record(august);
    const ids = async (since: string, until: string) =>
      (await store.read(since, until)).rows.map((r) => r.id);
    expect(await ids("2026-07-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z")).toContain(july.id);
    expect(await ids("2026-07-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z")).not.toContain(
      august.id,
    );
    expect(await ids("2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z")).toContain(august.id);
  });

  it("counts a line it cannot read rather than letting it shrink the total", async () => {
    /* A truncated tail is what a killed process leaves. Skipping it silently
       makes the ledger quietly short; refusing to read the file at all makes one
       bad byte lose a month. */
    const before = (await store.read()).unreadable;
    await writeFile(store.describe(), "{not json\n", { flag: "a" });
    const after = await store.read();
    expect(after.unreadable).toBe(before + 1);
    const text = await readFile(store.describe(), "utf8");
    await writeFile(store.describe(), text.replace("{not json\n", ""), "utf8");
  });

  it("finds one job's calls across every advance that ran it", async () => {
    const a = row({ id: "00000000-0000-4000-8000-00000000a0f4", jobId: "job-parted" });
    const b = row({
      id: "00000000-0000-4000-8000-00000000a0f5",
      jobId: "job-parted",
      stepName: "arc",
    });
    await store.record(a);
    await store.record(b);
    const found = await store.forJob("job-parted");
    expect(found.map((r) => r.stepName).sort()).toEqual(["arc", "toc"]);
  });
});

/* ------------------------------------------------------ the Postgres store -- */

let reachable = false;

if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 10_000,
  });
  let why = "";
  try {
    const probe = await pool.query(
      "select to_regclass('spideryarn.ai_calls') is not null as ready",
    );
    reachable = probe.rows[0]?.ready === true;
    if (reachable) {
      /* The table has existed since 0000 with a different shape. A probe that
         only asks whether it exists would let this suite run against the old
         columns and fail in a way that reads like a bug in the store. */
      const shaped = await pool.query(
        "select count(*) as n from information_schema.columns " +
          "where table_schema='spideryarn' and table_name='ai_calls' and column_name='credits_used_nanos'",
      );
      reachable = Number(shaped.rows[0]?.n) === 1;
      if (!reachable) why = "ai_calls is the pre-0021 shape — run npm run db:migrate";
    } else why = "the spideryarn schema is not there — run npm run db:migrate";
  } catch (err) {
    reachable = false;
    why = `could not reach it: ${(err as Error).message}`;
  }
  await pool.end();
  if (!reachable) console.warn(`\n  ⚠ DATABASE_URL is set but these tests are skipping: ${why}\n`);
}

const when = reachable ? describe : describe.skip;

when("the Postgres ledger", () => {
  const RUN = "00000000-0000-4000-8000-00000000c001";

  afterAll(async () => {
    const { getDb, closeDb } = await import("../src/db/client.js");
    const { aiCalls } = await import("../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    await getDb().delete(aiCalls).where(eq(aiCalls.runId, RUN));
    await closeDb();
  });

  it("hands nano-dollars back as a number, not as the string node-pg would give", async () => {
    const { pgCostStore } = await import("../src/store/ai-calls-pg.js");
    const { currentOwnerId } = await import("../src/owner.js");
    const written = row({
      id: "00000000-0000-4000-8000-00000000a101",
      runId: RUN,
      ownerId: currentOwnerId(),
      /* Deliberately over `int4`'s ceiling — $2.15 in nano-dollars — so a column
         that quietly went back to `integer` fails here rather than in a month
         with a big bill in it. */
      creditsUsedNanos: 9_000_000_000,
      /* A slug nothing owns, so `article_id` comes back null and the row is
         still written. That is the designed behaviour: the slug is the
         historical fact and the id is the convenience. */
      articleSlug: "no-such-article-here",
    });
    await pgCostStore.record(written);
    const { rows } = await pgCostStore.read();
    const found = rows.find((r) => r.id === written.id);
    expect(found?.creditsUsedNanos).toBe(9_000_000_000);
    expect(typeof found?.creditsUsedNanos).toBe("number");
    expect(found?.articleSlug).toBe("no-such-article-here");
    expect(found?.cacheWrite5mTokens).toBe(8583);
  });

  it("writes one row for one call, however often the insert is retried", async () => {
    const { pgCostStore } = await import("../src/store/ai-calls-pg.js");
    const { currentOwnerId } = await import("../src/owner.js");
    const written = row({
      id: "00000000-0000-4000-8000-00000000a102",
      runId: RUN,
      ownerId: currentOwnerId(),
      articleSlug: null,
    });
    await pgCostStore.record(written);
    await pgCostStore.record(written);
    const { rows } = await pgCostStore.read();
    expect(rows.filter((r) => r.id === written.id)).toHaveLength(1);
  });
});

--- tests/ai-cost-cli.test.ts ---
/**
 * The ranges `npm run cost` asks for — [scripts/ai-cost.ts](../scripts/ai-cost.ts).
 *
 * Only the arithmetic is tested here, and it is the part that is quietly wrong
 * rather than loudly wrong: a month boundary in the wrong timezone moves a few
 * calls between two reports and nothing looks broken from either end. **UTC,
 * half-open** — `[since, until)` — so a call at midnight belongs to exactly one
 * month, and the same boundary OpenRouter's own key limits reset on, which is
 * what makes the reconciliation comparable at all.
 */
import { describe, expect, it } from "vitest";
import { parseArgs } from "../scripts/ai-cost.js";

describe("--month", () => {
  it("runs from the first instant of the month to the first instant of the next", () => {
    const a = parseArgs(["--month", "2026-08"]);
    expect(a.since).toBe("2026-08-01T00:00:00.000Z");
    expect(a.until).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rolls the year over in December rather than asking for month 13", () => {
    const a = parseArgs(["--month", "2026-12"]);
    expect(a.since).toBe("2026-12-01T00:00:00.000Z");
    expect(a.until).toBe("2027-01-01T00:00:00.000Z");
  });

  it("is UTC, so a British-summer midnight does not move a call into July", () => {
    /* 00:30 BST on 1 August is 23:30 UTC on 31 July — a July call. The bound
       below is what decides that, and it is the whole reason this is pinned. */
    const july = parseArgs(["--month", "2026-07"]);
    expect(Date.parse(july.until as string)).toBe(Date.UTC(2026, 7, 1));
    expect(new Date(july.until as string).toISOString()).toContain("T00:00:00.000Z");
  });

  it("refuses a shape it cannot read rather than guessing a range", () => {
    /* Guessing here is a report that silently covers the wrong days. */
    expect(() => parseArgs(["--month", "August"])).toThrow("YYYY-MM");
    expect(() => parseArgs(["--month", "2026-8"])).toThrow("YYYY-MM");
  });

  it("leaves the range open at both ends for --all", () => {
    const a = parseArgs(["--all"]);
    expect(a.since).toBeUndefined();
    expect(a.until).toBeUndefined();
    expect(a.label).toBe("all time");
  });

  it("defaults to the current month in UTC, not to everything", () => {
    /* A bare `npm run cost` that showed all time would grow a bigger number
       every week and never answer "what is this costing me now". */
    const a = parseArgs([]);
    expect(a.since).toBeTruthy();
    expect(a.until).toBeTruthy();
    expect(a.label).toContain("UTC");
  });

  it("says so rather than silently ignoring a flag it does not know", () => {
    expect(() => parseArgs(["--last-week"])).toThrow("Unknown flag");
  });
});

```
