# Wire the work classifier into the Overseer daemon

**Status:** done, 2026-09-10. On `dev`; the live daemon needs a restart before any of it is visible.
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
sessions this stage exists to find. **An idle entry with recognised child work is kept.** An idle
entry with measured `none` is still dropped; `cannot-tell` and a missing scan entry are kept, because
filtering either would render an unmeasured absence as idle. The rank is unchanged.

**And the card's sentence changes with it**, on Sol's fifth finding. Today it claims *these are the
ones that have waited longest*, and an idle row admitted for an 18-minute review may sort first
because it went idle six hours ago — which is not a wait. The card now says what it is: the oldest
status records worth showing — non-idle sessions, idle sessions with recognised child work, and idle
sessions without a usable pane reading — and the tooltip says the order is by pane-status age, not
by child-work age.

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

- [x] `tools/fleet/overseer-status.ts`: join `json["work"]` onto register entries by key, **only when
  `sourceCollectedAt` matches `lastGoodSnapshotAt`** (finding 2); keep idle-with-work; restate the
  card's ranking claim (finding 5).
- [x] `tools/fleet/wire.ts`: `OverseerSessionHistory.work`, and the register's own work clock.
- [x] `tools/fleet/web/src/types.ts`: parse it, on the browser's clock.
- [x] `tools/fleet/web/src/OverseerPanel.tsx`: the `pane: idle · work: …` line in **both** its
  sentences — fresh and stale (finding 1) — and the evidence detail.
- [x] `tests/fleet-overseer-status.test.ts` and `tests/fleet-overseer-panel.test.tsx`, including the
  acceptance fixture: `pane: idle` beside `work: … running 18m`; the stale sentence; a failed probe
  reading *cannot tell*; and a `sourceCollectedAt` mismatch refusing the join rather than making it.

**Status:** done, 2026-09-09. The server refuses stale, future-clock and malformed work without
losing the register; the browser keeps the scan's duration frozen, shifts only instants to its own
clock, and exposes the process evidence in an `Explain` tooltip. A real-daemon end-to-end test now
drives an injected captured process table through the checkpoint, projection, browser parser and DOM.

### Round 3: GPT Sol on its own stage 3 code — and what that is worth

**This round is Sol reviewing its own work**, and it says so itself: its usual wrapper could not
start a nested process in that sandbox, so it dispatched the same brief through the runner it
already had. That is closer to re-reading your own work than to an independent check: the same model
that chose a framing is the worst-placed thing to notice the framing was wrong. It found two real
P1s, so it was not worthless — but it is **not** the cross-family round the house workflow asks for,
and Round 4 below is. Recorded rather than quietly counted as one.

Two established P1s were found and fixed in the review-capable pass, then accepted unchanged in a
fixes-only second round ([review artefact](260909h-stage3-code-review-sol.md)):

- A stale positive reading changed tense, but stale `none` and `cannot-tell` readings still sounded
  current. They now say what *was* observed and when; fresh copy is unchanged.
- A semantically impossible pane start after the scan clock passed both parsers. Both boundaries now
  reject pane or job starts after `scannedAt` and depth-zero positive child jobs, while keeping valid
  bare panes (`inspected: 0`) and unknown job starts.

**Gates after the fixes:** five focused suites green (505 tests), including the real-daemon browser
join; all four TypeScript projects clean when run directly; fleet production build and diff check
clean. The `npm run typecheck` wrapper itself could not open tsx's IPC socket in this sandbox, so its
four underlying projects were run separately.

### Round 4: independent review of stage 3

An independent review on 2026-09-10 refused the candidate on five established P1s, all fixed
red-first without changing the register when only work was bad:

- **F17:** the row filter discarded idle `cannot-tell` and missing-pane readings, and `HistoryRow`
  rendered a meaningful `work: null` as silence. Both facts now remain visible and distinct from
  measured `none`; the all-idle sentence names pane status and says what the scan did or did not know.
- **F18:** a scan could predate the inventory it claimed to describe. The projection now requires
  `sourceCollectedAt <= scannedAt <= writtenAt` as well as exact inventory equality.
- **F19:** the exact-inventory check covered `scan` but not `probe-failed`, so an old probe failure
  could be attributed to the current register. Both attempted arms now enforce the same provenance.
- **F20:** the parsers shape-checked `ranForMs`, starts, depths and counts without checking that the
  facts agreed. Both boundaries now reject incoherent durations, impossible ancestry/counts and
  duplicate job pids, while preserving bare panes and genuinely unknown job starts.
- **F21:** duplicate register keys attached one pane measurement to two sessions. The register now
  becomes unreadable on a repeated join key rather than duplicating the claim.

