Found and fixed one behavior bug. Changes remain uncommitted.

- **F5 — D — P1 — Established; fixed.** [notes.ts:337](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/src/web/marginalia/notes.ts:337) used whitespace-deleting matching to prove phrase containment. It accepted **“Injune” as “In June”**, placing a yearless note beside the wrong mention. The inner lookup now uses `"spaced"`. [Regression tests:606](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/tests/marginalia-notes.test.ts:606) cover yearless and `words` events, plus normalized offsets. Red: **2 failed, 1 passed**; green: **3 passed**.
- **F6 — D — P3 — Established; reporting.** [marginalia.md:67](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/docs/project/marginalia.md:67) introduces yearless notes but still says “The date always carries its year.”
- **F7 — B — P3 — Established; reporting.** [quiz.css:59](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/src/web/styles/quiz.css:59) has inconsistent arithmetic: `234 − 218 = 16`, not 18; `226 − 218 = 8`, not 10. The [test comment:7](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/tests/remember-submode-four-chips.test.ts:7) points to plan files for measurements that are actually in the commit message. This does not dispute your browser measurements.
- **F8 — E — P2 — Reasoned; reporting, preexisting.** [PublicLibraryPage.tsx:337](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/src/web/PublicLibraryPage.tsx:337) keys facts by text. Equal author and site names produce duplicate keys and unsupported reconciliation. E does not introduce this risk; I left it unchanged.

Earlier findings:

| Finding | Status |
|---|---|
| **F1 — B** | Closed: Remember-specific padding fixes the fit without moving the `(i)`. |
| **F2 — C** | Closed: reservation survives empty pending and refreshing answers. |
| **F3 — C** | Partially closed: separate minimum heights are present and compile; actual before/after geometry remains unverified without a browser. |
| **F4 — D** | Closed: containment is inside the surviving quote; F5 additionally preserves word boundaries. |

A’s copy and E’s separator placement are correct. C still drops reservation during archive loading and after failure, as documented; this can move topicless cards too. The hidden empty list has no focusable children and valid nesting. Remember’s direct children are chips; tooltip wrappers do not inflate the selector’s count. `findQuote` returns original-text offsets, so slicing is correct.

All requested suites passed after the fix: **9 files, 201 tests**. Temporary removal of each change produced failures; restoring F2/F4’s old checks produced six failures. Additional utility/chip tests passed. Typechecking passed via `node --import tsx` after the npm wrapper hit sandbox `EPERM`. Lint reported only existing complexity advice. No browser checks ran.

The root cause is recorded in the [postmortem](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/docs/postmortems/261005g-drawing-normalization-reused-as-evidence-validation.md). No Greg quotations were changed.

**Verdict: land with the fixes I made.**