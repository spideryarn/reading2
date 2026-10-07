# Review: stage 1 — an admin's Earlier tab gets four statuses, a stored number and a comment per report

Repo: this worktree (branch `worktree-fbcnbv8f-earlier-tab-deferred-and-ask`, off `dev`).
TypeScript, ESM, one Node server, Postgres via drizzle, React under `src/web/`.

## The candidate

Committed: commit `16963ad41` alone.
`git diff 16963ad41^..16963ad41`; changed paths: `git diff --name-only 16963ad41^..16963ad41`
(51 files; 21 of them are one-line `comment:` additions to notes in `docs/user-feedback/`).

Start with: `drizzle/20261007041657_feedback_number.sql`, `src/store/pg-feedback.ts`
(`statusOf`, `listMineByStatus`), `src/routes.ts` (the new `GET /api/admin/feedback/earlier`
row), `src/web/FeedbackEarlier.tsx`, `scripts/feedback-endings.ts` (`chooseComment`),
`scripts/feedback-reporter.ts`, `scripts/feedback-unswept.ts`, `scripts/feedback-shipped-emails.ts`
(`shippedIdsIn`). That is where to begin, not the limit; the manifest is.

## What it is meant to do

The spec is the plan:
`docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md`,
decisions 1 to 5, "What the plan review changed" (your own two plan reviews, F1 to F15; the
round-two bullets amend the decisions), and Stages → Stage 1. Stage 2 (question files, the answers
table, reply boxes) is not built and is out of scope.

Invariants it must not break: a non-admin reader's Earlier tab and `GET`/`POST /api/feedback`
behave exactly as before; one reader never sees another's reports; no handler authorises with
`isAdmin` (the `/api/admin` prefix gate is the only admin gate) and no listed defence in
`docs/project/security-map.md` § Where the defences physically live is edited; the migration is
safe to land before the code that reads it and while the old code keeps inserting; the
production-reading scripts work both before and after the migration is deployed; the shipped
email keeps reading the generated endings file at old and new commits.

The builder (a Claude Opus subagent) reported these departures from the plan; judge each:
an identity column with `row_number()` backfill and `setval` rather than a hand-made sequence;
only a 404 falls back to the plain list (a 403 shows the failure sentence); the status word
shows on every admin row under every filter; a new test requires a `comment:` on every declined
or awaiting report; `listMine`'s columns and row mapping moved into shared helpers.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside this stage — each finding red-first, with the test
that reproduces it — and leave anything wider as a finding for me to decide. Do not commit. List
every file you changed at the end.

You can run one test file (`npx vitest run tests/<one>.test.ts`) and a script
(`node --import tsx <script>`). You have no network, not even loopback, so anything needing
Postgres skips or fails for that reason alone. I ran these against the local database on this
commit: typecheck green (3366 files); `feedback-store`, `feedback-route`, `feedback-dialog`,
`feedback-endings`, `feedback-reporter`, `feedback-unswept`, `feedback-shipped-emails`,
`admin-feedback-store`, `authenticated-api-route-contract`, `doc-links`, `owner-isolation`,
`migration-snapshots`: 12 files, 916 tests passed. If you add a test that needs Postgres, say so
and I will run it.

## Attack it

Independently, before you read my suspicions. Break an invariant above.

For each finding give: an ID continuing your numbering (C1, C2, … for code findings), a severity
(P0 data loss / exploitable security / broadly unusable; P1 user-visible wrong behaviour or an
authoritative contract violated; P2 design or maintainability risk; P3 prose), established or
reasoned, (a) the input or mutation I can run, (b) the smallest change that closes it, and
whether you applied it. A finding with no (a) goes last. Also check the docs changed in this
commit against the code (`docs/project/feedback.md`, `feedback-reports.md`, `admin.md`) and
correct wording that does not match. End with one line: `VERDICT: approve`,
`VERDICT: approve with fixes` (say whether your fixes are applied), or `VERDICT: refuse`
(only on an established P0 or P1 you could not fix).

## My own suspicions — read last

Already my doubts; worth less than what you find yourself.

- The migration against production as it is: about 500 rows, written by the `postgres` role
  during a deploy while the old server (role `spideryarn_app`, DML only) keeps inserting
  afterwards. Does an identity column's implicit sequence really need no grant for that role?
  Is `setval(…, null)` on an empty table really a no-op and not an error?
- `statusOf` binds three id arrays (about 460 ids) and is written into the query two or three
  times; `group by 1`. Any way the list's status and the counts can disagree, or the filter
  page wrongly?
- `feedback-reporter.ts` / `feedback-unswept.ts` numeric lookup: can `212` ever resolve to the
  wrong owner's report, or a numeric lookup before the deploy read as "no such report" and be
  treated as an abuse signal by the instructions in `docs/project/feedback-reports.md`?
- The client: `admin` comes from `isAdmin(readerId)` in the browser. Anything a non-admin's
  browser now does differently? Anything that makes the dialog test's guards on the hidden Write
  panel weaker?
- The 21 `comment:` lines: each should say only what its note or the matching bullet in
  `docs/user-feedback/awaiting-approval.md` already says. Flag any that claims something new.
