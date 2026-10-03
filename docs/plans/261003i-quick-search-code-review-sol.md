- **C1 — P1 — fixed:** [useSearch.ts:662](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/src/web/useSearch.ts:662). A revision or retry could PATCH this tab’s old colour over a newer choice from another tab. Inherited colour persistence now waits for the first `begin` and runs once. Red-first tests: “does not write an old tab choice back” failed with **2 PATCHes instead of 1**, for both revision and retry.

- **C2 — P1 — fixed:** [TableView.tsx:403](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/src/web/TableView.tsx:403). The generic hit exclusion made invisible quick-hit paragraphs touch dead zones. Removed it; washed hits and interactive overlaps retain their exclusions. Red-first test: “selects an invisible quick hit on touch” failed with **no selected row**.

- **C3 — P3 — not fixed; predates this stage:** [search.md:1498](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/docs/project/search.md:1498), candidate line 1486, still says quick search does not run as you type and would save a row per pause. Both claims contradict the current typing-session behaviour.

- **C4 — P3 — not fixed; predates this stage:** [search.md:1466](/home/greg/code/spideryarn2/.claude/worktrees/fb-search-quick-2610/docs/project/search.md:1466) says no keyboard shortcut opens Search; `/` opens Quick search.

The new Stage B documentation matches the implementation.

Validation:

- Original requested suites: **213 passed**.
- Final scoped suites, including touch regressions and doc links: **247 passed**.
- All three requested mutations went red for the intended behaviour and were restored.
- All four TypeScript projects compiled; the coverage guard failed only on the excluded agent’s 21 `data/qeval/` scratch files.
- `npm test` was blocked by unavailable local database access. Scoped lint reported existing findings.

Root causes are recorded in two postmortems. No commits made; the eval agent’s files were left alone.

**Verdict: the committed candidate needs C1 and C2; both are fixed and pass scoped checks, while full validation remains blocked.**