Verdict: block. No P0; four P1s. S5 is substantially implemented for a readable store, S6 is implemented inside the scheduler engine, and S12 was only acknowledged in prose.

## Findings

### C1 — P1 — The executable daemon never enables the scheduler

[`scripts/overseer.ts`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/scripts/overseer.ts:703) calls `runOverseer` with attention and usage, but no `jobs`. Consequently [`daemon.ts`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/daemon.ts:671) sets `jobsTicker` to `null`.

Outside tests, there are no job definitions and no `SpawnJob` implementation anywhere in the repository. The test at [`overseer-daemon.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tests/overseer-daemon.test.ts:836) confirms the exact state the real CLI uses: no jobs and no occurrence events.

This revision contains a scheduler engine, but the installed Overseer schedules nothing. S6’s replacement is real in isolation and absent in operation.

### C2 — P1 — `definitionHash` detects history separation, not unauthorised edits

[`lastRunOf`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/jobs.ts:366) compares the current hash to occurrence hashes and returns `never` when they differ. But [`due`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/jobs.ts:336) interprets `never` as immediately due, after which [`dispatch`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/scheduler.ts:221) hashes and runs the edited definition.

There is no separately stored authorised hash, source revision, or mismatch state. Thus:

```text
authorised definition A ran
definition is edited to B
lastRunOf(B) = never
due(B) = due
B is dispatched
```

The test named “an edited definition reads as a job that has never run” at [`overseer-jobs.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tests/overseer-jobs.test.ts:170) catches incomplete hashing, but it actually codifies the unsafe half of the behaviour and stops before asking what the scheduler does with `never`.

Your mutation conclusion was correct but insufficient: all fields affect history identity. Being in the key is not equivalent to comparing against an authorisation.

### C3 — P1 — A cold recovery discards occurrence identity and permits the job to run again

When replay has a hole or exceeds 64 MiB, [`openStore`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/store.ts:2245) deliberately starts with an empty occurrence map. A configured job then reads as `never` and is dispatched.

This is acceptable for reconstructing the session register—the next snapshot repairs it—but not for an occurrence ledger whose purpose is preventing uncertain work from being repeated.

The corruption test at [`overseer-jobs.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tests/overseer-jobs.test.ts:783) explicitly expects `store.occurrences.size === 0`; it never calls the scheduler afterwards. It therefore passes over the dangerous consequence.

Occurrence loss must inhibit scheduled dispatch until history is recovered or explicitly reconciled. “Started cold” in a log is not enough once the empty state authorises actions.

### C4 — P1 — Gate 4 still has no executable global budget

The runbook now says “shared reservation” and “explicit exhausted state” at [`overseer.md`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/docs/project/overseer.md:109), but the scheduler accepts only definitions, store, spawn, and clock at [`scheduler.ts`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/scheduler.ts:118).

There is no shared concurrency, call, token/cost, or wall-time reservation; no exhaustion state; and no seam shared with attention, question routing, or recovery. S12 was acknowledged, not answered.

### C5 — P2 — Only the reservation append is genuinely fail-closed

The important pre-spawn claim is true:

- Reservation append completes before `spawn`.
- A refused or thrown reservation append returns `not-dispatched`.
- The scheduler uses a one-event append here, so no scheduler batch can be half-applied before spawn.

However, later append results are ignored:

- Runner-throw → `unknown`: [`scheduler.ts:255`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/scheduler.ts:255)
- Refusal: [`scheduler.ts:259`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/scheduler.ts:259)
- Successful completion: [`scheduler.ts:282`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/scheduler.ts:282)
- Rejected completion: [`scheduler.ts:288`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/scheduler.ts:288)

A failed refusal append still returns `refused`, and a failed completion append is completely silent; the durable state remains `reserved` or `started` and later becomes unaccounted. This does not defeat the initial no-unrecorded-spawn invariant, but it makes reports disagree with durable history and changes the next-run anchor.

### C6 — P2 — The watchdog and daemon do not actually share the snapshot deadline

The watchdog computes a constant from the historical 65-second cadence at [`overseer-watchdog.ts`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/scripts/overseer-watchdog.ts:118). The daemon calls `staleAfterMs` using the snapshot’s advertised `refreshMs`.

They already differ under the documented normal values:

```text
daemon:   staleAfterMs(60_000) = 300_000 ms
watchdog: staleAfterMs(65_000) = 325_000 ms
```

Importing the same function prevents formula drift, but not input drift. If collector cadence changes, the daemon adapts and the watchdog does not. The actual cadence or computed deadline needs to be stored in the checkpoint.

### C7 — P3 — The timer’s missed-run test proves a setting that has no effect here

[`systemd-units.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tests/systemd-units.test.ts:225) claims `Persistent=true` proves missed-run catch-up. The timer has only `OnBootSec` and `OnUnitActiveSec`, while the local `systemd.timer` manual says `Persistent=` only affects `OnCalendar=` timers.