**F22 (P2) was fixed:** the end-to-end test used the four named implementations but passed the
projection object directly to `parseOverseer`; it did not cover `statePayload`, JSON serialization or
the top-level `parseFleetState` field. It now does. The source stream and process-table probe remain
controlled inputs, and the HTTP route/default `probeProcessTable` adapter remain outside its claim.

**F23 (P2) remains wider than stage 3:** `PaneWork.jobs` is typed as an ordinary array even though
the producer and both parsers require it to be non-empty. That is why `workLine` still carries the
otherwise unreachable “positive reading carried no job” sentence. The complete fix is a non-empty
tuple through the wire and the stage-1 store parser, not another renderer branch.

**F24 (P2) was fixed:** the parser tests did not assert the cases Round 3 said were preserved or
rejected: `inspected: 0`, unknown job starts, equality with the scan clock, future job starts and
depth zero. After the missing assertions were added, removing the depth-zero checks at both
boundaries made both strengthened suites fail until the checks were put back.

**Gates after Round 4:** all five requested focused suites green (518 tests), the TypeScript wrapper
clean across all four projects, scoped lint without errors, and diff check clean. The whole suite was
not run, as this review explicitly excludes it.

### F23 closed after all: `jobs` is a non-empty tuple

The independent round left F23 open as *wider than stage 3* — `PaneWork.jobs` was an ordinary
`readonly PaneJob[]` though the producer and all three parsers require it non-empty, which is why
`workLine` had grown a *"the positive reading carried no job"* branch nothing could reach.

It is closed, because every file it touches is this stage's own: `wire.ts`, the store's parser, the
projection's, the browser's, and the renderer. The type is now
`readonly [PaneJob, ...PaneJob[]]`, the three parsers destructure to satisfy it rather than cast, and
the unreachable sentence is gone.

**The stake is not the dead branch.** `{kind: "work", jobs: []}` renders as a session with recognised
work and nothing to say about it — a positive claim with no evidence under it, which is the one shape
this area exists to refuse. The type refuses it now.

**And the guard was mutation-tested**, because `vitest` never type-checks and a type-level guard that
has never been seen to fail is not evidence. `tests/fleet-compile-guards.test.ts` gained a block whose
`@ts-expect-error` asserts `jobs: []` does not compile. Widening the tuple back to an array makes
`npm run typecheck` fail with three errors — the unused directive, and two `'first' is possibly
undefined` in the guard and in `OverseerPanel` — and reverting makes it green again. Both directions
observed, 2026-09-10.

### What it actually says about this box — measured, 2026-09-10 00:18 UTC

The suite proves the wire carries a reading. It cannot say whether the reading is worth having, so I
ran the same computation by hand against the live `~/.overseer/current.json` register and one real
`ps`. Read-only; the live daemon was not restarted and still runs the old code.

```
register: 20 sessions, last inventory 2026-09-09T23:17:09.965Z

  18  none
   2  work

  shell:true  codex-round2-260909g-2351-1382811   GPT review (codex exec) running 27m, depth 5
  shell:true  bc-s3rev-0004-1444220               GPT review (codex exec) running 13m, depth 5

idle sessions: 10; of those RETAINED on the card by the new rule: 0
```

Three things worth having written down:

1. **It finds real work.** Two live `codex exec` reviews, at depth 5, with honest durations. Both are
   other agents' Sol reviews, running while this was measured.
2. **And it did NOT find an idle-but-working session at this instant.** Both rows already read as
   `shell:true`, so the dashboard already knew something was running in them. **This is the
   direction doc's caveat coming true rather than a disappointment** — what work evidence adds here
   is *which* review and *how long*, not the discovery that the pane is busy. The original finding's
   four `idle` rows were a different moment; nothing in this measurement contradicts it, and nothing
   in it confirms that this stage fixes it either. Claiming otherwise would be the kind of
   unearned conclusion this whole area exists to refuse.
3. **The crowding risk from F17 measures zero today.** Retaining idle `cannot-tell` rows could have
   filled an eight-row card and pushed out the sessions worth acting on; on this box, right now, no
   pane classifies as `cannot-tell` at all. **That is one snapshot, not a rule** — a survey cannot see
   a state that happens to be absent — so it is a reason to stop worrying now and a reason to look
   again once the daemon has been running this code for a day.

### Stage 4 — gates, review, docs

- [x] `npm test`, `npm run typecheck`, lint on touched files.
- [x] GPT Sol code review, `--sandbox workspace-write` — four rounds in the end, not two: the plan,
  stages 1–2, Sol's own pass over stage 3, and an independent pass over the same commit.
- [x] A section in [overseer-direction.md](../project/overseer-direction.md) § "Where the work reading
  now lives, and the four things it may not claim", plus a line closing one of the two instances in
  its "Built, tested, and called from nothing but its own tests" section — which is the class this
  classifier had been sitting in for two days.

**Status:** done, 2026-09-10.
