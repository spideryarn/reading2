1. **C1 — Medium — stale accessibility status.** The refusal sentence survived a reply/deferral and reappeared after paging away and back. Evidence: [FeedbackEarlier.tsx:1492](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/src/web/FeedbackEarlier.tsx:1492). I tied it to the refused pager snapshot, clear it after pager changes, and clear it before successful navigation. Regression tests: [feedback-dialog.test.tsx:2090](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/tests/feedback-dialog.test.tsx:2090).

2. **C2 — Low — false documentation/comments.** `THREAD_GROUPS` still claimed the pager followed grouped contents order, while the project doc implied every thread showed `N of M`. Corrected at [FeedbackEarlier.tsx:671](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/src/web/FeedbackEarlier.tsx:671) and [feedback.md:344](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/docs/project/feedback.md:344).

3. **C3 — Low — test could not prove repeated announcement.** The test changed from Next to Previous, so it did not verify that pressing the same endpoint re-keyed identical text. It now repeats Next and checks that React replaced the status child: [feedback-dialog.test.tsx:2082](/var/tmp/spideryarn-worktrees/needs-decision-next-prev/tests/feedback-dialog.test.tsx:2082).

Verified without further changes:

- `at + 1` is correct for a live waiting thread: every stop is then a deciding thread, so its stop index equals its deciding rank.
- React leaves the empty status node genuinely childless; `:empty` matches.
- The `aria-disabled` click handler guards navigation while remaining keyboard/click responsive for the explanation.
- `ThreadView` has no other caller, and no external caller or selector relied on native `disabled` or the old grouped order.

Checks:

- `npx vitest run tests/feedback-dialog.test.tsx` — 241 passed.
- `npm run typecheck` — launcher blocked by sandbox IPC permissions before project code ran.
- Equivalent `node --import tsx scripts/typecheck.ts` — all TypeScript projects passed; all 3,589 source files covered.
- No commit made.

**Verdict: approve after fixes.**