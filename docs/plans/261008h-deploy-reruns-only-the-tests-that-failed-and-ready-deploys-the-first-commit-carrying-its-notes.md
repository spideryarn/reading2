# Deploy reruns only the tests that failed, and `--ready` deploys the first commit carrying its notes

Status: built, 2026-10-08. Brief from the Overseer, from Greg's request at ~19:10 BST. GPT Sol's
plan review ([…-plan-review-sol.md](261008h-plan-review-sol.md)) found four P1s; what each changed
is in [§ After the plan review](#after-the-plan-review), which overrides the design below where they
differ.

> It seems as though the deployment is getting more and more kind of slow and brittle. We've made one
> change that involves deploying from a separate branch with the deployment-ready. I don't know if
> that's actually ever been tried, but that's one change. Maybe that'll do the job.
>
> The other thing is just, it seems as though if a test, a single test fails, does that then require
> it to run all the tests again? Because that sounds dumb. Could we not just run the test that failed
> and if that's been fixed, assume it's okay? I'm willing to take that small risk rather rerun the
> whole test suite every time.
>
> If the current deploy is proving problematic, let's try this and the new `deploy --ready` approach.
>
> — Greg, 2026-10-08

## What went wrong today

Four deploy attempts on 2026-10-08 each stopped at the `test` gate on one or two reds (a
clock-dependent test, a 30 s timeout under load in `tests/citation-investigate-route.test.ts`,
uncompressed plan PNGs, a Help picture the wrong width). Each fix meant a new deploy, and each new
deploy ran the whole suite again — about an hour — to learn whether the one fixed file now passed.
The deploy's own test runs are written nowhere the next deploy can read, so it had no choice.

`--ready` ([261007k](261007k-deploy-a-commit-the-readiness-loop-already-saw-green.md)) has never
deployed anything. **Verified why**, from `~/.fleet-readiness/runs/` and `notesAt`:

1. **Green prepared runs are rare.** Since the loop began stamping its preparation (2026-10-07
   16:13), it has finished nine `npm run check` runs: one pass (`9fd040df`, 17:02 today), six reds,
   two voids. Before 17:02 there was nothing for `--ready` to pick.
2. **The one green commit cannot carry its notes.** `notesAt(9fd040df)` says *"76 commit(s) after
   91665016 change what a reader sees and no release notes describe them"*. The notes are a commit
   on top of `dev` (`781c53ec` at 16:53, describing up to `1ca91aa8`; `a7ccdb2b` at 18:27), and a
   commit the loop tested cannot contain a commit made after it. `--ready` deploys exactly the green
   commit, so its `changelog` gate refuses it — *"wait for the readiness loop to pass a commit after
   them"* — and with a full run at 70–90 minutes and only one pass in nine, that wait rarely ends.

Note `781c53ec` itself **contains** `9fd040df` (checked with `git merge-base --is-ancestor`; it is
its immediate child, adding only the notes), and its notes describe `1ca91aa8`, which `9fd040df`
contains. The green run finished at 17:02 UTC (18:02 BST); `781c53ec` was committed at 16:53 BST,
so the commit B would pick was on `dev` about an hour before the run that vouches for it finished.
The design below would have picked it, subject to the other gates.

## The design

### A. A deploy's test gate may rerun only what failed

**The rule.** Find the newest settled *full* run of the suite on a commit `X` that is an ancestor
of the candidate `Y` (or `Y` itself) and finished within 24 hours. If that run passed, or failed
**only in test files it named**, the gate runs just:

- the files that failed at `X` (dropping any `Y` no longer has), and
- the test files changed in `X..Y` (`git diff --name-only X Y`, matching vitest's include pattern,
  present at `Y`) — cheap, and catches the obvious hole: a test somebody edited since.

If those pass, the gate passes. It prints which run it reused, its age, the files it re-ran, and
how many commits `X..Y` holds; the summary's `test:` line says the same. `build`, the tooling
builds, `fixtures` and `typecheck` always run at `Y`, as today.

**Every other case runs the whole suite and says why**, which is the silent-success clause this
keeps from 261007k: no run at an ancestor in the window; the nearest one is void-only, or red with
failures it did not name (an unhandled error, a crashed setup, an interrupted run, an old record);
its `.env.local` differs from the primary's now; the test infrastructure changed in `X..Y`
(`package.json`, `package-lock.json`, `vitest.config.ts`, `vitest-admission.ts`, `tests/setup/`,
`tests/helpers/`, `tests/store-migration-registry.ts`); or the rerun's own report does not show
every requested file ran and passed (vitest silently ignores a filter that matches nothing —
measured).

**Nearest, and the newest run there decides.** If the nearest ancestor's newest settled run is
unusable, the gate does not fall back to an older green one: a red nobody can name, nearer `Y`, may
be exactly what broke in between.

**Green `X` counts too, not only red.** This is the consequence worth naming. A green run is a red
run with no failed files; treating it differently would mean a deploy whose last run was red in one
file reruns one file, while one whose last run was green reruns the whole suite — the weaker
evidence rewarded. So a plain deploy at `dev`'s tip will usually reuse the readiness loop's latest
run and rerun only changed test files. That is the risk Greg took — commits in `X..Y` whose
non-test changes break a test nobody re-ran — at the size the loop's cadence sets it (`X..Y` is
usually one or two hours of `dev`), and the loop still runs the full suite every ~75 minutes, so
such a break shows on the Readiness tab within the hour.

