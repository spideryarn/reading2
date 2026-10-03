You are reviewing code before it is pushed, in the worktree you are running in. You may fix what you find, inside this change's scope: edit the files, but do not commit, do not run git commands that change anything, and do not touch the database beyond what the tests do. Report anything wider for me to decide.

The change is the last commit: `git show HEAD` (commit 157a4c74d, "261003b: counts on the Earlier tab's pills"). The plan is docs/plans/261003b-earlier-tab-counts-on-the-pills.md, and your own plan review is docs/plans/261003b-earlier-tab-counts-on-the-pills-plan-review-sol.md. Check the build answered it.

The request (Greg, admin, 2026-10-01): "In Feedback / Earlier / Not shipped, it says at the bottom 'Showing your 50 most recent.' Is that true? Are there >50 not shipped? Perhaps include a number/badge in the tab-pills for Shipped and Not shipped?"

Look hard at:
- src/store/pg-feedback.ts listMine: the repeatable-read read-only transaction (the transaction pooler on port 6543 in production; is anything here unsafe there?), the count predicate matching idFilter exactly, the owner scoping.
- src/routes.ts GET FEEDBACK_PATH: counts on every answer.
- src/web/FeedbackEarlier.tsx: isEarlierFeedbackPage's new consistency rules. Could a legitimate server answer ever be refused, for example with `more` and a count, a report whose id is shipped but which the map handles oddly, or ids duplicated in the map? Also counts precedence in useEarlierFeedback, the pill markup (accessible name "Not shipped 45": is there a space?), and the cap-line copy.
- Tests: tests/feedback-store.test.ts, tests/feedback-route.test.ts, tests/feedback-dialog.test.tsx. Can each new test go red?

Gates you can run: `npx vitest run tests/feedback-dialog.test.tsx tests/feedback-route.test.ts tests/feedback-store.test.ts` and `npm run typecheck`. Run them after any fix.

End with findings as P0/P1/P2 with file:line and what you changed for each, then a one-line verdict.
