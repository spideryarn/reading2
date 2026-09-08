# Adaptive test resource limits, so concurrent suites cannot exhaust the box

On 2026-09-08 the shared box went to a load average of **391** on 16 cores with **swap 100% full**,
and sshd could not complete a banner exchange. 18 concurrent vitest runs held ~14.3 GB. The OOM
killer had already fired three times that week, and on 2026-09-06 **postgres invoked it** — the
local Supabase every worktree's suite depends on.

The cap from [260906h](260906h-cap-vitest-workers-so-one-box-can-hold-ten-suites.md) was already in
place and set to 3 on the box. It did not hold, and that plan predicted exactly this in its own
voice: *"eight steady-state runs at three workers is still 24 forks on 16 cores. This is a cap, not
a bound."*

The new thing here is a measurement nobody had taken.

## What we did not know: memory is fixed per *run*, not per worker

260906h measured wall time only, at 17/9/4 workers. The 2026-09-08 failure was a **memory**
exhaustion, so the missing number was RSS. Measured on an 18-core Mac, one run at a time, sampling
the whole process group every 250 ms (`scripts/spike-vitest-workers.py`), unit lane only:

| workers | wall | peak RSS | mean RSS | procs |
| --- | --- | --- | --- | --- |
| 1 | 787.0s | 3.88 GB | 0.85 GB | 8 |
| 2 | 393.5s | 4.33 GB | 1.00 GB | 11 |
| 4 | 206.8s | 4.47 GB | 1.54 GB | 15 |
| 8 | 127.4s | 5.76 GB | 2.59 GB | 21 |
| 16 | 94.9s | 6.86 GB | 4.55 GB | 40 |

Least-squares, and the fit is close enough to trust (predicted vs actual within 0.2 GB everywhere):

    peak RSS ≈ 3.84 GB fixed  +  0.198 GB per worker
    mean RSS ≈ 0.55 GB fixed  +  0.250 GB per worker

**87% of a run's peak memory is there before the first worker forks.** That single number decides
this plan, because it means the worker cap — the only lever we had — is close to useless against
the failure that actually happened:

| box policy | wall (idle machine) | 18 runs, mean | 18 runs, peak | forks |
| --- | --- | --- | --- | --- |
| cap 3 (today) | ~280s | 23.5 GB | 79.7 GB | 54 |
| cap 2 | 393s | 19.0 GB | 76.1 GB | 36 |
| cap 1 | 787s | 14.5 GB | 72.6 GB | 18 |

The box has 30 GiB RAM + 32 GiB swap = 62 GiB. **Every row overruns it.** Dropping 3 → 1 costs 2.8×
wall time and removes 9% of peak memory. It is a real CPU lever — 54 forks to 18 — and close to
nothing as a memory lever.

The mean column corroborates the incident independently: cap 3 × 18 runs predicts 23.5 GB against
14.3 GB actually observed. The gap is expected — the observation was a snapshot with runs at
different phases, and RSS understates the working set on a thrashing machine.

**So the quantity to bound is the number of concurrent runs, and nothing in this repo bounds it.**

### Repeated on Linux, against the number the policy actually reads

GPT Sol's review pointed out that the constants above are Mac RSS gating a Linux box, and that
summed RSS is not what `decideAdmission` consumes. Re-run on the box (16 cores, other agents
working, so the machine is not quiet):

| workers | wall | peak RSS | **MemAvailable drop** |
| --- | --- | --- | --- |
| 1 | 1973.8s | 3.68 GB | **5.77 GB** |
| 2 | 996.1s | 4.38 GB | **4.10 GB** |

Two findings. Peak RSS transfers between the machines — 3.68/4.38 against the Mac's 3.88/4.33 — so
the shape is not a macOS artefact. But **the drop in `MemAvailable` is larger than the RSS peak**,
because RSS misses the page cache a run evicts and the kernel memory charged on its behalf. Two
runs on a shared box cannot separate 3.8 from 5.8, so the policy constant is **5.0 GB**: above the
RSS figure, below the noisiest `MemAvailable` one, chosen on the asymmetry that refusing too
eagerly costs a slow run and admitting too eagerly costs the box.

