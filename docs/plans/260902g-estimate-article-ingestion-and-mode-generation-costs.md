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
  is not length-dependent. Consistent with the old files-mode queue; possibly already prevented
  by the Postgres attempt-token/lease claiming ([`src/jobs.ts`](../../src/jobs.ts)). **An Opus
  agent is root-causing and fixing/pinning this now** (dispatched 2026-09-02 at Greg's request,
  with its own plan + Sol reviews); this eval treats it as a separate historical anomaly, and
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

### Stage: Baseline from the ledger we already have (no code, no spend)

- [ ] Aggregate `data/_ai-calls.jsonl` (and the Postgres `ai_calls` table where populated) per
      slug × step × runId, **separating overlapping duplicate executions from single executions**
      and using BYOK-aware totals. Output the named-cases table into this doc's appendix,
      replacing the current one.
- [ ] Sanity-check against `npm run cost --reconcile` for the same period.
- [ ] Stop and show Greg: the observed range, labelled extrapolations, ranked expensive bits.
      This alone answers "roughly what does an article cost" — the rest buys repeatability and
      model comparison.

### Stage: No-spend feasibility — orchestration, attribution, fixtures

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

### Stage: Fixture corpus — three articles, held constant

- [ ] **Short HTML** (~1,000 words): pick from `tests/fixtures/data-root/` or
      `evals/extraction/fixtures/`.
- [ ] **Long/dense HTML** (10k+ words): find a licence-safe candidate (or snapshot
      `towards-a-theory-of-bugs…`'s source if licensing allows); check in with a hash as
      `evals/extraction/fixtures/hashes.json` does.
- [ ] **~20-page PDF**: check page counts of the existing `evals/pdf/` fixtures; add one near 20
      pages if needed (with LICENCE). Run `planChunks` on it (free) to learn the real chunk
      count rather than assuming pages/6.
- [ ] Record word/page/block/gistable counts per fixture so the report can show cost-per-1k-words.

### Stage: v1 runner — one article, end to end, cold

- [ ] **Gate: the cost-tracking plan has landed.** Check
      [260902g-cost-tracking-that-can-set-a-price.md](260902g-cost-tracking-that-can-set-a-price.md)
      and the `byok_upstream_nanos` rename in [`src/db/schema.ts`](../../src/db/schema.ts). Not
      landed → delay an hour or two and re-check until it has (see Principles). The rest of
      this stage is code and can be written and unit-tested meanwhile — only the first paid run
      waits on the gate.
- [ ] `evals/cost/run.ts`, modelled on `evals/hierarchy-structure/run.ts` (including incremental
      result persistence); `npm run eval:cost`. Production-path calls run under normal
      `collectSpend`; `declared-spend` only if any arm later bypasses the gateway.
- [ ] Drive the fixture through ingest via the design the feasibility stage chose, under a fresh
      run-prefixed slug. Read the ledger back (`CostStore.read` window + in-memory filter);
      capture reports via `onDone` so a thrown stage still reports; name an owner or no row is
      written.
- [ ] Per step, report: cost (BYOK-aware), calls, input/output/cache-read/cache-write/reasoning
      tokens, gateway outcome **and** stage outcome, ledger wall-clock envelope *plus*
      runner-measured elapsed time.
- [ ] Record comparability metadata per run: commit, fixture hash, block/gistable counts,
      requested and answered model, upstream, effort, service tier, geo, cache counters.
- [ ] Assert cold: every step expected to pay must have non-zero spend; flag unexpected call
      counts (duplicate execution would show here — report, don't hide).
- [ ] Unit-test the pure parts (ledger aggregation, BYOK totalling, report formatting) with
      fixture rows before the paid path runs.
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

### Observed named cases (from the existing ledger; extrapolations labelled)

| Case | Observed |
|---|---|
| `read`, 468 words / 23 blocks — hierarchy+labels, per single execution | **$0.047–0.078** (six overlapping duplicate executions in the file; per-execution is the honest unit) |
| `what-if-we-had-bigger-brains…`, 13,476 words / 172 blocks — hierarchy+labels | **$0.36** |
| same article + arc, glossary, ideas, sketch (the four measured modes) | **~$0.91** partial total; quotes/tweets/timeline/quiz unmeasured |
| `towards-a-theory-of-bugs…` — the duplicate-execution incident | $5.43 in one job (11 overlapping executions, distinct runIds; a *waste* incident, not a per-article cost) |
| PDF extraction, easy fixture | ~$0.01 (`evals/pdf/README.md`); full BYOK eval runs span ~$0.015–0.118 upstream |
| chat turn | ~$0.04 |
| embeddings per article | ~$0.0003 |

**Labelled extrapolations** (to be replaced by the eval): a short article with all per-article
modes pressed plausibly lands **under ~$1**; a long article **roughly $1–3**; per-run eval cost
over three fixtures with repeats, order of **$3–8**. The historical $5+ figures are duplicate
execution, not a cost any single ingest should pay.

### Cost-reduction candidates (Sol's re-ranking adopted; to be priced by the eval)

1. **Duplicate job execution** — the largest historical waste. Root-cause/fix already in flight
   (Opus agent, 2026-09-02) and **owned by that investigation, not this plan** — including the
   concurrency test that pins the guarantee if the Postgres queue already prevents it.
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
- Run with `SPIDERYARN_STORE=postgres`; assert the local target before spending.
