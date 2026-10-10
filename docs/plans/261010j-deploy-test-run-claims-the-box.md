# While a deploy runs its tests, the deploy has the box

Status: built, 2026-10-10. Owning docs: [testing.md § While a deploy runs](../project/testing.md#while-a-deploy-runs),
[deployment.md § When the suite does run, it takes the box](../project/deployment.md#when-the-suite-does-run-it-takes-the-box),
[overseer.md § Deploying](../project/overseer.md#deploying).

> I wonder if we can speed up the tests during deploy, e.g. by running them more in parallel. If
> that means we have to conserve resources on the box (e.g. pause a few agents or tell them not to
> run tests while the deploy is running), that would be fine.
>
> — Greg, 2026-10-10

## What we measured

**Every whole-suite run in the sample took 69–84 minutes, deploy or readiness.** (The deploy logs
kept are all of red runs, because `logs/deploy/` keeps output only on failure, but a red run still
runs every file.)

| source | runs | wall time |
|---|---|---|
| deploy gate, `logs/deploy/*-test.log`, 2026-10-06 → 10-10 | 10 whole-suite runs | 4249–4987 s (71–83 min) |
| readiness loop, `~/.fleet-readiness/runs/`, 2026-10-08 → 10-10 | 25 `check` runs | 69–84 min |

**Every one of them ran at two workers.** `~/.config/spideryarn/vitest-max-workers` says 2 on the box,
the deploy did not override it, and no deploy log carries a `memory admission` line, so admission never
cut it further. A 16-core box gave its most important suite two cores' worth of files, alongside five
agents' suites at two each.

**Where the time goes**, from the deploy log of `b2f8edcf` (2026-10-10 01:58, 4617 s wall, 1928 files),
by summing vitest's per-file lines with a scratch script:

| lane | files | sum of per-file `tests` time |
|---|---|---|
| unit | 1679 | 3658 s |
| private-postgres | 244 | 669 s |
| shared-services | 4 | 9 s |

Vitest's own breakdown for the run: `tests 4335s, import 2111s, environment 745s, setup 144s,
transform 168s` — about 7,300 worker-seconds.

**And the shape matters more than the sum.** Read from vitest 4.1.11's `groupSpecs`
(`node_modules/vitest/dist/chunks/cli-api.*.js`): a project with `maxWorkers: 1` and default
`groupOrder` goes into a **separate sequential group that runs after every parallel group has
finished**. So a run is two phases, one after the other:

```
|— unit + shared-services, N workers —|— private-postgres, one file at a time —|
```

The private lane alone, run in this worktree at 18:42 on a box at load 18–45 with the deploy's suite
beside it: **247 files, 1563 s (26 min)**, `import 676s, tests 768s, setup 38s, transform 37s`.
Nearly half of each file's ~6 s is importing the server's module graph again, because isolation is
on (it has to be: `src/process-state.ts` keeps the queue's locks on `globalThis`). That is a
crowded-box reading, not a quiet baseline.

So of a 77-minute deploy run, roughly **26 minutes is the serial lane and ~50 the parallel phase at
two workers** (about 5,800 worker-seconds of unit and shared files, halved). The parallel phase is
the part more workers can shorten; the serial lane is the floor.

## What we built

Option (1) of the brief, using the existing lock and the existing worker sizing:

1. **The deploy's suite asks for half the machine** — `VITEST_MAX_WORKERS=deployTestWorkers()`, which
   is `max(2, cores / 2)`, 8 on the box: the number a machine without the crowded-machine file has
   always taken, so the parallel lanes have run at this width on every laptop. Memory admission still
   applies and can only reduce it.
2. **Every other run that starts while a live process holds the release lock takes one worker**, and
   prints a line naming the deploy's pid and how to override. `resolveRunWorkers` in
   `vitest-admission.ts`: the existing three layers, then this. An explicit `VITEST_MAX_WORKERS`
   is never overruled — that is what exempts the deploy's own run, which sees its own lock.
3. **The lock's location has one home**, `scripts/release-lock.ts`, read by `deploy.ts`,
   `release-notes.ts` and the vitest config. It holds only Node built-ins and `lockfile.ts`, because
   the config imports it on every run. A lock whose pid is dead is ignored, so a SIGKILLed deploy
   cannot hold the box at one worker.

**Correctness gates are untouched.** The private lane stays serial (`resolveParallelWorkers` still
takes the variable from vitest); the unit lane has no database; the four shared-services files ran
side by side at two workers already and at nine on the Mac.

**Expected gain**: the parallel phase at roughly a quarter of its time, the serial phase a little
faster because the box is quieter. An optimistic estimate, not a measurement: 5,800 worker-seconds
over 8 workers is ~12 minutes ideal, call it 15–20 on a box that is never idle, plus the serial ~26,
so **about 40–45 minutes instead of 77**. The next deploy that runs the whole suite confirms it: its
record in `logs/deploy/test-runs/` has `startedAt` and `at` whether it passes or fails.

## What the Overseer does differently

Nothing it has to remember: the yield is automatic. Runs already going when the deploy starts keep
their workers, so when the box is busy with suites, starting the deploy after they finish is
quicker. A line in [overseer.md § Deploying](../project/overseer.md#deploying) says so.

## Passed over

- **(2) The Overseer asks sessions not to test, with no code.** It reaches only sessions it can talk
  to, depends on them reading it in time, and leaves the deploy at two workers anyway — the yield is
  half of the gain and the deploy's own width is the other half.
- **Make other runs wait** instead of taking one worker. A wait is a scheduler, blocks agents for up to
  an hour, and a crash leaves them waiting on a dead pid's file. One worker keeps everyone moving.
- **Run the private lane beside the parallel phase, in a second vitest process.** Vitest cannot do it
  in one process (groups are sequential), so the deploy would run two, each narrowed by `--project`,
  and the outcome reporter's "did this cover the whole suite" judgement — reviewed five times — would
  have to learn to merge two halves. The biggest remaining win (the wall time becomes the longer of
  the two phases rather than their sum), and the next thing to build if the serial phase stays as
  long as measured above.
- **Per-worker private databases**, so the private lane can run in parallel — stage G of
  [260903e](260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md). The real
  fix for the serial floor, and much larger.
- **(4) A readiness run right before the deploy.** `--ready` already reuses the loop's run when
  one proves the commit; a pre-run is the same 75 minutes moved earlier.
- **Scoping the yield to the test gate** with a second marker file. The lock is held for the whole
  deploy, so runs starting during the migration, push and verification also yield; that is minutes,
  and a second file is a second thing to leave behind.
- **Taking more than half** (12 of 16). Agents' own processes need the rest, and half is a number the
  suite has already been run at.

## Limits, stated

- The forecast in the fleet's admission panel and the readiness loop's preview still call
  `resolveParallelWorkers`, so they do not show the yield.
- A run that starts during a deploy keeps one worker after the deploy ends.
- Unreadable locks and git failures mean no yield (a slower deploy, today's behaviour); a reused pid
  could make runs yield to a deploy that is gone. Speed, never a verdict.

## Review

GPT Sol on the plan and first build ([plan-review-sol](261010j-deploy-test-run-claims-the-box-plan-review-sol.md)),
all four taken: `tests/vitest-worker-caps.test.ts` no longer compares two live reads of the lock
(it accepts the machine's number or one); `scripts/release-lock.ts` and `scripts/lockfile.ts` joined
`TEST_INFRASTRUCTURE` in `scripts/deploy-evidence.ts`, since the config now imports them; the
confirmation points at the run record rather than a log kept only on failure; the numbers are
worded as a sample and an estimate.