`OnBootSec=2min` still gives the desired post-boot check, so this is not an operational blocker. But the test and comments claim the wrong mechanism.

The adjacent “parses as a valid systemd unit” test merely checks that an `OnUnitActiveSec=` line exists; it does not parse the unit. `systemd-analyze verify` is the appropriate positive control.

### C8 — P3 — One watchdog test does not test what its name says

“The four unhealthy states are textually distinct” at [`overseer-watchdog.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tests/overseer-watchdog.test.ts:174) compares the internal `state` tags and never calls `formatVerdict`. All four rendered messages could become identical and it would remain green.

## Crash-window table

| Crash window | Implementation result | Verdict |
|---|---|---|
| Before reservation becomes durable | Failed append prevents spawn. If no bytes landed, restart sees `never`; if the line landed despite a later error, restart conservatively sees `unknown`. | Correct |
| After reservation, before spawn | On restart, checkpoint entries pass through [`adoptOccurrence`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/jobs.ts:447); replayed reservations are folded against the new instance ID at [`jobs.ts:482`](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/jobs.ts:482). Both become derived `unknown`. | Correct for readable recovery |
| After spawn, before `started` append | Same bytes and same derived `unknown`; that occurrence is never dispatched again. A later scheduled instant may create a distinct occurrence after the interval. | Correct |
| After effects, before completion append | Restart retains `started`; it holds until its persisted lease expires, then sweep records `unknown` and permits a later occurrence. | Correct |
| Ran once but recorded never dispatched | The scheduler cannot produce no reservation before spawn. A failed `started` append leaves `reserved`, which restart classifies as `unknown`. | Correct |

The caveat is C3: these guarantees disappear when store opening chooses the cold path.

## Other requested conclusions

- The lease is not merely the old promise in durable clothing. `started` survives checkpoint/replay, the scheduler rereads `store.occurrences`, and expiry is consumed by `sweep`, which writes an occurrence event and a `job-unaccounted` daemon note. The engine answers S6. The shipping CLI does not activate it.
- Reusing `OverseerEvent` was the right choice and worked. `SessionEvent` keeps `diff()` narrow; both folds explicitly name the other family’s arms with exhaustive `never` checks. Job events leave the session register unchanged. I found no widened consumer that silently drops job events.
- `stale` before `deaf` is correct: once the heartbeat is stale, “deaf” would overclaim that the daemon is alive and ticking.
- The watchdog honestly leaves A27 open.

I checked restart recovery hardest—checkpoint adoption, tail replay, full rebuild, and the cold fallback—because the append path alone gives a falsely reassuring answer. What would change my verdict is an end-to-end executable path with an independently pinned authorised hash and budget, plus recovery that refuses scheduling whenever occurrence history was not reconstructed.

Validation: 271 of 272 touched/scoped tests passed. The remaining existing store test assumes signalling PID 1 yields `EPERM`; in this environment it succeeds, so that environmental assertion failed. All TypeScript projects passed when the typecheck script was run directly with Node; the normal `tsx` wrapper could not create its sandboxed IPC socket. No PostgreSQL-dependent test was needed for this review.