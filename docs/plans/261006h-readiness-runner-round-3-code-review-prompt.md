# Code review: readiness runner round 3, Stage 1

You are GPT Sol, reviewing **write-capable** in this worktree
(`/var/tmp/spideryarn-worktrees/qi-4xfb5d54-readiness-round3`). You have 60 minutes; write your
answer early and amend it rather than risk ending with none.

**Fix what is inside this stage, narrowly, each fix red-first with the test that reproduces it.
Report, do not fix, anything wider.** Do not weaken a guard to suit the sandbox: git-spawning and
npm-spawning tests may fail here with `EPERM`; that is the sandbox, not a finding, and not a reason
to change what "succeeded" means. Do not commit. Do not put words in anyone's mouth in a doc: every
trade-off in this stage was the implementing agent's decision, not the user's, and no doc edit of
yours may quote or attribute anything to Greg.

Severity: P0 = would record a false READY or destroy data; P1 = a check that can pass without doing
its job, or a claim the code cannot back; P2 = smaller. An ID on every finding (C3R-01, …), and for
each: fixed here / reported only. Verdict last: ACCEPT / ACCEPT WITH FIXES / REFUSE, one line.

## The candidate

- Commit `8649ab8d804072c478a94649796b971bc8818360` on this worktree's branch; parent `8ad8fa8a3`.
  `git show --stat 8649ab8d8` lists the 14 paths; `git show 8649ab8d8` is the diff. The tree is
  clean at that commit, so anything `git diff` shows afterwards is yours.
- Start with `tools/fleet/build-files.ts`, `vite.fleet.config.ts`, `scripts/readiness-loop.ts`
  (§ `ensureFleetClient`, `removeFleetBundleMarkers`, `prepareRunner`, `advanceRunner`, `runCommand`),
  `tools/fleet/readiness-git.ts` § `runnerChildEnv`, `tools/fleet/readiness-loop.ts`, then the tests
  (`tests/readiness-loop.test.ts`, `tests/fleet-build-files.test.ts`,
  `tests/helpers/fleet-bundle-fixture.ts`). That does not limit your scope.
- What it answers: your review of 724c5245
  (`docs/plans/260909g-readiness-runner-commit-724c5245-overseer-commissioned-review-sol.md`,
  R724-01..04) and your plan review (`docs/plans/261006h-readiness-runner-round-3-plan-review-sol.md`,
  P3R-01..05). The plan, with what was built and what was not covered, is
  `docs/plans/261006h-readiness-runner-round-3-fleet-bundle-provenance-and-npm-ignore-scripts.md` —
  read its Stage 1 status and its plan-review section as a reviewer of the claims, not only the code.
  The doc edits in `docs/project/readiness.md` are part of the candidate: check them against the code.

## Evidence I ran outside your sandbox (raw)

- `npx vitest run tests/readiness-loop.test.ts tests/fleet-build-files.test.ts tests/fleet-build-stamp.test.ts`
  → `Test Files 3 passed (3)  Tests 121 passed (121)`.
- `npm run typecheck` → all four projects, 3319 files covered.
- On the clean tree at 8649ab8d8, the real `ensureFleetClient(runner, sha, {fleetBuiltFor:null})`:
  `first: { fleetBuiltFor: '8649ab8d…' } 4434 ms`, then a second call `10 ms` (reused).
- The real build's manifest lists 15 files: index.html, build-stamp.json, 1 js, 1 css, 11 woff2.

## What to do

1. Independent pass first. For each guard, name the tree or environment state in which it reports
   success without the thing being true. In particular: can `fleetBundleProblem` return null for a
   bundle this process did not just build whole from the target; can `ensureFleetClient` leave
   `fleetBuiltFor` set after any failure; can a child of the runner still be hollowed through the
   environment; does anything else in the repo break because `npm_config_*` is now stripped from the
   check's environment or because `dist/` gains `build-files.json`?
2. Run what needs nothing outside the tree: `npx vitest run tests/fleet-build-files.test.ts` and
   `npx vitest run tests/readiness-loop.test.ts`, `node --import tsx <script>`.
3. Mutation-check by reasoning or by doing: for R724-01..04 and P3R-01..05, does a named test go red
   when its guard is removed? The plan claims 60 mutations all reddened; spot-check the ones you
   trust least.
4. Say whether each of R724-01..04 and P3R-01..05 is now closed, partly closed, or open.

## My suspicions, last, labelled, and worth less than your pass

- The "unlisted file in dist" refusal: could anything legitimately write into `tools/fleet/web/dist/`
  between the build and the next tick's still-whole check (the fleet server? a test?) and make the
  runner rebuild every tick, or throw?
- `writeBundle` with `order: "post"`: is the `bundle` object there guaranteed to hold every file
  vite writes for this config, or can vite's own plugins write files that never appear in it?
- The vite hook has no automated test (the plan says so). Is that acceptable given the runner's
  postcondition fails loudly without it, or is there a cheap test worth adding?
- The sentence I would least like to be wrong: "the `npm_config_*` variables npx and npm run export
  are echoes of the npmrc files, so removing them loses nothing this box needs".
