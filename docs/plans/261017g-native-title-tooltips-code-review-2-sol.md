Verdict: approve with the fixes applied below. No remaining blocking findings. Changes are uncommitted.

1. **F1 — P1, fixed:** [useDelegatedCard.tsx:288](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/useDelegatedCard.tsx:288). The page-wide tip can register before Dock’s drawer listener and swallow its Escape. Added an explicit yield while the drawer is open. A real Dock pair test reproduced the failure; nested hover-card priority is also tested.

2. **F2 — P1, fixed:** [HomeLogo.tsx:133](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/HomeLogo.tsx:133). Below 731px, the letters disappear and the decorative spider leaves the home link unnamed. Added a permanent `aria-label` and regression test.

3. **F3 — P1, fixed:** Nonfocusable admin facts became hover-only: em-dash explanations in [admin-columns.tsx:81](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/admin-columns.tsx:81), exact creation dates in [AdminArticlesPage.tsx:372](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/AdminArticlesPage.tsx:372), build time/full SHA in [AdminPage.tsx:204](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/AdminPage.tsx:204), and rebuild time in [AdminPublicTopics.tsx:85](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/AdminPublicTopics.tsx:85). Added hidden text and regression assertions.

4. **F4 — P1, fixed:** [ShelfEntry.tsx:382](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/src/web/ShelfEntry.tsx:382). The question counter became an unexplained number for screen readers. Added hidden words identifying what it counts.

5. **F5 — P2, fixed:** [shelf-table-row-card.test.tsx:365](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/tests/shelf-table-row-card.test.tsx:365) and [quiz-in-prose.test.tsx:417](/var/tmp/spideryarn-worktrees/fbq04h98-no-native-titles/tests/quiz-in-prose.test.tsx:417) needed `data-tip` absence checks to preserve their original intent. Added them and verified both fail under intentional mutations. Sketch and Tweets already exercise their actual cards; their native-title checks remain useful.

No further issues found in prop forwarding/renames, current guard coverage and allowlists, Search activation paths, cost-chart modes/callers, or the DELAY move.

Validation: **306 tests passed across 17 focused files**; typechecking and changed-file lint passed. Typechecking used `node --import tsx scripts/typecheck.ts` because the npm wrapper hit a sandbox IPC restriction. No full-suite run.