The wall times are also worth noting — 33 minutes at one worker on the box against 13 on the idle
Mac — which is the contention the cap exists to reduce, and further reason not to have taken cap 1.

## The change

Two levers, because the measurement says they do different jobs.

1. **The worker cap stays a CPU lever**, and the box drops 3 → 2. Not 1: the third worker costs
   0.2 GB and buys back half the wall time, and on a *loaded* box the cap costs much less than the
   idle-machine table above suggests, because the CPU is shared anyway.

2. **A memory admission check, which is the actual fix.** Before a run starts, ask whether there is
   room for it:

       capacity = floor((MemAvailable - reserve - fixedRunPeak) / perWorkerPeak)

   - `capacity < 1` — **refuse to start**, with a resource-pressure message naming the numbers.
     Not "floor to one worker": the calculation has just said that no worker fits, and starting a
     4 GB process group anyway is how postgres gets OOM-killed. This was GPT Sol's correction and
     it is the sharpest point in the review.
   - otherwise take `min(nominal, capacity)`.

   **No registry, no lock, no coordination.** Each run reads the kernel's own number; the shared
   state is `MemAvailable` itself, so there is nothing to keep in sync or leave behind on a crash.

   **This is a valve, not a bound**, and the first draft of this plan claimed otherwise. Runs that
   arrive one after another each see less memory than the last, are throttled, and are eventually
   refused — the shape of 2026-09-08, whose eighteen suites arrived across an hour (their tmux
   session names timestamp them 0100 to 0159). Runs that read `MemAvailable` in the same instant
   all see the same figure and all admit, and the overshoot can be the whole cohort. The fixed
   3.84 GB is also a *peak reached later*, not an allocation made on admission, so even a staggered
   arrival can read a machine emptier than it is about to be. GPT Sol pressed on both and was right
   about both. Bounding a cohort needs an atomic claim — a short admission critical section — which
   is a home-grown scheduler, is not what this incident needed, and is not here.

Linux only, and opt-in per machine: `/proc/meminfo` has `MemAvailable` and macOS has no honest
equivalent, so a laptop keeps today's static behaviour rather than getting a guessed-at
approximation. The box opts in through the same `~/.config/spideryarn/` mechanism that already
carries its worker count, written and self-checked by `infra/hetzner/provision.sh`.

## The simpler options passed over

- **Only lower the cap, and stop.** What 260906h did, and the measurement above is the reason it is
  not enough on its own: at 18 runs it is a 9% memory reduction for a 2.8× slowdown. Kept as the
  CPU half of the answer, dropped as the whole answer.
- **A lease registry: each run records its worker count, new runs take their share.** Proposed, and
  GPT Sol was right to refuse it. It is write-after-read, so during the thundering herd it is
  meant to handle, all 18 starters read zero leases and all choose the maximum — *"the overshoot
  can be the whole herd"*. `O_EXCL` on a per-pid filename does not help, because each pid is a
  different filename. Worse, it cannot even be made to account correctly: `--maxWorkers` on the
  command line overrides the config by design ([260906h](260906h-cap-vitest-workers-so-one-box-can-hold-ten-suites.md)),
  so a config-time lease can record 1 while the run really uses 8.
- **`flock`, N runs at a time.** 260906h passed this over because a waiting run is
  indistinguishable from a hung one, and that objection still stands. The admission check gets the
  bound without the wait: a refused run **ends**, immediately and loudly, rather than blocking.
- **Gate on swap used %.** Sol: swapped pages stay resident after the pressure that caused them has
  passed, so 90% swap with 15 GiB free and no paging is not tonight's state. Swap belongs in the
  emergency condition alongside low `MemAvailable`, never alone.
- **A per-fork `--max-old-space-size`.** Treats a symptom; the heaviest fork was doing real work, so
  the result is a red test rather than a slow one.

## What is deliberately not solved

- **The fixed 3.84 GB per run.** That is transform and import cost, and reducing it is a different
  project. The admission check works *around* it.
