# GPT Sol's review of Stage 3's plan, 2026-09-08

Verbatim, as returned. Reviewed durable commit `848938a7`. Up:
[260908g](260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md) § The plan
review, which says what each finding changed. **Every finding was accepted; none was overruled.**

---

Stage 3 should be blocked as written. The ordering of the three rules is sensible, but four P0 gaps prevent the acting rule from satisfying the Overseer’s gates.

## Findings

### SP-1 — P0 — Rule implementations are outside the authorisation fingerprint

Plan § “What the survey found,” `848938a7` lines 375–380; [jobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/jobs.ts:149).

The proposed dispatcher selects executable rule code using `definition.id`, but `definitionHash()` covers only `id`, schedule, lease, `what`, and document digests. Changing a threshold, action, or rule implementation would leave the authorised pin valid. Rule 3 could therefore continue acting after its behaviour changed, violating gate 3’s prohibition on acting from a changed definition.

Do instead: make rule jobs a discriminated definition whose complete configuration and implementation version/digest participate in `definitionHash()`. At minimum, include the relevant rule source digest in `documents` and pin it. Thresholds and selected action must be data in the hashed definition, not hidden in the dispatcher.

### SP-2 — P0 — `SpawnJob` cannot durably record a `RuleEvent`, and post-action logging is not fail-closed

Plan §§ “How the three rules behave” and “Where the findings go,” lines 329–343 and 402–412; [scheduler.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/scheduler.ts:107), [daemon.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/daemon.ts:424).

`SpawnJob` receives only `(definition, key)` and returns either a refusal or `{pid, done: Promise<JobOutcome>}`. `JobOutcome` contains only an exit code or failure reason. The store is opened privately inside `runOverseer`; the dispatcher has no store capability, and opening it again would hit the exclusive lock.

Consequently, the proposed in-process runner has no supported way to append its rich `RuleEvent`. More importantly, the examples record what happened after the action. Gate 1’s existing requirement is that the decision be appended before delivery, fail-closed. A broadcast followed by a failed append produces an unlogged action.

Do instead: add a scheduler-owned two-phase rule protocol:

1. Detect and produce a typed proposal.
2. Append/fsync a `rule-intended` or `rule-proposed` event.
3. Only if that succeeds, execute the action.
4. Append a terminal `sent`, `refused`, or `failed` event.

That requires new scheduler/runner machinery; the current `SpawnJob` seam alone is insufficient.

### SP-3 — P0 — `RuleEvent` does not reach the review surface required by gate 1

Plan § “Where the findings go,” lines 402–412; [OverseerPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/fleet/web/src/OverseerPanel.tsx:19), [attention.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/fleet/attention.ts:40).

`events.jsonl` is not currently on the dashboard wire or in the Overseer panel. The panel explicitly says the decision log is later, and the fleet-side checkpoint projection reads only `schema`, `writtenAt`, and `attention`. The only current reader of event history is the CLI.

Therefore choosing `events.jsonl` over `daemon.jsonl` does not establish the stated distinction that one is reviewable in the panel. Once rule 3 acts, this violates the explicit gate requiring an easily reviewed web surface.

Do instead: before rule 3 may act, fold a bounded rule-event projection into `current.json`, add the independent fleet-side parser and wire type, and render it in the Overseer panel. Alternatively, keep rule 3 observe-only until that surface exists.

### SP-4 — P0 — Stage 3’s live acceptance test requires arming the unbudgeted paid jobs

Plan status lines 233–249, Stage 3 done condition line 322, and Stage 7; [schedulerWiring](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/scripts/overseer.ts:615).

There is one global `OVERSEER_JOBS_ENABLED` switch. When armed, `schedulerWiring()` supplies both existing standing jobs as well as any new rule definitions. Both existing jobs have never run and are immediately due. The plan also says Stage 7’s global model budget is unbuilt and becomes load-bearing exactly when this switch is armed.

Thus “watch each rule fire for real” cannot currently be satisfied without also starting paid model sessions under an unenforced gate 4.

Do instead: either build Stage 7 before any live arming, or introduce a separate deterministic-rules enablement/one-job invocation path that demonstrably cannot include model-backed standing jobs.

