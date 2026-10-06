# A fresh worktree builds once, so the five standing reds stop

Status as of 2026-10-06: **built, one stage** — evidence: `scripts/worktree-builds.ts`,
`tests/check-steps.test.ts`, and the run under [What happened](#what-happened).

Two entries from the Overseer's queue, handed over under Greg's 2026-10-04 "If you're confident,
address all of the Q-queue-yeses". Both are one cause.

## The problem

Five test files read build output, and say so loudly instead of skipping when it is missing:

| file | reads | built by |
|---|---|---|
| `tests/cold-start-lazy-imports.test.ts` | `api-dist/vercel.js` | `npm run build` |
| `tests/pdf-bundle-trace.test.ts` | `api-dist/vercel.js` | `npm run build` |
| `tests/fleet-composed-access.test.ts` | `tools/fleet/web/dist/` | `npm run build:fleet` |
| `tests/fleet-decisions-route.test.ts` | `tools/fleet/web/dist/` | `npm run build:fleet` |
| `tests/fleet-reports-route.test.ts` | `tools/fleet/web/dist/` | `npm run build:fleet` |

Failing loudly is right, and stays. What is wrong is that two of the three places that run the
suite do not build first:

1. **A fresh worktree.** `npm run worktree:setup` installs and copies the corpus but builds nothing,
   so every agent's first `npm test` has the same five reds. It prints a line saying so, which
   every session then repeats in its report; the noise hides a real red.
2. **`npm run check`** (queue entry `qi-nwqfadjz`). It runs `npm run build` above the test gate but
   never `build:fleet`, so the three fleet files are red in any checkout where nobody ran it by
   hand. `scripts/check.ts` fixed this class once already, for `api-dist/`.

The third place, the deploy gate, is already right: `scripts/deploy.ts` runs `build` and then every
entry of `GATE_TOOLING_BUILDS` (`scripts/deploy-checks.ts`), and `tests/deploy-checks.test.ts` reads
the suite's own "run `npm run build…`" hints and fails if one names a script that list lacks.

Measured in this worktree, 2026-10-06, at load average 17: `npm run build` 16.5 s, `npm run
build:fleet` 2.7 s; 16 MB of output in all.

## The change

**A shared tooling list, with the product build first.** `scripts/deploy-checks.ts` gains
`SUITE_BUILDS`: `"build"` followed by every `GATE_TOOLING_BUILDS` script, in order.
It is "every npm script that has to have run before
the suite can be green". The drift test in `tests/deploy-checks.test.ts` compares the suite's hints
against that. Setup reads `SUITE_BUILDS`; check and deploy run the product build separately and
read `GATE_TOOLING_BUILDS` for the rest. The check-order test holds check to that tooling list.

1. **`scripts/check.ts`** adds one gate step per `GATE_TOOLING_BUILDS` entry, between `build` and
   `test`. `--fast` keeps them (2.7 s; and the test gate below reads the output, the same argument
   that keeps `build:api` under `--fast`). A new `--list` flag prints the step names in order and
   exits, which is what makes the order testable without running the suite inside the suite.
2. **`scripts/worktree-setup.ts`** runs every `SUITE_BUILDS` script as a new step after the corpus
   copy. The running lives in a small injectable function in a new `scripts/worktree-builds.ts`
   (the shape of `scripts/corpus-materialise.ts`), so it has a unit test.
   **A failed build does not fail setup.** A trunk whose build is broken must not stop an agent
   getting a tree to fix it in. It prints `FAIL`, the tail of the output and the command to re-run,
   and the closing line about red tests is printed only in that case.
3. `scripts/deploy.ts` is unchanged.

The five tests are unchanged: they still fail, loudly, with no build.

### What this does not fix: a stale build

Build output in a worktree is as old as the last build. An agent who changes what the API bundle
imports and runs bare `npm test` reads the bundle from setup time, as the primary checkout always
has. `npm run check` and the deploy gate rebuild, and those are the gates. The new setup line says
this in a few words.

### The simpler options passed over

- **The tests skip when the build is missing.** Simplest, and the one thing both test headers
  refuse for a stated reason: a silent skip is how a guard stops being a guard.
- **A vitest `globalSetup` that builds what is missing.** Makes every `npm test` able to pay
  19 s, puts a build inside every concurrent suite in one tree, and still leaves the staleness
  above. Building at the two points that already own "make the tree ready" is fewer builds, not
  none: the builds empty their output directories, so `check` or setup running while another
  suite reads them in the same tree can still redden that suite. That risk was already there.
- **Only the `check.ts` half.** Fixes the queue entry and leaves the five reds every session
  reports.

## Stages

One stage; it is about sixty lines.

1. Red first:
   - `tests/check-steps.test.ts` — spawns `tsx scripts/check.ts --list`, asserts `build`, then every
     `GATE_TOOLING_BUILDS` script, all before `test`. Red today (no `--list`, no fleet step).
   - `tests/worktree-builds.test.ts` — the injectable runner: runs every `SUITE_BUILDS` script in
     order, carries on past a failure and reports which failed.
   - `tests/deploy-checks.test.ts` — `SUITE_BUILDS` starts with `build` and holds every tooling
     build.
2. The change above.
3. Evidence that is not a unit test: a second fresh worktree, `npm run worktree:setup`, then the
   five files run and seen green; then `rm -rf tools/fleet/web/dist api-dist` and the same five
   seen red, so the check can still fail.
4. Docs: `docs/project/worktrees.md` § What a worktree costs, and the build row in
   `docs/project/static-analysis.md` / `code-quality-overview.md` where they describe the gate.
5. `npm test`, `npm run typecheck`, GPT Sol code review, push to `dev`.

Done means: in a fresh worktree after `worktree:setup`, none of the five files is red; `npm run
check` builds the fleet client before the test gate; deleting the build output turns the five red
again.

## What happened

**GPT Sol's plan review: approve, three P2s**
([prompt](261006g-fresh-worktree-builds-once-plan-review-prompt.md),
[answer](261006g-fresh-worktree-builds-once-plan-review-sol.md)).

- **F1, taken, after it had already happened.** `check.ts` had no `--list`, so the red-first run of
  `tests/check-steps.test.ts` ran the real check three times until its 60 s timeout killed each.
  So the order was reversed: `--list` first, then the test seen red by mutation (the fleet step
  removed: three reds; `break` after a failed build: two reds).
- **F2, half taken.** `scripts/readiness-loop.ts` § `ensureFleetClient` is an earlier local
  mitigation whose comment names this change as the real repair. It stays, with its comment
  brought up to date: `scripts/readiness-run.ts`'s `test` check runs a bare `npm test`, and a
  failed build there aborts the tick rather than recording a red. When preparation needs a fleet
  rebuild and then runs `check`, it builds that client twice; a newly created runner also builds
  during setup first. **The "three places" above is not a full inventory**: that `test` check
  and `scripts/store-migration-witness.ts --full` also run the suite without building, and both
  rely on a tree that has been set up.
- **F3, taken**: the claim about concurrent builds is narrowed above.

**The run that is not a unit test**, in this worktree on 2026-10-06:

```
rm -rf dist api-dist tools/fleet/web/dist
vitest run <the five files>         Test Files  5 failed (5)
npm run worktree:setup              ok   built what the suite reads (`npm run build`, `npm run build:fleet`)
vitest run <the five files> + 2     Test Files  7 passed (7)   Tests 198 passed
```

`npx tsx scripts/check.ts --list` prints `typecheck build build:fleet test …`.
