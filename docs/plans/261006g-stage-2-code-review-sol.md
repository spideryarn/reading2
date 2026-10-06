No production defect found in stage 2. I strengthened one test.

- **F1 — P2, fixed:** [sideways-scroll-box.test.tsx:201](/var/tmp/spideryarn-worktrees/qi-none-yet-404-and-costs-scroll-cue/tests/sideways-scroll-box.test.tsx:201) checked observer cleanup but missed leaked scroll listeners. Removing `removeEventListener` originally passed. The strengthened test failed with **“get scrollLeft … called 2 times”**, exit **1**; restoring the correct code gave **69 tests passed**, exit **0**.

- **F2 — P2, reporting wider, reasoned:** [SidewaysScrollBox.tsx:109](/var/tmp/spideryarn-worktrees/qi-none-yet-404-and-costs-scroll-cue/src/web/lib/SidewaysScrollBox.tsx:109) preserves the existing lack of keyboard focus on scroll boxes. Browsers without automatic scroller focus need `tabIndex={0}` plus accessible context. This predates the stage; a shared accessibility change should address it separately. [MDN guidance](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow#accessibility).

- **F3 — P3, reporting optional cleanup:** [DataTable.tsx:669](/var/tmp/spideryarn-worktrees/qi-none-yet-404-and-costs-scroll-cue/src/web/lib/DataTable.tsx:669) duplicates the inner box’s classes. One exported class constant would remove the synchronization obligation while preserving the shelf DOM. No current behavior fails.

The measurement and cleanup are correct for the current persistent table children. `z-20` above pinned `z-10`, contained by `isolate`, is appropriate. The small reader-bundle addition is reasonable, and the admin-costs doc sentence matches the code.

All nine mutations were detected after strengthening cleanup coverage, including the two previously unproved tests. Biome passed. `npm run typecheck` hit a sandbox IPC restriction; the same script passed through `node --import tsx scripts/typecheck.ts`.

Changed only the test and the plan’s review-evidence section. Production code and Git state are unchanged. Browser validation remains pending separately.

VERDICT: land it with my fixes