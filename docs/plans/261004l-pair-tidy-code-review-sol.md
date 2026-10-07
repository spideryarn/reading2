1. **R1 — P1 — fixed:** Another tab’s stale array write could revive a cancelled record, causing deletion much later. Storage mutations and tidy now share one Web Lock. [Evidence: stored-pairs.ts:113](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/modes/search/stored-pairs.ts:113).

2. **R2 — P1 — fixed:** Revising and unmounting in the same React batch could skip the effect that forgets the pair. Revision, retry and deletion now invalidate at the call. [Evidence: SearchMode.tsx:171](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/modes/search/SearchMode.tsx:171).

3. **R3 — P2 — fixed:** `navigator.onLine` can remain true for a cached opening response. Tidy now checks the existing offline-copy header. I disagree with accepting T4 when this check is available. [Evidence: opening-read.ts:98](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/lib/opening-read.ts:98).

4. **R4 — P2 — partially fixed:** If writing and fallback clearing both fail, another tab or reload can still tidy the cancelled pair. Quarantine fixes recovery within the same runtime; a fresh-module probe still reproduced the unsafe swap. This remaining durability gap needs your decision. [Evidence: stored-pairs.ts:88](/home/greg/code/spideryarn2/.claude/worktrees/search-pair-tidy/src/web/modes/search/stored-pairs.ts:88).

T3 remains the explicitly accepted server race. Meeting “never” across tabs requires wider server coordination.

Both required checks **did not start**: after prolonged waiting, final attempts exited with `flock: timeout while waiting to get lock`. Neither passed. Direct storage probes passed after the fixes; removing locking made the interleaving probe fail. Lint reported existing complexity advisories.

Files changed:

- `src/web/modes/search/stored-pairs.ts`
- `src/web/modes/search/auto-thorough.ts`
- `src/web/modes/search/SearchMode.tsx`
- `src/web/useSearch.ts`
- `src/web/lib/opening-read.ts`
- `tests/auto-thorough.test.ts`
- `tests/search-auto-thorough.test.tsx`
- `docs/project/search.md`
- `docs/plans/261004l-quick-search-starts-a-thorough-search-in-the-background-and-swaps-it-in.md`
- `docs/postmortems/261005i-a-cancelled-search-pair-survives-stale-storage-writes.md`

do not land