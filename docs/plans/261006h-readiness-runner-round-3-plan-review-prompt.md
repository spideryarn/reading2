# Plan review: readiness runner round 3

You are GPT Sol, reviewing a **plan**, read-only. Nothing is built yet. Severity scale: P0 = would
record a false READY or destroy data; P1 = a check that can pass without doing its job, or a claim
the plan makes that the code cannot back; P2 = smaller defect or maintainability problem. Put an ID
on every finding (P3R-01, …). End with a verdict — ACCEPT / ACCEPT WITH FIXES / REFUSE — and one
line of reason. Keep it short: findings, not a tour.

## The candidate

- Live, uncommitted, in this worktree (`/var/tmp/spideryarn-worktrees/qi-4xfb5d54-readiness-round3`),
  base `8ad8fa8a3`. One untracked file is the plan:
  `docs/plans/261006h-readiness-runner-round-3-fleet-bundle-provenance-and-npm-ignore-scripts.md`
- It answers your own earlier review:
  `docs/plans/260909g-readiness-runner-commit-724c5245-overseer-commissioned-review-sol.md`
- The code it will change: `scripts/readiness-loop.ts` (§ `ensureFleetClient`, `preparationChanges`,
  `prepareRunner`, `tick`), `tools/fleet/readiness-loop.ts` (§ `preparationAfterChanges`,
  `PreparationNeeds`), `tools/fleet/build-stamp.ts`, `vite.fleet.config.ts`,
  `tests/readiness-loop.test.ts`. That list does not limit your scope.

## What to do

1. Independent pass first. For the plan's central move — deleting the fleet path classifier and
   instead validating `dist/` against the target sha through `build-stamp.json` — name any tree or
   environment state in which the proposed `fleetBundleProblem` returns null while the bundle on
   disk was not built from the target commit, or is not usable. Read how the stamp is produced
   (`tools/fleet/build-stamp.ts`, the plugin in `vite.fleet.config.ts`) before answering.
2. Check the plan's "Measured before planning" claims against the tree where you can. You may run
   `npx vitest run tests/readiness-loop.test.ts` and `node --import tsx <script>`; you have no
   network, and git-spawning tests may fail with sandbox `EPERM` — do not report those as findings.
3. Say whether each of R724-01..04 would actually be closed by what is written, and whether each
   proposed test would go red with its guard removed.
4. Say whether the Stage 2 relaunch procedure can be done as written given the lifetime lock in
   `main()` of `scripts/readiness-loop.ts`, and suggest a better proof if not.

## My suspicions, last, and worth less than your own pass

All of these trade-offs are mine (the implementing agent's), not the user's.

- The stamp is taken at config load from `git` in the runner. Could an inherited environment make
  it describe a different repository or report `kind: "unknown"` forever, so the runner rebuilds and
  throws on every tick (loud, but a permanent stall)?
- `dirty === false` in the stamp: is there any legitimate state where the runner's tree is clean by
  the runner's own stamp but the build stamp says dirty (different untracked-file rules)?
- R724-02: I found that on npm 11.19 dependency install scripts are gated by `allowScripts` and do
  not run here regardless, so the override only affects root lifecycle scripts, of which there are
  none. Is the plan right to do the override and claim no more — or is there a further npm setting
  that should be pinned at the same time?
- Leaving `tools/fleet/server.ts:148` alone (reported, not fixed).
