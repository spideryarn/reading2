# Readiness runner: GPT Sol review of commit 724c5245, commissioned by the Overseer

Up: [260909g-readiness-runner-git-env-and-preparation-latch.md](260909g-readiness-runner-git-env-and-preparation-latch.md). Commit 724c5245 was written by a write-capable reviewer whose run was killed at its 45-minute budget with no answer file, so nobody had reviewed it. The Overseer ran this read-only review against `dev` on 2026-09-09 (gpt-5.6-sol, high effort, 60-minute budget, job `rr-724c-review-2241-996324`); the prompt is the section below the answer. Verdict REFUSE on three P1s; the follow-up is queue item qi-4xfb5d54.

---

## Findings

**R724-01 — P1 — A real fleet-client input is omitted from change classification.**

`tools/fleet/web/src/dictation-client.ts:38` directly imports `src/dictation-limits.ts`, but the classifier watches only `tools/fleet/`, `src/web/`, and `vite.fleet.config.ts` (`scripts/readiness-loop.ts:569-573`, `tools/fleet/readiness-loop.ts:111-116`).

For a commit changing only `src/dictation-limits.ts`, I confirmed `preparationAfterChanges()` returns every need as `false`. The existing `index.html` is accepted, and the preparation latch advances despite the fleet bundle belonging to the previous SHA.

The test at `tests/readiness-loop.test.ts:447-451` hides this: it submits the missed path alongside two paths that already force `fleetClient: true`.

Fix by watching this file—or, more durably, deriving or conservatively covering all fleet bundle inputs—and test each source root independently.

**R724-02 — P1 — `npm ci` remains hollowable through inherited npm configuration.**

The command at `scripts/readiness-loop.ts:623` overrides only `dry-run`. `runCommand()` otherwise preserves inherited `npm_config_*`.

