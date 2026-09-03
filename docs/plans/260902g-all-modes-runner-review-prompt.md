# Review: the all-modes cost runner, before the first paid sweep

You are reviewing code in `/home/greg/code/spideryarn2/.claude/worktrees/cost-all-modes` (branch
`worktree-cost-all-modes`). Read the repo directly — the diff below is the change, but the
surrounding files are on disk and you should open them.

**The next thing that happens after this review is a run that spends real money** (~$6, authorised
up to $20), against a shared local Postgres, driving the production job queue. A wrong number here
does not fail loudly; it gets written into a report and quoted for months. Weight your review
accordingly: **a defect that produces a plausible wrong number outranks one that produces an
error.**

## What this stage is for

`docs/plans/260902g-estimate-article-ingestion-and-mode-generation-costs.md` is the plan. Read
`## Principles, key decisions`, the stage `### Stage: All modes, all three articles, with repeats
where variance lives`, and `### What the eval must not get wrong (traps already documented)`.

The eval measures what it costs to ingest an article and generate each reading mode. Existing
runner: `evals/cost/{run,harness,report,fixtures}.ts`, with `report.ts` pure and `harness.ts`
holding the pre-spend gates.

## The load-bearing decision you are being asked to attack

A per-mode cost must be **cold**. The runner previously minted a fresh slug and URL per draw, so
measuring eight modes meant paying for ingest eight times (~$3.40 of scaffolding per long fixture).

This stage instead **ingests once and runs each mode as its own job against the adopted article**.
The argument that this is still cold:

1. `runStep` sets `cacheArticle` from `sharesArticleCache(step, laterStepsOfTheSameJob)`
   (`src/pipeline.ts` ~line 289). A single-mode job's `later` list is empty, so it marks nothing
   and writes no cache entry for a later job to read.
2. Anthropic's cache is explicit-only (`cache_control`), so nothing warms implicitly.
3. Every article mode is Anthropic. The only OpenAI models in the app (`QUICK_MODEL_OPENROUTER`,
   `PDF_READER_MODEL`) are used in exactly one file, `src/pdf-read.ts` — and OpenAI *does* cache a
   repeated prefix automatically, which would span jobs. Contained because that is PDF extraction
   only, which this shape runs once per fixture rather than eight times.
4. Adoption is a designed path: a job with neither URL nor upload is `{kind: "adopted"}`
   (`src/jobs.ts` ~line 2221).

**Attack all four.** In particular: is there any route by which a second job reads a prefix the
first wrote — OpenRouter-side caching, a provider that caches regardless of `cache_control`, a
step that re-renders identical bytes, `assets`, embeddings, a retry path? If the argument is wrong,
the sweep buys seven warm modes and prices them as cold, and the fatal finding below is the only
thing between us and that.

## What was built

- `checkFirstCallCold` (`report.ts`) — on a `phase: "mode"` draw, the **earliest call by
  `startedAt`** with `cacheReadTokens > 0` is fatal. Earliest, not any, because a later call in the
  same step reading off the first is within-run caching the Principles deliberately keep. Silent
  under `--batched-modes`.
- `checkAdoption` (`report.ts`) — a mode job that minted instead of adopting is fatal; it would
  otherwise be a whole cold ingest reported under a mode's name, and every other check would pass.
- `observedVariation` (`report.ts`) — median, range, failure count, cost conditional on success,
  total paid. **No stddev and no tail probability, deliberately** (Principles; and n=4).
- `--all-modes`, `--modes`, `--against <slug>` in `run.ts`; cleanup now deletes only articles the
  run created.
- `evals/cost/interactions.ts` (new) — per-interaction unit costs (chat, explain, search, quiz
  marking, three referee tasks, dictation, embeddings), cold and warm separately, driven live.
  **Zero lines of `src/` changed**: the route handlers are module-private, so it calls the exported
  functions one layer down (`converse`, `explain`, `findPassages`, `markAnswer`, `runCriterion`,
  `runClaims`, `mirror`, `transcribe`, `articleVectors`), assembling arguments as `src/routes.ts`
  does.

## Specific questions

1. **Is the cold-per-mode argument sound?** See above. This is the review's main job.
2. **Does `checkFirstCallCold` actually fire when it should?** Consider: a mode whose step makes
   only one call; a mode that fails and retries; rows whose `startedAt` ties; a step that makes its
   first call *after* a cheaper one (does any mode make a small call first, which would become "the
   earliest" and mask a warm article call behind it?). That last one worries me most.
3. **Does `interactions.ts` record eval-scoped rows?** The claim is that the only request-path
   `collectSpend` is the one `handleApi` opens (`src/routes.ts` ~5640), and that none of the nine
   functions opens a nested collector or sets its own attribution — so calling them under
   `withLedger("eval", () => runAsOwner(EVAL_OWNER_ID, …))` carries eval scope. A nested collector
   shadows, and rows would silently land in Product. Verify independently.
4. **Cold vs warm in `interactions.ts`** — is what it calls "warm" actually warm, and "cold"
   actually cold? A warm number that is really cold understates the cache's value; the reverse
   overstates it.
5. **Cleanup.** It must delete only what the run created and must not touch `--keep` articles or
   anything belonging to another agent on this shared database. Check the failure paths.
6. **Anything that would make a number plausible and wrong**, especially: a mode counted twice, a
   draw whose cost includes work from a neighbouring draw, `--against` measuring a step that
   silently skipped on its `stepIsDone` stamp, or the variance summary averaging failed draws in
   with successful ones.

## Evidence

The scoped diff, then the full text of the new `evals/cost/interactions.ts`, follow. Unit tests:
`tests/cost-eval.test.ts`, 94 passing (was 64). `npm run typecheck` clean. Nothing under `src/`
changed — verify that claim from the diff.

Give findings as P0/P1/P2 with file and line, each with the concrete failure it would produce. Say
plainly whether this is ready for the first paid sweep.
