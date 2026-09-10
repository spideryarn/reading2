| Finding | Status |
|---|---|
| F1 | **not closed** |
| F2 | **closed if the promised protocol change lands as described** |
| F3 | **closed if the promised protocol change lands as described** |
| F4 | **closed if the promised protocol change lands as described** |
| F5 | **closed** |
| F6 | **closed** |
| F7 | **closed** |
| F8 | **closed if the promised protocol change lands as described** |

F1’s basic continuation path is sound when the request remains identical:

- `admissible()` includes `planned` and `waiting-admission` (`worktree-launch-protocol:tools/overseer/launch-protocol.ts:420`).
- `plan()` returns the existing record (`…launch-protocol.ts:1121`).
- `launchOccurrence()` passes that record to `drive()` (`…launch-protocol.ts:1180`).
- `drive()` accepts those states and asks admission again (`…launch-protocol.ts:1193`).

Thus a restart after `planned`, or capacity becoming available after `waiting-admission`, can continue the original occurrence exactly once.

Two gaps remain:

1. The disposition says `plan()` is idempotent “for the same origin” (`scheduled-dispatch…md:282`), but the protocol requires the same origin, material, launcher kind and admission class (`…launch-protocol.ts:1121`), with run spec also joining the conflict check when promised Stage 2 lands. A framing-code change can alter material without changing the current `behaviourHash`, because the plan explicitly excludes framing from the pin. That strands the occurrence as a conflict rather than resuming it.

2. Supersession is asserted but not defined strongly enough. The old and replacement occurrences have the same `scheduledAt`; the current “newest” selector compares only that field and retains the first equal entry (`tools/overseer/schedule-plan.ts:290`). Meanwhile both records remain protocol-admissible (`…launch-protocol.ts:420`), because the protocol has no superseded state. The wording at `scheduled-dispatch…md:277-290` therefore does not yet establish which record is permanently excluded, especially after a later rollback to the old hash.

Smallest remaining F1 fix:

- Make the complete protocol request stable under one `behaviourHash`, including the exact generated material/framing, launcher kind, admission class and run spec—or add a protocol-owned resume operation that drives the stored immutable request.
- Define one durable active winner for all records sharing `(jobId, scheduledAt)`, using journal order rather than `scheduledAt` alone. Older siblings must never be passed to `launchOccurrence`, including after rollback to an earlier hash.
- Add the acceptance test: revision A waits, revision B supersedes it, capacity clears, and later ticks or a rollback to A still produce at most one invocation.

F2 is conditional only on carried entries gaining nullable `origin` and `plannedAt`. The disposition otherwise separates ledger authority, handles each ledger’s loss independently, and safely holds unattributable carried entries (`scheduled-dispatch…md:293-308`).

F3 is conditional on `AttemptRef.launchingAt`. Using the first attempt’s durable launching-event time correctly separates identity from spacing (`scheduled-dispatch…md:309-313`).

F4 is conditional on stable `endedAt` fields on both terminal arms. The disposition explicitly excludes mutable `updatedAt` from cadence (`scheduled-dispatch…md:314-318`).

F5 is closed. The implemented classifier evaluates a disposition before nonterminal state results while preserving actual ending evidence (`tools/overseer/occurrence-result.ts:192`).

F6 is closed. The resulting armed state now controls whether stale live-session pins warn or block, covering disarm, explicit arm and already-armed activation (`scheduled-dispatch…md:326-329`).

F7 is closed. The disposition adds the missing schedule-origin join, exact-attempt binding, descriptor-safe regular-file read, and size/hash verification (`scheduled-dispatch…md:330-337`).

F8 is conditional on the promised SIGHUP handling and finalisation. With that change, the exact printed `tmux kill-session` command is exercised through signalled receipt, `interrupted`, and release (`scheduled-dispatch…md:338-347`).

No disposition introduces a new P1. F1 is an incompletely closed original P1.

Verdict: *not yet*.