- **The `private-postgres` lane's 18 databases.** Already `maxWorkers: 1` per run. Sol notes 18
  setup paths and 18 lease connections are worth measuring, but not worth a second mechanism until
  they prove material.
- **A macOS implementation.** Stated rather than guessed.

## What the code review changed

[GPT Sol's review](260908b-adaptive-test-resource-limits-so-concurrent-suites-cannot-exhaust-the-box-review-sol.md)
returned "request changes" and was right about four things:

- **The bound that was not one.** Corrected above, and pinned by a test that asserts the cohort
  overshoot rather than a bound the code does not deliver.
- **Fail-open states.** An existing-but-empty reserve file read as "no policy", which is exactly
  what a truncated write leaves behind — so the check would switch itself off on the one machine
  that asked for it. It now throws, and provisioning writes through a temporary file and renames.
  A `/proc/meminfo` that will not answer on an opted-in Linux box now refuses instead of waving the
  run through; `MemorySnapshot` grew separate `not-linux` and `broken` members so the two cannot
  share an outcome.
- **The config's side effect.** `tests/vitest-worker-caps.test.ts` imports the worker logic, and
  evaluating `vitest.config.ts` *runs* the admission decision — so near the threshold an import
  from inside an admitted run could throw a refusal, producing precisely the misleading partial red
  the refusal message promises cannot happen. The worker logic moved into `vitest-admission.ts`,
  leaving only the glue in the config.
- **Linux calibration.** The constants are Mac RSS and gate a Linux box. Summed RSS double-counts
  shared pages, so it is *probably* conservative, but that was an argument rather than a
  measurement. The spike now also records the drop in `MemAvailable` — the observable the policy
  actually consumes — and the Linux numbers are below.

And wrong, or overstated, about one:

- **"`--maxWorkers` can exceed the admitted capacity."** Half true, and the important half is the
  other way round. A **refusal cannot be bypassed**: it throws while the config is being evaluated,
  before any CLI option is applied. Measured, not reasoned —
  `npx vitest run --maxWorkers=8` against a forced low snapshot still stops with the refusal and
  exits 1. What `--maxWorkers` *can* exceed is a capacity-based **reduction**, and that is the
  escape hatch the cap deliberately sits at the config root to preserve.

Sol also asked for a multi-process barrier test. With the registry gone there is no allocation
algorithm left to prove oversubscribed, and the property in question is a pure function of one
snapshot, so the cohort test above asserts the same arithmetic deterministically instead of paying
for process spawning and its flakiness.

## Verification

- The memory table above, reproducible with `scripts/spike-vitest-workers.py`.
- **The refusal tests were watched red.** Widening `capacity < 1` to `capacity < -999` in
  `vitest-admission.ts` turns exactly three of the fourteen red — the cliff case, the boundary case,
  and the one asserting the message says `NO TESTS RAN` — and reverting turns them green. A test
  that has never been red proves nothing, and this one had to be seen.
- **The refusal was watched happen**, not just unit-tested, by temporarily forcing a low snapshot
  into `workersForThisRun()`. Vitest reports it under `Startup Error` with the whole message intact
  and exits 1:

      Error: REFUSING TO START: not enough memory on this machine for a test run.
        MemAvailable 1.70 GB, and swap 32.00 GB of 32.00 GB used.
        ...
        NO TESTS RAN AND NOTHING WAS VERIFIED — this is resource pressure, not a test failure.

  One wart worth knowing: vitest prints `failed to load config from …` on the line above, which
  reads like a syntax error until you get to the next line. The message survives intact, so this is
  filed rather than fixed.
- `provision.sh` writes and self-checks both files; `tests/vitest-memory-admission.test.ts` reads
  the numbers back out of the script, checks the write and the verify agree, puts the value through
  the real parser, and asserts an idle box is still admitted — the existing habit from
  `tests/vitest-worker-caps.test.ts`, which continues to assert what **vitest resolves** rather than
  what the config object says.
- `npm run check`: all gates green, including the full suite.
- Applied to the live box on 2026-09-08 and read back with the exact `grep -qx` the provisioning
  self-check uses.
