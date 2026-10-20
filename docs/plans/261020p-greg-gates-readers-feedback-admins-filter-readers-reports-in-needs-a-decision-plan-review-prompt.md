You are reviewing a plan, read-only, in the Spideryarn repo (this worktree). Read CLAUDE.md, then the plan at
docs/plans/261020p-greg-gates-readers-feedback-admins-filter-readers-reports-in-needs-a-decision.md.

Then read the code it would change: src/routes.ts § questionsForAdmin (around "replies to questions") and the route that
parses `questions=`, src/store/pg-feedback.ts § linkedReports, src/store/pg-admin-feedback.ts, src/types.ts
(FEEDBACK_FROM, AdminFeedbackQuestion and its V1/V2), src/web/FeedbackEarlier.tsx (withLegacyQuestions, isQuestion,
isLinkedReport, ThreadIds, the thread's "Your report"), src/web/AdminPage.tsx (FeedbackFromToggle), and
docs/project/feedback.md § Questions for an admin, docs/project/feedback-reports.md § Who sent it and § Asking Greg.

Questions:
1. Is the design right and the simplest that works? Is the shape-4 bump necessary, or is there a simpler compatible route?
2. Security/privacy: the thread now shows another reader's report text and address to an admin. Any route by which a
   non-admin, or a different admin, could see it, or by which a question file could show the wrong owner's report?
   Is "ambiguous id => none" right?
3. Anything missing: tests to write, places that must hear about a new FEEDBACK_FROM value or a new shape, docs.
4. Is anything here a defence edit (docs/project/security-map.md) that an unattended run must not make?

Write findings, numbered, with severity, file:line, and a concrete fix. End with a one-line verdict:
"VERDICT: proceed" or "VERDICT: proceed with changes" or "VERDICT: rethink".
