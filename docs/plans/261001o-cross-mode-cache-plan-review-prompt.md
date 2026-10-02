# Review request: plan 261001o (one shared article-first prefix cached across modes)

You are GPT Sol, reviewing read-only. Repo root is the current directory.

Read, in order:
1. docs/plans/261001o-one-shared-article-first-prefix-cached-across-modes.md (the plan)
2. docs/investigations/261001b-cost-per-article-and-the-cross-mode-article-cache/README.md (the measurement)
3. The queries a1.sql–a8.sql in that folder and their verbatim output, results.txt (production, read-only, last 30 days)
4. The previous sweep it follows: docs/plans/261001l-prompt-caching-across-every-call.md (especially § What the review changed — your own earlier findings F1–F6) and docs/investigations/261001a-prompt-caching-production-audit/README.md
5. Code: src/models.ts (STAGE_EFFORT, ARTICLE_RENDERER), src/pipeline.ts (sharesArticleCache, cacheArticleForStep), src/article-prompt.ts, src/illustrated.ts (~line 1040), src/hierarchy-prompt.ts (renderBlocks, EFFORT), src/messages-stream.ts (MeteredCall.onStart), src/jobs.ts, web/auto-modes.ts, src/pricing.ts.

Questions, in priority order:
1. **Are the numbers right?** Check the SQL logic in a5–a8 against the README's claims: the 0.35 tokens/char P, the oracle premium accounting, the per-grouping table, the input/output/thinking split, and the per-article distribution. Is anything double-counted, mis-partitioned (e.g. the lag/lead window), or wrongly excluded? Is the conclusion "ceiling ~16% of a normal article's Claude cost, ~8% at today's efforts, ~6% plumbing-only" supported? Is thinking really ~25%?
2. **Is the answer to Greg's question ("is the article first in every full-article prompt?") accurate** call site by call site?
3. **Option B's design** (durable prefix record keyed by sha256(model, effort, article block bytes); warm/writing/claim; wait on onStart; 20 s claim expiry; always-mark within compatible groups). Does it actually solve your 261001l F2/F3 objections (no readiness signal; two leaders; warm cache whose writer finished; sticky routing)? Races? Where exactly in the code would the seam go, and does message_start on OpenRouter's Messages wire reliably arrive before the cache is readable? Is there a simpler design that captures most of the 6%?
4. **The recommendation order** (thinking eval first, then B, E with B, C conditional, not D). Is D's rejection argument sound (glossary at high: +4,558 output tokens ≈ 4.6¢ vs ~3¢ saved)? Is E (1h TTL for long articles only) argued from one outlier article — say so if that's too thin.
5. Anything the plan claims that the code contradicts.

Answer with numbered findings, each tagged P0/P1/P2 with file:line evidence, and end with a one-line verdict (approve / approve with changes / reframe). Do not edit files.