### SP-5 — P1 — A checkpoint can retain a stale `approaching` usage verdict

Plan § “How the three rules behave,” lines 348–352; [usage.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/usage.ts:926), [usage-carry.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/usage-carry.ts:89).

`computeUsageVerdict()` correctly rejects windows whose `resets_at` was already past when the report was computed. But the checkpoint persists the computed verdict. A window can subsequently reset while the stored report still says `approaching`. `chooseUsage()` may retain a same-account incomplete report for up to seven days; it does not recompute its verdict against the current clock.

A rule reading `checkpoint.usage.report.verdict.level` would therefore silently fire the expensive broadcast from stale data.

Do instead: recompute `computeUsageVerdict({account, cache, rateLimits, nowMs})` at rule execution. Never branch directly on the persisted verdict. Add a test where a stored `approaching` report is evaluated just after its reset.

### SP-6 — P1 — The cooldown and wake-check do not form a durable action lifecycle

Plan § “Build order, revised,” lines 422–425; [routes-actions.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/fleet/routes-actions.ts:125), [wire.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/fleet/wire.ts:756).

The existing cooldown is:

- 10 minutes, while broadcast pauses span 5–60 minutes;
- held only in `lastBroadcastAt` process memory;
- reset whenever the dashboard restarts.

It therefore does not provide “once per stagger window.” Persistent pressure can produce several contradictory broadcasts during one wake window.

The wake-check also lacks the state necessary to close the loop. `Pause` already has `scheduled-wakeup` and `overdue`, but `ObservedRow` drops `pause`; no second typed path into the Overseer exists. There is also no record of exactly which conversation was told, when delivery succeeded, its promised wake time, or its verification deadline.

Do instead: persist a `WakeExpectation` keyed by tmux generation, session handle, and conversation claim, with `sentAt`, actual rendered wake time, grace deadline, and terminal state. Fold it into the checkpoint. Suppress rebroadcast while any relevant expectation remains open, and explicitly record satisfied, overdue, replaced, and indeterminate outcomes.

### SP-7 — P1 — Rule 3 has not been granted the confirmation its route requires

Plan lines 329–343 and 348–352; [actions.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/fleet/actions.ts:467), [routes-actions.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/fleet/routes-actions.ts:1412).

`resource-broadcast` has `needsConfirm: true`. The route checks `confirm:true` before it checks `FLEET_ACT_ENABLED`. The plan says the action acts behind `FLEET_ACT_ENABLED` and that the switch is the only thing between proposal and action, which is false.

The caller can mechanically send `confirm:true`, but the plan must say what authorises an unattended process to assert that human-facing confirmation.

Do instead: explicitly define the pinned, pre-recorded rule intent as the standing authorisation to supply `confirm:true`; otherwise the v1 must remain dry-run-only. Do not leave this to an implementation detail.

### SP-8 — P1 — The selected broadcast text is false for the proposed triggers

Plan lines 317–320 and 348–352; [actions.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/fleet/actions.ts:258), [health.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/fleet/health.ts:386).

The fixed `resource-broadcast` text asserts that load and memory are both high and that processes are being OOM-killed. Rule 3 may fire solely because usage is approaching a quota. Even a health `strained`/`critical` verdict can be caused by one metric, disk, swap, or I/O wait; the health report does not establish the text’s three claims.

The plan also does not specify which health levels and usage levels combine with OR versus AND.

Do instead: define an explicit trigger table and use separate reviewed messages for usage pressure and machine pressure. Each message should assert only facts its predicate established.

### SP-9 — P1 — Adding `RuleEvent` costs more than the claimed five updates

Plan § “Where the findings go,” lines 404–412; [store.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/store.ts:951).

The list omits at least:

- `store.ts`’s `EVENT_KINDS`;
- a rule-family discriminator and full runtime parser;
- the producer path discussed in SP-2.

After adding a rule kind to `EVENT_KINDS`, `parseEvent()` currently treats every non-job event as a session event and requires `key`, `identity`, and `tmuxServerPid`. A rule event would therefore be rejected during replay. The cast to `SessionEvent["kind"]` means this omission is not compiler-enforced.

