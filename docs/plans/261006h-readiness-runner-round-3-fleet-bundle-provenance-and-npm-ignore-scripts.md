# Readiness runner round 3: the fleet bundle is checked against the commit, not guessed from a diff

Up: [260909g-readiness-runner-git-env-and-preparation-latch.md](260909g-readiness-runner-git-env-and-preparation-latch.md).
Queue item **qi-4xfb5d54**. The review this answers is
[260909g-readiness-runner-commit-724c5245-overseer-commissioned-review-sol.md](260909g-readiness-runner-commit-724c5245-overseer-commissioned-review-sol.md):
GPT Sol refused commit 724c5245 on three P1s and one P2, all of the
[silent-success](../reusable/silent-success.md) class.

## What the job is

The readiness runner (`scripts/readiness-loop.ts`, pure half in `tools/fleet/readiness-loop.ts`)
prepares a worktree for the commit `origin/dev` is on — `npm ci`, migrations, the fleet client
build — and then *latches* that preparation to the sha, so it is not repeated until the sha moves.
A latch is a claim that the derived state belongs to that commit. Three ways it can be made
without being true:

| | What Sol found | 
|---|---|
| R724-01 | The fleet bundle is rebuilt only when a diff touches a hand-kept list of paths, and the list misses a real input (`src/dictation-limits.ts`). |
| R724-02 | `npm ci` only overrides `dry-run`; an inherited `npm_config_ignore_scripts=true` makes it exit 0 with lifecycle scripts skipped. |
| R724-03 | After the build, the check is `existsSync(index.html)`. An empty file passes. |
| R724-04 | Five tests would stay green with their guard deleted. |

## Measured before planning (2026-10-06, this worktree, npm 11.19.0, node 26.8.1)

- `npm run build:fleet` takes **3.7 s**. The check it prepares for takes about 26 minutes.
- The build already writes a producer-owned marker: `tools/fleet/web/dist/build-stamp.json`, emitted
  in vite's `generateBundle` beside `index.html`, carrying `{kind:"known", sha, dirty, …}` for the
  checkout the config observed (`tools/fleet/build-stamp.ts` § `readBuildStamp` already parses it).
  The same stamp is compiled into the bundle as `__FLEET_BUILD__`, so **every commit is an input to
  the bundle** — a path list can never be complete, whatever is on it.
- The built `index.html` references exactly two assets, `./assets/index-*.js` and
  `./assets/index-*.css`.