**Where the evidence comes from: two sources, one shape.**

- **The deploy's own full runs**, newly recorded: one JSON file per run in
  `logs/deploy/test-runs/` of the primary (gitignored; pruned after 7 days), with the sha, finish
  time, exit code, the `.env.local` hash, and the outcome below. Only full runs are recorded; a
  rerun is reported, not recorded, so evidence never chains.
- **The readiness loop's `npm run check` runs**, with every per-record clause `testEvidenceFor`
  already applies (the runner's checkout, the preparation stamp for that sha at the current
  version with the same `.env.local` hash, clean at both ends, `typecheck` and the suite builds
  clean in its table) — extracted into one function both paths call, not restated. Plus a new
  optional `testOutcome` on the record.

Not the readiness store for the deploy's runs: its records drive the Readiness tab's verdict about
`dev`, and a throwaway worktree's run under `/tmp` is a different kind of claim. A file beside the
deploy's other logs is one reader, one writer.

**The outcome comes from a vitest reporter, not from scraped text.** Measured with vitest 4.1.11:
the JSON reporter records a failing `beforeAll` on its file, but an unhandled error appears only in
the text (`Vitest caught 1 unhandled error`). A ten-line custom reporter,
`scripts/vitest-outcome-reporter.ts`, receives `onTestRunEnd(modules, unhandledErrors, reason)` and
writes `{ reason, unhandledErrors, files: [{ path, state }] }` to the path in
`SPIDERYARN_TEST_OUTCOME_FILE`. From it, one pure function decides:

```
pass         reason "passed", exit 0, no unhandled errors, ≥ 1 file, every file passed/skipped
red-in-files reason "failed", exit ≠ 0, no unhandled errors, ≥ 1 failed file, every file
             passed/skipped/failed (the failed ones are the rerun set)
unusable     anything else, with why
```

CLI `--reporter` flags replace the config's (measured), so the deploy names the outcome reporter on
its command line beside `default` and `json`; the readiness runner's `npm run check` passes no
reporter flags, so `vitest.config.ts` adds `default` + the outcome reporter when the variable is
set. The last writer is the outer run (a nested vitest inside a test finishes first), so a nested
run cannot leave its result as the outer one's.

### B. `--ready` deploys the first commit after the green one that carries its notes

Not the green commit `G` itself — it can never contain its notes — but **the earliest commit `C` on
`origin/dev` that contains `G` and passes the `changelog` gate** (`notesAt(C).gap === null`),
walking `git rev-list --reverse --topo-order --ancestry-path G..origin/dev`, `G` itself first. Its
test gate is A with `X = G`: rerun `G`'s failures (none, when it was green) and the test files
changed in `G..C`. The deploy prints `G`, `C` and the commits between them.

~~And `G` may now be red-in-files too.~~ Dropped after the plan review (P2-10): `G` stays green-only.

**Today this would have picked `781c53ec` once `9fd040df`'s run finished** (18:02 BST), with that
green run standing in and nothing to rerun but the test files changed between them (none: the
commit adds only the notes).

### The simpler option passed over, and the larger one

