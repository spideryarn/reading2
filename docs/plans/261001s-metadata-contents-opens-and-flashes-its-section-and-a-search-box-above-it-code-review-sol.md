No P0/P1 findings. I found and fixed five issues; no scoped findings remain for the author.

1. **P2 — superseded navigation could flash the wrong section and leak timers/listeners.** Each reveal created an independent scroll-idle wait. A rapid second choice did not cancel the first. Fixed with owned cancellation on replacement and unmount in [PageContents.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb7y-83-metadata-toc-flash-and-search/src/web/PageContents.tsx:100), with regressions at [metadata-contents-reveal.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb7y-83-metadata-toc-flash-and-search/tests/metadata-contents-reveal.test.tsx:268).

2. **P2 — common reader searches returned nothing or surprising sections.** Queries such as “comments and notes”, “remove from shelf”, “download my data”, “who can read it”, and “read time” were missing or misranked. The reading/progress/time synonym bucket also let the PDF section win unrelated queries. Fixed the synonym/stopword logic in [page-search.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb7y-83-metadata-toc-flash-and-search/src/web/page-search.ts:53), added honest section vocabulary in [Metadata.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb7y-83-metadata-toc-flash-and-search/src/web/Metadata.tsx:930), and added a real-query matrix in [page-search.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb7y-83-metadata-toc-flash-and-search/tests/page-search.test.ts:150).

3. **P3 — `MutationObserver` rescanned for every text mutation in the page.** Dynamic body/status updates caused unnecessary whole-index scans even though only section labels, keywords, and asides matter. Fixed by filtering mutation records in [PageContents.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb7y-83-metadata-toc-flash-and-search/src/web/PageContents.tsx:137), tested at [metadata-contents-reveal.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb7y-83-metadata-toc-flash-and-search/tests/metadata-contents-reveal.test.tsx:331).

4. **P2 — filtered results changed silently for screen-reader users.** Only the zero-results state had a status message. Fixed with a permanently mounted result-count status while retaining the visible “Nothing…” state in [PageContents.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb7y-83-metadata-toc-flash-and-search/src/web/PageContents.tsx:388).

5. **P2 — flash tests could pass with no visible flash.** They asserted only that a class appeared, so deleting the CSS overlay would remain green. Added assertions for the orange overlay, animation, still state, and pointer transparency in [block-flash.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb7y-83-metadata-toc-flash-and-search/tests/block-flash.test.ts:158).

The `flushSync` path works through a real React click, the margin clears `--dock-space`, the `wash` refactor preserves block/passage behavior, and *Share…* still focuses the sharing heading. The implementation now answers 7Y and 83 for the existing desktop contents column. The narrow-window and keyboard-shortcut deferrals remain honest; I corrected the matching-line deferral’s rationale in the [plan](/home/greg/code/spideryarn2/.claude/worktrees/fb7y-83-metadata-toc-flash-and-search/docs/plans/261001s-metadata-contents-opens-and-flashes-its-section-and-a-search-box-above-it.md:93).

Validation:

- Requested Vitest command: **5 files, 108 tests passed**
- `npm run typecheck`: could not start because this sandbox denied the `tsx` CLI socket under `/tmp`
- Same repository typecheck script via `node --import tsx scripts/typecheck.ts`: **passed all four projects; all 2,628 source files covered**
- Scoped Biome check and `git diff --check`: passed
- No commit made.