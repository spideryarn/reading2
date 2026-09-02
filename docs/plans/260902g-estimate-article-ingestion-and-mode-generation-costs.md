# Estimate article ingestion and mode generation costs

## Goal

Know what one article costs us in AI spend — the full ingestion queue plus every AI-powered
reading mode — for two or three representative articles (a ~1,000-word HTML page, a long/dense
HTML article, a ~20-page PDF). Build it as a repeatable eval so we can run it again; **model
comparison requires the follow-up arms plan** (see the deferred stage at the end) — this plan
delivers the baseline it would compare against. Deliverables:

1. A **range** ("an article costs $X–$Y"), per article shape, with observed variation reported
   where it lives (long-article hierarchy) rather than a claimed tail.
2. A ranked list of **which bits are most expensive**.
3. **Cost-reduction suggestions**, each with the product tradeoff it would require, named so Greg
   decides rather than inherits.

This doc is the plan only (Greg, 2026-09-02: "For now, let's just write up a plan, with a review
from GPT Sol, don't actually implement yet"). **Reviewed twice by GPT Sol.** Round 1 returned
*rework* with three blockers
([review](260902g-estimate-article-ingestion-and-mode-generation-costs-review-sol.md)); every
blocker was verified against the code/ledger and confirmed, and this version folds them in — the
biggest: what looked like a truncation-retry tail was actually **concurrent duplicate execution
of one job** (see Context). Round 2 returned *approve with changes*
([review 2](260902g-estimate-article-ingestion-and-mode-generation-costs-review-sol-2.md)), all
applied — including its one substantive catch, that slug-attributed eval runs would land in
`npm run cost`'s Product bucket.

Other agents are concurrently building payments machinery and cost-tracking; this work reads the
cost-tracking machinery and must not modify it.

> **Note from the cost-tracking plan, 2026-09-02.** That plan is
> [260902g-cost-tracking-that-can-set-a-price.md](260902g-cost-tracking-that-can-set-a-price.md),
> and it has **handed its measurement stage to this one** rather than duplicating it — so this is
> the plan that produces the unit costs, and that one produces the ledger they are read from.
> Three things it is changing underneath you, all landing before you run:
>
> - **`upstream_inference_nanos` is being renamed `byok_upstream_nanos` and nulled on non-BYOK
>   rows.** Today it is populated on non-BYOK rows *equal to* `credits_used_nanos`, so a naive
>   `SUM` over the money columns roughly doubles the answer — one auditor got $23.54 where the
>   truth was $11.77. Read totals through `totalRows()`
>   ([`src/store/ai-calls.ts`](../../src/store/ai-calls.ts)) until the rename lands.
> - **The test suite will stop writing into the Postgres ledger**, and the ~4,000 existing fixture
>   rows will be deleted (Greg approved 2026-09-02). If your harness reads Postgres, its `By owner`
>   and `By article` numbers are currently buried under them.
> - **Postgres becomes authoritative from that stage's deploy; the filesystem ledger is not being
>   imported.** Your appendix numbers come from `data/_ai-calls.jsonl`, which stays readable but
>   stops being the source of truth.
>
> Also: **live conversation is being metered** for the first time, which will add a cost line no
> article-shape measurement can see — voice is roughly $0.06–$0.46 a minute against $0.05–$0.36 for
> a whole article ingest. Worth naming as out of your scope rather than absent from the picture.

## Context: most of the machinery already exists

- **Cost capture is done.** Every paid call already lands in the `ai_calls` ledger
  ([`src/ai-spend.ts`](../../src/ai-spend.ts), sink [`src/store/ai-calls.ts`](../../src/store/ai-calls.ts))
  with OpenRouter's authoritative `usage.cost`, token breakdowns, `job_id`, `step_name`,
  `article_slug`, `duration_ms`. `ScopeKind` already includes `"eval"`. We build a **harness that
  drives articles through the pipeline and reads the ledger back**, not new instrumentation.
- **We already have real numbers** (`data/_ai-calls.jsonl`, 565 rows, files mode, Greg's laptop):
  a single hierarchy+labels execution on a 468-word article costs **$0.047–0.078**; on a
  13,476-word article, **$0.36** (hierarchy $0.24 + labels), and with arc, glossary, ideas and
  sketch added the observed partial total is **~$0.91**. See the appendix for the named cases.
- **The $5.43 incident is duplicate execution, not a retry chain.** On
  `towards-a-theory-of-bugs…`, one job's eleven hierarchy calls have eleven **distinct runIds**
  starting 7–60 s apart while earlier calls were still in flight, and several finished *below*
  the token ceiling — something kept starting fresh attempts of a step already running.
  The same overlap appears on the 468-word `read` article (six executions under one job), so it
  is not length-dependent. **Root-caused and fixed, 2026-09-02**
  ([260902c-the-truncation-retry-cost-storm.md](../postmortems/260902c-the-truncation-retry-cost-storm.md)):
  a Vite dev-server restart re-imported the server modules, the files-mode queue's in-memory
  claims vanished with the old module copy, and the sweeper requeued the still-running job.
  Postgres claiming never had the bug, and a restart is now a pause (`src/process-state.ts`).
  **The size of it was understated while it was being fixed**, in two ways the stage-1
  aggregation caught: "$9.62 of $11.36" compared the storm against *the four storm jobs*, not
  against the ledger, and it counted only the structure calls. Across both ledgers the waste is
  **$10.47–$10.81 of $31.22, a third of all recorded spend** (39 unpriced rows are unknown, not
  zero) — and one of the five groups is a `summary` step 15h20m later, a **different step on a
  later day** than the postmortem describes. Same root cause, wider blast radius; the postmortem is corrected.
  This eval treats it as a fixed historical anomaly, and
  separately measures *stochastic* hierarchy cost under current code — where hierarchy runs at
  effort `medium` precisely because this article filled the ceiling at `high`
  ([`src/hierarchy.ts`](../../src/hierarchy.ts)), and a truncation surfaces as a `bug` failure
  with no Retry button.
- **Only five steps run at ingest** (`DEFAULT_INGEST_STEPS`, [`src/pipeline.ts`](../../src/pipeline.ts)):
  fetch, extract, blocks, hierarchy (+labels fan-out), assets. Of those, only hierarchy/labels
  pay (extract pays too, but only for PDFs). Everything else — arc, tweets, glossary, quotes,
  ideas, timeline, quiz, sketch — is **on-demand**; arc also auto-fires when an owner opens an
  article. **Summary mode is free** since 2026-08-31: no stage, it draws the gists hierarchy
  already wrote ([summaries.md](../project/summaries.md)).
- **One model does nearly everything**: `anthropic/claude-sonnet-5` on both wires
  ([`src/models.ts`](../../src/models.ts)). Exceptions: PDF extraction (`openai/gpt-5.6-luna`,
  per-chunk, BYOK), embeddings (`voyageai/voyage-4`), dictation (`google/gemini-3.1-flash-lite`).
  **There is no per-stage pipeline model override**: every pipeline entry in `MODEL_ENV_VAR` is
  deliberately `null`, only `SPIDERYARN_PIPELINE_EFFORT` exists, and Luna cannot ride the
  Messages-shaped pipeline wire without a protocol rewrite (`src/models.ts`). Model arms
  therefore need a real injection/bypass mechanism (as `evals/hierarchy-structure/model-arms.ts`
  built for itself) and are **deferred to a follow-up plan**.
- **An arms-style eval harness exists**: `evals/hierarchy-structure/` is the template —
  including its incremental result persistence and interleaved repeats. Paid evals that bypass
  the gateways use [`evals/declared-spend.ts`](../../evals/declared-spend.ts); ordinary
  production-path calls need `collectSpend`/`withLedger`, not the declared wrapper.

## References

- [`src/pipeline.ts`](../../src/pipeline.ts) — `STEP_ORDER`, `DEFAULT_INGEST_STEPS`, the step
  implementations; `fetchDocument` is hardcoded in stage 1 and accepts only HTTP(S) (no local
  files) — [`src/fetch.ts`](../../src/fetch.ts).
- [`src/jobs.ts`](../../src/jobs.ts) — `runStep` opens its own `collectSpend` with
  `scopeKind: "job_step"`; nested collectors **shadow** rather than merge
  ([`src/ai-spend.ts`](../../src/ai-spend.ts)), so wrapping the queue in an eval scope yields no
  eval rows. The feasibility stage exists because of this.
- [`src/store/contracts.ts`](../../src/store/contracts.ts) — `CostStore.read(since, until)`; there
  is **no `forRun`**, so the runner reads a bounded window and filters in memory (fine at current
  size).
- [ai-gateway.md](../project/ai-gateway.md) — the two wires; the duration trap
  (`max(finishedAt) − min(startedAt)` per step, never `sum(durationMs)`); OpenRouter's provider
  choice is a preference with fallback, so `upstream` can vary run to run.
- [260827q-ai-cost-tracking.md](260827q-ai-cost-tracking.md),
  [260827d-ai-cost-tracking-options.md](../research/260827d-ai-cost-tracking-options.md) — the
  cost-tracking work this reads from.
- [prompt-caching.md](../project/prompt-caching.md) — pipeline cache breakpoints are
  **conditional and off by default** (`sharesArticleCache`); an ordinary ingest marks nothing.
  Request-path search/chat/explain have real per-task article caches, so their scenarios must
  distinguish a cold first touch from a warm later turn.
- [`src/token-budget.ts`](../../src/token-budget.ts) +
  [260826a-toc-max-tokens.md](../postmortems/260826a-toc-max-tokens.md) — budgets, truncation
  failure kinds, and why adaptive thinking makes repeated draws vary.
- [`src/pdf-read.ts`](../../src/pdf-read.ts) — chunk planning (dense pages can become one-page
  chunks, so "20 pages ≈ 4 chunks" is not guaranteed); checkpoints are article-scoped Postgres
  rows that `force` does **not** bypass; files mode uses `nullCheckpointStore` and never resumes.
- `evals/hierarchy-structure/`, [`evals/README.md`](../../evals/README.md) — harness template;
  eval rows are deliberately excluded from `npm run cost`, so the eval self-reports.
- [`evals/results/effort-vs-quality.md`](../../evals/results/effort-vs-quality.md) — arc/glossary
  `medium` vs `high` already measured.
- [`src/article-vectors.ts`](../../src/article-vectors.ts) — the embeddings purchase seam;
  `similar.ts` still buys its own vectors (a known debt), so Force/Drift can pay twice.
- Fixtures: `tests/fixtures/data-root/` (5 HTML articles), `evals/pdf/{easy,harder,much-harder}/`
  (licensed PDFs; the easy one already measured at about a penny — `evals/pdf/README.md`),
  `evals/extraction/fixtures/` (21 hard HTML pages).
- [260831ah-toc-on-request-and-the-tree-that-costs-nothing.md](260831ah-toc-on-request-and-the-tree-that-costs-nothing.md)
  — STOPPED plan bearing on hierarchy cost; read before proposing hierarchy changes.

## Principles, key decisions

- **All modes, not just three** (Greg, 2026-09-02). The inventory includes the four referee
  tasks, and classifies Force/Drift diagram embeddings as **cold first-open article costs** (an
  article-scoped purchase, currently sometimes made twice), not per-interaction costs.
- **Real runs, not a dry-run estimator** (Greg, 2026-09-02). Costs real money per run; the
  feasibility stage produces the per-run price before the corpus runs.
- **Simpler option passed over: no runner, just aggregate the existing ledger.** Stage one does
  exactly that, free — but it can't compare models, can't hold fixtures constant, mixes warm,
  cold and duplicate executions, and most modes have 1–2 rows. Repeatability needs the runner.
- **"Cold first generation" is the headline number** — the cost of the first paid generation of
  each stored artefact. Legitimate warm/resume costs (prompt-cache reads on request-path
  scenarios, PDF checkpoint resume) are **reported separately**, not declared harness failures;
  a $0 that should have been cold is still a failure. Within-run chunk/label caching is part of
  production cost and stays.
- **Independent draws need fresh articles.** PDF checkpoints and step artefacts are
  article-scoped and `force` does not bypass checkpoints — each independent draw ingests under a
  fresh run-prefixed slug/article id rather than fighting the caches.
- **Variation is measured, not assumed.** Long-article hierarchy gets 3–5 independent cold
  draws, interleaved; report median, range, truncation/semantic-failure count, cost conditional
  on success, and total paid cost — called *observed variation*, never a tail probability. The
  ledger's `outcome: "ok"` only means the gateway returned; the stage/job outcome is recorded
  beside spend.
- **Per-article vs per-interaction, kept separate.** Per-article: the eight mode steps, extract,
  hierarchy+labels, article embeddings, referee stored artefacts. Per-interaction: chat turn,
  quiz marking, explain, search, remember, dictation, glossary term lookup, referee per-turn
  calls — unit costs, one sample call each or existing ledger rows, never folded into the
  per-article number.
- **BYOK-aware totals.** Sum the way [`src/store/ai-calls.ts`](../../src/store/ai-calls.ts)
  does — Luna PDF rows carry $0 OpenRouter credits and the real cost in
  `upstreamInferenceNanos` (78 such rows today). The 39 unpriced rows are *unknown*, not zero.
- **Read-only towards the cost-tracking machinery.** The one open coordination point: eval
  attribution through the production queue (blocker 2) must be designed **with** the
  cost-tracking agents, not around them.
- **Run in parallel with the cost-tracking work; gate only the paid runs on it** (Greg,
  2026-09-02). Its plan
  ([260902g-cost-tracking-that-can-set-a-price.md](260902g-cost-tracking-that-can-set-a-price.md))
  is changing the ledger underneath us — the `upstream_inference_nanos` →
  `byok_upstream_nanos` rename with non-BYOK rows nulled, the test-suite fixture rows deleted,
  Postgres authoritative (see the note at the top of this doc). Everything free proceeds
  meanwhile: the baseline aggregation (totals via `totalRows()` only, never a naive `SUM` over
  the money columns — it double-counts today), the feasibility design and dry pass, the fixture
  corpus, the runner code and its unit tests. **Before the first paid run**, check whether that
  plan has landed — concretely: `byok_upstream_nanos` exists in
  [`src/db/schema.ts`](../../src/db/schema.ts) and that plan's own stages show its ledger
  changes done. If not, **delay an hour or two and re-check** (repeating until it has landed)
  rather than paying for runs whose rows would straddle the rename and the fixture-row purge;
  keep working through any remaining free items while waiting.
- **Out of scope**: live conversation (browser-direct OpenAI Realtime, invisible to the ledger —
  known and accepted); infrastructure costs; implementing cost reductions (the duplicate-execution
  fix is already in flight separately); model arms (follow-up plan once an injection mechanism
  exists).

## Stages & actions

### Stage: Baseline from the ledger we already have (no code, no spend) ✅ 2026-09-02

- [x] Aggregated both ledgers per slug × step × runId, separating duplicate from single
      executions, BYOK-aware. **Working kept**: `evals/cost/baseline/` — `final-numbers.py`
      reproduces every figure quoted below, `coverage.py` the mode coverage, `pg-dump.mjs` /
      `pg-articles.mjs` the local Postgres reads, and
      [`stage1-baseline.md`](../../evals/cost/baseline/stage1-baseline.md) is the full report.
      The appendix below is rewritten from it.
- [x] Cross-checked against `npm run cost`: $28.6727 / 565 calls on the filesystem ledger,
      per-job table identical to the cent.
- [x] **Five corrections it made to this plan and the postmortem**, each verified from
      timestamps rather than argued: the duplicate-execution waste is a third of all spend, not
      the stated fraction of one incident; there was a fifth group, on a different step and a
      later day; every headline hierarchy figure in the old appendix was taken at effort `high`,
      which `fb82dc8` left on 2026-08-30 20:03 UTC, so the numbers were right about a
      configuration we no longer run; two word counts were wrong; and `summarise` is a deleted
      step whose $1.36 must stay out of any per-article figure.
- [ ] Stop and show Greg: the observed range, labelled extrapolations, ranked expensive bits.

**Two requirements this stage handed the runner.** Record **effort and commit on every run** —
this analysis was nearly wrong by 2× because a config constant moved mid-ledger and no row said
so. And the prompt cache is worth **2.5× on chat and 7× on quiz marking**, the largest observed
lever in the data, so per-interaction scenarios must report cold and warm separately rather than
averaging them.

### Stage: No-spend feasibility — orchestration, attribution, fixtures ✅ 2026-09-02

**Design and the dry-pass output: [`evals/cost/feasibility.md`](../../evals/cost/feasibility.md).**
All three couplings are answered, and **none of them needs the cost-tracking agents to change
anything** — which was the coordination risk this stage existed to size.

- [x] **Attribution: wrap each step's `run` in `withSpendAttribution({ scopeKind: "eval" })`.**
      `scopeKind` is read at row-write time and `withSpendAttribution` re-enters the same box
      ([`src/ai-spend.ts`](../../src/ai-spend.ts)), so every call inside a step writes an `eval`
      row while keeping the owner, slug, jobId and stepName that `runStep` set. Since
      [`scripts/ai-cost.ts`](../../scripts/ai-cost.ts) already defines Product as
      `scopeKind !== "eval"`, **Sol's acceptance criterion is met with no seam and no
      coordination.** Rejected: slug-only attribution (fails exactly as Sol said), an eval
      coordinator (a second copy of the thing being measured), and a production branch in
      `runStep`.
- [x] **Fixture ingress: replace only stage 1, through the existing `AdvanceParts.steps` seam.**
      A fixture `fetch` step reads the checked-in HTML and calls the exported `writeRaw()`;
      everything downstream is the production registry. **No SSRF guard is weakened** — rejected a
      `fixture:`/`file:` scheme in `src/` for exactly that reason, and a non-loopback static
      server because the box's LAN address is private and blocked anyway.
- [x] **Shared-state safety**, plus a trap that was not in the plan: `enqueue` ends with `pump()`,
      which drives the job with the **production** registry and wins the claim synchronously — on
      the first dry run this silently skipped the fixture step and the pipeline looked fine. The
      existing idiom (`VERCEL=1` across the `enqueue` call) is the fix. Also: the run tag has to
      be on the **URL** as well as the slug, or `freeSlug` adopts an existing article.
- [x] **The dry pass was seen to fail before it passed.** Control arm, no overlay →
      `scope=job_step` → `Product spend: $0.0123`. Eval arm → `scope=eval` → `Eval spend:
      $0.0123`. Same fixture, same step, same fabricated cost. The pipeline really ran
      (`fetch 19 KB (fixture)` → `extract "Tufte CSS"` → `blocks 70 blocks`), and cleanup left
      `ai_calls` untouched with zero `evalcost-%` articles or jobs behind.
- [x] **`costStore.forJob(jobId)` exists**, so the plan's "read a window and filter in memory" is
      unnecessary. That paragraph in References is superseded.

**One new hard gate, and it is not ours** — see the blocker below the stages.
**One nice-to-have**: a dedicated eval owner wants a third `SEEDED_ACCOUNTS` entry
([`scripts/seed-accounts.ts`](../../scripts/seed-accounts.ts)), a file another agent is editing
now. Not a blocker — the isolation comes from `scopeKind`, not from the owner — so ask for it
rather than hand-inserting into `auth.users`.

<details>
<summary>The original framing of this stage, kept because the reasoning is what Sol reviewed</summary>

The runner design has to answer three couplings before any money moves (Sol blocker 2):

- [ ] **How eval spend gets attributed.** `runStep` opens its own `job_step` collector and
      nested collectors shadow, so "wrap the queue in an eval scope" produces no eval rows.
      Decide between (a) driving the production queue with an explicit eval-attribution seam —
      requires agreeing the seam with the cost-tracking agents — or (b) an eval coordinator that
      faithfully does session begin/run/commit itself (probably over-built; say why if chosen).
      Also possible: attribute by run-prefixed slug + `job_step` rows rather than by
      `scopeKind: "eval"` at all — evaluate this first, but note it solves attribution only:
      slugged `job_step` rows are still classified as **Product spend** by
      [`scripts/ai-cost.ts`](../../scripts/ai-cost.ts). **Acceptance criterion: eval spend must
      not land in the Product bucket of `npm run cost`** — which may still require a coordinated
      seam or a reporting change agreed with the cost-tracking agents (Sol round 2).
- [ ] **How a checked-in HTML fixture enters stage 1.** `fetchDocument` accepts only HTTP(S) and
      rejects loopback; refetching live URLs doesn't hold bytes constant. Candidates: a
      fixture-input seam, or a tiny local static server on a non-loopback interface, or seeding
      the fetched blob directly (the store is content-addressed). Pick the smallest.
- [ ] **Shared-state safety** (several agents share the dev database): a local-target assertion
      before any run; a dedicated eval owner; collision-proof run-prefixed slugs; record every
      created article/job id; cleanup deletes exactly those rows and **retains** ledger history
      (deleting an eval article nulls `ai_calls.article_id` but keeps the spend row).
- [ ] Prove the chosen design with a **free end-to-end dry pass** (a no-model or stubbed step)
      showing rows land attributable and cleanup removes exactly what was created.
- [ ] Write the decision into this doc; stop & review with Greg if the attribution seam needs
      cost-tracking coordination.

</details>

### 🚧 Blocked: the local database cannot be migrated, by anybody

**Found 2026-09-02 by the feasibility dry pass; verified independently.** `npm run db:migrate`
refuses:

> 1 ledger row(s) belong to no migration in this journal: `1788351034981`

**It is `0052_per_article_job_queue`, in the `article-job-queue` worktree.** That worktree's
journal has it at `when: 1788351034981`, which is the ledger row's `created_at` exactly; the
migration is committed there (`540927f`) but **not pushed to `dev`**, so `origin/dev`'s journal
does not contain it. What it did is visible in the database: `spideryarn.jobs` now carries
`jobs_active_work`, `jobs_reserved_slug`, `jobs_active_source` and `jobs_one_running_per_slug`,
and `jobs_active_slug` is gone.

*(A first pass at this attributed the row to a since-deleted
`20260902122542_auth_users_token_defaults.sql`. That was wrong — a peer session working on the
same blockage supplied the jobs-index detail, and the journal `when` settled it. Recorded because
a wrong attribution here sends somebody to delete the wrong ledger row.)*

The consequence is wider than this plan: **`byok_upstream_nanos` cannot be applied**, so
`src/db/schema.ts` and the local database disagree, every Postgres-backed test fails, and
`runStep`'s own `jobSpend` errors on every job. **Nobody's ledger row needs deleting** — the fix
is to push `540927f` to `dev`, after which the journal reconciles. Until then the paid runs cannot
start and neither can the cost-tracking plan's stage 1b.

### Stage: Fixture corpus — three articles, held constant ✅ 2026-09-02 (with two gaps)

Measured by running `runExtract`, `runBlocks`, `pass0` and `planChunks` locally — all four are
free, which was checked in the code before running rather than assumed.

| slot | pick | measured |
|---|---|---|
| Short HTML | `tests/fixtures/data-root/data/writes/raw.html` (a Paul Graham essay) | 561 words, 19 blocks, 18 gistable, sha256 `728a75e7…` |
| Long/dense HTML | `evals/extraction/fixtures/gwern.html` ("The Scaling Hypothesis", public domain) | 16,855 words, 186 blocks, 177 gistable, sha256 `4a2564b8…` |
| PDF | `evals/pdf/harder/source.pdf` | 14 pages, 11,937 words, **5 chunks** `[3,3,3,3,2]`, sha256 `18d0d66a…` |

- [x] **`planChunks` confirmed the plan's own warning**: `much-harder` is 17 pages and still
      plans 3 chunks, capped by `MAX_CHUNK_PAGES`. Pages ÷ 6 would have been wrong three times
      out of three.
- [ ] **Gap 1 — nothing checked in is a normal ~1,000-word article.** The hole runs from 625
      words (`mkdocs_tabs.html`, and it is one of the deliberately-broken extraction fixtures, so
      it is excluded as pathological) to 1,638 (`shakespeare_hamlet`, a play scene rather than
      prose). 561 words is the closest honest choice; say so in the report rather than calling it
      a thousand.
- [ ] **Gap 2 — no PDF fixture is near 20 pages.** `much-harder` is 17 but is a photographic
      scan, so its cost is vision transcription and not representative; `harder` is 14 and
      born-digital. Taking `harder` and flagging the shortfall — a true 20-page fixture means a
      new licensed download, which is a decision for Greg, not a thing to slip in.
- [x] `gwern.html` was checked for the duplication failure its corpus exists to provoke: zero
      exact-duplicate blocks under current code, so its word count is trustworthy.
- **For the feasibility stage**: three of the five `tests/fixtures/data-root/` articles have no
  committed `raw.html` by design, so they cannot enter stage 1 at all without the fixture-input
  seam.

### Stage: v1 runner — one article, end to end, cold

- [ ] **Gate: the cost-tracking plan has landed.** Check
      [260902g-cost-tracking-that-can-set-a-price.md](260902g-cost-tracking-that-can-set-a-price.md)
      and the `byok_upstream_nanos` rename in [`src/db/schema.ts`](../../src/db/schema.ts). Not
      landed → delay an hour or two and re-check until it has (see Principles). The rest of
      this stage is code and can be written and unit-tested meanwhile — only the first paid run
      waits on the gate.
- [x] **Built 2026-09-02, in four files.** `evals/cost/run.ts` drives and prints;
      [`harness.ts`](../../evals/cost/harness.ts) holds the three mechanisms;
      [`report.ts`](../../evals/cost/report.ts) is the arithmetic and has no IO;
      [`fixtures.ts`](../../evals/cost/fixtures.ts) is the committed corpus manifest. Same
      pure/impure split as `evals/hierarchy-structure/{score,run}.ts`. `npm run eval:cost` sets
      `SPIDERYARN_STORE=postgres` — the flag is read at module load, so the runner can only
      *assert* it. Production-path calls run under normal `collectSpend`; `declared-spend` is not
      used and should not be.
- [x] Drives the fixture through ingest under a fresh run-tagged slug **and URL**, with
      `advanceJobWith(id, { session: claimSession, steps })` — the whole production registry with
      `scopeKind: "eval"` overlaid and stage 1 replaced. Incremental persistence: `run.json` is
      rewritten after every draw and **before** the job runs, so a crash leaves a cleanup
      manifest. Reads the ledger back with **`costStore.forJob(jobId)`**, which supersedes the
      "read a window and filter in memory" line in References above.
- [x] Per step and **per `AiJob`** — there is no `labels` step, so the hierarchy/labels split
      exists only in the second cut. Cost (BYOK-aware), calls, every token counter, gateway
      outcome *and* stage outcome, ledger wall-clock envelope *and* runner-measured elapsed.
- [x] Comparability metadata: commit (plus whether the tree was dirty), fixture sha256 hashed at
      run time against the manifest, observed block count against the manifest's, requested and
      answered model, upstream, service tier, effort. **Hierarchy's effort is read through
      `structureRequest`** rather than restated — the constant is module-private and has already
      moved once. Labels' is module-private with no exported reader; `commit` is what pins it.
- [x] Cold assertion, with `scope-leak`, `no-spend`, `unpriced` and `ledger-short` fatal and
      duplicate execution, gateway failures, call-count mismatches and unexpected paid steps
      reported rather than hidden. **A fatal finding stops the run**, so the next draw cannot
      spend measuring the same wrong thing.
- [x] Unit tests: `tests/cost-eval.test.ts`, 61 of them, no database and no network. Includes the
      dry pass's **control arm** as a test — the same stubbed step without the overlay records
      `job_step`, which is Product spend.
- [x] **Reviewed by GPT Sol, 2026-09-02: five P1s and three P2s, all fixed.** The review is
      `scratchpad/cost-runner-review-sol.md`; each finding was re-verified against the code before
      it was implemented. What changed, because four of them are traps the next harness would fall
      into too:
      1. **A stale fixture warned and spent anyway.** Every selected fixture is now hashed
         *before any job exists* (`verifyFixtures`); per-draw checking would let the first two
         articles be paid for before the third was found to have changed.
      2. **"Cold" never established that labels ran.** Both the structure call and every label
         batch carry `stepName: "hierarchy"`, so one priced row satisfied the step check even if
         the whole fan-out was skipped or lost. There is now an **`AiJob`-level** cold assertion
         (`mustPayJobs`) requiring `hierarchy` *and* `labels`. The first version's own tests hid
         this by giving label rows a `stepName` production cannot produce.
      3. **An open dev tab could steal the job.** `src/web/jobEngine.ts` drives every queued job
         of the owner it is signed in as, and `VERCEL=1` silences only this process's pump — so a
         browser winning a claim mid-job would run the remaining paid step through the
         **production** registry, into Product. There is now a dedicated **eval owner**
         (`EVAL_OWNER_ID` in [`src/owner.ts`](../../src/owner.ts), a third entry in
         `SEEDED_ACCOUNTS`), and the runner refuses to start unless its owner is distinct from
         `environmentOwnerId` and seeded.
      4. **The ledger could be short while every check passed.** Sink write failures are
         swallowed and a Postgres `forJob` reports `unreadable: 0` for a row that was never
         inserted. `AdvanceParts.onStepSpend` — an **observer**, added to
         [`src/jobs.ts`](../../src/jobs.ts) and the only production change this stage makes —
         hands the runner each step collector's counts, and calls-made is reconciled against
         rows-kept. An unpriced required step is now fatal too (`--allow-unpriced` overrides).
      5. **A non-zero bill is not a cold provider cache.** Compatible modes in one job share a
         cached article prefix, so the second one reads warm and still shows spend. The runner
         now refuses more than **one on-demand mode per job**; `--batched-modes` records that as a
         separate, labelled `scenario` which must not be aggregated with per-mode numbers.
      P2s: each `advanceJobWith` is wrapped in an outer attribution carrying the job id and slug
      (a future purchase in `commit` falls to the *outer* eval collector, which is eval-scoped but
      job-less, so `forJob` would never see it); the result directory carries the `runTag` and
      checkpoints are written by temp-file rename; and a dirty tree now records a
      `srcPatchSha256` over `src` and `evals` rather than being merely flagged — refusing a dirty
      tree would make the eval unrunnable on a checkout several agents share.
- [ ] **Not run against a model, and cannot be.** The `ai_calls` table still has
      `upstream_inference_nanos`, so every insert and select fails and `costStore.forJob` is
      unexercised — see the blocker above. Free end-to-end passes with `--steps
      fetch,extract,blocks` did run: all three fixtures through the fixture ingress, 19 and 186
      blocks matching the manifest exactly, cleanup returning the article and job counts to where
      they started, and `onStepSpend` reporting a call count for every step. Each gate was watched
      refusing: the local-target check, the stale fixture (no job created), two on-demand modes,
      and a fabricated phantom call producing a fatal `ledger-short` that stopped the run.
- [x] **Code review, GPT Sol: *"not ready for the first paid run — no P0s, five P1 correctness
      gaps"*** ([prompt](260902g-estimate-article-ingestion-and-mode-generation-costs-code-review-prompt.md),
      [review](260902g-estimate-article-ingestion-and-mode-generation-costs-code-review-sol.md)).
      All eight findings checked against the code before implementing; seven right as stated. Three
      of the five would have produced a **plausible wrong number** rather than an error, which is
      the whole reason a code review outranks a plan review here:
      - **A stale fixture warned and spent anyway** — hashed after the job was created. Now every
        selected fixture is hashed *before any job exists* and a mismatch aborts the run.
      - **"Cold" never established that labels ran.** Label rows carry `stepName: "hierarchy"`, so
        one priced structure row satisfied the check even if every label call vanished — and **the
        unit test hid it**, giving label rows a `stepName` production cannot produce. There is now
        an `AiJob`-level assertion and a real-shape test, watched red first.
      - **An open dev tab could steal the job** ([`src/web/jobEngine.ts`](../../src/web/jobEngine.ts)
        drives every queued job it can see for its owner), running the rest of it through the
        *production* registry and writing `job_step` rows into Product. The dedicated eval owner is
        therefore **required isolation, not a nicety**: `EVAL_OWNER_ID` in
        [`src/owner.ts`](../../src/owner.ts), a third entry in
        [`scripts/seed-accounts.ts`](../../scripts/seed-accounts.ts), and the runner refuses to
        start unless its owner differs from `environmentOwnerId`.
      - **The ledger can come back short while every check passes** — sink write failures are
        swallowed and a Postgres read cannot report a row that was never inserted.
      - **A non-zero bill is not a cold provider cache.** One on-demand mode per job is now
        enforced; batched modes are a separate labelled scenario.
- [x] **One production change, and it is an observer**: `AdvanceParts.onStepSpend` in
      [`src/jobs.ts`](../../src/jobs.ts) — handed each step's `SpendReport`, return value ignored,
      `undefined` in production. Nothing outside that file could otherwise learn how many calls a
      step made, and "calls made" against "rows kept" is the only thing that can notice a lost row.
      **Sol's proposed mechanism was wrong and was not taken**: `writeFailures` is a lower bound,
      because `collectSpend` calls `onDone` before it drains `box.writes`, so a late-rejecting
      write is never counted. The comparison is call counts, and both ends say so.
- [x] **The bug only running caught.** After wiring the eval owner, the gate passed and the
      isolation did not exist: the entrypoint still said `runAsOwner(environmentOwnerId(), main)`,
      so articles were still created under the environment owner. Read back from
      `articles.owner_id`, not inferred. Nothing but running it would have found this, which is
      [silent-success.md](../reusable/silent-success.md) in one line.
- [ ] Run on the short HTML fixture (expected well under $0.50 total). Commit runner + result.

### Stage: All modes, all three articles, with repeats where variance lives

- [ ] Extend to every per-article mode step (arc, tweets, glossary, quotes, ideas, timeline,
      quiz, sketch) plus article embeddings and referee stored artefacts, after ingest, cold,
      separable per (article, step).
- [ ] Long-article hierarchy: 3–5 independent cold draws under fresh slugs, interleaved; report
      the variation treatment from Principles.
- [ ] Per-interaction unit costs (chat turn, quiz marking, explain, search, referee per-turn,
      dictation): one sample call each or representative ledger rows; for request-path scenarios
      report cold first touch and warm later turn separately (the article cache is real there).
- [ ] Run over all three fixtures. Stop & review with Greg: the range, ranked expensive bits.

### Stage: Committed report + docs

- [ ] `evals/results/cost-per-article-<date>.md`: per-article × per-step table, range,
      cost-per-1k-words, per-interaction table, variation for long hierarchy, ranked expensive
      bits, exact reproduction command.
- [ ] Update [`evals/README.md`](../../evals/README.md); check where evals are signposted before
      adding lines elsewhere.
- [ ] `npm test` + `npm run typecheck`; `npm run lint` on touched files.

### Stage: Cost-reduction write-up

- [ ] Turn the appendix candidates into a recommendation ranked by measured saving × ease, each
      with its tradeoff named; decisions to Greg.

### Stage (follow-up plan, not this one): Model arms

- [ ] A separate plan once the baseline is committed: a per-stage model injection/bypass
      mechanism (the `MODEL_ENV_VAR` pipeline entries are deliberately null; Luna can't ride the
      Messages wire), paired with the existing quality evals so cost never picks a model alone.

## Appendix

### Observed named cases

Rewritten 2026-09-02 from the stage-1 aggregation; full tables and method in
[`evals/cost/baseline/stage1-baseline.md`](../../evals/cost/baseline/stage1-baseline.md).
**Split by effort**, because `fb82dc8` moved hierarchy from `high` to `medium` partway through
the ledger and the two halves are not comparable.

**Under current code** (`medium`, the only two clean observations we have):

| slug | words | ingest + first open | of which |
|---|---|---|---|
| `own-spya-bf6g9b` | 2,530 | **$0.0987** | hierarchy+labels $0.0814, arc $0.0173 |
| `replication-crisis-spya-hrjamq` | 21,200 | **$0.6100** | hierarchy+labels $0.5200, arc $0.0900 |

That is $0.032 and $0.025 per 1,000 words — **the long article is cheaper per word**, which is
the opposite of the shape the old appendix implied.

**Under the old `high` effort** (everything in the filesystem ledger): `read` 459 words,
hierarchy+labels **$0.047–0.078** per single execution; `what-if-we-had-bigger-brains…` 12,975
words, **$0.3639**, and **~$0.91** with arc, glossary, ideas and sketch added.

**Other measured units**: sketch $0.23 · ideas $0.17 · timeline $0.12–0.18 · quiz $0.079–0.110 ·
glossary $0.024–0.081 · quotes $0.029 · embeddings **$0.0006** per article · PDF extraction
$0.007–0.12 upstream on Luna, which is **8× cheaper than terra** on the same corpus. A chat turn
is $0.068 cold and $0.027 warm; quiz marking $0.050 cold and $0.0068 warm.

**Labelled extrapolations** (what the eval exists to replace): short article, every mode pressed,
~$0.25–0.35; 13k words ~$1.2–1.3; 21k words ~$1.5–2.0. None of those has been observed end to end
on one article — they are sums of single executions from different articles.

**Total historical spend, both ledgers: $31.22 over 601 rows, plus 39 unpriced rows that are
unknown rather than zero.** A naive `SUM` over the money columns gives $52.62, an 84%
overstatement — which is the double-count the cost-tracking plan's rename exists to kill.

### Cost-reduction candidates (Sol's re-ranking adopted; to be priced by the eval)

1. ✅ **Duplicate job execution** — the largest waste in our history by a distance:
   **$10.47–$10.81 of $31.22, a third of everything ever spent**, across five job/step groups.
   **Fixed 2026-09-02**
   ([260902c-the-truncation-retry-cost-storm.md](../postmortems/260902c-the-truncation-retry-cost-storm.md)):
   dev-server restarts were forgetting files-mode claims; pinned by
   `tests/two-servers-one-queue.test.ts`. Still open from that work, for Greg: two OS processes
   over one `data/` remain unfenced — Sol recommends `npm run dev` on Postgres by default or
   refusing a second files-mode server.
2. **Keep artefact modes on demand** (status quo, and the largest product-level saving already
   operating). One eager exception to reconsider: arc auto-fires on owner open
   (`src/web/useArc.ts`); tradeoff of changing it: the L0 column appears only after a press.
3. **Effort tuning** on the `high` modes, paired with quality measures per mode
   (effort-vs-quality already covers arc/glossary). Tradeoff: per-mode quality, decided by Greg.
4. **Cheaper models where selection is measurable** — search first; labels have volume but much
   higher product risk; quotes/glossary are cheap enough to rank lower. Tradeoff: quality,
   measured not guessed. Needs the arms follow-up.
5. **Remove the duplicate Force/Drift embedding purchase** (`similar.ts` not yet on the
   `article-vectors.ts` seam). Tiny, easy, tradeoff-free.
6. **Bound tool/web-search turns** where interaction data shows they dominate (explain has the
   web-search tool). Tradeoff: answer depth and external evidence.
7. **PDF chunk/retry policy** — only if measurement shows it matters.

Hierarchy split/resume work is a **latency/quality/engineering** question (see the stopped
260831ah), not a free cost win, and is not on this list.

### What the eval must not get wrong (traps already documented)

- Eval rows are excluded from `npm run cost` by design — self-report from the ledger.
- Nested `collectSpend` shadows; naive eval-scope wrapping records nothing (feasibility stage).
- Per-step wall clock = `max(finishedAt) − min(startedAt)`; add runner-measured elapsed for the
  free local work around the calls.
- Total = credits **plus** BYOK upstream nanos; unpriced rows are unknown, not zero.
- A $0 cold step is a failure of the eval; a $0 warm read in a request-path scenario is a
  finding.
- `gateway ok` ≠ `stage ok`; record both.
- Fresh article per independent draw; `force` does not bypass PDF checkpoints.
- Run against Postgres and **assert the local target before spending**. Since 2026-09-02
  `npm run dev` defaults to `postgres`; the CLI and the eval do not, so the runner still sets it.
- **Record effort and commit on every run.** A config constant moved mid-ledger and no row said
  so, which nearly made the baseline wrong by 2×. This is the trap that already bit us once.
- **Three steps have never been paid for at all** — `extract` (PDF extraction has never run
  through the job queue in either ledger), `tweets` (two CLI runs, both against the `claude-test`
  stub, both unpriced), and `timeline`/`quiz` outside CLI/eval scope. A number for those comes
  only from running them.
