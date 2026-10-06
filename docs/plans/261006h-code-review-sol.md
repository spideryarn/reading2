- **C1 — P0, reproduced, fixed red-first.** A→signed-out→B remounted `ArticlePage`, losing the hook’s reader identity while retaining A’s URL. B inherited A’s position and overwrote B’s saved view. Moved last-view tracking above App’s auth branches and added five integration cases.
- **C2 — P2, wider, not fixed.** The unchanged [Search F2 test](/var/tmp/spideryarn-worktrees/qi-9wyhwqre-reader-keyed-storage/tests/search-auto-thorough.test.tsx:515) failed under load. Its timer assertion has a 100 ms margin; scheduling as the cause is reasoned. The isolated rerun passed.

Final verification: **228 tests passed**. Search-filter, Feedback-provider, and dialog-key mutations each produced the expected failures; all were restored. Typechecking passed through `node --import tsx`; touched-file lint reported only App’s existing complexity advisory. Full `npm test` was blocked by database access; the broader unit sweep was interrupted without a result.

No seed-id collision or further scoped defect found. Stage 2 needed no fix.

Files changed:

- [App.tsx](/var/tmp/spideryarn-worktrees/qi-9wyhwqre-reader-keyed-storage/src/web/App.tsx)
- [ArticlePage.tsx](/var/tmp/spideryarn-worktrees/qi-9wyhwqre-reader-keyed-storage/src/web/article/ArticlePage.tsx)
- [last-view.ts](/var/tmp/spideryarn-worktrees/qi-9wyhwqre-reader-keyed-storage/src/web/last-view.ts)
- [last-view-app-reader-change.test.tsx](/var/tmp/spideryarn-worktrees/qi-9wyhwqre-reader-keyed-storage/tests/last-view-app-reader-change.test.tsx)
- [auth.md](/var/tmp/spideryarn-worktrees/qi-9wyhwqre-reader-keyed-storage/docs/project/auth.md)
- [url-state.md](/var/tmp/spideryarn-worktrees/qi-9wyhwqre-reader-keyed-storage/docs/project/url-state.md)
- [261006h plan](/var/tmp/spideryarn-worktrees/qi-9wyhwqre-reader-keyed-storage/docs/plans/261006h-browser-storage-keyed-by-reader-and-the-feedback-switch-test.md)
- [C1 postmortem](/var/tmp/spideryarn-worktrees/qi-9wyhwqre-reader-keyed-storage/docs/postmortems/261006l-reader-switch-guards-must-outlive-the-auth-branches-they-guard.md)

No commits made.

VERDICT: approve with fixes