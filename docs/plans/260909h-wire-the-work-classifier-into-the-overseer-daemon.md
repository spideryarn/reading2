# Wire the work classifier into the Overseer daemon

**Status:** in progress, 2026-09-09.
**Roadmap stage:** [260908f](260908f-overseer-and-fleet-improvement-roadmap.md) § "Stage: Work
evidence — connect the classifier that is already written". Queue item `qi-z8ascd78`.
**Waits on:** Execution identity (landed) and Overseer status (landed). Both are in.

## What this is for

The dashboard says `idle` about a pane whose child process is a 20-minute GPT Sol review or a full
test suite. Measured on the live fleet on 2026-09-08 and recorded in
[overseer-direction.md](../project/overseer-direction.md) § "`idle` is the bug": **four sessions
were running `codex exec` and none of them showed as anything but `idle`**, because the review runs
inside the session's Bash tool and, for the 15–45 minutes it takes, the pane looks exactly like a
pane with nobody at it.

The thing that can tell — `classifyPaneWork` in [`tools/overseer/work.ts`](../../tools/overseer/work.ts),
with its probe in [`work-probe.ts`](../../tools/overseer/work-probe.ts) — is already written, already
tested against eight captured process trees, and **has no caller in the Overseer at all.** This
stage connects it and gets the answer onto the page.

It is not a new capability; it is a wire. No new collector, no model call.

## What the reader gets

One line, in the Overseer's own history card:

```
  idle   ≥42m   codex-cli-as-subagent-agent          $2077
                pane: idle · work: GPT review, running 18m
```

and, on the row's detail, the evidence that claim rests on: the command line the recogniser matched,
how deep under the pane it sits, how many processes the walk inspected, and when the process table
was read.

When the probe fails, the line says **cannot tell** and why. It never says idle.

## The empirical caveat, kept

The direction doc is careful about this and the roadmap repeats it, so it goes here too: **a
foreground review often already reads as `working`**, because the pane's Claude is mid-turn waiting
on its Bash tool. The value of this stage is *richer explanation* and *catching the background and
stuck cases* — not fixing every idle row. If the live fleet after this lands still has idle rows,
that is not a failure of the wire.

## Where it goes, and what was passed over

### The shape

`ps` is read **once per accepted fresh inventory** — not once per pane, not once per tick. One
reading serves every row, which is also the only way two rows can be consistent with each other
about a process they share.

```
  fleet dashboard ──payload──▶ daemon: admissible() accepts
                                  │
                                  ├─ probe()  ← ONE ps, injected, ~40 ms
                                  │
                                  └─ for each row: classifyPaneWork(row.panePid, reading)
                                                        │
                                              checkpoint.work  (a NEW top-level field)
                                                        │
                              fleet /api/overseer: projectRegister joins work → entry, by SessionKey
                                                        │
                                              OverseerSessionHistory.work
                                                        │
                                                   OverseerPanel
```

### `checkpoint.work`, not `RegisterEntry.work` — and why

The register is a **fold of the event log**, and `ENTRY_FIELD_OWNERS` in
[`store.ts`](../../tools/overseer/store.ts) pins every one of its fields to an owning event class so
that a field nothing keeps current cannot be added by accident. A work reading is not an event: it
is a measurement taken at one instant, which a restart must not resurrect.

So `work` is a **top-level checkpoint field beside `attention` and `usage`**, written with exactly
their idiom — optional on `CheckpointUpdate`, omitted meaning *keep what the store holds*, with a
`workNotYetRun(at)` default that says nothing has looked rather than that nothing is running. The
join back onto a register entry is by `SessionKey`, and it is not a cross-source join: the same
daemon writes both halves of the same file in the same instant.

### Simpler options passed over

- **Put the classification in the fleet collector instead** (`tools/fleet/collect.ts`), which already
  runs two `ps` probes per collection for execution identity. That would cost no third probe, and the
  reading would be simultaneous with the `panePid` it describes rather than ~30 s later — strictly
  more accurate, and it would land the answer on the fleet row where `SessionDetail` could show it
  without any join at all. **Not taken**: the roadmap assigns this to the daemon, `collect.ts`
  belongs to another live agent's stage, and the daemon is where the "one probe per accepted
  inventory" contract can be tested. Named here because it is the better long-term home and somebody
  will want it: the cost of moving later is one function and its tests.
- **Add a `work` arm to `SessionState`.** Refused for the reason `work.ts`'s own header gives: that
  union is consumed by exhaustive switches all over `tools/fleet/`, it is the dashboard's word for
  what its own two sources say, and a row can be honestly `idle` and honestly mid-review at the same
  time. Two vocabularies, deliberately.
