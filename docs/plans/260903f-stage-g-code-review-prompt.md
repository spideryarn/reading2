# Stage G code review — delete the filesystem store

You are reviewing **the deletion of an entire storage backend** from a working application. The
codebase is a reading app: one server process, TypeScript + ESM, Postgres, deployed on Vercel, with
real paying readers since 2026-09-03.

## The candidate — committed, on `dev`

Four commits, all on branch `dev` in this repository. **Review these SHAs, not a range** — `dev` is
shared and a merge-base range sweeps up twenty-seven other agents' commits from the same evening.

| SHA | subject | files |
|---|---|---|
| `69f8ebae` | G1 — two shared symbols leave the condemned module | 6 |
| `f8798186` | G2 — three adapters with no callers | 20 |
| **`86a4ef7c`** | **G3–G6 — the queue, `fs.ts`, `src/api.ts`, the artefact store, the reader-state halves** | **184** |
| `c5188697` | the cohort freeze written *before* any edit (plan doc only) | 1 |

```
git show 86a4ef7c --stat
git show 86a4ef7c -- <path>
git show 86a4ef7c --name-only --format=
```

`86a4ef7c` is ~14,000 deletions and is where nearly all the risk is. **Start there; this does not
limit your scope** — if something in the other three matters, say so.

The plan, and the record of what each group did and why, is
`docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md` § *G*, especially
the subsections `G's cohort, frozen before any edit`, `G1–G3 landed`, `G4 landed`, `G5 landed` and
`G6 landed`.

## What the job was

`SPIDERYARN_STORE` used to select between a filesystem store and Postgres, and **unset meant
`files`** — so the whole test suite exercised the store that was not deployed. Stage F (already on
`dev`, commit `1481e196`) removed the selection: there is one store, and a tombstone in
`src/store/live.ts` refuses a stale flag value. **Stage G, which you are reviewing, deletes the
filesystem store itself.**

Deleted here: `src/store/uploads-fs.ts`, `ai-calls-fs.ts`, `realtime-sessions-fs.ts`, `jobs-fs.ts`,
`fs.ts`, `artifacts-fs.ts`, `data-root.ts`, `src/job-scope.ts`, **`src/api.ts`** (which *was* the
filesystem article reader — it read `blocks.json` and `tree.json` off disk), the filesystem halves
of eight reader-state modules, and `PipelineStep.outputs()` with `StepContext.dir` / `htmlFile` /
`contextPaths`. Deliberately **not** deleted: `src/store/blobs-fs.ts` (selected by credentials, not
by the flag) and `src/store/copy-artefacts.ts` (made store-agnostic in an earlier stage).

## What I want from you

**Do an independent pass first.** The highest-value finding is anything that is *wrong in the
deployed application* — a reader loses data, gets a 500, is charged incorrectly, or sees the wrong
article's content. Second-highest is **coverage that was deleted without anyone noticing**, since a
green compiler and a green suite cannot detect a test that no longer exists.

Note that `npm test` is green (703 files, 12,654 tests) and `npm run typecheck` is clean. **Neither
is evidence about this change**, which is the whole problem: the suite cannot fail for a case that
was deleted.

You have no network and no database, so the Postgres suites are not runnable by you. Any test that
needs nothing outside the tree, you may run. Say which you ran.

### Severity

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an **ID** (`F1`, `F2`, …), a severity, the file and line, and — for anything P0
or P1 — a concrete failure scenario: the inputs or state, and the wrong output. If you cannot
construct one, say so and drop it a level. Some of your findings will be wrong; I check each.

---

## My own suspicions — read these last, and spend most of the run elsewhere

These are already mine. They are worth less than anything you find independently.

1. **`src/api.ts` was never instrumented.** Two witnesses were built to track which tests reach the
   filesystem store; both scan `src/store/*.ts`, and the article reader lived outside that
   directory. Two test files were recorded as "ran and touched nothing" while executing it. **Are
   there other rooms outside `src/store/` that were part of this store?** I found `src/api.ts`,
   `src/job-scope.ts` and eight reader-state modules by hand.

2. **Two files broke only at runtime**, because they build an import path as a *string* for a
   spawned child (`await import(${src("api.ts")})`) — invisible to the typechecker, to grep for
   import statements, and to both witnesses. I swept for that pattern afterwards. **Did I miss a
   third form?** Config files, `package.json` scripts, dynamic requires, `vi.mock` with a computed
   path.

3. **The seam guard was narrowed** (`tests/store-seams-have-two-implementations.test.ts`). It
   demanded two implementations of every store seam; it now demands a Postgres one, and
   `SEAM_ASYMMETRIES` is deleted from `src/store/live.ts`. I claim this is *strictly stronger*
   because every entry excused a missing **files** side. **Is that true, and does the narrowed guard
   still catch the outage it was written for** (a seam shipped with no Postgres implementation,
   answering 501 in production for four hours, 2026-08-31)?

4. **`assertScratchUntouched` → `assertNothingOnDisk`** in `tests/claim-session-postgres.test.ts`,
   across eleven call sites. It asserted "this Postgres publish wrote nothing to a disk" against a
   temp root that no longer exists; it now checks the repository root. I believe that is stronger in
   one direction and weaker in another. **Is the weaker direction one that matters?**

5. **Several properties are claimed to have *ceased to exist* rather than been dropped** — a
   different claim, and each needs to be true. The three: an ownerless job record cannot exist
   against a `not null` `owner_id`; a module-scope fence has no hazard when `claimIn` is a single
   conditional `UPDATE`; no job id is concatenated into a path anywhere in `src/`. **Check each.**

6. **The reader-state split.** Eight modules (`src/comments.ts`, `chat.ts`, `searches.ts`,
   `profile.ts`, `glossary-lookups.ts`, `referee-criteria-store.ts`, `shelf.ts`,
   `library-search.ts`) kept a domain half and lost a filesystem half. **Was the line drawn in the
   right place in each?** Note `src/referee-claims-store.ts` was deleted outright with `CLAIMS_SWEPT`
   moved into `src/store/pg-referee-claims.ts`.

7. **Everything that died with no home is supposed to be named in the plan with a reason.** The
   freeze says an unexplained deletion is the one failure no gate can see. **Find a deleted
   assertion that is not accounted for there** — that is the finding I most want and least expect to
   get for free.
