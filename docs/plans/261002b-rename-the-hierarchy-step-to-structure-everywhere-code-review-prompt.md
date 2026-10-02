# Code review: rename the `hierarchy` step to `structure` (stage 2)

You have write access to this worktree. Repo root is the current directory. **Fix what you find
inside this change** (edit files directly), and report anything wider for me to decide. Do not
commit, do not run any version-control command that changes state, do not touch the database
(no `npm run db:migrate`, no SQL against any server), and do not edit anything under
`docs/plans/`, `docs/postmortems/`, `docs/user-feedback/`, `docs/research/` or `evals/results/`
except this review's own answer file.

Read first: `docs/plans/261002b-rename-the-hierarchy-step-to-structure-everywhere.md` (the plan,
with your own plan review folded in), then the diff:

    git show d988cc77f            # stage 2 (this review)
    git show b96fb333e --stat     # stage 1, already on dev — context only

Stage 1 renamed files and identifiers and kept every stored literal. Stage 2 (commit d988cc77f) is
what you are reviewing: the step value and AiJob `"hierarchy"` → `"structure"`, the checkpoint
namespaces, `drizzle/20261002123135_structure_step.sql`, `RETIRED_STEPS` / `currentStepName` in
`src/step-order.ts` applied in `toJob` and the overlap `shape` in `src/store/pg-jobs.ts`, `RENAMED`
in `src/cost-categories.ts`, the new `tests/retired-step-names.test.ts`, and a large prose pass over
comments, docs and messages.

What I most want, in order:

1. **The migration.** Order (guards → drop CHECKs → UPDATEs → postcondition → re-add), the drain
   guard's predicate (does `steps @> '[{"name":"hierarchy"}]'` really match a `JobStep[]` row?), the
   checkpoint `CASE`, idempotence (a second run on an already-migrated database), and what happens
   while old code is briefly live after it commits. Production counts (read-only, 2026-10-02):
   `revision_step_runs` 421 of 4,116 rows with `hierarchy`; `checkpoints` 139 `hierarchy-labels`,
   30 `hierarchy-structure`, 0 `hierarchy-deepen`; `jobs` 2 rows (both finished) naming it; none
   queued or running.
2. **Any stored or matched string still spelled the old way, or moved when it should not have**:
   step-keyed records, raw SQL predicates, string comparisons on `step.name`, `ai_calls` readers
   that bypass `RENAMED`, checkpoint queries in evals, prompt text (a prompt change would change
   checkpoint keys — check none was touched: `git show d988cc77f -- src/structure-prompt.ts
   src/structure.ts src/structure-expand.ts src/structure-deepen.ts src/labels.ts` and look for any
   change inside a template literal sent to a model).
3. **The job-reader translation**: is `toJob` the only path rows reach the worker by? Any other
   reader of `jobs.steps` / `jobs.reset` (raw SQL in `src/store/pg-jobs.ts`, `jsonb_array_elements`,
   `settledSteps`, labels-successor queries matching `step.name === "labels"`)? Would a
   `hierarchy` row written by old code after the migration be written back still spelled the old
   way, and does that matter?
4. **The prose pass**: spot-check that comments now say true things, that no plan/postmortem/
   results path was broken (a scripted swap broke two; both were fixed), and that user-visible
   strings changed only where they should.

Run `npm run typecheck` and the test files you touch. Write findings as a numbered list with
severity (P0–P3), file:line, what you changed (or why you did not), and a one-paragraph verdict at
the top.
