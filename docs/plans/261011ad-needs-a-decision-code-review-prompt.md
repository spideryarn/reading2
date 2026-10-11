Code review, with fixes. Repo: Spideryarn (TypeScript, React), worktree
/var/tmp/spideryarn-worktrees/fbh2d3my-needs-a-decision-counts. Work only in this worktree. Do not
commit, do not push, and never run a git command that discards changes (checkout --, restore, stash,
reset, clean).

Read docs/plans/261011ad-needs-a-decision-one-count.md (the plan, with the section "After GPT Sol's
plan review" that changed it) and your own plan review,
docs/plans/261011ad-needs-a-decision-plan-review-sol.md. Then review the change:
`git diff HEAD~1 -- src tests docs/project` (the stage commit), touching src/web/FeedbackEarlier.tsx,
src/web/styles/feedback.css, src/types.ts, tests/feedback-dialog.test.tsx and
docs/project/feedback.md.

Check especially:
- the pill's number really is the live waiting-thread count in every view, and the same as the
  shortcut's (src/web/FeedbackDialog.tsx ~1290), including after a reply, a deferral, a retained
  draft, and before the questions arrive;
- nothing else still reads the admin's `waiting` pill as a report count, or shows the row word
  "Needs a decision" for a report (search the client, CSS selectors, tests, docs);
- the docs say what the code does, and nothing stale is left (comments, feedback.md, types.ts).

**Before you edit anything, write your findings to
docs/plans/261011ad-needs-a-decision-code-review-findings.md** (numbered, severity, file:line,
evidence). Then fix what is clearly in scope, run `npx vitest run tests/feedback-dialog.test.tsx`
and `npm run typecheck`, and append to that findings file what you changed and the results. Leave
anything wider as a finding for me. End your answer with a one-line verdict: LAND, LAND WITH
FIXES (made), or DO NOT LAND.
