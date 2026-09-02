I found three blockers and several methodological issues. The plan’s goal is sound, but the runner and the claimed hierarchy tail do not match the current code.

## Blockers

1. **Blocker — the $5.43 “truncation retry tail” is misdiagnosed.**

The plan says one job retried eleven sequential truncated hierarchy calls and that every call hit `max_tokens` (`docs/plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md:28`). The ledger shows eleven distinct `runId`s whose calls overlap:

- The first starts at 17:48 and finishes at 17:53 (`data/_ai-calls.jsonl:232`).
- Several more start at 17:50–17:53, before the first finishes (`data/_ai-calls.jsonl:236`).
- One run succeeds far enough to generate four label batches (`data/_ai-calls.jsonl:240`); other hierarchy calls continue afterwards (`data/_ai-calls.jsonl:245`).

The exact totals are 11 hierarchy calls / 11 run IDs / $5.427476, plus four labels, for $5.572911. Several calls emitted fewer than the 52,225-token ceiling, so “every call hit max_tokens” is also false.

This is an overlapping duplicate-execution incident—consistent with the old files-mode queue—not one retry chain. The same pattern appears on the tiny `read` article: six overlapping hierarchy executions under one job.

Current behavior has also changed:

- Hierarchy now runs at `medium`, specifically because this article filled the ceiling at `high` (`src/hierarchy.ts:63`).
- A hierarchy truncation is a `bug` failure with no Retry button (`src/token-budget.ts:199`, `src/hierarchy.ts:1495`).
- Only a label batch deliberately retries its own incomplete call (`src/labels.ts:2211`).

Therefore one new long-article run cannot characterize or reproduce the historical $5 tail. Split this into:

- stochastic hierarchy cost/truncation under current code; and
- the historical operational duplicate-execution anomaly, checked with a non-paid concurrency test of current Postgres claiming.

2. **Blocker — the proposed runner cannot simultaneously use the production queue, `force`, and an eval-scoped `runId`.**

The plan proposes direct step calls “inside `collectSpend`, scopeKind: eval” while using queue `force` (`docs/plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md:140`). These belong to different layers:

- `force` is a `JobStep` flag consumed in `runStep`; it is not a step-function argument (`src/jobs.ts:436`, `src/pipeline.ts:633`).
- Production `runStep` opens its own collector with `scopeKind: "job_step"` (`src/jobs.ts:572`).
- Nested collectors shadow the outer collector entirely (`src/ai-spend.ts:591`). Wrapping `enqueue` or `advanceJob` in an eval collector will therefore produce no eval rows.
- Calling `STEPS[name].run` directly returns an unpublished product. The queue also owns `beginStep`, atomic commit, postconditions and job transition (`src/jobs.ts:559`, `src/jobs.ts:612`). The Postgres session requires a claimed job and attempt token (`src/store/pg-session.ts:235`).

The fixed HTML fixtures add another coupling: stage 1 hardcodes `fetchDocument` (`src/pipeline.ts:1394`), which accepts only HTTP(S) and rejects local/loopback sources (`src/fetch.ts:804`). A checked-in HTML file cannot traverse the full production queue without a new fixture-input seam; refetching its original URL no longer holds bytes constant.

Add a no-spend feasibility stage before corpus work. It must choose one real design:

- a production queue route with an explicit eval attribution seam; or
- an eval coordinator that faithfully implements session begin/run/commit.

The latter is probably over-built. The former requires coordination with the agents changing cost attribution; it cannot remain “decide at implementation time” while cost machinery is read-only.

3. **Blocker for the arms stage — pipeline model overrides do not exist.**

The plan says `SPIDERYARN_*_MODEL` and `MODEL_ENV_VAR` can switch pipeline stages without plumbing (`docs/plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md:41`). Every pipeline entry in `MODEL_ENV_VAR` is explicitly `null` (`src/models.ts:630`). Only the global effort override exists.

