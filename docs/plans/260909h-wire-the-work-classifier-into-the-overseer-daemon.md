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

and, once the reading is no longer fresh, **a different sentence rather than the same one growing**:

```
  idle   ≥3h    codex-cli-as-subagent-agent          $2077
                pane: idle · work: GPT review — was running 18m when checked 1h ago
```

That distinction is GPT Sol's first finding and it is the difference between a measurement and an
extrapolation: the elapsed time is computed at the scan and frozen there, so a daemon that has
accepted nothing for an hour cannot silently turn eighteen observed minutes into seventy-eight
claimed ones.

On the row's detail: the executable and subcommand the recogniser matched, how deep under the pane
it sits, how many processes the walk inspected, and when the process table was read.

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
  belongs to another live agent's stage, and the daemon is where the probe contract can be tested.
  **This bullet first claimed the cost of moving later was "one function and its tests", and that was
  wrong** — GPT Sol counted `collect.ts`, the fleet row type, the wire type, `observation.ts`'s strict
  parser, the daemon's ingestion and their contract tests. Round 1 finding 6 below has the corrected
  reasoning and where the decision now sits.
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

**And the card's sentence changes with it**, on Sol's fifth finding. Today it claims *these are the
ones that have waited longest*, and an idle row admitted for an 18-minute review may sort first
because it went idle six hours ago — which is not a wait. The card now says what it is: the oldest
status records worth showing — non-idle sessions, and idle sessions with recognised child work — and
the tooltip says the order is by pane-status age, not by child-work age.

## Product default, recorded rather than asked

Greg has not been asked; this is the brief's default:

> the work line shows the kind and the elapsed time only ("review running 18m"), with the command
> line in session detail and never any environment or argument that could be a secret.

**The first half is built; the second half is not, and GPT Sol is why.** `ps args` never carries the
environment, so that part is free. But a *redactor* over the argv cannot uphold the promise: quoting
and argument boundaries are already lost by the time `ps` prints a command line
([work.ts](../../tools/overseer/work.ts) § `ProcessRow`), a `codex exec` line carries a whole prompt,
and a ten-line rule over option NAMES misses positional secrets, URLs, headers and any spelling
nobody thought of. So the full command line is **not persisted at all**. What is kept is the
executable and its leading subcommand — `codex exec`, `claude`, `node` — plus the recogniser's own
label, the pid, the depth, the inspected count and the scan clock. That is enough to say what the
work is and to check it by hand, and it cannot leak an argument.

Adding the full line later is one field and one producer change, if Greg decides the evidence is
worth the exposure. Recorded so it is a decision rather than an omission.

## Round 1: GPT Sol on the plan

Read-only review, `gpt-5.6-sol`, 2026-09-09. **No P0s; the checkpoint placement was confirmed**, with
the argument sharpened: putting work on `RegisterEntry` would need either process-observation events
on every inventory (bloating a durable log with samples) or a register that is partly folded and
partly overwritten. Seven P1s and two P2s, all of them taken except one, which is deferred with its
reason:

1. **"running 18m" can become a confident claim about an unobserved hour.** If the daemon accepts
   nothing for an hour and the browser computes `now − startedAt`, the card says *running 78m* having
   observed 18m. **Taken:** the elapsed time is computed at the scan and frozen there
   (`PaneJob.ranForMs`), and the row says which of the two sentences it is — *running 18m* while the
   scan is fresh, *was running 18m when checked 1h ago* once it is not.
2. **An optional, retained field lets a stale scan attach to a newer register.** `SessionKey` binds
   a tmux handle and a launch-time conversation claim; it does not bind a reading to the collection
   it came from. **Taken:** `OverseerWork` carries `sourceCollectedAt`, and the projection joins only
   when it equals the checkpoint's `lastGoodSnapshotAt`. A mismatch is an explicit *work unavailable*,
   never a silent join. The guard is self-enforcing: the accept path always writes work, so a moved
   `lastGoodSnapshotAt` with an unmoved scan stops joining by itself.
3. **"Accepted inventory" is the wrong boundary.** `admissible()` can accept and `diff()` can then
   return `held` — a populated inventory with no readable tmux generation — after which the daemon
   returns without checkpointing. A probe there is spent and discarded. **Taken:** the contract is
   *once per inventory that will be checkpointed*, so the probe moves below the `held` check, and
   `held` joins duplicate, rejected and bare-tick in the zero-calls test.
4. **The pid-reuse race needs a guard before this may claim positive work.** Co-publication is not
   simultaneity: the pane pid came from the fleet collection and the process tree comes ~30 s later.
   Sol offered a strong guard (re-read tmux around the probe) and a nearly free one. **The free one is
   taken and the strong one is refused:** a pane process whose start is later than the inventory's
   `collectedAt`, beyond the documented one-second `etimes` tolerance, is `cannot-tell` with a new
   `pane-younger-than-inventory` cause. Re-reading tmux is refused because it would put an
   `execFileSync` against the tmux server inside the loop whose whole job is to keep folding when
   other things are broken — the daemon deliberately reads no tmux, and the honest way to close that
   gap is finding 6 below, not a second collector in here.
