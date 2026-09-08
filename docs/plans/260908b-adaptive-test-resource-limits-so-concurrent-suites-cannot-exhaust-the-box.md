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

   **No registry, no lock, no coordination.** Each run reads the kernel's own number, and a run
   that starts is visible in the next run's reading — the shared state is `MemAvailable` itself.
   That bounds concurrent runs adaptively, which is the thing that was unbounded.

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

## Verification

- The memory table above, reproducible with `scripts/spike-vitest-workers.py`.
- A red-first test for the admission arithmetic: fed a synthetic low-memory snapshot it must refuse,
  and the refusal must be the thing that goes red if the comparison is inverted.
- `tests/vitest-worker-caps.test.ts` extended, keeping its existing habit of asserting what **vitest
  resolves** rather than what the config object says, and of cross-checking the number
  `provision.sh` writes against the number it verifies.