Luna also cannot simply replace Sonnet on the Messages-shaped pipeline wire; the code says that requires a protocol rewrite (`src/models.ts:68`). The hierarchy arms harness works by using declared transport bypasses precisely because production owns the model and wire (`evals/hierarchy-structure/model-arms.ts:12`).

Move model arms to a follow-up plan, or explicitly budget a stage-specific injection/bypass and its quality eval. Do not present it as existing configuration.

## Should-fix findings

- **Ledger readback mostly works, with qualifications.** Both stores preserve `runId` and `scopeKind`, but `CostStore` has no `forRun`; the runner must perform a bounded `read(since, until)` and filter in memory (`src/store/contracts.ts:1310`). Postgres has no run-ID index, only owner/time, job and scope/time indexes (`src/db/schema.ts:2133`). That is acceptable at current size.

  The collector must name an owner or it writes no row (`src/ai-spend.ts:733`). It must also capture the report through `onDone`, because a thrown stage never returns its report (`src/ai-spend.ts:638`). Persist results incrementally, as the hierarchy harness does (`evals/hierarchy-structure/run.ts:442`).

- **Use `totalRows`, not `creditsUsedNanos` alone.** Luna’s existing PDF rows are BYOK: OpenRouter credits are `$0`, while `upstreamInferenceNanos` contains the real cost (`data/_ai-calls.jsonl:265`). The existing total deliberately handles this distinction (`src/store/ai-calls.ts:55`). The 565-row ledger also contains 39 unpriced rows; those are unknown cost, not zero.

- **`declared-spend.ts` is not the normal wrapper.** It exists for evals that bypass the two gateways (`evals/declared-spend.ts:17`). Ordinary production calls need `collectSpend`/`withLedger`; only model arms that bypass the gateway need declared transport.

- **The PDF cold-cache prescription is wrong.** There is no fresh filesystem PDF-cache location now. Files mode uses `nullCheckpointStore` and never resumes (`src/store/checkpoints.ts:429`). Postgres checkpoints are article-scoped, while the key includes source bytes, pages, context, prompt, reader and token ceiling (`src/pdf-read.ts:1014`). `force` does not bypass them.

  Use a fresh eval article ID for each independent PDF draw. Preserve normal within-run chunk and label caching—it is part of production cost, not contamination.

- **Cold should remain the headline, but call it “cold first generation.”** It is the right primary number for stored article artefacts. Also report legitimate warm/resume costs separately rather than declaring every `$0` a harness failure.

  Standalone pipeline mode jobs set `cacheArticle` only when a compatible later step exists in the same job (`src/jobs.ts:499`); waiting for the prompt-cache TTL between ordinary mode steps is unnecessary. Request-path search/chat/explain do have explicit per-task article caches (`docs/project/prompt-caching.md:40`), so their scenarios should distinguish first cold touch from a subsequent warm turn.

- **One hierarchy draw is not a tail estimate.** Run all fixtures once, then repeat only long hierarchy—at least three, preferably five independent cold draws—interleaved as the existing harness does (`evals/hierarchy-structure/run.ts:469`). Report median, range, truncation/semantic-failure count, cost conditional on success and total paid cost. With that sample size, call it observed variation, not a percentile or tail probability.

  The ledger’s `outcome: "ok"` only means the gateway returned. Truncation, malformed JSON or structural rejection happen afterwards; record the stage/job outcome beside spend.

- **“Every AI-powered mode” is incomplete.** `Task` also includes four referee tasks (`src/models.ts:339`). Diagram modes are also misclassified: Force and Drift make cold article-embedding purchases, cached only in process, and currently can buy the same vectors twice (`src/article-vectors.ts:17`). Classify these as cold first-open article-mode costs, not generic per-interaction costs. Referee claims/criteria, mirror and candidates need explicit stored-artifact versus per-turn classifications.

