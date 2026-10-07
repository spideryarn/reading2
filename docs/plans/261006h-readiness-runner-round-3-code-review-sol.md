# Readiness runner round 3 — Stage 1 code review

Candidate: `8649ab8d804072c478a94649796b971bc8818360`, parent `8ad8fa8a3`.
Write-capable review in the candidate worktree. No commits and no live-runner actions.

## Findings

**C3R-01 — P1 — SHA-only build memory accepts another producer's replacement. Fixed here.**

After this process builds B, replace the entire bundle and manifest with another whole bundle
stamped clean at B. A hand-run build can consume an untracked input without making the build stamp
dirty; removing the input afterwards restores readiness-clean source. Both original reuse checks
still pass: `fleetBuiltFor === B` and `fleetBundleProblem(dist, B) === null`. The runner therefore
reuses a bundle it did not build, contrary to the central claim.

`fleetBuiltFor` now holds `{ sha, manifest }`, with the accepted manifest's exact text. The validator
compares that remembered manifest before accepting reuse, then checks the listed files. The memory
is cleared before any fallible check or rebuild. The new test **“does not reuse a different whole
bundle substituted at the same commit”** was red on the candidate: one build rather than two.
It is green with the fix; removing the manifest comparison independently reddens it again.

**C3R-02 — P1 — Failed final-tree validation preserves fleet trust. Fixed here.**

Vite's clean stamp is taken when its config loads. Source can change during compilation, leaving a
whole, clean-stamped bundle whose final source tree is dirty, unknown or at another sha.
`latchPreparation` originally cleared `preparedFor` but retained `fleetBuiltFor`. Once the source
became clean at B again, the suspect bundle was reused. At an already-prepared B, a missing asset
can trigger rebuilding, but `shouldPrepare === false` skipped final-tree validation entirely.

Every preparation now validates the final tree, including rebuilding an already-prepared sha.
Failure clears both claims and throws, aborting the tick so its later tree reading cannot override
an observed failure. The three **“rebuilds after the post-build tree was …”** cases and **“checks the
tree after rebuilding an already prepared commit”** were red first. Existing final-tree tests now
also require aborting. Independent mutations of clearing fleet memory and validating the
already-prepared path both reddened the new cases.

A follow-up read of the patch kept dependency/migration needs clearing conditional on those steps
having been considered for preparation, preserving the original behavior. A sixth new test,
**“keeps pending needs when this call did not run dependency or migration preparation”**, was red
against the initial review patch and green after that conservative adjustment.

Root cause, investigated in a read-only subagent:
[261006l-a-commit-label-cannot-identify-a-mutable-build.md](../postmortems/261006l-a-commit-label-cannot-identify-a-mutable-build.md).

**C3R-03 — P2 — The npm export rationale overclaims. Fixed here (wording).**

The claim that npm's exported configuration is necessarily an echo of npmrc files is false.
An offline package with a script printing only `npm_config_cache`, invoked through
`npm --cache /tmp/readiness-cli-only-cache run`, exported that CLI-only path. A separate
`npm config get cache` returned `/home/greg/.npm`; asserting equality failed. Removing inherited
variables also loses legitimate CLI/environment overrides and an alternate `userconfig` selection.

The comment and plan correction now state that this discard is intentional. The scrub remains;
it addresses the named hollowing settings and no current check directly requires the discarded
configuration. This correction makes no new claim about the actual machine's npmrc contents and
attributes no trade-off to the user.

## Independent guard pass and compatibility

- **Validator:** without process evidence, it can still return null for an internally consistent
  hand-built bundle at the target. That is deliberate and documented. The runner now supplies its
  remembered manifest on reuse. Missing, changed, truncated, unlisted, escaping or wrongly stamped
  files fail closed. It proves output integrity, not that the generated program works semantically.
- **Build failures:** command errors/nonzero status trigger cleanup and throw; an exit 0 with bad
  output throws; marker removal failures throw. Build memory is cleared before all these paths.
  Failed final-source validation also discards it. A valid reuse restores only the original memory.
- **Child environment:** `runCommand`, `readinessCheckEnv` and the standalone wrapper's
  `checkChildEnv` all use `runnerChildEnv`. Case-insensitive `npm_config_*` poisoning is removed,
  including `script_shell`, and the project-npmrc lifecycle test exercises the CLI pin separately.
  A setting in npmrc can still hollow a child beyond the two pins: for example `script-shell=/bin/true`.
  This limitation is explicitly disclosed, not newly closed. The scrub is not an allowlist of every
  environment variable or an isolation boundary against arbitrary executable injection.
- **Extra dist files:** the fleet server's static path only reads. Fleet process tests use scratch
  dist overrides; bundle fixtures also use scratch directories. I found no current legitimate
  runtime writer that adds files to the runner's dist between ticks. An added Vite public directory
  or plugin writing outside the output bundle would be refused, causing a visible rebuild failure.
- **Producer hook:** the installed Rolldown declaration says `writeBundle` runs after emitted files
  are written; Vite's public-directory copy is separate. This config has no public directory and
  disables sourcemaps. The supplied real-build evidence accounts for all 15 emitted files.
  `order: "post"` is not a universal guarantee covering every possible plugin's later side effects;
  the unlisted-file refusal detects additions. A failed later hook is caught by the command status.
- **Hook coverage:** no automated producer-hook or real accepting-build test exists, accurately
  disclosed in the plan. Removing the hook makes preparation fail before recording a check, so this
  is acceptable for Stage 1 with the supplied real-build evidence. A small direct hook test would
  improve accepting-path coverage; it would not establish clean source provenance or replace Stage 2.
