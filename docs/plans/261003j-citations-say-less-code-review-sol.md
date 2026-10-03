**C1 — should-fix, fixed:** Removing authors/year changed folding and identity: distinct works merged, shorthand rows split from entries, and legacy search rows lost IDs. Separated folding metadata and normalized unique inheritance matches. Evidence: [citations.ts:655](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/citations.ts:655), [inheritance:1368](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/citations.ts:1368).

**C2 — should-fix, fixed:** Progress-only runs, retries and discarded drafts could reveal `why` without an answer. Visibility now follows the investigation view actually rendered. Evidence: [CitationsPanel.tsx:1035](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/web/CitationsPanel.tsx:1035).

**C3 — should-fix, fixed:** The lexical guard dropped `O’Brien` from `O’Brien’s`, accepted `2017b` against `2017a`, and assembled “in press” from scattered words. Possessives and complete date expressions are now checked correctly. Evidence: [citations.ts:483](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/citations.ts:483), [date check:524](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/citations.ts:524).

**C4 — note, fixed:** The cache ignored the supplied reference list. Reusing one block map with another list returned the first corpus. Replaced it with an index built once per draft-reading run. Evidence: [citations.ts:478](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/citations.ts:478).

**C5 — should-fix, fixed:** The eval skipped HTML entries and supplied no PDF bibliography, so its replay differed from production. It now replays `toDrafts` across all rows with PDF reference text. Evidence: [citations-say-less.ts:32](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/evals/citations-say-less.ts:32).

**C6 — note, fixed:** Both checked-row fixtures shared the same `why`, masking a wrong-row assertion. They now have distinct claims, asserted within `.cite-why`. Evidence: [citations-panel.test.tsx:1066](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/tests/citations-panel.test.tsx:1066).

**C7 — note, not fixed:** The pre-existing PDF-entry validator still drops supported dates without four digits, including `n.d.`, `in press` and `c. 300 BC`. This wider limitation remains for you to decide. Evidence: [citations.ts:461](/home/greg/code/spideryarn2/.claude/worktrees/fb-citations-say-less/src/citations.ts:461).

All **216 requested tests pass**. `npm run typecheck` hit sandbox IPC restrictions; the identical script passed via `node --import tsx scripts/typecheck.ts`. Corpus remeasurement was blocked by database `EPERM`; docs distinguish the original totals. No commits made.

VERDICT: land