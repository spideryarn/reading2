# Review: sixth sweep cluster S1 — delete what the filesystem store left behind

## The candidate

- Your working directory is the cluster's own git worktree. The candidate is the single commit
  `e6a1cf04d` on this branch. See it with `git show --stat e6a1cf04d` and
  `git diff e6a1cf04d~1 e6a1cf04d`. 28 files, +238 −2,719.
- The plan: `docs/plans/261006j-sixth-codebase-sweep-umbrella.md` § S1 and § "What the review
  changed" (U1). The builder's own record: `docs/plans/261006j-sixth-sweep-s1-filesystem-store-leftovers.md`.

## What it is meant to do

Delete machinery that served the filesystem article store (removed 2026-09-05) and nothing else:
the store-migration "witness" instrument (six files), `scripts/migrate-fs-toc-to-hierarchy.ts`, and
the `{ kind: "off" }` arm of `ReaderPlan` in `src/billing-plan.ts`. It must not weaken any live
defence and must not change what a reader sees.

## What you can run, and what you may change

You have no network and no database. You can run `npm run typecheck`, `npm run knip`, and test
files that need no database, e.g. `npx vitest run tests/store-migration-registry.test.ts
tests/one-store-only.test.ts tests/billing-plan.test.ts tests/doc-links.test.ts` — run them
yourself; a finding you reproduced outranks one you reasoned to.

**You may fix what you find, inside this cluster's files, narrowly and red-first.** Do not commit.
Anything wider than this cluster: report it, do not fix it.

## Attack it

1. **Is every deletion an absence that holds?** For each deleted file and for the `off` arm, grep
   `src/`, `scripts/`, `tools/`, `evals/`, `tests/`, `api/`, `package.json`, config files,
   `.claude/`, `infra/`, `docs/project/`. Is there a path — a browser client parsing the billing
   summary off the wire, an old stored value, a script — on which `kind: "off"` can still arrive?
   What does the client do today if it does (exhaustive `switch` with a `never` check that would
   now throw)?
2. **The retired gate.** The builder retired four cases of `tests/store-migration-registry.test.ts`.
   One was live: it required every new test file that uses `scratchArticleInPg` to have a
   `STORE_MIGRATION` entry. Was that gate still protecting anything now that there is one store, or
   was it a record of a finished migration? If it was protecting something (e.g. which test lane a
   database-using file runs in), say what, and restore the smallest check that keeps it.
3. **Do the surviving lane checks still fail when they should?** Mutate and see.
4. `tests/one-store-only.test.ts`: the builder says it silently skips a missing root file. Is that
   a vacuous pass introduced or exposed by this commit?
5. The seven plan-doc links turned into backticked text, and the doc edits in
   `docs/project/testing.md`, `static-analysis.md`, `structure-step.md`: true to the code now?
6. Anything the builder left that should go with it, or deleted that should have stayed.

## Format

Verdict line first: **ship**, **ship with these fixes (applied)**, or **do not ship**. Then
findings with ids (C1, …), severity P0–P3, `file:line`, reproduced or reasoned, and for each
whether you fixed it (say exactly which files you changed) or are reporting it. Under 900 words.

## My own suspicions — read last

The client's handling of an unexpected `kind`; the retired import-graph gate.
