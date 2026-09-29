## Findings

- **S2-1 — P2, established:** stale active/archive responses could resurrect, duplicate, or hide a successfully archived row. A red test produced both active and archived copies of “Alpha”; archive-load failure made it disappear entirely. Added mutation barriers, archived-row overlays, reconciliation, and final slug deduplication in [useShelf.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-3/src/web/useShelf.ts:221) and [Library.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-3/src/web/Library.tsx:830).

- **S2-2 — P2, established:** Undo updated the server, then depended on another shelf GET. If that GET failed, the UI remained archived and disagreed with the server. Undo and Put back now commit both arrays directly from the PATCH response.

- **S2-3 — P3, established:** after an archived-list failure, a successful off/on retry left the old red error visible. `loadArchived` now clears the action error when retrying.

- **S2-4 — P3, established:** an all-zero detail topic view rendered an unexplained empty list. It now shows “None of the topics is in this view” and omits the empty list in [ShelfTerms.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-3/src/web/ShelfTerms.tsx:160).

No further issue found in merged sorting, fixture sinking, row caps, search/Unread/topics, counts, all-archived access, direct `?archived=1`, zero-pill ordering, tooltips, or accessible names/state.

## Test tail

```text
Test Files  5 passed (5)
Tests       69 passed (69)
Duration    16.47s
```

Additional shelf regressions: 92/92 passed. Full typecheck passed via `node --import tsx scripts/typecheck.ts`; the npm wrapper itself was blocked by sandbox IPC permissions. Full `npm test` could not initialize because no local Postgres was available. Lint reported no errors and two complexity advisories.

Verdict: **Stage 2 passes after the uncommitted fixes; no unresolved Stage 2 finding.**