# Plan review: 260930f high-powered AI per article

You are reviewing a PLAN, read-only. Repo: this worktree. Candidate: commit 3f83c9a7, file
`docs/plans/260930f-high-powered-ai-per-article.md`. Nothing is built yet. Read the plan, then read the
code it names to check its claims: `src/models.ts` (resolveModel, modelFor, TASK_TIER, DISPLAY_NAME),
`src/messages-stream.ts` (messagesWireBody, streamMessage), `src/store/artifacts.ts` (stampOf,
sameStamp), `src/pipeline.ts` (StepContext ~:521, each step's `stamp`), `src/jobs.ts` (runStep ~:958),
`src/arc.ts:285`, `src/labels.ts` (batchFingerprint ~:1044), `src/store/pg.ts` (articleMetadata ~:2769
and the *IsCurrent functions), `src/routes.ts` (the /api/admin gate ~:9429, the explain/chat/search/
quiz-mark routes, POST /api/jobs), `src/admin.ts`, `docs/project/billing.md`, `docs/project/admin.md`,
`docs/project/security-map.md`. Those are a starting point, not a limit.

The goal: a per-article switch that moves that article's capable-tier model calls from Sonnet 5 to
Opus 5.5, admin-only in v1, with the billing half written up for the product owner rather than built.

## What to attack

1. Is the v1 genuinely free of billing/defence edits? Does anything in it let a non-admin cause Opus
   spend, or let the admin switch another owner's article?
2. Plumbing completeness: will every capable-tier call made for a high-power article actually send
   Opus? Name any call path the plan misses (pipeline stages, chat-wire calls inside the pipeline,
   request-path routes, successor/reset/retry jobs, hierarchy expand/deepen, term lookup, anything).
3. Freshness: does the `sameGenerator` equivalence in sameStamp + arc.ts do what decision 6 says,
   without making something stale that should not be or current that should not be? Any other
   staleness path keyed on the model (checkpoints, fingerprints, caches keyed on model id)?
4. Decision 5 (required argument vs AsyncLocalStorage): is the reasoning sound, and is the diff size
   proportionate? Is there a simpler design that is equally safe?
5. Decision 3 (read the article row per step, not snapshot on the job): what can go wrong?
6. Opus 5.5 request compatibility on both wires (Anthropic-messages via OpenRouter and
   chat/completions via OpenRouter): parameters we send that it might reject or treat differently
   (effort default medium; max_tokens; provider pin; cache_control; web search max_uses).
7. The deferred billing write-up: is it accurate to billing.md and is its recommendation right?
8. Anything that should make the plan smaller, or be dropped.

## Severity and format

P0 data loss / exploitable security / incorrect charging / service broadly unusable; P1 user-visible
wrong behaviour or an authoritative contract violated; P2 design or maintainability risk with no wrong
behaviour today; P3 prose. Refuse only on an established P0/P1 (direct evidence, no unresolved
inference). Give every finding an ID (F1, F2…), severity, file:line evidence, and a proposed fix.
End with a verdict line: `VERDICT: proceed` or `VERDICT: revise`.

## My own suspicions (worth less; spend most of the run elsewhere)

- The request-path routes and async generators: I claim ALS would lose context there. True?
- `labels.ts` fingerprint and hierarchy's structure fingerprint.
- Whether `articleMetadata`'s current checks all go through sameStamp or compare generator directly.
