Verdict: functionally valid, but not safe to call complete as a caching optimisation. The main pipeline-sharing claim is false, the live eval covers only search, and several marked prefixes are probably net-negative.

The requested command could not start in this read-only sandbox: `tsx` failed creating its IPC socket, then `run-codex.ts` failed creating its temporary directory. No `/tmp/sol-caching-review.md` was produced. This is my direct review; no files were edited.

## Findings

1. **Should-fix — `glossary` cannot share the claimed pipeline cache.**

   `docs/project/prompt-caching.md:43` claims one cache shared by arc, tweets, and glossary. The rendered article is byte-identical, and all three load missing or malformed metadata identically: `src/arc.ts:233`, `src/tweets.ts:382`, `src/glossary.ts:1000`.

   But arc and tweets use `effort: "high"` (`src/arc.ts:252`, `src/tweets.ts:401`); glossary uses `"medium"` (`src/glossary.ts:1059`). Anthropic explicitly says resolved effort is rendered into the prompt and changing it starts a new cache prefix. [Anthropic thinking and caching](https://platform.claude.com/docs/en/build-with-claude/thinking#thinking-and-prompt-caching).

   **Fix:** either align effort across those stages after quality testing, or document two caches and stop treating glossary as cross-stage reuse. Add live `arc → tweets` and `arc → glossary` checks.

2. **Should-fix — the live eval proves only repeated search.**

   The eval calls `findPassages` twice (`evals/prompt-caching.ts:89`) and explicitly leaves pipeline verification manual (`evals/prompt-caching.ts:214`). It does not test:

   - explain’s explicit breakpoint with a web-search tool;
   - converse’s top-level automatic caching;
   - Anthropic `system` arrays;
   - cross-stage sharing;
   - labels.

   Its pass condition is merely `read > 0` (`evals/prompt-caching.ts:169`); a small system-only hit could pass while the article missed.

   **Fix:** exercise search twice, explain twice, two chat turns, one stage twice, arc→tweets, and arc→glossary. Require the warm read to approximate the cold write or expected prefix, not merely exceed zero.

3. **Should-fix — pipeline breakpoints are normally single-use and net-negative.**

   Only arc runs during ordinary ingest; tweets and glossary are on demand (`src/pipeline.ts:90`). Consequently:

   - arc usually writes a cache nobody reads within five minutes;
   - tweets usually runs after arc’s entry expires;
   - glossary’s first and often only invocation is a cold write;
   - glossary cannot share with arc/tweets anyway because of effort.

   Each costs a 25% write premium. The docs acknowledge opportunism at `docs/project/prompt-caching.md:45`, but the normal execution path makes misses the default.

   **Fix:** have the job planner enable these breakpoints only when a compatible second stage is scheduled immediately, or remove them until logs demonstrate enough reuse.

4. **Should-fix — labels’ original staggering bought nothing on the committed articles.**

   Both known labels prefixes are below Sonnet 5’s 1,024-token floor. The concurrently edited working tree now recognises this and starts wide unless its estimate says caching is possible (`src/labels.ts:1121`). The live `p-queue` concurrency setter is valid; there is no setter race.

   Two problems remain:

   - the guard uses approximate characters-per-token near the boundary;
   - `cacheable` is returned at `src/labels.ts:1266`, but `toc` does not propagate it into the pipeline log.

   The docs still say labels reliably cache and always start at one (`docs/project/prompt-caching.md:48`, `docs/project/prompt-caching.md:144`).

   **Fix:** expose `cacheable` in `TocRun` and logging; use provider token counting or a conservative margin near 1,024; update the docs.

5. **Should-fix — deterministic tests do not pin the pipeline call sites.**

   The tests verify `articleText` itself (`tests/article-prompt.test.ts:262`), but not the actual arc/tweets/glossary request objects. A stage could inline another renderer, change effort, or alter metadata handling while every test remained green.

   **Fix:** export pure request builders and assert equality of the first cached system block plus all cache-relevant configuration. Test missing and malformed `meta.json`, and assert shared effort where sharing is intended.

6. **Should-fix — the quality gate remains unfinished.**

   The plan admits that the article-first reorder has not been evaluated (`docs/plans/prompt-caching.md:460`). This reorder changes model input semantics, not just transport.

   **Fix:** regenerate arc, tweets, and glossary, run the recorded comparison, and read both versions before accepting those call sites.

7. **Nice-to-have — two observability/economics claims are inaccurate.**

   `cachedText` claims to measure everything through the breakpoint but traverses only messages (`src/article-prompt.ts:177`); explain and converse also have tools ahead of them (`src/explain.ts:481`, `src/converse.ts:416`).

   Also, `evals/results/README.md:43` says one search, one chat, and one explanation cross break-even. They are three different caches, so all three are cold writes. Break-even requires a second use within the same feature.

   **Fix:** estimate the complete request or rename the boolean as a hint; correct the README.

## Checks that passed

- Anthropic’s SDK shape is valid: cached text blocks in a `system` array alongside adaptive thinking and effort are supported. A system breakpoint covers the preceding tools and system prefix. [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
- OpenRouter supports both per-part explicit breakpoints and top-level automatic caching; search/explain and converse use the correct respective forms. [OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching).
- Three request-path caches are unavoidable under the current prompts: tools and systems differ before the article.
- Leaving toc and summaries uncached is reasonable. So are the five-minute TTL, no pre-warming, and availability-preserving fallbacks.
- `provider.order` without disabling fallback is a defensible availability choice, although manual ordering disables OpenRouter sticky routing. A stable feature-and-article `session_id` is worth considering if fallback cache misses become material. [OpenRouter routing](https://openrouter.ai/docs/guides/routing/provider-selection).

First change: align or separate the pipeline effort configurations, then expand the live eval before trusting any cross-stage or non-search caching claim.