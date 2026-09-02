# Estimate article ingestion and mode generation costs

## Goal

Know what one article costs us in AI spend — the full ingestion queue plus every AI-powered
reading mode — for two or three representative articles (a ~1,000-word HTML page, a long/dense
HTML article, a ~20-page PDF). Build it as a repeatable eval so we can run it again and compare
models. Deliverables:

1. A **range** ("an article costs $X–$Y, with a tail to $Z"), per article shape.
2. A ranked list of **which bits are most expensive**.
3. **Cost-reduction suggestions**, each with the product tradeoff it would require, named so Greg
   decides rather than inherits.

This doc is the plan only — reviewed by GPT Sol before anything is built (Greg, 2026-09-02:
"For now, let's just write up a plan, with a review from GPT Sol, don't actually implement yet").
Other agents are concurrently building payments machinery and checking cost-tracking; this work
reads the cost-tracking machinery and must not modify it.

## Context: most of the machinery already exists

- **Cost capture is done.** Every paid call already lands in the `ai_calls` ledger
  ([`src/ai-spend.ts`](../../src/ai-spend.ts), sink [`src/store/ai-calls.ts`](../../src/store/ai-calls.ts))
  with OpenRouter's authoritative `usage.cost`, token breakdowns (input, output, cache read/write,
  reasoning), `job_id`, `step_name`, `article_slug`, `duration_ms`. `ScopeKind` already includes
  `"eval"`. We build a **harness that drives articles through the pipeline and reads the ledger
  back**, not new instrumentation.
- **We already have real numbers** (from `data/_ai-calls.jsonl`, 565 rows, files mode on Greg's
  laptop): happy-path ingest ≈ **$0.40/article** (hierarchy ~$0.24–0.30 + labels ~$0.09–0.15 + arc
  ~$0.06). The tail: on `towards-a-theory-of-bugs` the hierarchy step ran **11 paid calls in one
  job, $5.43** — every call hit its `max_tokens` cap, produced truncated JSON, and the queue
  retried the whole 8-minute call. Adjacent jobs on the same slug: $5.05, $0.82. **Any estimate
  ignoring retry-on-truncation on long articles is off by an order of magnitude**, and it is where
  the money actually is. See [260826a-toc-max-tokens.md](../postmortems/260826a-toc-max-tokens.md).
- **Only five steps run at ingest** (`DEFAULT_INGEST_STEPS`, [`src/pipeline.ts`](../../src/pipeline.ts)):
  fetch, extract, blocks, hierarchy (+labels fan-out), assets. Of those, only hierarchy/labels pay
  (extract pays too, but only for PDFs). Everything else — arc, tweets, glossary, quotes, ideas,
  timeline, quiz, sketch — is **on-demand**, one job per mode press; arc also auto-fires when an
  owner opens an article. **Summary mode is free** since 2026-08-31: no stage, it draws the gists
  hierarchy already wrote ([summaries.md](../project/summaries.md)).
- **One model does nearly everything**: `anthropic/claude-sonnet-5` on both wires
  ([`src/models.ts`](../../src/models.ts)). Exceptions: PDF extraction (`openai/gpt-5.6-luna`,
  per-chunk), embeddings (`voyageai/voyage-4`, ~$0.0003/article), dictation
  (`google/gemini-3.1-flash-lite`). Per-job env overrides (`SPIDERYARN_*_MODEL`,
  `SPIDERYARN_PIPELINE_EFFORT`, `MODEL_ENV_VAR` table in `src/models.ts`) are the eval's
  arm-switching mechanism — no new plumbing needed.
- **An arms-style eval harness exists**: `evals/hierarchy-structure/` (`run.ts`,
  `model-arms.ts`, `corpus.ts`) is the template. Paid evals must use the
  [`evals/declared-spend.ts`](../../evals/declared-spend.ts) wrapper
  (`tests/no-undeclared-spend.test.ts` enforces it).

## References

- [`src/pipeline.ts`](../../src/pipeline.ts) — `STEP_ORDER`, `DEFAULT_INGEST_STEPS`, the step
  implementations; which steps pay and what each prompt contains.
- [`src/ai-spend.ts`](../../src/ai-spend.ts) / [`src/store/ai-calls.ts`](../../src/store/ai-calls.ts) —
  the ledger the eval reads back (`collectSpend`, `scopeKind: "eval"`, `runId`).
