Verdict: Approve after fixes; parallel searches now behave correctly, with one accepted 30-concurrent-run edge case remaining.

1. **P1 — persisted `pending` rows could wedge Find indefinitely.** [SearchMode.tsx:90](/home/greg/code/spideryarn2/.claude/worktrees/fb-5v-parallel-searches/src/web/modes/search/SearchMode.tsx:90), [SearchPanel.tsx:287](/home/greg/code/spideryarn2/.claude/worktrees/fb-5v-parallel-searches/src/web/SearchPanel.tsx:287)  
   The GET sweep’s 90-second grace does not trigger another client refresh, so an orphan left pending could block its criterion until reload—not merely 90 seconds. Changed `running` to include only requests this tab started. Persisted pending rows no longer block Find.

2. **P1 — retry bypassed duplicate protection.** [SearchMode.tsx:124](/home/greg/code/spideryarn2/.claude/worktrees/fb-5v-parallel-searches/src/web/modes/search/SearchMode.tsx:124), [SearchPanel.tsx:927](/home/greg/code/spideryarn2/.claude/worktrees/fb-5v-parallel-searches/src/web/SearchPanel.tsx:927)  
   A failed run could be retried while a newer run with the same criterion was pending, sending two paid calls. Added controller-level guarding for asks and retries, including same-batch presses, and disabled retry with an explanatory tooltip.

3. **P1 — the nuqs updater claim was incorrect.** [SearchMode.tsx:219](/home/greg/code/spideryarn2/.claude/worktrees/fb-5v-parallel-searches/src/web/modes/search/SearchMode.tsx:219), [SearchMode.tsx:266](/home/greg/code/spideryarn2/.claude/worktrees/fb-5v-parallel-searches/src/web/modes/search/SearchMode.tsx:266)  
   nuqs evaluates consecutive functional updates before React advances its internal ref, so two writes in one batch can still lose one another. Discrete events normally flush separately, but the updater itself provided no guarantee. Replaced it with a synchronous active-set accumulator used by ask, delete, toggles, solo, and toggle-all. Legacy `?run=` seeding remains preserved and is now tested.

4. **P2 — tests and documentation missed or conflated important paths.** [search-parallel-finds.test.tsx:243](/home/greg/code/spideryarn2/.claude/worktrees/fb-5v-parallel-searches/tests/search-parallel-finds.test.tsx:243), [search.md:575](/home/greg/code/spideryarn2/.claude/worktrees/fb-5v-parallel-searches/docs/project/search.md:575)  
   Added coverage for persisted pending rows, retry duplication, same-batch duplicate submission, batched selection writes, legacy URL append/delete, and distinct model-versus-transport failures. Corrected the plan’s error-banner claim: only transport failures populate the shared banner. I also verified the original `!busy` implementation makes the core parallel-search test fail.

5. **P2 — wider accepted edge remains.** [searches.ts:214](/home/greg/code/spideryarn2/.claude/worktrees/fb-5v-parallel-searches/src/searches.ts:214), [routes.ts:4192](/home/greg/code/spideryarn2/.claude/worktrees/fb-5v-parallel-searches/src/routes.ts:4192)  
   The plan’s `MAX_RUNS` analysis is correct: 30 newer starts can trim an older in-flight run, after which `finish` emits no `done`. Left unchanged as the documented, accepted edge case.

Checks:

- Requested Vitest set: **34 passed**
- Typecheck script via `node --import tsx`: **all four projects passed**
- Touched-file lint: **clean**
- `git diff --check`: **clean**
- Full `npm test`: blocked because the sandbox cannot reach Docker/Postgres
- Plain `npm run typecheck`: blocked by `tsx` IPC permission; the equivalent script invocation passed
- Commit was not possible because the shared worktree Git index is read-only in this sandbox.