- **Simpler: only A, and leave `--ready` alone.** A plain deploy at the tip would mostly reuse the
  loop's run anyway, so `--ready` would add little. Passed over because the brief asks for `--ready`
  to work, and because it is cheap here: the walk is a loop over `notesAt`, which already exists.
  What `--ready` then adds is the smallest `X..Y`: the fewest commits shipped that no full run saw.
- **Simpler: let `changelog:prepare` describe up to the green commit.** Does not help on its own —
  the notes are still a commit after `G`, so `G` still cannot carry them. Something has to deploy a
  commit after `G`; B just picks the first one.
- **Larger: Greg's release branch** — `R = G + a notes-only commit`, pushed to `main` and merged
  back into `dev` (deployment.md calls it `release/<sha>`). It would ship exactly what the green run
  saw. Passed over for now: `main` would hold a commit `dev` lacks until a merge lands, which the
  deploy must do itself from the primary (where it must not run an ordinary merge — other agents'
  edits live there) or a throwaway worktree, with conflicts in `changelog-pending.json` to handle;
  and the next deploy's `origin/main` ancestry check refuses every candidate until that merge is on
  `dev`. B gets `--ready` deploying today with none of that; the branch stays the answer for fixing
  a release candidate in place, if that need arrives.
- **Rerun what the import graph says changed** (`vitest list --changed X`). Measured: for the last
  six commits on `dev` it listed 1,051 of 1,866 test files, because `src/types.ts` and
  `src/db/schema.ts` reach almost everything. That is a full run in all but name.

## Stages

1. **Outcome.** `scripts/vitest-outcome-reporter.ts`; `vitest.config.ts` adds it under the
   variable; a pure `testOutcomeFrom(json, exit)` in `scripts/deploy-evidence.ts`. Tests first,
   against reports built the way the reporter writes them, including the unhandled-error and
   hook-failure cases.
2. **Readiness records carry it.** `readiness-run.ts` sets the variable to a fresh path for `test`
   and `check` runs, reads it after, and puts `testOutcome` on the finished record; the parser
   reads it strictly (malformed is absent, like `preparation`). Nothing in the tab reads it.
3. **The deploy's runs are recorded**, and **the partial gate**: `partialEvidenceFor` (pure: runs,
   ancestry, changed files → `rerun` with files and sentence, or `run` with why), and in
   `gatesAt` the rerun with the reporter and the "every requested file ran and passed" check.
   `testEvidenceFor`'s per-record clauses extracted and shared.
4. **`--ready`'s candidate walk** (`firstCarryingNotes`, pure over an injected `notesGap`) and the
   red-in-files `G`.
5. **Docs**: deployment.md § Deploying a commit already known green, overseer.md § Deploying
   step 5 (no more "wait for a commit after the notes"), readiness.md's line about the record.

A dry run on the box (`npm run deploy -- --dry-run` and `-- --ready --dry-run`) at the end, with
its gate lines quoted below.

## After the plan review

Sol's verdict was *proceed with changes*. Taken, by finding:

- **P1-5, the report's file is its own.** The reporter takes the path when it is made and deletes
  the variable before workers start, so a vitest inside a test cannot write it. A real-vitest test
  proves workers do not see it (and went red when the delete was removed).
