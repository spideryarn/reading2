You are reviewing a PLAN (no code yet) in the Spideryarn repo, read-only.

Candidate: commit 15d475f84e2fb111747ecb51dda24baf9dc0a4de, file
docs/plans/261010o-addendum-to-an-earlier-feedback-report.md. Read it first.

Context to read (start here; this does not limit scope):
- docs/project/feedback.md § "What became of each report, for an admin" and § "Questions for an
  admin, and replies to them" — the existing reply box and `feedback_question_answers`, which this
  plan imitates.
- docs/project/feedback-reports.md § "Where the queue lives", § "The run", § "Three ways a report
  ends", § "The note" — how the sweep finds reports and what "covered" means.
- src/store/pg-feedback.ts (statusOf, listMineByStatus, submitAnswer), src/store/pg-admin-feedback.ts
  (FEEDBACK_LIST_BYTES budget), src/routes.ts (search "/api/admin/feedback/answers" and
  "/api/admin/feedback/earlier"), src/db/schema.ts (feedback, feedbackQuestionAnswers),
  drizzle/20261007051332_feedback_question_answers.sql, src/web/FeedbackEarlier.tsx (validators
  isAdminEarlierFeedbackPage, the reply box), scripts/feedback-unswept.ts (coveredReportIds),
  scripts/feedback-reporter.ts, scripts/feedback-endings.ts (parseNoteHeader).
- docs/project/sql.md, docs/project/security-map.md.

The request (Greg, the admin, 2026-10-10): "Make it possible for me to add a reply as a kind of
addendum to any earlier open feedback reports." Brief: admin-only, own reports only, simplest
version first; the sweep and the report's session must see the addendum alongside the original
words; an ordinary additive migration is in scope.

Do an independent pass first: is the design right, is anything simpler that gets the value, what
will break (mid-deploy shapes, the byte budget, the status race, owner isolation, the composite FK
— does `feedback` have a unique/PK on (owner_id, id)?, the coverage logic and its silent-failure
modes, how the sweep and an in-flight session would really learn of an addendum). Check claims
against the code, not the prose.

Severity scale: P0 = would ship broken or lose data/words silently; P1 = real defect a reader or
the sweep would hit; P2 = worth fixing, not blocking; P3 = nit. Give every finding an ID (F1, F2…),
a severity, the file/line evidence, and a concrete fix. End with a verdict line exactly:
VERDICT: APPROVE | REVISE | REJECT

My own suspicions, worth less than your independent pass — spend most of the run elsewhere:
- Is "Open only" the right set of statuses, or will Greg expect Needs a decision too?
- Is the uncovered-addenda listing plus a new `addenda:` note header line more machinery than
  this deserves, or is there a simpler way for the sweep to never lose one?
- Should the not-open 409 and the insert really share a transaction, given statusOf reads the
  compiled endings (in-process constant) rather than a table?