5. **Keeping work-bearing idle rows breaks the card's stated ranking claim.** An idle row included for
   its 18-minute review may rank first because it went idle six hours ago, and it has not *waited*
   six hours. **Taken:** the card's sentence is rewritten to say what it now is — the oldest status
   records worth showing, non-idle plus idle-with-recognised-work — and the tooltip says the order is
   by pane-status age, not by child-work age.
6. **The collector alternative was dismissed too cheaply.** Sol is right that *another agent owns the
   file today* is a coordination constraint rather than a design reason, right that moving later
   touches `collect.ts`, the fleet row and wire types, `observation.ts` parsing, daemon ingestion and
   their contract tests — **not "one function and its tests", which this plan claimed and which was
   wrong** — and right that its own compromise is the better architecture: *fleet owns the
   simultaneous sampling and calls the Overseer-owned classifier; the daemon owns persistence and
   interpretation.* That would also dissolve finding 4 outright, because there would be no gap.
   **Deferred, not refused.** It crosses three stage-ownership boundaries this stage was explicitly
   fenced out of, and the roadmap and
   [overseer-direction.md](../project/overseer-direction.md) both assign work interpretation to the
   Overseer. Built as briefed, with finding 4's backstop; **the question goes to the Overseer in the
   debrief with Sol's argument attached**, because it is an architecture call above this stage's pay
   grade and the third `ps` cadence is what it costs until somebody makes it.
7. *(P2)* **A failed probe should be one global arm, not N identical pane failures.** It repeats one
   fact per session and permits mixed states that cannot happen. **Taken:** `OverseerWork` gains a
   `probe-failed` arm, and only a successful scan carries pane readings. `PaneWork.cannot-tell`
   stays, for the per-pane causes that really are per-pane.
8. *(P2)* **The redactor cannot uphold its guarantee.** **Taken** — see the section above; the
   redactor is gone and the raw command line is not persisted.

Sol also settled the scan clock: on success it is `ProcessTableReading.atMs`, the instant the kernel
was read, **not** a later `now()`; on failure it is a separately named `attemptedAt`.

## Stages

### Stage 1 — the wire shape and the store field

- [x] `tools/fleet/wire.ts`: `PaneJob`, `PaneWork`, `OverseerPaneWork`, `OverseerWork`. Types only.
  Three arms on `OverseerWork` — `not-yet-run`, `probe-failed`, `scan` — so a global failure is one
  fact rather than N (round 1, finding 7); `sourceCollectedAt` on the two that describe a real
  attempt (finding 2); `ranForMs` frozen on the job (finding 1).
- [x] `tools/overseer/store.ts`: `Checkpoint.work`, `CheckpointUpdate.work?`, `workNotYetRun(at)`,
  and the read-back parse, mirroring `attention` exactly — held across writes that carry none, not
  restored across a restart.
- [x] `tests/overseer-store-work.test.ts`: round-trips; absent on a cold store is `not-yet-run` and
  says so; omitted on an update keeps what is held with its clock unchanged; a restart does not
  restore one; a malformed stored value degrades to `not-yet-run` with a reason and **never** to an
  empty scan.

**Status:** done, 2026-09-09. Implemented by GPT Sol (`gpt-5.6-sol`, `--sandbox workspace-write`)
against a written brief; tests red first, then green. I ran the gates: the three new suites are
green (35 tests), and so are the seven neighbouring Overseer and fleet suites (239). `npm run
typecheck` caught three `Checkpoint` literals in `tests/overseer-cli.test.ts` and
`tests/overseer-watchdog.test.ts` that now need the field — **Codex could not see them**, because it
ran `tsc --noEmit` on the source projects and those do not cover `tests/`. Fixed by hand.

### Stage 2 — the daemon probes once and publishes

- [x] `tools/overseer/work-reading.ts` (new, pure): `paneWorkOf` and `scanPaneWork`, including the
  `pane-younger-than-inventory` backstop (finding 4) and the executable/subcommand reduction that
  replaces the deleted redactor (finding 8).
- [x] `tools/overseer/daemon.ts`: `DaemonOptions.probe?`, defaulting to `probeProcessTable`; one call
  **below the `held` check**, on the path that will actually checkpoint (finding 3); `work` carried
  into `checkpointUpdate()` with the spread idiom.
- [x] `tests/overseer-daemon-work.test.ts`, the integration test the roadmap names: the probe is
  called **exactly once per inventory that gets checkpointed**, and **not at all** for a duplicate, a
  rejected payload, a `held` diff, or a bare tick; the classification reaches `current.json`; a
  failed and a thrown probe both say why and never say idle.
