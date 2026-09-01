# GPT Sol review prompt — prompt caching

**This review has been run.** The verdict is in
[260826i-prompt-caching-sol-review.md](260826i-prompt-caching-sol-review.md), 2026-08-26, `gpt-5.6-sol` at
`--effort high`. The prompt below is kept because it is what produced it.

## What the two failed attempts were actually about

Two earlier runs died without a verdict, and this file used to blame the effort tier — it said to run
at `medium` or lower, because a `high` run had burned 165,802 tokens and stopped mid-review. That
diagnosis was wrong. The workspace was out of credits, and the tier only decided how far the run got
before the money ran out. The proof is a `gpt-5.6-luna` `--effort low` probe with a five-word prompt,
which failed identically.

What fixed it was **`CODEX_API_KEY`**, which takes precedence over a logged-in `~/.codex/auth.json`
rather than being ignored because one exists — so a credits-exhausted subscription and a working key
are a fallback pair. With the key set for the single command, `high` ran to completion in 13 minutes.
See [../reusable/codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md).

The general lesson is the one in that doc's gotchas: **running out of credit looks like a generic
non-zero exit.** `codex exec` exits 1 and the wrapper says `codex exec exited 1`; the real reason is
only in the activity log. Read it before theorising about the prompt, as I did twice.

```bash
CODEX_API_KEY=… npx tsx scripts/run-codex.ts \
  --model gpt-5.6-sol --effort high \
  --prompt-file docs/plans/260826g-prompt-caching-review-prompt.md \
  --output /tmp/sol-caching-review.md --quiet --timeout-minutes 45
```

---

Review the prompt-caching work in this repo (Spideryarn, TypeScript/ESM). Read
[docs/project/prompt-caching.md](../project/prompt-caching.md) first — it is the operating manual —
then [docs/plans/260826g-prompt-caching.md](260826g-prompt-caching.md) for the reasoning, then the three research
docs under `docs/research/prompt-caching-*.md`.

The code that changed:

- **New** [`src/article-prompt.ts`](../../src/article-prompt.ts) — the one article renderer
- [`src/search.ts`](../../src/search.ts), [`src/explain.ts`](../../src/explain.ts),
  [`src/converse.ts`](../../src/converse.ts) — request-path calls, now with breakpoints
- [`src/labels.ts`](../../src/labels.ts) — `batchParts`, and a staggered fan-out
- [`src/glossary.ts`](../../src/glossary.ts), [`src/arc.ts`](../../src/arc.ts),
  [`src/tweets.ts`](../../src/tweets.ts) — article moved into a cached `system` block
- `src/summarise.ts` — `repair` moved out of position zero
- [`src/pipeline.ts`](../../src/pipeline.ts), [`src/toc.ts`](../../src/hierarchy.ts) — cache counts logged
- **New** [`tests/article-prompt.test.ts`](../../tests/article-prompt.test.ts),
  [`evals/prompt-caching.ts`](../../evals/prompt-caching.ts) and
  [`evals/reorder-quality.ts`](../../evals/reorder-quality.ts)

The caching eval has been **run against the live API** and all three articles pass — results and the
cost arithmetic in [`evals/results/README.md`](../../evals/results/README.md). So the question is no
longer "does it cache" but "is it caching the right things, and is anything net-negative".

I want a hard technical review, not encouragement. Cite `file:line`.

## What I most want checked

**A. Is the mechanism right?**
- The pipeline stages now pass `system` as an **array** — `[{article, cache_control}, {SYSTEM}]` —
  alongside `thinking: { type: "adaptive" }` and `output_config: { effort }`. Is that valid for the
  Anthropic SDK, and does the breakpoint really cover tools+system as claimed? It typechecks; that
  is not the same as being right.
- `search` and `explain` send array `content` with `cache_control` on the first part; `converse`
  sends a **top-level** `cache_control` with plain-string messages. Is each correct for OpenRouter
  against `anthropic/claude-sonnet-5`? Does the array form survive OpenRouter's translation?
- Is the claim right that **three** separate caches (not one) are unavoidable for search / chat /
  explain because tools and system differ ahead of the article?

**B. Hunt for invalidation bugs the work has not noticed.** This is the highest-value part. Anything
non-deterministic or per-call landing *inside* an intended cached prefix. Known and fixed:
`←READER IS HERE` in the article body, glossary's growing `${already}` list, summarise's prepended
`repair`. Two more were found by running the eval against the live API rather than by reading:
`cache_write_tokens` read one level too high (it is nested in `prompt_tokens_details`), and
`tooShortToCache` measuring the marked block rather than the whole prefix. **What was missed?** Check every rendering function for interpolated state, Map/Set
iteration order, or metadata that varies per run.

**C. Cross-stage sharing.** `arc`, `tweets` and `glossary` are supposed to now emit a byte-identical
`articleText(meta, blocks)` as `system[0]`. Verify they really do — including that all three load
`meta` the same way and handle a missing `meta.json` identically. If they differ by even a line, the
sharing silently does not happen.

**D. The staggered fan-out.** `labels.ts` starts its p-queue at `concurrency: 1` and sets
`queue.concurrency = CONCURRENCY` after the first batch returns. Is that correct with p-queue? Is
there a race, or a case where it stays at 1? Is the wall-clock cost worth it?

**E. Is anything now net-negative?** A cache write costs 1.25× and a prefix used once never earns it
back. Are any of the marked prefixes single-use in practice? Specifically: `glossary` when it runs
exactly once, and `arc`/`tweets` if they never run within the 5-minute TTL of another stage.

**F. Testing.** `tests/article-prompt.test.ts` is deterministic and cannot prove anything is cached;
`evals/prompt-caching.ts` makes real calls and can. Is the deterministic surface sufficient for the
realistic regressions? What is missing? Does anything claim to test what a pure test cannot?

**G. Deliberate omissions — argue with them.** Summaries got the `repair` fix but **no breakpoint**
(its text is scoped per batch, so batches mostly share nothing, and another agent was concurrently
restructuring that prompt). `toc` is uncached (one call per article). The 1-hour TTL and pre-warming
are unused. Provider routing is `order: ["anthropic"]` **without** `allow_fallbacks: false`, so an
outage degrades to a cache miss rather than a hard failure on a reader-facing call. Are these right?

**H. Anything simply wrong**, or contradicting the research docs or the code.

## Output

A prioritised list. For each: severity (blocker / should-fix / nice-to-have), the claim or line at
fault with `file:line`, why it is wrong or risky, and the concrete fix. Then a verdict: is this safe
as written, and what would you change first.

Do not edit any files — review only.
