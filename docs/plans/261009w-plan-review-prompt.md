# Plan review: Peer review becomes Sources, all the way down (261009w)

You are reviewing a **plan**, read-only. Candidate: commit `f5b247d4503e563c70c0c25bb523c5f0ffc72872`,
file `docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md`. The repo at that commit is
the code the plan will change.

Context worth reading: `docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md` (the
merge this renames, and its held Stage 3), `docs/project/mode.md § Renaming a mode` (the checklist
of where a mode's name is stored), the two precedents
`docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md` with
`drizzle/20261001224759_skim.sql`, and
`docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md`.

The brief (from Greg via the Overseer): rename the mode "Peer review" to "Sources" comprehensively —
docs, code, database — and in the same work rename the stored names `citations` → `bibliography`,
`debate` → `reception`, `debate-claims` → a sources-prefixed name (not bare `claims`). Old links
`?mode=peer-review`, `?mode=citations`, `?mode=debate` must still land. "source" already means other
things here; decide every hit by hand. **Plan the migration so that the deployed code and the
database are never out of step in a way that breaks a reader.** Apply locally only; never touch
production; the Overseer deploys (`npm run deploy` applies migrations, then pushes and waits for
Vercel — `scripts/deploy.ts`, `docs/project/deployment.md`).

## What to do

An independent attack first. In particular:

1. **The database design** (§ The database). Is expand/contract the right shape here, and is each
   part of it sound against the actual code? Read the real seams: `src/db/schema.ts`
   (`articleRevisions`, `revision_step_runs_step`, `chat_threads` origin CHECKs, `debateClaimChecks`,
   the cost bucket CHECK), `src/store/pg-revisions.ts` (draft begin copies step runs; the lease
   insert `ON CONFLICT` and its updates), `src/store/artifacts-pg.ts` (`runRowFor`, `heldBy`),
   `src/store/pg-jobs.ts § toJob`, `src/store/pg-debate-claim-checks.ts`. For each of the six expand
   parts: does the old code keep working against it, does the new code, and are writes from either
   seen by both? Would the step-run mirror trigger break the lease semantics (e.g. an `ON CONFLICT
   … DO UPDATE … setWhere` that now sees a mirrored row; a delete of `extraSteps()`; a copy of runs
   into a new draft creating both spellings and then the trigger mirroring again)? Would a view over
   the renamed claim-checks table really carry the old store's statements (its `ON CONFLICT`
   target, `RETURNING`, the partial unique index, grants to the app role)? Is there a simpler design
   that meets the brief — and is any part over-built for what can actually happen in a deploy
   window?
2. **Anything the plan misses** that stores or transmits a renamed name: `jobs.reset`, `work_key`,
   Storage paths, export bundle, public payload, IndexedDB, localStorage last-view, Sentry tags,
   generated files, cost categories, `scripts/`, `evals/`, `tools/`, the help corpus, the rate
   bucket names, `src/web/lib/api.ts` (`CACHEABLE`, `NONE_YET_AS_NULL`), anything else.
3. **The naming table and the keep-list.** Is any decision wrong or inconsistent (e.g. keeping
   singular `citation`, keeping `cite-` CSS and `?citeby=`, `citations-find` → `citation-find`,
   `DebatePanel` → `ReceptionPanel`, chat origin `debate` split by shape into `reception` /
   `sources-claims`)? Is the collision-avoidance for "source" workable?
4. **Stage boundaries.** Is each stage landable on its own (tests green, deployable alone with its
   own expand migration)? Is anything sequenced so that a deploy between stages would break?
5. **The accepted costs** (§ What is still accepted): the stale tab's 404 on renamed API routes in
   particular. Is it acceptable under the brief, or should old routes alias for one deploy?

## Severity

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

An ID on every finding (F1, F2, …), with file:line evidence and a concrete change to the plan.

## Output

A verdict on the first line: `BUILD AS PLANNED`, `BUILD WITH CHANGES`, or `RETHINK`. Then the
findings, most severe first.

## My own suspicions (worth less; spend most of the run elsewhere)

- The `revision_step_runs` mirror trigger is the part I am least sure of: the lease machinery is
  keyed on `(revision_id, step_name)` and I have not traced every statement.
- Whether drizzle's whole-row `select()` on `article_revisions` with the `legacy…` columns still
  declared costs anything that matters, or whether something iterates all columns (export, public
  DTO) and would emit the legacy ones.
- The sentence I would least like to be wrong about: *"Old code selects the columns by name, so a
  column renamed in place fails every read of a revision"* — is that actually true of this code?
