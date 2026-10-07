# Review, round two: the revised plan for the Earlier tab's statuses, numbers and questions

Repo: this worktree (branch `worktree-fbcnbv8f-earlier-tab-deferred-and-ask`, off `dev`).

## The candidate

Committed, at HEAD:
`docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md`.
Your round-one review is
`docs/plans/261007d-earlier-tab-says-what-became-of-each-report-plan-review-sol.md` (F1 to F11).
Nothing is built.

## Previous findings

All eleven were accepted and the plan's "The design in one picture", "Decisions", "Questions for
Greg" and "Stages" were rewritten; "What the plan review changed" lists the disposition of each.
Treat the rewrite as unreviewed text by someone else.

## What to do

1. For each of F1 to F11: is it closed by the revised plan? Say closed, or still open with the
   line that leaves it open.
2. Then attack the parts that are new since round one, which nothing has reviewed: the two
   routes under `/api/admin/feedback/` (does a route under the admin namespace that reads the
   admin's *own* rows through the owner-scoped store fit how that namespace and the store work
   today, e.g. `ADMIN_FEEDBACK_REPORT_PATTERN` matching `/api/admin/feedback/earlier` or
   `/answers` as an owner id and report id?), the 404 fallback, the `feedback_question_answers`
   table and `scripts/feedback-questions.ts --answers` (is "admin-gated route wrote it, script
   keeps only rows whose owner isAdmin" as strong a provenance claim as
   `feedback-reporter.ts` makes for a report?), and moving `awaiting-approval.md`'s waiting list
   into question files (what else reads that section: grep for `awaiting-approval`).
3. New findings number from F12. Same scale and format as round one: severity P0 to P3,
   established or reasoned, (a) the scenario or contract with file and line, (b) replacement
   wording. Refuse only on an established P0 or P1.

The tree is read-only; /tmp is writable; no network, no Postgres. End with one line:
`VERDICT: approve`, `VERDICT: approve with fixes`, or `VERDICT: refuse`.

Do not change any file.