- **Carry `WorkReading` whole onto the wire.** It is JSON-safe, so this would work — but
  `tools/fleet/wire.ts` has *zero imports* on purpose (it compiles under DOM-only libs for the
  browser), and the persisted form wants ISO strings rather than raw millisecond numbers. So the
  daemon converts once, in a small pure function, at the point of writing.

### What this stage does NOT do

**The work reading does not reach the fleet `SessionDetail`.** It is shown on the Overseer's own
history rows, which is where a register entry may honestly be drawn — `wire.ts` § `OverseerRegister`
says in as many words that these rows are not matched to the Sessions tab. Joining work onto a live
fleet row now has an honest key for the first time (Execution identity landed, so a row carries a
durable `execution` token and a register entry carries `verifiedExecution.token`), but it is a
second slice, it touches `SessionsPanel`/`SessionDetail` which another agent is live in, and it is
not what the acceptance asks for. **Recorded for the Overseer as the obvious next slice.**

## The one behaviour change outside the new field

`projectRegister` currently drops every `idle` entry from the history card: *"an idle session that
has been idle for six hours wants nothing"*. That filter is exactly what would hide the four codex
sessions this stage exists to find. **An idle entry with recognised child work is kept**; an idle
entry with none, or with a `cannot-tell`, is dropped as before. The rank is unchanged.

## Product default, recorded rather than asked

Greg has not been asked; this is the brief's default and it is what is built:

> the work line shows the kind and the elapsed time only ("review running 18m"), with the command
> line in session detail and never any environment or argument that could be a secret.

`ps args` never carries the environment, so that half is free. A command line *can* carry a secret if
somebody passes one as an argument, so a small bounded redactor blanks the value of any argument
whose name matches `token|key|secret|password|auth`. That is a positive safety rule of about ten
lines, not the unbounded recogniser catalogue the roadmap warns against.

## Stages

### Stage 1 — the wire shape and the store field

- [ ] `tools/fleet/wire.ts`: `PaneWork`, `PaneJob`, `OverseerWork`, `OverseerPaneWork`. Types only.
- [ ] `tools/overseer/store.ts`: `Checkpoint.work`, `CheckpointUpdate.work?`, `workNotYetRun(at)`,
  and the read-back parse, mirroring `attention` exactly.
- [ ] `tests/overseer-store-work.test.ts`: round-trips; absent on a cold store is `not-yet-run` and
  says so; omitted on an update keeps what is held; a malformed stored value does not become an
  empty scan.

**Status:** not started.

### Stage 2 — the daemon probes once and publishes

- [ ] `tools/overseer/work-reading.ts` (new, pure): `paneWorkOf(WorkReading) → PaneWork` and
  `scanPaneWork(rows, reading, nowIso) → OverseerWork`, including the redactor.
- [ ] `tools/overseer/daemon.ts`: `DaemonOptions.probe?`, defaulting to `probeProcessTable`; one
  call on the accept arm, after `admissible()` and before the checkpoint; `work` carried into
  `checkpointUpdate()` with the spread idiom.
- [ ] `tests/overseer-daemon-work.test.ts`, the integration test the roadmap names: the probe is
  called **once per accepted fresh inventory** and **not at all** for a duplicate, a rejected
  payload or a bare tick; the classification reaches `current.json`.
- [ ] `tests/overseer-work-reading.test.ts`: deep wrapper tree (the depth-8 codex capture),
  foreground and background review, missing process table → every pane `cannot-tell`, exited child,
  pid reuse, no child work. Existing process-tree fixtures plus one disposable positive control.

**Status:** not started.

### Stage 3 — the projection and the browser

- [ ] `tools/fleet/overseer-status.ts`: join `json["work"]` onto register entries by key; keep
  idle-with-work; `OverseerRegister` read arm gains `workScannedAt`.
- [ ] `tools/fleet/wire.ts`: `OverseerSessionHistory.work`, `OverseerRegister.workScannedAt`.
- [ ] `tools/fleet/web/src/types.ts`: parse both, on the browser's clock.
- [ ] `tools/fleet/web/src/OverseerPanel.tsx`: the `pane: idle · work: …` line and the evidence
  detail.
- [ ] `tests/fleet-overseer-status.test.ts` and `tests/fleet-overseer-panel.test.tsx`, including the
  acceptance fixture: `pane: idle` beside `work: … running 18m`, and a failed probe reading
  *cannot tell*.

**Status:** not started.

### Stage 4 — gates, review, docs

- [ ] `npm test`, `npm run typecheck`, lint on touched files.
- [ ] GPT Sol code review, `--sandbox workspace-write`, two rounds.
- [ ] A section in [overseer-direction.md](../project/overseer-direction.md) or
  [fleet-dashboard-modes.md](../project/fleet-dashboard-modes.md) saying where work evidence lives
  and what it may not claim.

**Status:** not started.
