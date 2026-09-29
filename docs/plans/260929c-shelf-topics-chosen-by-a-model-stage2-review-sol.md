## Findings

- **S2-1 — P2, established: client invalidation missed real shelf changes.** The pre-fix client key contained only `slug:words`. A re-extraction with the same word count, or a title/gist change, therefore did not request the route again, so the server could not observe its correctly changed model-input hash.  
  **Changed:** library rows now carry the published revision ID, and the client key includes revision, title, gist, and derived counts ([useShelfTerms.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/src/web/useShelfTerms.ts:58), [types.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/src/types.ts:1760)). Added an unrun regression for equal-word-count revisions ([shelf-topics.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/tests/shelf-topics.test.tsx:286)).

- **S2-2 — P2, established: one of two concurrent tabs could stop polling.** Both requests could read before the claim existed; the claim loser received `null` and previously answered `refreshing: false`, despite the winner actively refreshing. The atomic claim still prevented duplicate spend, but the losing tab could remain stale.  
  **Changed:** a live claim now always means `refreshing: true`; a claim loser re-reads once to distinguish an active/completed race from backoff or allowance refusal ([shelf-topics.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/src/shelf-topics.ts:170)). Tightened the unrun concurrency regression to require both tabs to report refreshing while still asserting one model call ([shelf-topics-route.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/tests/shelf-topics-route.test.ts:355)).

- **S2-3 — P2, established: candidate labels left paid input unbounded.** Titles, gists, profile, article count, and candidate count were bounded, but an extractor token can be arbitrarily long and candidate labels were inserted verbatim. Malicious article text could therefore create an oversized paid request or repeated provider failures.  
  **Changed:** candidate labels are clipped to 160 characters before prompt construction ([model-scores.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/src/shelf-terms/model-scores.ts:67)). Added an unrun oversized-token regression ([shelf-topics-model-scores.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/tests/shelf-topics-model-scores.test.ts:172)).

- **S2-4 — P3, reasoned: the injection boundary did not explicitly cover candidate labels.** They are extracted article text, but the system instruction named only titles, summaries, and profile text as data.  
  **Changed:** the instruction now explicitly includes candidate labels, and the prompt version is bumped to 2 so existing rows refresh under the strengthened prompt ([model-scores.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/src/shelf-terms/model-scores.ts:43), [model-scores.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/src/shelf-terms/model-scores.ts:96)).

No further spend, correctness, privacy, or migration finding:

- The claim is atomic, allowance precedes the sole gateway call, the route awaits the refresh inside the request collector, and allowance completion is in `finally` ([routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/src/routes.ts:7101), [shelf-topics.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/src/shelf-topics.ts:178)). It uses request work, not ingest quota.
- Stale scores, unscored-key exclusion, deterministic fallback, pending gating, archive scope, fenced writes, and backoff match the plan.
- Every score-row read/write/claim/failure path is owner-and-scope constrained ([pg-shelf-terms.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/src/store/pg-shelf-terms.ts:355)). Provider bodies and malformed answers cannot reach logs.
- Privacy copy accurately names OpenRouter/OpenAI and the data sent ([PrivacyPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/src/web/PrivacyPage.tsx:397)).
- The migration is additive, schema-matched, owner-cascading, and preserves every existing rate-limit bucket ([migration](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-llm/drizzle/20260929065031_shelf_topic_scores.sql:18)).

Verification: all four TypeScript projects compile; Biome and `git diff --check` pass. Vitest again ran no tests because the memory guard refused startup. No paid calls, migration, or commit were made.

**Verdict: approve after these fixes; no known remaining P0–P2, but the Stage 2 tests remain unrun.**