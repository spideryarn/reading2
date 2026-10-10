1. **P2 — [src/chat-tools.ts:1380](/var/tmp/spideryarn-worktrees/fbgn-referee-criteria-overflow/src/chat-tools.ts:1380): Chat shares the changed `search` job.** `search_article_meaning` calls `findPassages`, so it now inherits `medium` and 9,750 tokens, but still overrides the deadline to 45 seconds at [src/chat-tools.ts:1384](/var/tmp/spideryarn-worktrees/fbgn-referee-criteria-overflow/src/chat-tools.ts:1384), not the new derived 129 seconds. Quick search is separate as `search-quick` and is unaffected. The author should either explicitly accept and test this shorter Chat-tool policy, or give it a distinct job/budget. [chat-tools.md:1329](/var/tmp/spideryarn-worktrees/fbgn-referee-criteria-overflow/docs/project/chat-tools.md:1329) also incorrectly says 20 seconds/`TOOL_TIMEOUT_MS`; update it after deciding.

2. **P3 — stale current-behaviour comments/docs fixed.** Updated [src/models.ts:118](/var/tmp/spideryarn-worktrees/fbgn-referee-criteria-overflow/src/models.ts:118) from Search’s old 4,000 ceiling, removed Search from the provider-default list at [src/ai-call.ts:1295](/var/tmp/spideryarn-worktrees/fbgn-referee-criteria-overflow/src/ai-call.ts:1295), and corrected [ai-gateway.md:323](/var/tmp/spideryarn-worktrees/fbgn-referee-criteria-overflow/docs/project/ai-gateway.md:323) to say the warning covers streamed and JSON chat calls.

3. **P3 — test gaps fixed.** [search-stream.test.ts:138](/var/tmp/spideryarn-worktrees/fbgn-referee-criteria-overflow/tests/search-stream.test.ts:138) now proves `require_parameters` accompanies `medium` on the wire. [json-wire-thinking-ceiling-log.test.ts:59](/var/tmp/spideryarn-worktrees/fbgn-referee-criteria-overflow/tests/json-wire-thinking-ceiling-log.test.ts:59) now proves the warning preserves the returned body and ignores embeddings even if their response contains chat-like fields.

Validated:

- Fresh `routes.ts` import succeeds with no TDZ; values are 3,750 / 9,750 / 129,000 ms / 159,000 ms.
- The warning runs after `meterBody`, is chat-wire guarded, catches logging failures, and logs no response text.
- PDF front matter correctly uses 2,000 answer + 2,000 thinking. It is not checkpointed, so no cache-key or fingerprint change is needed.
- Five unit suites, including the existing streamed-warning regression: 101 tests passed.
- Direct underlying typecheck passed all four TypeScript projects and coverage.
- `tests/store-wiring.test.ts` could not run because it requires the private Postgres lane; touching a database was explicitly forbidden. The exact command stopped during database setup.
- Targeted lint and `git diff --check` passed.

Files I edited:

- `docs/project/ai-gateway.md`
- `src/ai-call.ts`
- `src/models.ts`
- `tests/search-stream.test.ts`
- `tests/json-wire-thinking-ceiling-log.test.ts`

Verdict: **do not ship** until the shared Chat meaning-search behavior is explicitly decided and its database-backed test is run.