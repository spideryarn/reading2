You are the code reviewer-fixer for plan docs/plans/261010o-addendum-to-an-earlier-feedback-report.md
in the Spideryarn repo (worktree /var/tmp/spideryarn-worktrees/fbsaz0yw-addendum). Read the plan
in full first; its last section, "What the plan review changed", is the design you reviewed at plan
stage (docs/plans/261010o-addendum-plan-review-sol.md is your own earlier review) and overrides the
sections above it.

Candidate: three commits on top of origin/dev —
  15d475f84 (plan), 76424a883 (stage 1: table, store, route, scripts),
  7b1e0b2be (stage 2: the browser box, docs).
  Diff: `git diff 15d475f84~1 7b1e0b2be` (ignore merge noise; the stage commits are the scope);
  paths: `git diff --stat 15d475f84~1 7b1e0b2be`.
Start with: drizzle/20261010190341_feedback_addenda.sql, src/store/pg-feedback.ts (submitAddendum,
listMineByStatus), src/routes.ts (/api/admin/feedback/addenda, /earlier), src/types.ts,
scripts/feedback-unswept.ts, scripts/feedback-reporter.ts, scripts/feedback-endings.ts
(parseNoteHeader `addenda:`), src/web/FeedbackAddendum.tsx, src/web/FeedbackSendBox.tsx,
src/web/FeedbackEarlier.tsx, src/web/FeedbackDialog.tsx, and the tests. This list does not limit
scope.

What it must do: an admin adds an addendum to one of their own reports whose status is Open or
Needs a decision; it is shown under the report; the sweep scripts print it with the report from
production rows (read-only), and feedback-unswept lists any addendum nothing covers (typed
coverage, `addenda:` in a note, `addendum:spya-…` in a queue source) with the parent's queue item
and dispatchedTo so the sweep can hand it to the live session.

Independent pass first: correctness, owner isolation, the lock/order in submitAddendum, the byte
budget, mid-deploy shapes in both directions (old browser/new server, new browser/old server, the
scripts before the migration is on production), silent-success modes in the coverage logic, the
refactor of the reply box (did any reply behaviour change?), drafts/keepers/retry ids keyed per
report, the reload hold, and whether the docs (feedback.md § Adding to an earlier report,
feedback-reports.md § An addendum to a report already taken) say what the code does.

Fix what is inside this work, narrowly and red-first (a test that fails before your fix). Report,
do not fix, anything wider. You can run unit tests that need nothing outside the tree, e.g.
`npx vitest run tests/feedback-dialog.test.tsx tests/feedback-unswept.test.ts tests/feedback-endings.test.ts tests/feedback-reporter.test.ts`;
tests needing Postgres (feedback-store, feedback-route, owner-isolation, db-schema) cannot run in
your sandbox — say which of your fixes would need them and I will run them. Run
`npm run typecheck` after any fix.

Severity: P0 = ships broken or loses words silently; P1 = a real defect Greg or the sweep would hit;
P2 = worth fixing; P3 = nit. Every finding gets an ID (C1, C2…), severity, file:line, what you did
(fixed / reported). End with exactly one line:
VERDICT: APPROVE | APPROVE-WITH-FIXES | REVISE

My own suspicions, worth less than your pass — spend most of the run elsewhere:
- The box unmounts on a pill change (the reply box stays mounted and hidden); a recording in
  progress is cut off and offered back later. Is that a lost-words path?
- The addenda-in-listing window: addenda "since --since" plus those on reports filed since then.
  Can an addendum written to an old report be missed by the default 30d listing?