- [ai-gateway.md](../project/ai-gateway.md) — the two wires; also §345–383: summing `durationMs`
  is wrong, use `max(finishedAt) − min(startedAt)` filtered on `scopeKind` **and** `runId` (three
  workstreams got this wrong in one day).
- [260827q-ai-cost-tracking.md](260827q-ai-cost-tracking.md),
  [260827d-ai-cost-tracking-options.md](../research/260827d-ai-cost-tracking-options.md) — the
  cost-tracking work this reads from; the research doc opens with exactly this question ("what did
  ingesting this article cost?") and records it as unanswered-by-a-runner.
- [prompt-caching.md](../project/prompt-caching.md) — what caching actually does today, including
  that on the normal add path the pipeline cache breakpoints **lose money** (1.25× write premium,
  no later reader in `DEFAULT_INGEST_STEPS`), and that labels' shared prefix is under the
  1,024-token cache floor so caches nothing on real articles.
- [`src/token-budget.ts`](../../src/token-budget.ts) +
  [260826a-toc-max-tokens.md](../postmortems/260826a-toc-max-tokens.md) — the machinery behind the
  truncation-retry tail.
- [`src/pdf-read.ts`](../../src/pdf-read.ts) — PDF chunking (≤6 pages/chunk), per-chunk response
  cache keyed on prompt version: re-runs are free, which a cost eval must defeat, not inherit.
- `evals/hierarchy-structure/`, [`evals/README.md`](../../evals/README.md) — harness template and
  the rules (eval rows are deliberately **excluded** from `npm run cost`; the eval self-reports by
  querying the ledger for its own `runId`).
- [`evals/results/effort-vs-quality.md`](../../evals/results/effort-vs-quality.md) — arc/glossary
  at `medium` vs `high` already measured; input to the cost-reduction section.
- Fixtures: `tests/fixtures/data-root/` (5 HTML articles), `evals/pdf/{easy,harder,much-harder}/`
  (licensed PDFs), `evals/extraction/fixtures/` (21 hard HTML pages).
- [260831ah-toc-on-request-and-the-tree-that-costs-nothing.md](260831ah-toc-on-request-and-the-tree-that-costs-nothing.md)
  — a stopped plan that bears on the hierarchy cost; read before proposing hierarchy changes.

## Principles, key decisions

- **All modes, not just three** (Greg, 2026-09-02). Core table covers ingestion + Hierarchy,
  Summary, Glossary; the eval also runs every other per-article mode step so we see the full
  worst-case "reader pressed everything" cost.
- **Real runs, not a dry-run estimator** (Greg, 2026-09-02). The eval ingests fixtures for real
  through OpenRouter and reads actual usage from the ledger. True numbers including cache and
  retry behaviour; costs real money per run (est. $2–10 per full cold run over three articles —
  see appendix; model arms multiply this).
- **Simpler option passed over: no runner, just aggregate the existing ledger.** We *do* do that
  first (stage one, free, immediate range) — but it can't compare models, can't hold fixtures
  constant, mixes warm and cold cache, and the modes barely appear in it (most have 1–2 rows).
  Repeatability needs the runner.
- **Cold cost is the number.** The content-hash caches (`articleFingerprint` on the mode steps,
  the per-chunk PDF cache) make a re-run silently cost $0 — a classic
  [silent success](../reusable/silent-success.md). The runner must force cold runs (the pipeline's
  `force` mechanism; a fresh PDF cache location) and assert non-zero spend per paid step.
- **Per-article vs per-interaction, kept separate.** Modes that generate one artefact per article
  (arc, tweets, glossary, quotes, ideas, timeline, quiz-generation, sketch, hierarchy, extract)
  are measured per article. Per-interaction features (chat turn, quiz marking, comment explain,
  search, remember, dictation, embeddings, glossary term lookup) are reported as **per-interaction
  unit costs** — one sample real call each, or existing ledger rows — never folded into the
  per-article number, because usage count is a product unknown.
- **Read-only towards the cost-tracking machinery.** Other agents are working in it; this plan
  adds an eval that consumes it. If the ledger schema moves under us, adapt the eval, don't touch
  the ledger.
- **Out of scope**: live conversation (OpenAI Realtime, browser-direct, invisible to the ledger —
  known and accepted, [ai-gateway.md](../project/ai-gateway.md)); infrastructure costs (Vercel,
  Supabase); implementing any cost reduction (this plan only names and prices the options).

## Stages & actions

### Stage: Baseline from the ledger we already have (no code, no spend)

- [ ] Aggregate `data/_ai-calls.jsonl` (and the Postgres `ai_calls` table where populated) per
      slug × step: cost, calls, tokens, retries. A short script or even a jq one-liner; output a
      table into this doc's appendix.
- [ ] From it, publish the **prior**: happy-path ingest cost, per-mode costs where rows exist, and
      the truncation tail, with slugs named.
- [ ] Sanity-check against `npm run cost --reconcile` for the same period.
- This stage alone answers "roughly what's the range and what's expensive" — the rest buys
  repeatability and model comparison. Stop and show Greg before building the runner.

### Stage: Fixture corpus — three articles, held constant

- [ ] **Short HTML** (~1,000 words): pick from `tests/fixtures/data-root/` if one fits, else from
      `evals/extraction/fixtures/`.
- [ ] **Long/dense HTML** (10k+ words, the shape that triggers the truncation tail): nothing
      checked in is known to qualify — find a licence-safe candidate (or snapshot
      `towards-a-theory-of-bugs`'s source if licensing allows) and check it in with a hash, the
      way `evals/extraction/fixtures/hashes.json` does.
- [ ] **~20-page PDF**: pick from `evals/pdf/` (check page counts of `easy`/`harder`/
      `much-harder`; add one if none is near 20 pages — with LICENCE, as the existing ones have).
- [ ] Record word/page/block counts for each in the eval's corpus file so the report can show
      cost-per-1k-words.

### Stage: v1 runner — one article, end to end, cold

- [ ] `evals/cost/run.ts`, modelled on `evals/hierarchy-structure/run.ts`; wire in
      `evals/declared-spend.ts`; add `npm run eval:cost`.
- [ ] Drive the fixture through the ingest steps in-process (the same step functions the queue
      calls), inside a `collectSpend` scope with `scopeKind: "eval"` and a fresh `runId`, with
      `force` set so every paid step runs cold. Note: the eight article-reading stage CLIs were
      deleted 2026-09-01; in-process invocation or `POST /api/jobs` are the two routes — decide at
      implementation time, prefer in-process (no server dependency).
- [ ] Read the ledger back by `runId` + `scopeKind`; print per-step: cost (USD), calls (so retries
      are visible), input/output/cache-read/cache-write/reasoning tokens, and wall clock as
      `max(finishedAt) − min(startedAt)`.
- [ ] Assert non-zero spend on every step expected to pay; fail loudly if a step cost $0
      (cache leak) or a step ran more calls than expected (retry storm — report, don't hide it).
- [ ] Tests before code where they're cheap: the ledger-readback aggregation and the report
      formatting are pure functions — unit-test those with fixture rows; the paid path is
      exercised by running the eval itself.
- [ ] Run it on the short HTML fixture. Expected ≈ $0.40. Commit the runner and the first result.

### Stage: All modes, all three articles

- [ ] Extend the runner to fire every per-article mode step (arc, tweets, glossary, quotes,
      ideas, timeline, quiz, sketch) after ingest, still cold, still one `runId` per
      (article, step) so steps are separable.
- [ ] Add the per-interaction unit costs: one sample call each for chat turn, quiz marking,
      explain, search, embeddings (or reuse existing ledger rows where they're representative);
      report per-unit, in a separate table.
- [ ] Run over all three fixtures. Watch the long article for the truncation tail — if hierarchy
      retries, that *is* the finding; record it, don't re-run until it goes away.
- [ ] Stop & review with Greg: the range, the ranked expensive bits.

### Stage: Committed report + docs

- [ ] Write `evals/results/cost-per-article-<date>.md`: per-article × per-step cost table, the
      range, cost-per-1k-words, the per-interaction table, ranked expensive bits, and the exact
      command to reproduce.
- [ ] Update [`evals/README.md`](../../evals/README.md) with the new runner; add a line to
      [code-quality-overview.md](../project/code-quality-overview.md) only if that's where evals
      are signposted (check; don't duplicate).
- [ ] `npm test` + `npm run typecheck`; `npm run lint` on touched files.

### Stage: Model arms (only after the baseline is committed)

- [ ] Add `--arm` support (as `hierarchy-structure` does) using the existing
      `SPIDERYARN_*_MODEL` / `SPIDERYARN_PIPELINE_EFFORT` env overrides. First arms: the top two
      expensive stages from the baseline (expected: hierarchy, then PDF extract or sketch).
- [ ] Candidate arms: `claude-haiku-4-5` and `gpt-5.6-luna` for stages currently on sonnet-5;
      `medium` vs `high` effort where [effort-vs-quality.md](../../evals/results/effort-vs-quality.md)
      hasn't already answered it.
- [ ] **Cost alone can't pick a model** — pair each arm's cost with the existing quality evals for
      that stage (`eval:hierarchy`, extraction corpus, effort-vs-quality) and report both columns.
- [ ] Stop & review with Greg before any model change ships.

### Stage: Cost-reduction write-up

- [ ] Turn the appendix's candidate list (below) into a recommendation ranked by saving × ease,
      each with its product tradeoff named, informed by the measured numbers. Deliver as a section
      of the results doc, decisions to Greg.

## Appendix

### Preliminary range (from existing ledger data, before any new runs)

Treat as priors to be replaced by the eval:

| Article shape | Ingest (fetch→hierarchy) | + all per-article modes | Tail |
|---|---|---|---|
| ~1k-word HTML | ~$0.30–0.45 | ~$0.9–1.6 (arc .06, glossary .06/pass, quotes .03, ideas .17, sketch .23, tweets/timeline/quiz ~.05–.20 each) | — |
| long/dense HTML | $0.4–0.8 happy path | ~$1.5–3 | **$5–6+** when hierarchy hits retry-on-truncation |
| ~20-page PDF | ingest + extract: ~4 luna chunks, price unmeasured (est. cents, to be measured) | as HTML + extract | chunk retries |

Per-interaction (rough, from ledger): chat turn ~$0.04, embeddings ~$0.0003/article,
quiz-mark/explain/search unmeasured.

**Eval run cost**: three articles, cold, all modes ≈ $2–10 per full run (the long article
dominates; a truncation storm could double it). Arms multiply by the number of arms.

### Cost-reduction candidates (to be priced by the eval, tradeoffs named now)

1. **Stop paying for retry-on-truncation** (hierarchy, long articles). The queue re-runs the whole
   8-minute call when output hits `max_tokens`; three jobs on one slug cost $11+. Fix is
   engineering (detect truncation and split/resume rather than retry whole; see the stopped plan
   260831ah before redesigning). **Product tradeoff: none.** Expected biggest single saving.
2. **Effort tuning** on modes running at `high` (arc, ideas, timeline, quiz, sketch, tweets).
   effort-vs-quality already measured arc/glossary; extend per mode. **Tradeoff: per-mode output
   quality — decided per mode, by Greg, with the quality eval in hand.**
3. **Cheaper model for cheap-safe stages** (quotes, glossary, labels are candidates; the quick
   tier exists in `src/models.ts` and nothing uses it today). **Tradeoff: quality; measured, not
   guessed, via the arms stage.**
4. **Fix or drop the losing cache breakpoints on the ingest path** — today they pay the 1.25×
   write premium with no later reader ([prompt-caching.md](../project/prompt-caching.md)). Small,
   tradeoff-free. The bigger caching play — batch several mode generations into one job so they
   share one cache entry within the TTL — **trades away on-demand**: you pay eagerly for modes
   nobody opens, and on-demand is itself the biggest cost saver we already have.
5. **Keep modes on-demand** (status quo; worth stating because it's doing more work than anything
   we might add). One eager exception to reconsider: arc auto-fires when an owner opens an
   article (`src/web/useArc.ts`). **Tradeoff of changing it: the L0 column appears only after a
   press.**

### What the eval must not get wrong (traps already documented)

- Eval rows are excluded from `npm run cost` by design — self-report by `runId`.
- Wall clock = `max(finishedAt) − min(startedAt)`, never `sum(durationMs)`.
- A $0 step is a failure of the eval (warm cache), not a saving.
- `npm run pdf` re-pays for chunks the queue would resume ([setup-dev.md](../project/setup-dev.md));
  drive PDFs the way the queue does, or account for it.
- Store: run with `SPIDERYARN_STORE=postgres` like everything else new.
