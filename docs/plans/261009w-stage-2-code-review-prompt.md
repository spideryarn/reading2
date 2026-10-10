# Code review, Stage 2 of 261009w: Bibliography's stored names (`citations` → `bibliography`)

You are a reviewer **and fixer**, write-capable in the worktree. Candidate: commit `c66854ae1`
(one commit; `git show --stat c66854ae1` lists the paths). Plan:
`docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md` — § The names, § What keeps its
word, § The database, and § After GPT Sol's plan review (F1–F11 override earlier sections). Your own
plan review is `docs/plans/261009w-plan-review-sol.md`.

## What the stage is

The Bibliography sub-mode of the Sources mode was the Citations mode; its stored names still said
`citations`. This stage renames them to `bibliography`: step/job/column/route/files/types/CSS root
class/public key/export file, `citations-find` → `citation-find`. **The database is expanded, not
renamed** — `drizzle/20261009230106_bibliography_expand.sql` — because `npm run deploy` applies
migrations before the new code is live, and the brief says the deployed code and the database must
never be out of step in a way that breaks a reader. Old routes, the public payload's old key, old
job step names and old chat origins are accepted for one deploy (F1). A contract migration later
removes the compatibility pieces.

## Evidence you cannot produce yourself

Your sandbox has no Postgres. The database tests were run by me on this commit; raw output:
`docs/plans/261009w-stage-2-pg-tests-output.txt` (tests/bibliography-expand-pg.test.ts,
db-step-constraint, pg-session-sharing-rebase, chat-origin-route, store-export-covers-tables,
bibliography-old-names). Read the test files to judge what they actually prove. The builder also
reports a full `npm test` green bar one file that needed untracked files added (now committed).

## What to do

An independent attack first:

1. **The migration and its triggers.** Against the real store code (`src/store/pg-revisions.ts`
   draft copy, `beginStepRun` upsert and its `setWhere`, the lease `UPDATE`s in
   `src/store/artifacts-pg.ts` `heldBy`, the `extraSteps()` delete, the sharing rebase's `runsOf`):
   do old-code statements (as of the commit before Stage 2, `git show c66854ae1^:<file>`) and
   new-code statements both behave correctly with the triggers present? The step-run mirror deletes
   the partner then re-inserts it from NEW via `jsonb_populate_record` — any case where that loses
   a row, fights a concurrent lease, or violates a FK/CHECK? Does `BEFORE INSERT OR UPDATE OF
   citations, bibliography` miss any write path (e.g. an `UPDATE` that sets the column through a
   different expression, a `COPY`, an `INSERT … SELECT` from another revision that carries only one
   of the two)? Is the postcondition actually able to fail?
2. **Old code against the expanded schema**: list every place the pre-Stage-2 code reads or writes
   `citations` in the DB (column, step name, origin, job steps) and check each still works.
   **New code against data the old code writes in the window**: same, the other way.
3. **The one-deploy aliases** (F1): do the old routes give back exactly what the pre-Stage-2 client
   (`git show c66854ae1^:src/web/useCitations.ts`) reads, including the none-yet header behaviour?
   Does the public payload carry both keys everywhere a visitor's client reads it?
4. **Hits decided wrongly** — something renamed that is a web citation, a cited work, a stored
   inner key or a stored tool name; or something still named `citations` that is Bibliography's
   step/artefact/mode-level name. The builder's own unsure list: local variables named `citations`
   holding a `Bibliography`; the marginalia input field `citations`; `attachCitationRegistry`
   returning `{ citations }`; help keywords; `evals/plain-words`' stage name.
5. **`RENAMED` was removed from `src/cost-categories.ts`** in favour of `currentLedgerName` in
   `src/step-order.ts` (F10). Docs that still describe `RENAMED` (docs/project/mode.md § Renaming
   a mode, cost-tracking.md, admin-costs.md, …) are now wrong — fix them.
6. Docs: docs/project/bibliography.md (was citations.md), sources.md, mode.md's checklist — true
   against the code?

Fix what is inside this stage, narrowly, red-first where it is behaviour. Report, do not fix,
anything wider. You can run any vitest file needing no network or Postgres, and
`npm run typecheck`. Do not commit; no git command that discards work.

## Severity and output

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

First line: `LAND`, `LAND AFTER FIXES`, or `DO NOT LAND`. Then findings C1, C2, … most severe
first, each with evidence and whether you fixed it (files changed) or are reporting it.

## My suspicions (worth less; spend most of the run elsewhere)

- The builder notes a possible deadlock if old and new code lease the same revision's step at the
  same instant (delete-then-insert in the mirror). Is the outcome of that abort safe — a job step
  that fails and retries, or something worse?
- `carriedColumns` now copies only `carry` columns, with a new `mirror` policy for the legacy
  column: does a new draft revision end up with both columns set (the trigger fills the legacy one
  on insert)?
