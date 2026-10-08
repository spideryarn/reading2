Round 2 of a read-only PLAN review in the Spideryarn repo. You refused round 1; your findings are in
docs/plans/261008f-needs-a-decision-plan-review-sol.md. The revised plan is
docs/plans/261008f-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md — read its new
section "What the plan review changed", which amends the numbered decisions above it.

Some stage-1 work already exists uncommitted in this worktree (compare the working tree against
HEAD): the compiler's FEEDBACK_QUESTION_ACTED map and Details-line rule in
scripts/feedback-endings.ts, the body cap and splitQuestionBody in src/feedback-question-values.ts,
--show and the orphan listing in scripts/feedback-questions.ts, and a failing UI test in
tests/feedback-dialog.test.tsx ("draws no report under Needs a decision that cannot be answered").
Check them against the plan too.

For each of F1–F9: closed, or not (and why). Then any NEW finding, numbered from F10, with severity
(blocker / should-fix / nit), file:line evidence, and the change. Be brief where it is closed.
End with one line: APPROVE, APPROVE WITH FIXES, or REFUSE.