With `npm_config_ignore_scripts=true`, npm exits 0 after installing packages but skips install lifecycle scripts. Direct `npm run build:fleet` still runs, so the new fleet-artifact guard does not catch this behavior. This is npm’s documented behavior: [npm ci configuration](https://docs.npmjs.com/cli/v11/commands/npm-ci/).

I reproduced this against the pinned tree:

- `npm ci` exited 0 under `npm_config_ignore_scripts=true`.
- This lockfile names five packages with install scripts.
- Fleet build, all four TypeScript projects, and the product client/API build still passed.
- The dry-run test’s sentinel and `.package-lock.json` assertions also remain satisfiable because its fixture has no lifecycle scripts.

Thus the runner can latch a dependency tree whose lifecycle preparation was never performed. At minimum, explicitly override `--ignore-scripts=false` and add a test with an install-script-produced effect.

`npm_config_package_lock=false` is not another hole on npm 11.19.0: `npm ci` internally forces `packageLock: true`. I did not establish an `omit` setting that can pass through this repository’s immediate fleet-build backstop; omitting dev dependencies fails closed because Vite is a dev dependency.

**R724-03 — P1 — The fleet postcondition still proves only existence, not a usable artifact.**

After a successful command, `scripts/readiness-loop.ts:551` checks only `existsSync(entry)`. It accepts an empty file or a directory created at that path. The test’s final content assertion (`tests/readiness-loop.test.ts:627`) reads what its fake wrote; production never reads or validates that content.

A build script or plugin that exits 0 after creating an empty `index.html` therefore satisfies preparation, while the server’s own prerequisite also checks only existence. This is exactly the claim the postmortem says exit status plus existence cannot support.

The suspected removal failures themselves fail safely:

- EACCES causes `unlinkSync` to throw.
- A directory already at the path causes `EISDIR`.
- Failed-build cleanup errors are included in the thrown failure.

The remaining problem is successful-but-invalid output. Require at least a regular, non-empty file and validate its referenced assets, or use a producer-owned completion marker/atomic publication.

**R724-04 — P2 — Several “red-first” claims are not mutation-sensitive.**

Reasoned from the assertions:

- Removing the pre-build unlink still leaves the fleet test green: its fake overwrites the stale file, then failure cleanup removes it.
- Removing the successful-build existence check still leaves it green: the fake always creates the file.
- Removing either `.npmrc` or `npm-shrinkwrap.json` from the classifier leaves their combined test green.
- Removing individual fleet roots leaves their combined test green.
- Dropping `expectedRepository` from the tick’s guard call still satisfies the source-order test; only the helper is tested for foreign-repository rejection.

By contrast, removing `--dry-run=false`, the dirty-tree predicate, the backlink check, or the common-directory comparison would make their direct tests fail.

## Plan comparison

The Stages 1–3 account matches the diff for the dirty entry gate, backlink plus common-directory validation, `.npmrc`/shrinkwrap pathspecs, dry-run override, and pre-/post-failure fleet cleanup.

It is wrong that all current fleet source roots are covered: `src/dictation-limits.ts` is already a runtime bundle input. Its confidence in the test evidence is also too strong for the mutations listed in R724-04.

The copied `.git` pointer suspicion is otherwise closed: the code checks the backlink and, when called from `tick()`, compares the runner’s canonical common Git directory with the primary repository’s.

## Checks

- Pinned `npx vitest run tests/readiness-loop.test.ts`: **58/61 passed**. Three Git-boundary tests failed because nested `spawnSync git` returned the documented sandbox `EPERM`; I do not report the suite as passed.
- `npm run typecheck`: wrapper could not open tsx’s IPC socket (`EPERM`). Equivalent `node --import tsx scripts/typecheck.ts`: **passed all four projects, 1,893 files covered**.
- No Postgres or live-service command was run.

**Verdict: REFUSE — dependency preparation and fleet rebuild classification/postconditions can still report success without establishing the state they latch.**

---

## The prompt

# Review: commit 724c5245 on `dev` — the readiness runner's "two more commands that succeed without doing their job"

You are GPT Sol, reviewing read-only. Severity scale: P0 = would record a false READY or destroy
data; P1 = a check that can pass without doing its job, or a claim the code cannot back; P2 = a
smaller defect or a maintainability problem. Put an ID on every finding (R724-01, …). Verdict at
the end: ACCEPT / ACCEPT WITH FIXES / REFUSE, and a one-line reason.

## What this commit is, and why nobody has reviewed it

The readiness runner (`scripts/readiness-loop.ts`, `scripts/readiness-run.ts`, `tools/readiness/`)
runs `npm run check` against the commit `dev` is on, in the worktree `.claude/worktrees/readiness-checks`,
and records a run under `~/.fleet-readiness/runs/`. The doc is `docs/project/readiness.md`; the plan
that landed this commit is `docs/plans/260909g-readiness-runner-git-env-and-preparation-latch.md`.

Commit **724c5245** was written by a *previous* cross-family reviewer running write-capable. That
run was killed at its 45-minute budget with no answer file, so its diff is its only report: the
implementing session reproduced its two headline findings, re-ran the gates and committed it — but
**nobody has reviewed the reviewer**, and it is 539 lines. That is what this review is for. Treat
the commit as unreviewed code by an author who could not explain it.

## The candidate, durably

- Commit: `724c5245f60b9d2bb7557dd1f352c1249ecd272b`, on `dev` (an ancestor of `origin/dev`; the
  branch has moved on since, so review the commit, not the tip).
- Diff: `git show 724c5245`. Changed paths: `git show --stat --format= 724c5245`. Start with the
  runner's preparation and prerequisite code; the file list does not limit your scope.
- The commit message states its claims: `npm ci --dry-run=false` defeats `npm_config_dry_run=true`
  in the environment; the fleet `dist/index.html` entry is removed before the build and checked
  after; a dirty tree is refused at the entry gate; the worktree's `.git` backlink is checked.

## What to do

1. Independent pass first: read the commit as an attacker would. For each guard it adds, name the
   environment or tree state that still makes the guarded command report success while doing
   nothing, if one exists. `docs/reusable/silent-success.md` is the class.
2. Run what needs nothing outside the tree: `npx vitest run <the test files this commit touches>`
   and `npm run typecheck` if the sandbox allows. Anything touching Postgres or a live service is
   not yours to run — say what you could not run, and do not report it as passed.
3. Check the commit message's claims against the code: does each test go red when its guard is
   removed? Reason from the test's assertions, and say where you could only reason.
4. Check the plan doc's account of this commit (section on the Stages 1-3 review) against the diff.

## Our suspicions, last and labelled as suspicions

- The `.git` backlink check: does it prove the worktree belongs to THIS repository, or only that the
  file parses? A backlink copied from another repository's worktree is the case the plan says it
  closes.
- The `dist/index.html` removal: is the removal itself guarded against failing silently (EACCES,
  a directory in its place), and is the post-build check reading content or existence?
- `--dry-run=false`: is it the only npm environment override that can hollow out `npm ci`
  (`npm_config_ignore_scripts`, `npm_config_package_lock`, `npm_config_omit`, a `.npmrc` in the
  tree)? The commit lists `.npmrc` as an install input — is that input actually read into the
  preparation key?
