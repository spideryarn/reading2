You are reviewing a plan, read-only. Repo: Spideryarn (TypeScript, React). Read
docs/plans/261011ad-needs-a-decision-one-count.md, then check its claims against the code:
src/web/FeedbackEarlier.tsx (EarlierFilter, waitingThreads, EarlierThreads, EarlierList's waiting
branch, useEarlierFeedback's waitingQuestionCount), src/web/FeedbackDialog.tsx (the shortcut, around
line 1290), src/feedback-question-values.ts (questionState), src/store/pg-feedback.ts (statusOf),
src/types.ts (EARLIER_FEEDBACK_STATUSES, AdminEarlierFeedbackPage), docs/project/feedback.md
§ Questions for an admin, and the tests in tests/feedback-dialog.test.tsx that assert "to decide" and
"Needs a decision N".

Questions:
1. Is the diagnosis right — are the two numbers really from different sources, and is the plan's
   account of the second complaint ("something I think I deferred") plausible?
2. Is "the pill draws waitingThreads for an admin" the right fix? Anything it breaks: places that
   rely on the pill's number, the pills summing to All, the opening default (Earlier opens on Needs a
   decision when a thread waits), the empty states, stale/retained drafts (liveQuestions vs
   questions), the moment before questions arrive.
3. Is there a simpler or better fix the plan missed?
4. Anything else wrong or missing.

Answer with numbered findings (severity, evidence with file:line, suggested change) and end with a
one-line verdict: BUILD, BUILD WITH CHANGES, or RETHINK.
