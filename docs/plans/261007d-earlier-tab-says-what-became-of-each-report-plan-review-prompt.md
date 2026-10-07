# Review: a plan to give the Feedback dialog's Earlier tab four statuses, a comment, a sayable number per report, and questions Greg can answer in place

Repo: this worktree (branch `worktree-fbcnbv8f-earlier-tab-deferred-and-ask`, off `dev`).
TypeScript, ESM, one Node server, Postgres via drizzle, a React client under `src/web/`.

## The candidate

Committed: the plan doc
`docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md`
at HEAD. Nothing is built. Start with the plan, then the code it stands on:
`scripts/feedback-endings.ts`, `src/feedback-ending.ts`, `src/store/pg-feedback.ts` (`listMine`),
`src/routes.ts` (search `FEEDBACK_PATH`, the POST parser around `[fb-field]`,
`serveAuthenticatedApi`, the `/api/admin` gate), `src/web/FeedbackEarlier.tsx`,
`src/web/FeedbackDialog.tsx`, `scripts/feedback-unswept.ts`, `scripts/feedback-reporter.ts`,
`scripts/feedback-shipped-emails.ts`, `src/db/schema.ts` (the `feedback` table),
`docs/project/feedback.md`, `docs/project/feedback-reports.md`, `docs/project/security-map.md`
§ Where the defences physically live, `docs/project/database.md` § A new migration. That is where
to begin, not the limit.

## What it is meant to do

Read the plan's "What Greg asked for" and "The design in one picture". The constraints the plan
must honour: the unattended agent building this may not deploy, may not write to the production
database, and may not edit a defence listed in security-map.md § Where the defences physically
live; simplest version first; one reader must never see another reader's reports; text written by
agents must not reach a non-admin reader in this version; the three note endings
(shipped/declined/awaiting) and everything that reads them (the sweep, the shipped email,
feedback-unswept) must keep working.

## What you can and cannot run

The tree is read-only. /tmp is writable. You may run a single test file
(`npx vitest run tests/<one>.test.ts`) or a script with `node --import tsx`. No network and no
Postgres.

## Attack it

Independently, before reading my suspicions. Is each statement the plan makes about today's code
accurate? Does the design do what Greg asked with the fewest parts? Where would it be wrong,
unsafe, or break something that reads the generated endings map or the feedback table? Is anything
in it actually an edit to a listed defence, or a production write by an agent, under another name?
Is there a simpler design that gives Greg the same thing?

For each finding give: an ID (F1, F2, …), a severity (P0 data loss / exploitable security / broadly
unusable; P1 user-visible wrong behaviour or an authoritative contract violated; P2 design or
maintainability risk; P3 prose), whether it is established or reasoned, (a) the concrete scenario
or the contract it contradicts, with file and line, and (b) the smallest change to the plan that
closes it, as replacement wording. A finding with no (a) goes last. End with one verdict line:
`VERDICT: approve`, `VERDICT: approve with fixes`, or `VERDICT: refuse` (refuse only on an
established P0 or P1, naming what established it).

## My own suspicions — read last

These are already my doubts; confirming them is worth less than what you find yourself.

- Decision 3: a stored global `number` versus a computed per-owner rank. Is the migration (backfill,
  then sequence default, not null, unique) safe against the running server inserting between its
  statements, and in the window where the migration has landed and the old code is still running?
  Does anything insert into `feedback` in a way that would break?
- Decision 6: an answer as a feedback row with an `answers` column. Does anything downstream
  mishandle such a row (the admin email per reader report, the shipped email, the Sentry mirror,
  `feedback-unswept` coverage, `/admin/feedback`)? Should an answer row be listed in the Earlier
  tab as a report?
- Decisions 5 and 6: `isAdmin(user.id)` used inside `GET`/`POST /api/feedback`, outside the
  `/api/admin/` prefix gate. Is that a second way of doing the admin check that the codebase tells
  me not to add?
- Decision 1: the status precedence, and an ignored report showing to its reader as "Set aside".
- Decision 8: deploy skew with an already-open tab.
- The generated module growing to hold comment text and question bodies: bundled into the server,
  and it must not be bundled into the client.

Do not change any file.