- **P1-6, teardown runs after `onTestRunEnd`** (checked in vitest 4.1.11's `close()`). The report is
  written `final: false` there and finalised from the process's `exit` handler with the exit code;
  `tests/setup/private-db-global.ts` marks its own failure with `markFailureOutsideFiles` where it
  sets `process.exitCode = 1`. A run whose verdict and exit code disagree, or whose report never
  finalised, is unusable. Both cases have real-vitest tests that went red under mutation.
- **P1-7, a short report is not a whole run.** The reporter records the filters, shard, project and
  test-name pattern, and how many specs the unfiltered config collects that did not finish, keyed by
  project and path. A baseline must be unnarrowed with nothing left out; a rerun must show every
  requested file *passed* (skipped is not). Measured in the real config: a two-file run reports
  `notRun: 1866`.
- **P1-8, the timeline stays.** Readiness `test` runs and running attempts are kept as blockers: a
  newer one on the nearest commit refuses the older full run. Unreadable records in either store
  refuse the partial path. The gate re-reads evidence for the commit it deploys, so a nearer
  unusable run between `G` and `C` sends `--ready` to the whole suite. The test row and the
  reporter decide, not the check's own exit, so a `cycles` failure does not void a green suite.
- **P1-9, provenance.** A deploy record carries a run id, the worktree, the sha and cleanliness at
  both ends, and the `.env.local` hash at both ends. It guards against mistakes; nothing on this box
  defends against a same-user agent forging one, the readiness store included.
- **P2-2, B's walk asks all three preflight gates a later commit can fix**: notes, the serving
  deploy recorded, and `origin/main` contained.
- **P2-3, green counts, with a leash.** Cross-commit reuse is limited to runs **2 hours** old; the
  exact-commit reuse keeps 24. What a pass claims is worded "a whole run on X … plus N files here".
- **P2-4, the harness list** is now every non-test file under `tests/`, plus the root configs,
  `scripts/db-test-create.ts`, `scripts/corpus-materialise.ts` and the reporter.
- **P2-10, `--ready` stays green-only.** A red `G` followed by its notes commit and then a fix would
  have `--ready` pick the notes commit, where the red remains, every time. A plain deploy at the tip
  already handles that through A.
- **P2-11** — `tests/vitest-outcome-reporter.test.ts` runs real vitest projects, and the record keeps
  only the compact judgement (the raw report is ~116 KB; the store's ceiling is 64 KB).
- **P3-1** — the timing above is corrected.

## After the code review

Sol's code review ([…-code-review-sol.md](261008h-code-review-sol.md)), with write access, fixed five
P1s and two P2s in place: the reporter finalises only after vitest's `close()` has completed (exit
alone is not teardown done), and the private-DB teardown marks an unexpected throw too; exact-commit
reuse now also requires a current reporter outcome, so a record from before this landed cannot
stand in at all; void and narrowed runs stay on the timeline as blockers, and the nearest commit is
chosen before the age limit; a partial rerun must show a passing report with exit 0; the deploy
writes a `started` record before its suite, so an interrupted attempt blocks older evidence; the
`.env.local` hashes are the tested worktree's; a failed file may be dropped only if its deletion is
in the diff, and paths are read NUL-separated. Its verdict: *ship after my fixes*.

One change of mine afterwards, from running the selection against the real store: **a run still
going no longer decides which commit is nearest.** The readiness loop is mid-run most of the time,
on a commit newer than its last verdict, and as reviewed that sent the plain deploy at `dev`'s tip
to the whole suite (*"a run on 033f122d … is still going"*). It still blocks the runs on its own
commit. A void run stays a blocker: it may have hung because of the code.

**The transition.** Every readiness record written before this lands has no outcome of the new
version, so neither the exact-commit reuse nor `--ready` can use them; both start working with the
loop's first green run after the push (~75 minutes once the runner is on the new code). Checked on
the box at 20:20 BST: `--ready` said *"9fd040df: the passing run has no version-3 outcome"*. Before
Sol's fix, the same check picked `G = 9fd040df`, walked one commit to `C = 781c53ec` (the notes
commit) and found nothing to rerun there.

## Tests, red first

`tests/deploy-partial-evidence.test.ts`, against the pure functions: the outcome classifier (each
of the three answers, and each way to be unusable); the partial chooser (nearest ancestor wins;
newest run there decides; an unusable nearest does not fall back; env mismatch; age; future time;
infra path changed; deleted failed file dropped; changed test files added; exact sha with nothing
to rerun); the rerun verdict (a requested file missing from the report is a fail); the notes walk
(first passing commit, `G` itself when it carries notes, none within the cap). The chooser's tests
were written before it and seen red (33 failing) before it existed.

`tests/vitest-outcome-reporter.test.ts`, against real vitest runs: red in one file, green, a
failing `beforeAll`, an unhandled error, workers not inheriting the path, a teardown that marks
itself, a teardown that only sets the exit code, a filtered baseline, a rerun naming a missing
file, and the reporter named on the command line. Mutations of the reporter — not deleting the
variable, dropping the marked failures, faking the exit code — each turned exactly its own case red.
Forcing the filters to empty did not, because `notRun` catches a filtered run independently.

`tests/readiness-preparation.test.ts` now also checks that the real wrapper puts `testOutcome` on
the finished record.