For a log-only event, the generic append and byte/event cursor need no changes, and the watchdog is unaffected. If rule state is folded into `current.json` for wake recovery or the panel, then the checkpoint type, parser/writer, schema version, fleet-side projection, wire type, and UI also need changes.

### SP-10 — P1 — Threading `permissionMode` must preserve old event-log rows

Plan § “Build order,” lines 426–429; [observation.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/observation.ts:154), [store.ts](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/store.ts:899).

The suspicion is correct: `permissionMode` is present in the fleet payload but dropped by Overseer `parseRow()`. I found no second path carrying it into `tools/overseer/`. The same is true of `pause`.

However, adding it as a required `ObservedRow` field also affects persisted `session-seen` and `session-row-changed` rows. Existing event-log rows do not contain it. A strict store parser would turn historical lines into replay holes, potentially putting the occurrence ledger into `history-lost` and holding all jobs.

Do instead: make the live parser produce a required four-arm value, while the persistence parser maps an absent historical field to an explicit `cannot-tell: event predates this field`. Do not put this volatile pane reading in `REGISTER_ROW_FIELDS`.

### SP-11 — P2 — “3 of 15” is a sample, and “the five are the load” is unsupported

Plan § “What the survey found,” lines 382–400.

The route behavior is structural: every `working` row is excluded, and an all-working fleet causes refusal. But the measured denominator mixes eight agent sessions with seven shells. The meaningful result is “3 of 8 agent sessions were deliverable; 5 were held because working; 7 shells were blocked.” `working` also does not prove those five were consuming the machine resources; it describes Claude’s pane state.

Do instead: store the categorical counts and actual delivery outcomes. Only attribute load to sessions using process/health attribution evidence.

## Direct answers

**Q1.** An already-resolved `done` promise is lifecycle-safe. The scheduler records `reserved`, calls the runner, records `started`, installs `.then()`, and returns `dispatched`. Promise callbacks run as microtasks, so `finished` is appended after `started` and before the next timer tick. A finished occurrence has no lease and never becomes `stuck`.

If `done` never settles, expiry causes `sweep()` to append `unknown`, report `stuck`, and release the job. Whether another occurrence starts immediately depends on `everyMs`, measured from the old reservation time.

For an in-process run, `process.pid` is the only truthful positive PID under the current schema. Mechanically, nothing dereferences it. Semantically, however, the code and log call it “the child’s pid,” and restart handling assumes a started child might outlive the daemon. A proper execution-identity union would be cleaner. The larger “no scheduler machinery” claim is false because rule authorisation and durable rule-event recording do not fit the current seam.

**Q2.** No. The five-item list misses store kind registration, runtime parsing/replay routing, and event production. Cursor accounting is generic and needs no change. The watchdog needs no change for a log-only event. A durable checkpoint projection for wake state or the web surface does require a schema and wire change.

**Q3.** `computeUsageVerdict()` enforces expiry only when it runs. A persisted verdict can age into a stale `approaching`. Recompute it at the rule’s current `nowMs`; do not trust the stored `verdict.level`.

**Q4.** Yes, `killVerdict`, `selectForKill`, and `planKillProcesses` are pure. The dry-run route performs read-only process inspection and logging but never runs a kill plan or spends the action limiter. No current consumer turns a stored proposal into an action, and the queue structurally cannot contain enacted actions. A later human run is protected by a fresh scan and intersection with the PIDs they confirmed.

**Q5.** The conceptual order is right, but the stages do not stand alone as written:

- 3a lacks the event-production seam, implementation pin, review surface, and a safe way to live-test only one deterministic job.
- 3b must atomically include durable cooldown, wake expectations, and their terminal handling; abandoning it with only automatic broadcasting is unsafe.
- 3c can be small and observe-only, but must include backward-compatible event parsing and should share the common event/surface machinery.

I would put the common rule protocol and review surface first, make rule 2 the first consumer, establish a deterministic-only arming path or build Stage 7, then land rule 3 as one complete broadcast-and-wake lifecycle. Rule 1 can remain last.

`npx vitest run tests/overseer-jobs.test.ts` passed: 48/48. No files were changed. The shared worktree advanced after review began, but those later commits changed only the plan; all findings above refer to durable commit `848938a7`.