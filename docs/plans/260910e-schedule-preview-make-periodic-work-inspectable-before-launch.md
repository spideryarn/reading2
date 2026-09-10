# Schedule preview — make periodic work inspectable before launch

The roadmap stage of the same name in
[260908f § Stage: Schedule preview](260908f-overseer-and-fleet-improvement-roadmap.md#stage-schedule-preview-make-periodic-work-inspectable-before-launch),
dispatched by the Overseer on 2026-09-10 as queue item `qi-2yk4gxas`, session `schedule-preview`.

**This stage launches nothing.** `OVERSEER_JOBS_ENABLED` stays unset and remains Greg's switch. What
it builds is the ability to say, in the browser and on the CLI, exactly what the scheduler *would*
run next, when, under which pinned revision, and why not — before anybody arms it.

> Yes, I'm thinking get-ready-to-deploy every 6h, and feedback-sweep every 3h (perhaps offset so
> they don't bump into each other). Ideally these would be written in some config somewhere that
> would be easy to edit, with an idempotent script to update them.
>
> — Greg, 2026-09-08 (quoted in `tools/overseer/schedules.ts`)

**Status:** plan revised after Sol's review
([260910e-schedule-preview-plan-review-sol.md](260910e-schedule-preview-plan-review-sol.md) —
*build with these changes*; all eight findings accepted, see § What the review changed). Stage 1
next.

## What already exists, and so what this stage is

Most of the machinery the roadmap asks for is built and disarmed (`overseer.md` § The standing
jobs). Jobs are data (`standing-jobs.ts`, `rule-jobs.ts`), their behaviour is pinned by
`authorisedHash` with each job's document digest inside it, cadence/lease/first-run delay live
unhashed in `schedules.ts` behind `validateSchedules`, `due()` is state-based and already runs a
missed job **once** rather than replaying it, a durable lease releases a stuck launcher, and a
durable 30-minute spacing gate separates session launches. `overseer status` prints one line —
`scheduler OFF — …` — naming the definitions.

What is missing is **the per-job answer** (next due, last attempt, why not, what would run), any
**browser** reader of it, and four defects found while planning — the first by reading the code,
the other three by Sol:

1. **A document edited after the daemon starts is dispatched without a re-pin.** `standingJobs()`
   digests each document once, at start (`standing-jobs.ts:189`), every tick reuses those
   definitions (`daemon.ts:992`), and the session it launches is told to follow the document **on
   disk** in the primary checkout (`dispatch.ts:131`, `gjd-remote.ts:2726`), where every push to
   `dev` lands. So between a doc edit and the next restart, unattended authority grows silently.
   Not live harm today — the scheduler is OFF.
2. **The daemon's `ARMED` headline is computed once at start** (`daemon.ts:744`), so after fixing 1
   a tick could refuse a job while the checkpoint went on saying `ARMED`.
3. **Duplicate job ids: the first one dispatches.** The loop refuses an id only when it meets it the
   second time (`scheduler.ts:421`), so the first definition has already been reserved and spawned
   while the report says *"neither can be addressed"*.
4. **A cron hidden in the session.** `get-ready-to-deploy.md` § Running it on a timer tells whoever
   runs it that *"the recurring form is a `/loop` in a Claude session"*, and suggests a system cron
   for longer. The scheduled prompt says *"all steps"*. An armed Overseer would start sessions that
   may start their own recurrence — the opposite of the roadmap's *"No cron hidden inside a Claude
   session"*.

And there is no per-job enabled switch, so a harmless fixture job cannot be in the list without
being live when armed.

## Decisions

### D1. No second job list — the existing one, with each roadmap field mapped

| roadmap field | where it lives |
|---|---|
| id | `JobBehaviour.id` — exists |
| approved document path + pinned content hash | `JobBehaviour.documents` + `authorisedHash` — exists; **plus** `authorisedDocuments` (D4) so the preview names *which* document moved |
| interval | `ScheduleConfig.everyMs` — exists |
| timezone | **none, deliberately.** Interval scheduling has no wall-clock boundary. Durable instants are UTC ISO; display goes through `tools/fleet/zones.ts` (London first). A zone field arrives with the first calendar schedule |
| enabled flag | **new, and hashed**: `JobBehaviour.dispatch`, `live` or `dry-run` with a reason (D5) |
| resource class | **derived** from `work.kind`: `session` = a Claude session on the box, rationed by the spacing gate; `rule` = in process, no model |
| no-overlap key | **stated as what it is**: the *launcher* is held per job id while its lease runs; **session no-overlap: not enforced** (the occurrence settles when `gjd-remote` exits, and the session runs on for hours); box-wide session *launches* are spaced 30 min |
| timeout | **launcher lease** (`leaseMs`), labelled as that; **session timeout: not built**. The Scheduled-dispatch stage replaces both lines |
| missed-run policy | a named constant `MISSED_RUN_POLICY = "one-run"`, which describes `due()`; planner tests hold it |
| versioned | the preview file carries `schema: 1` and a **`listRevision`** — a hash over every job's id, `authorisedHash`, schedule and dispatch mode — so the page can say whether the running daemon holds the list this checkout builds |

### D2. One pure, list-wide planner, shared by the tick and the preview

New `tools/overseer/schedule-plan.ts`: `planJobs(input, launch)`. **Pure given its inputs**: the
definitions, the occurrence index, the ledger's history state, arming, the launch separation,
`nowMs`, and **document evidence resolved by the caller** (`ReadonlyMap<jobId, DocumentReading[]>`
for session jobs, where a reading is a digest or the reason it could not be taken). It owns the
whole gate order:

1. history lost → every job held;
2. **duplicate-id preflight over the whole list → every definition sharing an id refused, before
   anything is planned** (defect 3);
3. per job, in order: authorisation (session jobs against the fresh evidence, rule jobs against
   their load-time digests) → `due()` → dry-run → the spacing gate → `dispatch`.

For each `dispatch` it calls the injected `launch(job) → boolean` — *did a session start (or
possibly start)?* — and moves its in-loop spacing clock only on `true`, exactly as
`schedulerTick` does now. The tick's `launch` reserves, spawns and records, and returns the real
answer (so a failed reservation or a refusal moves nothing); the preview's returns `true` for a
live session job, and the preview says in words that *rows after a proposed launch assume it
succeeded*. `schedulerTick` keeps only the sweep and the side effects.

**The simpler option passed over:** a separate preview function beside the tick — a second copy of
the gate order, which is the one thing a preview must not get wrong.

Tests: **characterisation first** — the existing `overseer-jobs`, `overseer-schedules` and
`overseer-rules` suites stay green unchanged in meaning, plus explicit report-sequence tests for
sweep+dispatch, history lost, spacing, a rule/session mix. **Red first**: duplicate ids → zero
spawns and every duplicate refused. Planner scenarios: **startup** (arming unknown → held; armed →
not-yet-eligible until `armedAt + initialDelayMs`, due at exactly that instant); **interval
boundary** (`last + everyMs − 1` waiting, `last + everyMs` due); **missed intervals** (three days
down on a 3h job → one dispatch across repeated ticks, then held); **forward time jump** (one run);
**backward time jump** (next due stays the absolute `last + everyMs`); **already running** (held;
released as stuck after the lease, never retried).

### D3. Fresh document evidence every tick, and the headline made of it

`TickInput` gains a **required** `readDocument(path)`; the tick resolves evidence for every session
job's documents before calling the planner. An unreadable document refuses the job with a sentence.
**Rule jobs keep their load-time digests**: their "documents" are the source of code already loaded
into the daemon, so re-reading them would refuse a rule whose running code has not moved. The false
comment in `standingJobs()` ("nothing dispatches the edited document either") is corrected.

**The headline too (defect 2):** the daemon recomputes its `StoredScheduler` from the same fresh
evidence on every checkpoint, so `ARMED` cannot outlive the job that earned it.

Named and not closed here: a document edited between the tick's digest and the session reading it,
or during the session. Pinning the material handed to the child is the Scheduled-dispatch stage's
first bullet.

### D3b. The Overseer owns the recurrence (defect 4)

Both session prompts gain one sentence: *"This run is one occurrence of a schedule the Overseer
owns: do not create a /loop, cron job, timer or any follow-up schedule."* A behaviour change,
narrowing, re-pinned in the same reviewed commit. The document itself is a rule doc
(`docs/reusable/`) and its § Running it on a timer should say the same — that edit goes to Greg (see
*Needs Greg*). The prompt is the mechanism in the meantime, and the comment that says the prompt is
*"copied from the doc"* is updated to say where and why it now differs.

### D4. Per-document pins, so a changed document is named

`AuthorisedJob.authorisedDocuments: readonly JobDocument[]` — each document's full sha256 when it
was pinned. **The behaviour hash stays the only gate**; these exist so a refusal can say
*"feedback-reports.md: pinned 1a2b…, now 9f8e… — edited since it was authorised"*. A test ties the
two: for every shipped job, `behaviourHash({...behaviour, documents: authorisedDocuments}) ===
authorisedHash`, and it is shown to go red when one digest is altered. Rule jobs get the field from
their load-time digests, so it is not optional.

### D5. `dispatch: live | dry-run`, inside the fingerprint, and one fixture job

`JobBehaviour.dispatch` is `{ kind: "live" } | { kind: "dry-run"; why: string }`, **hashed** (Sol's
P1): dry-run → live changes *whether* an unattended session may start, not *when*, so it is gate 3's
and not S8-1's. The clock fields stay outside. All four shipped jobs re-pin once — for the two
standing jobs, in the same commit as D3b.

A dry-run job goes through every gate. Where a live job would reserve, it reports **`dry-run`** —
*"due now; dry-run, so nothing is reserved or launched"* — and **writes nothing to the ledger**: a
last attempt that never happened would corrupt it. It never counts against spacing, and
`eligibilityOf` calls it ineligible so it cannot earn `ARMED`. (It reports every tick while due, the
same volume as `waiting` does today.)

**The fixture: `schedule-fixture`.** A session job whose document is
`tools/overseer/schedule-fixture.md` — one paragraph telling a session to reply one line and stop,
touching nothing — `dispatch: dry-run`, every 24 h, lease 1 h, first run 2 h after arming. It gives
the preview a harmless job in every state, lets an edit to its document demonstrate the
changed-document display end to end, and gives the Scheduled-dispatch stage a pre-pinned *"one safe
occurrence"*. Making it live is Greg's (see *Needs Greg*).

### D6. The daemon writes the preview; everything else reads it

**Changed on review (Sol's P1-4).** The first draft computed the preview on demand in the fleet
server, which has two drifts: the fleet process holds *its own* loaded prompts, pins and schedule
constants, not the daemon's; and the checkpoint's occurrence ledger lags the scheduler timer.

So: **on every checkpoint tick the daemon writes `~/.overseer/schedule.json`** (atomic temp +
rename), computed by the shared planner from *its* loaded definitions, the documents as they are
now, its **in-memory** occurrence index, its arming, and the capabilities it actually holds. It
carries `schema`, `writtenAt`, the daemon's `instanceId`, `listRevision`, capabilities, arming,
history state, the headline, and per job: resource class, dispatch mode, the verdict and its
sentence, next due (absolute UTC instant, or *"after the run in flight settles"*), last attempt and
result, the launcher lease, the prompt (`what`), the behaviour hash against its pin, and each
document's pinned and current digest.

To do that when the scheduler is **off** — today's state, where `jobs` is absent — `schedulerWiring`
always hands the daemon a separate `preview` option (definitions, `readDocument`, held capabilities,
`listRevision`); it is the list the daemon *would* run, never something it can dispatch.

A separate file rather than a checkpoint field keeps `store.ts`'s checkpoint schema untouched, and
the checkpoint's scheduler line stays the headline.

Readers: the fleet route reads that file (a few KB, bounded) and forwards it; `overseer status`
reads it and **also** builds the list from the checkout it runs in, so it can say *"the running
daemon holds list abc; this checkout builds def — a restart loads it"*. A daemon that predates this
build writes no file, and both readers say exactly that.

Limits stated on the page: it is as of `writtenAt` (≤ one tick, 30 s); rows after a proposed launch
assume it succeeded.

### D7. Surfaces: `overseer status` and a section on the Overseer tab

- **One parser**, in a browser-safe leaf `tools/fleet/schedule-parse.ts` (no node imports — the
  `zones.ts` precedent), used by the CLI, the route and the browser; unknown kinds become an
  `unreadable` arm, never a throw. The types are appended to `wire.ts`.
- **CLI.** `overseer status` gains a `schedule` block after the scheduler line.
- **Browser.** A section on the Overseer tab directly under the status card — not a new tab (six
  registrations in three files for one card). `SchedulePreview.tsx` fetches
  `GET /api/overseer/schedule` through `schedule-client.ts` (an injectable seam, the `HistoryApi`
  shape) on mount and every 60 s. `routes-schedule.ts` has a pure payload function, and
  `schedule-wiring.ts` a `makeSchedule()` composition so a join test drives what `server.ts` mounts.
- **Outside the brief's file set, named:** `server.ts` gets the composition and one mount line;
  `OverseerPanel.tsx` a defaulted `scheduleApi` prop and one mount line (after `action-receipts`'
  ReceiptList if that has landed); `daemon.ts`'s scheduler region (not the usage pass) and
  `scripts/overseer.ts`'s `schedulerWiring` and `status` case.

Absence is stated: no file (the daemon predates this build), an unreadable file, a schema this build
does not know, an unreadable document, `armed.json` missing (the daemon is off, so first runs read
*"2 h after it is armed"*), and *"this page could not reach the route"* — each its own sentence.

## What the review changed

Sol's eight findings, all accepted: P1-1 → D3's headline paragraph; P1-2 → D3b; P1-3 → D5 hashed;
P1-4 → D6 rewritten; P1-5 → the preflight in D2; P2-6 → evidence passed in, `launch` injected,
characterisation tests; P2-7 → D1's timeout and no-overlap rows; P3-8 → D4 kept, test shown red.
No second plan-review round: the revisions follow Sol's own suggested shapes, and the stage reviews
will see the code.

## Stages

Implementation goes to Opus subagents, not Codex — the brief's account note of 2026-09-10: Codex is
the tighter budget. Sol reviews each stage once.

### Stage 1 — the scheduler core

**Done.** `18f64a04` (built by an Opus subagent from
[the task](260910e-schedule-preview-stage1-task.md); the activation fix by the manager) and Sol's
stage-review fixes F1–F3 on top
([review](260910e-schedule-preview-stage1-review-sol.md)). Focused overseer suites 9 files / 322
tests, typecheck exit 0. What the plan did not know:

- **A dry-run job needs its own eligibility arm, not `ineligible`**, or the activation preflight —
  which stops on any `ineligible` — could never arm a box carrying the fixture. `overseer-activate`
  now names it as never dispatching.
- **Duplicates had to reach the headline too** (Sol's F1): the planner refused them and
  `eligibilityOf` still counted them, so `ARMED` could stand over a tick that launched nothing.
- **Rule document pins had to be literals** (F2): load-time digests compared a moved source with
  itself.
- New pins: get-ready-to-deploy `c5c7f9f93886`, feedback-sweep `c921a5c4b732`, schedule-fixture
  `465648545712`, wedged-work `28d1f83b8a42`, launch-mode `4de4439f7848`. The D3b sentence is one
  constant, `OVERSEER_OWNS_THE_RECURRENCE`, and the fixture's prompt carries it too.

- [x] `schedule-plan.ts` `planJobs`; `schedulerTick` refactored onto it; duplicate preflight (red
  first); the planner and characterisation tests of D2.
- [x] `JobBehaviour.dispatch` (hashed), the `dry-run` report arm, and a `dry-run` eligibility arm
  (not `ineligible` — see above).
- [x] Required `readDocument`; session evidence per tick; the `standingJobs()` comment corrected;
  wired through `schedulerWiring` and `daemon.ts`; the headline recomputed per checkpoint.
- [x] D3b's sentence in both prompts.
- [x] `authorisedDocuments`; the pins-agree test, shown red.
- [x] `schedule-fixture` job, its document, its pins; all four jobs re-pinned; shipped-job tests
  updated.

### Stage 2 — the preview file and the CLI

- [ ] `wire.ts` types; `schedule-parse.ts`; pure `schedulePreview()` over `planJobs`;
  `listRevision`; `MISSED_RUN_POLICY`.
- [ ] The daemon writes `schedule.json` each checkpoint tick; the `preview` option from
  `schedulerWiring`; a daemon test with a disposable store.
- [ ] `overseer status` prints the block, and the checkout-vs-daemon `listRevision` line.

### Stage 3 — the browser section

- [ ] `routes-schedule.ts` + `schedule-wiring.ts` + mount; `schedule-client.ts`;
  `SchedulePreview.tsx`; the `OverseerPanel` mount.
- [ ] Tests: the route over a fixture store; the join through `makeSchedule()`; the section drives
  the seam, draws each absence, and prints times through `zones.ts`.

### Stage 4 — docs and close-out

- [ ] `overseer.md` § The standing jobs: the preview, the fixture, dry-run, per-tick evidence, the
  no-recurrence sentence. Factual, not a change to a rule.
- [ ] Full suite through `tmux-job`, typecheck, lint of touched files; the roadmap row; debrief. The
  daemon needs a restart to write the file, and the dashboard one to serve the route — both the
  Overseer's.

## Not doing

Launching anything; arming; calendar schedules and a timezone field; enforcing session no-overlap or
a session timeout; recording dry-run occurrences; a new dashboard tab; editing
`get-ready-to-deploy.md`.

## Needs Greg

- **`get-ready-to-deploy.md` § Running it on a timer** still describes a `/loop` in a session as the
  recurring form. Once the Overseer's scheduler is armed that is wrong; it should say the Overseer
  owns the recurrence. It is a rule doc, so it waits for his approval (D3b is the mechanism until
  then).
- **The fixture job** — prompt, daily cadence, dry-run — is a definition he has not seen. Inert as
  written; making it live for the next stage's first end-to-end run is his.