- [x] `tests/overseer-work-reading.test.ts`: deep wrapper tree (the depth-8 codex capture),
  foreground and background review, missing process table, exited child, pid reuse (both the caught
  case and the recorded uncaught one), no child work, and the safe-command reduction. Existing
  process-tree fixtures plus one disposable positive control.

**Status:** done, 2026-09-09. Also GPT Sol's implementation.

**The positive control was skipped in Codex's own run and is not skipped here** — its sandbox denies
`ps` with `EPERM`, which is exactly the shape that makes a control worthless: a test that skips on
the machine that matters proves nothing. Run in this worktree it passes, and I checked separately
that it **discriminates**: `classifyPaneWork(process.pid, …)` returns `no-child-work` with nothing
spawned and `child-work` matching the spawned pid immediately after. A control that would pass
either way is not a control.

### Round 2: GPT Sol on the stage 1-2 code

`--sandbox workspace-write`, so it fixed what it found inside the stage and reported the rest.
**Refused the candidate on two established P1s**, both real, both fixed:

- **F9 (P1, established) — arbitrary argv could be persisted as a "safe subcommand".** The rule I
  wrote in the brief was *keep the first argument if it is a bare word*, and
  `safeCommand("python customer-secret-token")` therefore returned the secret. **This is the same
  class the redactor was deleted for**, reintroduced one level down by the thing that replaced it,
  and it is worth naming: a rule about the SHAPE of an argument cannot tell a subcommand from a
  positional secret, because there is no shape difference. The fix is a closed allowlist —
  `codex` may keep `exec`/`e`/`review`, `vitest` may keep `run`, and nothing else keeps anything.
  Checked by hand afterwards on the real captured command lines: `codex exec` survives,
  `bash /home/greg/deploy.sh --api-key=sk-live-abc123` becomes `bash`.
- **F11 (P1, established) — a conversion exception escaped the probe's containment and killed the
  fold.** The `try` was around `probe()` and not around `scanPaneWork`, so a reading with a `NaN`
  `atMs` threw `RangeError: Invalid time value` **before the first durable write**. That is
  invariant 2 — the daemon's crash semantics — broken by an enrichment, which is exactly what the
  containment was for. The conversion is part of the instrument and is now inside it.
- **F10 (P1, reasoned)** — a pane whose own start could not be read bypassed the reuse backstop and
  could still produce `none`. `paneStartedAt` is now required on both measured arms, and an
  unavailable start is `cannot-tell` with its own cause. A positive finding is discarded there too,
  deliberately: without the pane's start there is no evidence the tree belongs to this session.
- **F13 (P2)** — the cadence test asserted the probe TOTAL over two inventories, which passes for a
  2-then-0 distribution. It counts per inventory now and requires `[1, 1]`. My brief asked for an
  exact number and got an exact number of the wrong thing.
- **F12, F14, F15, F16** — duplicate pane keys in a stored scan are now refused; an unresolvable
  command is the phrase `command unavailable` rather than `""`; `sourceCollectedAtMs` is passed from
  the clock that already carries it rather than re-parsed; and the tolerance comment now says what is
  actually closed.

**On the bounded question** — *is the `REUSE_TOLERANCE_MS` sentence accurate?* — the answer was no,
and that is F16. What the backstop closes is derived pane starts **more than two seconds** after the
inventory. The first two seconds, and any reuse by a process older than the inventory, remain open.
The comment says that now instead of claiming the daemon-created gap.

**Gates after the fixes:** 298 tests green across nine suites, `npm run typecheck` clean on all four
projects, lint clean bar the pre-existing `daemon.ts:602` warning.

### Stage 3 — the projection and the browser

- [ ] `tools/fleet/overseer-status.ts`: join `json["work"]` onto register entries by key, **only when
  `sourceCollectedAt` matches `lastGoodSnapshotAt`** (finding 2); keep idle-with-work; restate the
  card's ranking claim (finding 5).
- [ ] `tools/fleet/wire.ts`: `OverseerSessionHistory.work`, and the register's own work clock.
- [ ] `tools/fleet/web/src/types.ts`: parse it, on the browser's clock.
- [ ] `tools/fleet/web/src/OverseerPanel.tsx`: the `pane: idle · work: …` line in **both** its
  sentences — fresh and stale (finding 1) — and the evidence detail.
- [ ] `tests/fleet-overseer-status.test.ts` and `tests/fleet-overseer-panel.test.tsx`, including the
  acceptance fixture: `pane: idle` beside `work: … running 18m`; the stale sentence; a failed probe
  reading *cannot tell*; and a `sourceCollectedAt` mismatch refusing the join rather than making it.

**Status:** not started.

### Stage 4 — gates, review, docs

- [ ] `npm test`, `npm run typecheck`, lint on touched files.
- [ ] GPT Sol code review, `--sandbox workspace-write`, two rounds.
- [ ] A section in [overseer-direction.md](../project/overseer-direction.md) or
  [fleet-dashboard-modes.md](../project/fleet-dashboard-modes.md) saying where work evidence lives
  and what it may not claim.

**Status:** not started.
