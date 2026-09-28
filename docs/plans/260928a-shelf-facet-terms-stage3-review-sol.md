Findings:

- **S3-1 — P1 — established.** The previous scope’s topic answer remained exposed while a new archive/shelf scope loaded, transiently filtering rows with obsolete membership. This is a bug, not acceptable loading behavior. Fixed by exposing only an answer matching the current scope and shelf key. [useShelfTerms.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/web/useShelfTerms.ts:117), regression at [shelf-topics.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/tests/shelf-topics.test.tsx:430).

- **S3-2 — P1 — established.** An empty active shelf suppressed Topics even when the open archive contained enough articles. Fixed the render gate to use the combined scope. [Library.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/web/Library.tsx:613), regression at [shelf-topics.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/tests/shelf-topics.test.tsx:489).

- **S3-3 — P1 — established.** Native-disabled zero-count chips could not receive keyboard focus, making their tooltip inaccessible. Changed them to guarded `aria-disabled` buttons, preserving disabled behavior while allowing focus and tooltip access. [ShelfTerms.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/web/ShelfTerms.tsx:103), regression at [shelf-topics.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/tests/shelf-topics.test.tsx:388).

- **S3-4 — P2 — reasoned.** Search and Unread narrowing ran twice over every article per keystroke: once for rows and again for counts. Counts now derive from the already-narrowed active and archived rows. [Library.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/web/Library.tsx:236), [shelf-narrow.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/web/shelf-narrow.ts:142).

- **S3-5 — P3 — established.** The parameter documentation referenced a nonexistent `ShelfTerms.tsx § useTopicSelection`. Corrected to `useShelfTerms.ts § useChosenTopics`. [params.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-facets/src/web/params.ts:1481).

Added coverage also establishes combined card/table/archive counts, stale URLs, pending retries, Back/Forward, and half-typed-search batching. Typechecking passed. No commit was made. Full `npm test` could not start because local Postgres was unavailable; the requested database-free command passed:

```text
 Test Files  2 passed (2)
      Tests  30 passed (30)
   Duration  11.06s
```

Verdict: **Stage 3 is ready after the working-tree fixes; no wider blocking finding remains.**