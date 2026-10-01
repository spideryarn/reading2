Review this plan before it is built: docs/plans/261001i-search-pending-rows-survive-the-trim-and-the-duplicate-guard-follows-a-renamed-run.md

Read it, then read the code it changes: src/store/pg-searches.ts (begin, the trim, sweepPending), src/searches.ts (withRun), src/web/useSearch.ts (send, ask, retry), src/web/modes/search/SearchMode.tsx (SearchBand), src/web/SearchPanel.tsx (how `running` is used), src/routes.ts § search (how begin/finish/sweep are called, and whether the route's own `keep` set interacts with the trim), and tests/store-searches-pg.test.ts, tests/searches.test.ts, tests/search-parallel-finds.test.tsx, tests/use-search.test.ts. Background: docs/plans/260930f-parallel-searches.md § Deferred and its review files.

Questions:
1. Is the trim change correct and complete? Any way a pending row can still be deleted mid-flight (other delete paths, the sweep with its keep set, a retry reset)? Any unbounded growth the plan misses?
2. Is the description of when `begin` answers with a different id accurate? Are there other cases?
3. Is moving the in-flight map into useSearch sound under React batching/StrictMode? Does re-keying on begin, plus onRenamed swapping ?runs=, have holes (e.g. a delete landing between begin and rename, the run already unticked by the reader, the rename arriving after the reader removed it)?
4. Are the planned tests able to go red for the right reason?
5. Anything simpler.

This is a read-only review. Give findings ranked P0-P3 with file:line, and a verdict: approve, approve with changes, or reject. Also check the plan's conclusion, not only its steps.