- **Other repo consumers:** the direct npm-config consumers are deploy argument guards, whose npm
  baselines are recreated by their own child commands or explicitly supplied test fixtures.
  No fleet server or check consumer depends on a fixed dist-file inventory. `build-files.json`
  contains names, sizes and hashes and is served as ordinary JSON; it carries no secret.

The wider gaps already disclosed remain reported only: the fleet server's existence-only startup
check, `check.ts` not building the fleet client itself, shared-database schema provenance and
uncovered npmrc settings. They were not changed in this Stage 1 review. Live relaunch is Stage 2.

## Earlier finding closure

| Finding | Status after these fixes | Evidence or remaining limit |
|---|---|---|
| R724-01 | Closed | No fleet-input classifier; every new target requires its own build, and same-sha replacement is detected. |
| R724-02 | Closed | npm environment scrub plus explicit ignore-scripts pin; offline lifecycle effect asserted. |
| R724-03 | Closed | Producer manifest, required regular non-empty entry, sizes/hashes of all listed files and stamp. Semantic application correctness is not claimed. |
| R724-04 | Closed for its five named omissions | Pre-removal observations, invalid-success outputs, isolated dependency paths, new-sha build and repository wiring all have sensitive tests. General untested wiring still exists below. |
| P3R-01 | Closed | Fresh first build, remembered manifest identity, final-source refusal clearing both claims. |
| P3R-02 | Closed | Manifest binds the emitted JS, CSS and fonts; wrong same-length content and missing font each fail. |
| P3R-03 | Closed within the narrowed npm-environment claim | All inherited npm settings removed at three child boundaries; npmrc remains explicitly outside that claim. |
| P3R-04 | Partly closed | Safe Stage 2 sequence is documented; clean-tree preparation and live relaunch have not been performed by this review. |
| P3R-05 | Partly closed | Production diff pathspec, isolated fixtures, behavioural advanceRunner and textual tick wiring tested. main-to-tick repository wiring and default preparation wiring remain untested. |

## Verification

- Candidate baseline: fleet-build-files **30/30 passed**; readiness-loop **81/85 passed**.
  Three failures show nested Git `EPERM`. The fourth has empty nested Node output; an independent
  raw `spawnSync` reproduced sandbox `EPERM` with status 0/empty output. None is a finding, and no
  success guard was weakened.
- After the initial fixes, three targeted suites: **122/126 passed**, with the same four sandbox
  failures. Final run including the sixth new case and `tests/doc-links.test.ts`:
  **140/144 passed**, the same four sandbox failures; all six new cases and doc links passed.
  `git diff --check` passed.
- `npm run typecheck` is blocked by tsx IPC `EPERM`. Equivalent
  `node --import tsx scripts/typecheck.ts` **passed all four projects, all 3319 source files covered**.
- `npm test` was attempted as required by the repo; global setup refused unavailable local database
  access. It is not a passing full-suite result. No database was started or changed.
- Biome on touched code: exit 0, six existing informational `useLiteralKeys` suggestions, no fixes.
- The supplied clean-tree real build/reuse timings are external evidence from the implementing agent,
  not a measurement repeated here. This review leaves source edits, so real clean preparation still
  needs proof after the implementing agent commits them.

## Independent mutation spot checks

Each edit was asserted to match exactly once, restored by writing the saved text back, and its
failure inspected. These are 13 independent checks, not verification of the original claimed 60.
The original 60-mutation script/results table is not in the candidate, so that historical count
cannot be independently audited from this tree. Local raw logs/script: `/tmp/readiness-c3-review/`.

| Mutation | Named test | Observed red |
|---|---|---|
| Only build when shouldPrepare | skips classification when preparation is already latched | Expected build call missing |
| Remove ignore-scripts CLI pin | installs for real when .npmrc says ignore-scripts=true | Root postinstall effect absent |
| Remove regular-file predicate | refuses a directory at index.html | Wrong refusal reason instead of regular-file refusal |
| Omit pre-removal of stamp | clears the entry, the stamp and the manifest before it builds | Stamp still present at build start |
| Reuse solely from current disk validity | does not reuse a bundle it found on disk at start | No build observed |
| Remove content hash check | refuses JavaScript of the right length and the wrong content | Validator returned null |
| Remove npm family scrub | builds one runner environment that also removes every npm_config variable | Poison keys still present |
| Omit .npmrc from production diff pathspec | treats .npmrc, alone, as a reason to install again — and asks git about it | Git arguments missing .npmrc |
| Pass runner as expected repository from tick | opens every tick by advancing the runner against the repository it was given | Required call absent |
| Drop expected repository inside advanceRunner | does not fetch into a worktree of some other repository | Fetch attempted instead of repository refusal |
| Remove remembered-manifest comparison | does not reuse a different whole bundle substituted at the same commit | One build instead of two |
| Retain fleet memory on failed final tree | rebuilds after the post-build tree was … | Non-null fleet claim after failure |
| Skip final tree at already-prepared sha | checks the tree after rebuilding an already prepared commit | No throw |

One initial mutation test selector matched no tests; its all-skipped output was discarded and the
correct named test rerun red. None of the counted reds relies on a compile error or sandbox denial.

ACCEPT WITH FIXES — the two remaining Stage 1 provenance holes are repaired; live preparation and relaunch remain Stage 2, and four sandbox-limited tests still require the external gate run.
