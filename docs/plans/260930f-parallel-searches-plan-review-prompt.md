You are reviewing a PLAN (not code yet) in the Spideryarn repo, read-only. Plan: docs/plans/260930f-parallel-searches.md.

Greg's request: "In the search mode, I want to be able to kick off multiple searches in parallel."

Please verify against the code, not the plan's prose:
1. Is the plan's claim true that the ONLY thing preventing a second concurrent meaning-search is `!busy` in `ready` in `Box` (src/web/SearchPanel.tsx)? Check src/web/useSearch.ts (`send`, `ask`, tombstones, `put`, `setError(null)` per send, the error slot), src/web/modes/search/SearchMode.tsx (`onAsk` and `setActive([...panel.active, ...])` - any stale-closure issue when two asks happen before a re-render or while a stream updates?), the `search` route and `searchStore.begin`/`finish` in src/routes.ts and src/store/pg-searches.ts (lock, attempt ids, MAX_RUNS trim), and useSearchMode / search-hits.ts (merged list, counts "N still searching").
2. Anything that goes wrong visibly with two streams interleaving hits into different rows, or one failing while the other succeeds (the single `error` slot in useSearch is cleared by every send — does starting search 2 wipe search 1's error message? acceptable?).
3. Is the duplicate-question refusal (pending run with identical trimmed criterion) the right minimal guard? Better alternative?
4. Anything the test plan misses.

Write findings as a numbered list with severity (P0/P1/P2), file:line evidence, and a one-line verdict at the top: APPROVE, APPROVE WITH CHANGES, or REJECT.