- `npm install-scripts ls` reports four dependency packages whose install scripts are *"not yet
  covered by allowScripts"*: on this npm, dependency install scripts are not run by a default
  `npm ci` in any checkout here, with or without the flag. `package.json` has no root `postinstall`,
  `preinstall` or `prepare`. So R724-02 is narrower in practice than it read: the override is still
  right (the command should not depend on the caller's shell), but it changes nothing observable on
  this box today, and the plan does not claim otherwise.

## The design

### R724-01 and R724-03 together: ask the artefact which commit it is

Replace "did the diff touch a fleet input?" with "does the bundle on disk say it was built from the
target sha, and is it whole?". One pure-ish function, next to the stamp reader:

    fleetBundleProblem(distDir, targetSha): string | null

which returns a reason unless all of:

1. `index.html` is a **regular file** (`lstat`, so not a directory and not a symlink) and non-empty;
2. it references at least one `./assets/…` script, and **every** local `src=`/`href=` it references
   resolves inside `distDir` to a regular non-empty file;
3. `build-stamp.json` parses as a known stamp with `sha === targetSha` and `dirty === false`.

`ensureFleetClient(runner, target)` then becomes state convergence, the shape postmortem 260909a
asked for: if `fleetBundleProblem` is null, return; otherwise remove `index.html` **and**
`build-stamp.json`, build, and throw unless the problem is now null. It is called every tick with
the validated target, as today.

What goes away: `PreparationNeeds.fleetClient`, the three fleet branches of
`preparationAfterChanges`, and `tools/fleet`, `src/web`, `vite.fleet.config.ts` in the
`git diff` pathspec. The bundle is rebuilt once per new dev sha (3.7 s) because the stamp no longer
matches, which is also what makes `__FLEET_BUILD__` true.

**The simpler option passed over:** add `src/dictation-limits.ts` to the list and test each root
alone. It fixes today's miss and leaves the class: the next import from outside the list is silent
again. **The more elaborate one passed over:** derive inputs from vite's module graph. Correct, but
it is machinery to save 3.7 s.

**What the stamp does not prove**, said so in the code: it is an observation of HEAD at config load,
not a hash of the bytes. The runner only builds for a target it has just stamped clean and at that
sha, and only latches if the tree is still clean at that sha afterwards, so for this caller the
observation and the content agree.

**Not in this stage, reported instead:** `tools/fleet/server.ts:148` has the same existence-only
check at startup. That is the dashboard — the middle robustness tier — and a stricter refusal to
boot there wants its own decision. `scripts/check.ts` still does not run `build:fleet` either (the
runner's own header already says so).

### R724-02: pin the npm flags that can hollow the install

`npm ci --prefer-offline --dry-run=false --ignore-scripts=false`. A CLI flag beats both the
environment and any npmrc. Stripping every `npm_config_*` from the environment was considered and
passed over: it would also drop `npm_config_cache` and a registry setting, which are legitimate.

Test with a **real** `npm ci` in a temp fixture with no dependencies and a root `postinstall` that
writes a file, run under `npm_config_ignore_scripts=true`: the file must exist. No network. (A root
script, because dependency scripts are gated by `allowScripts` here regardless — see above.)

### R724-04: each guard gets a test that dies with it

- pre-build removal: a fake build that **asserts the entry and stamp are absent when it is called**;
- post-build check: a fake that exits 0 and writes nothing, an empty `index.html`, a directory at
  that path, an entry referencing a missing asset, and a stamp for another sha — each must throw;
- `.npmrc` and `npm-shrinkwrap.json`: `it.each`, one path at a time;
- fleet roots: moot — the classifier is deleted; replaced by "a bundle stamped for A is rebuilt for
  B even when the diff is empty";
- `expectedRepository` in `tick()`: the source-text test cannot see an argument dropped. Extract the
  guard-fetch-merge opening of `tick()` into an exported `advanceRunner(runner, expectedRepository, exec)`
  and test it behaviourally against a worktree of a foreign repository: no fetch may be attempted.

At the end, mutate each guard in the finished code and record which test went red.

## Stages

### Stage 1 — the code and its tests

One Opus subagent, red-first per defect, then `npx vitest run tests/readiness-loop.test.ts` (and the
build-stamp test file if touched), `npm run typecheck`, biome on touched files. Then the mutation
table. Then GPT Sol, write-capable, 60 minutes. Docs in the same stage: the fleet-prerequisite
comment in `scripts/readiness-loop.ts`, `docs/project/readiness.md` § Three ways it nearly lied,
and the status of the parent plan's owed review.

**Status: done 2026-10-06.** Built by an Opus subagent (`8649ab8d8`); GPT Sol's code review
accepted it with two P1 fixes of its own, committed separately after the gates were rerun outside
its sandbox (144 tests in four files, typecheck on four projects). What landed, beyond the
plan-review section below:

- `tools/fleet/build-files.ts` (the manifest and `fleetBundleProblem`), written by a `writeBundle`
  hook in `vite.fleet.config.ts`; `runnerChildEnv` in `tools/fleet/readiness-git.ts`;
  `advanceRunner` extracted from `tick`; `PreparationState.fleetBuiltFor`.
- Three validator checks the plan did not ask for: a file in `dist/` the manifest does not list is
  refused (this is what tests the manifest's "every emitted file"); an `index.html` the build itself
  wrote empty is refused; containment is checked through symlinks.
- **Reds:** 23 of the new tests failed against the old behaviour behind the new signatures. Not red
  first, and said so: `advanceRunner` (a behaviour-preserving extraction) and the validator's
  individual predicates (new code) — their evidence is the mutation run.
- **Mutations:** 60 guards broken one at a time in the finished code, each reddening a named test.
- **False in the plan:** `npm_config_dry_run=true` does not stop a root `postinstall` on npm
  11.19, so that case asserts the stale `node_modules` file instead; and once the environment is
  scrubbed, the env cases no longer test the two CLI flags, so two project-`.npmrc` cases do.
- **Not covered by any test:** the vite `writeBundle` hook itself (deleting it makes the runner
  throw on every tick — loud — but reddens nothing); `prepareRunner`'s default wiring; and the
  accepting path of the real build, which needs a clean tree and is Stage 2's proof.
- Targeted gates here: 121 tests in three files, typecheck clean on four projects.


### Stage 2 — land and relaunch

Rewritten after P3R-04 — see the plan-review section. Prove real preparation in this worktree once
it is clean; wait for the live loop to be between checks; stop it; confirm its children are gone and
the lock released; start the new loop from `.claude/worktrees/readiness-checks`; read one tick.

**Status: done 2026-10-06.**

- **Full suite** on the merged tree: 1739 files passed, 4 failed, none of them this work's. Two
  want `npm run build` (*has a build to inspect*); the other two
  (`a-broken-mode-leaves-the-article-readable`, `describe-fetch-failure`) fail on
  `src/web/useCitations.ts:341`, which arrived in the merge from `dev`. Pushed as `5539d76ce`.
- **Real preparation, proved in this worktree, not the live one:** `prepareRunner` with its real
  dependencies, started with `npm_config_script_shell=/bin/true`, `npm_config_ignore_scripts=true`
  and `npm_config_dry_run=true` in the environment. 33 s: `node_modules/.package-lock.json`
  rewritten, the bundle and manifest rebuilt, latched at the sha. A second call: 93 ms. (The first
  attempt at this proof printed nothing and exited 0, because it was launched with `npx` under that
  same environment — the hollowing, one level up, in the proof itself.)
- **The swap.** The old process (pid 972645, running since 2026-09-09) ticked at 14:21:26Z, which
  fast-forwarded the runner worktree onto the new code; no check was running. `SIGTERM`: gone within
  a second, children gone, lock file removed, log ends `EXIT=143`. New loop started from
  `.claude/worktrees/readiness-checks` under `tmux-job.ts` as `readiness-loop-1521-3777246`
  (pid 3777818 in the lock). Its first tick reinstalled, rebuilt the fleet client at 14:22:32Z with
  `build-files.json` and a stamp for `277503ef`, clean, and printed its decision line (a skip: the
  box was swapping).
- **Rollback, if wanted:** revert `8649ab8d8` and `618217791` on `dev` and restart the loop; the
  runner follows `dev`, so there is no old checkout to keep.


## Plan review (GPT Sol, 2026-10-06): REFUSE, five findings, all taken

[261006h-readiness-runner-round-3-plan-review-sol.md](261006h-readiness-runner-round-3-plan-review-sol.md);
prompt in [261006h-readiness-runner-round-3-plan-review-prompt.md](261006h-readiness-runner-round-3-plan-review-prompt.md).
The plan above is kept as written, wrong parts included; this section is what is built instead.
The plan is not sent back for a second read — the code review is where each of these is checked.

- **P3R-01, taken. A stamp found on disk is not provenance.** A hand-run build can consume an
  untracked file, stamp itself `{sha, dirty:false}` (the build stamp ignores untracked files), and
  survive the file's removal. So **the runner never reuses a bundle it did not build in this
  process**: `PreparationState` carries `fleetBuiltFor: string | null`, null at start, set only
  after a build this process ran passed the postcondition. Rebuild when `fleetBuiltFor !== target`
  or the bundle no longer validates. `fleetBundleProblem` stays, as the postcondition and as the
  per-tick "is it still there" check, not as a licence to skip the first build.
- **P3R-02, taken. "Whole" needs the producer to say what whole is.** HTML-only validation misses
  truncated JS and the eleven fonts the CSS names. `vite.fleet.config.ts` gains a `writeBundle`
  step that writes `build-files.json` last: every emitted file with its byte length and sha256,
  computed from the bundle in memory, not from disk. The validator requires that manifest, requires
  it to list `index.html` and `build-stamp.json`, and re-hashes every listed file. It is the
  completion marker R724-03 offered as the alternative; the HTML `src=`/`href=` parse is dropped as
  redundant. The removal before a build takes the manifest, the stamp and the entry.
- **P3R-03, taken, as the class rather than the instance.** `npm_config_script_shell=/bin/true`
  hollows a root lifecycle script past both pinned flags — and would equally hollow
  `npm run build:fleet`, `npm run db:migrate` and the check itself. Pinning flags one at a time does
  not end. So the runner's children get an environment with **every `npm_config_*` variable
  removed** (case-insensitive), in the same builder that already scrubs git's variables, used by
  `runCommand` and by the check launch. npm then reads its npmrc files, which is the configuration
  the box actually has. This reverses the plan's "considered and passed over": the variables `npx`
  sets for its children are echoes of that same config, so nothing legitimate is lost on this box.
  The two CLI pins (`--dry-run=false --ignore-scripts=false`) stay, because a user-level npmrc is
  not the environment. **Claim, narrowed:** independent of the inherited environment; not of a
  user or global npmrc beyond those two settings. My decision, not Greg's.
- **P3R-04, taken.** Stage 2 becomes: prove real preparation (`prepareRunner` with real deps) in
  *this* worktree, never in the live runner; then wait until the old loop has no check running,
  stop it, confirm its descendants are gone and the lock is released, start the new loop, read one
  tick. Keep the sha the old process was started from, for rollback.
- **P3R-05, taken in part.** The `git diff` pathspec is built from the same exported constant the
  classifier reads, and a test drives `preparationChanges` through `prepareRunner` and asserts the
  arguments git was given. Invalid-bundle fixtures start from a fully valid bundle and break one
  thing each. **Residual, accepted:** nothing tests that `main()` hands `tick()` the right
  repository short of running `main()`; `advanceRunner` is tested and the call site is one line.

## Stage 1 code-review corrections

The write-capable review is
[261006h-readiness-runner-round-3-code-review-sol.md](261006h-readiness-runner-round-3-code-review-sol.md).
It reproduced and fixed two remaining provenance gaps: `fleetBuiltFor` now retains the accepted
manifest with the sha, so a whole replacement at the same sha is rebuilt; failed post-build tree
validation clears both preparation claims and aborts the tick. That validation also runs after a
rebuild at an already-prepared sha. The new cases were red before these fixes.

The P3R-03 rationale above was too broad: npm exports CLI settings as well as settings from npmrc
files. A controlled `npm --cache /tmp/readiness-cli-only-cache run` exported that CLI-only path;
the default cache remained `/home/greg/.npm`. The scrub deliberately discards legitimate inherited
overrides too. It was the implementing agent's choice; this review corrects its rationale without
changing the policy. No current check consumes those inherited settings directly. Stage 2 still
requires the clean-tree preparation and live relaunch proof.