- **Add shared-state safety before the first paid run.** Postgres runs will create articles, revisions, jobs, blobs, checkpoints and mode artefacts. Require:

  - a local-target assertion;
  - an existing dedicated eval owner;
  - collision-proof run-prefixed slugs;
  - recording every created article/job ID;
  - precise cleanup of only those rows, while retaining ledger history.

  The schema supports this: deleting an eval article clears `ai_calls.article_id` but preserves its slug and spend row (`src/db/schema.ts:2017`); checkpoints cascade with the article.

- **Record comparability metadata.** Save commit, raw fixture hash, blocks hash/count, gistable count, profile choice, requested and answered model, upstream, effort, routing/service tier/geo and cache counters. OpenRouter’s provider choice is a preference with fallback, so upstream can vary even with a fixed requested model (`docs/project/ai-gateway.md:256`). Adaptive reasoning is visibly variable and expands with available room (`src/token-budget.ts:55`).

- **Ledger wall time is only the paid-call envelope.** `max(finishedAt)-min(startedAt)` is correct for calls belonging to one step (`docs/project/ai-gateway.md:345`), but excludes free local work before/after them. Keep it, and add runner-measured step and full-ingestion elapsed time.

## Preliminary priors

The table is not defensible as an article-shape range yet:

- `read` is 468 words / 23 blocks. Its six individual hierarchy+label executions cost `$0.0470–$0.0777`, not `$0.30–$0.45` (`data/_ai-calls.jsonl:67`). The six-call total is duplicate execution and must not be treated as one ingest.
- `what-if-we-had-bigger-brains…` is 13,476 words / 172 blocks. Its hierarchy+labels cost `$0.3639` (`data/_ai-calls.jsonl:26`). Adding the four measured modes—arc, glossary, ideas and sketch—brings the observed partial total to about `$0.91`, before quotes/tweets/timeline/quiz. That supports “roughly one to a few dollars for a long article,” but not a `$1.5–$3` measured range.
- PDF cost is already partly measured, contrary to “unmeasured”: the PDF README reports the easy fixture at about a penny (`evals/pdf/README.md:19`), while full BYOK eval runs in the ledger span roughly `$0.015–$0.118` upstream depending on fixture/calls. A 20-page estimate must first run `planChunks`; four chunks is not guaranteed because dense pages can become one-page chunks (`src/pdf-read.ts:148`).
- The `$2–$10` whole-run estimate has a plausible lower order of magnitude, but its upper end and “storm could double it” rely on the misclassified duplicate-execution incident.

Replace the appendix with observed named cases and explicitly labelled extrapolations until the fixed corpus runs exist.

## Cost-reduction candidates

I would re-rank them:

1. Audit/prevent duplicate job execution if current Postgres claim tests do not already prove it. It is the largest historical waste, but may already be obsolete.
2. Keep artefact modes on demand. This remains the largest product-level saving.
3. Tune effort on expensive `high` modes, paired with their quality measures.
4. Evaluate cheaper models first for measurable selection tasks such as search; labels have greater volume but much greater product risk. Quotes/glossary are cheap enough to rank lower.
5. Remove the duplicate Force/Drift embedding purchase. Tiny saving, but easy and tradeoff-free.
6. Bound tool/web-search turns where interaction data shows they dominate; the tradeoff is answer depth and external evidence.
7. Revisit PDF chunk/retry policy only if measurement shows it matters.

Delete candidate 4’s claim that normal pipeline cache breakpoints currently lose money: caching is already conditional and off by default (`docs/project/prompt-caching.md:128`). Recast hierarchy split/resume as a quality/engineering tradeoff, not “product tradeoff: none.”

**Verdict: rework.** Before approval, correct the historical tail diagnosis; add a no-spend orchestration/attribution feasibility stage; specify fresh-article cache and shared-DB isolation; add repeated long-hierarchy treatment; complete the mode inventory; use BYOK-aware totals; replace the preliminary ranges with observed named cases; and defer model arms until a real model-injection mechanism is chosen.