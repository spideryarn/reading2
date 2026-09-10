# Scheduled dispatch: one durable occurrence, one reconciled launch

Roadmap stage: [260908f § Stage: Scheduled dispatch](260908f-overseer-and-fleet-improvement-roadmap.md#stage-scheduled-dispatch--one-durable-occurrence-one-reconciled-launch)
— its five checkboxes and acceptance paragraph are the spec. Queue item `qi-qxw727jg`. Session
`scheduled-dispatch`, worktree `.claude/worktrees/scheduled-dispatch`, dispatched by the Overseer
2026-09-10.

Consumes the launch protocol, [260910f-launch-protocol-…](260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md)
(session `launch-protocol`, not on dev yet at the time of writing). Shares one launch gate with
Gradual recovery (session `gradual-recovery`).

## What this is for, in plain words

The scheduler is built, has a preview, and is switched off. When a job comes due today, it writes
`reserved` into `events.jsonl`, runs `gjd-remote new-claude … -p -`, and writes `started` with the
pid of **the launcher**. The launcher exits in seconds and the Claude session lives on for hours,
unobserved. So "finished, exit 0" means "a tmux session was created". Nothing sees whether the job
did its work. And if the daemon dies between the spawn and `started`, nothing can later find out
what happened.

This stage makes a scheduled job:

1. **one durable occurrence**, whose identity is job + scheduled instant + authorised definition
   revision;
2. launched through the **one crash protocol** that recovery also uses, so a restart can find the
   launch again rather than guess;
3. with a **result that is observed**: the wrapper's exit status, a non-empty answer, and the six
   ways it can fail, each recorded separately;
4. drawn on the Overseer tab: last occurrence, next occurrence, and a link to the answer.

**Arming stays Greg's.** Nothing here sets `OVERSEER_JOBS_ENABLED`, and the only occurrence run end
to end is the `schedule-fixture` job, on a scratch daemon, a scratch store and a disposable tmux
socket.

## What the launch protocol gives us (agreed with its session, 2026-09-10)

- `LaunchProtocol["launchOccurrence"](request) → LaunchOutcome`, handed over as a capability.
  Composed in `daemon.ts` by the protocol's Stage 3, which names the value; one line of mine passes
  it into `TickInput`. The scheduler never sees `LaunchParts` or a launcher (their F9).
- `PlanRequest = { origin: scheduleOrigin(key), material, admissionClass: "claude-session" } &`
  (`{ launcherKind: "tmux" }` | `{ launcherKind: "headless" | "tmux-headless"; run: RunSpec }`),
  where `RunSpec = { timeoutMinutes, access: "read-only" | "review" | "write" }`. `run` is part of
  the occurrence's identity: it goes into their F5 conflict check and into `intent.json`.
- **Launcher `tmux-headless`**: a tmux session on the already-running server, running
  `run-claude --launch-dir <artefactDir> --prompt-file <material> --timeout-minutes N --access X`.
  The reason is theirs and was measured: `overseer.service` sets no `KillMode`, so a plain headless
  child of the daemon dies on every Overseer restart and then holds its slot as `outcome-unknown`.
  A tmux session lives outside that cgroup. If no tmux server is running, the launcher refuses before
  doing anything, because otherwise it would fork the server inside the daemon's cgroup.
- `exit.json` carries `ending`, `timedOut`, `answer {path, bytes, sha256, usable}`,
  `transcript`, and, added for this stage, the wrapper's `verdict`
  (`ok` | `failed {cause: spawn|overflow|timeout|cli-error|no-result|nonzero|empty-answer}`),
  `usageLimit: boolean` and `permissionDenials: number | null`. The answer and transcript default to
  `<artefactDir>/answer.md` and `<artefactDir>/transcript.ndjson`.
- Class `claude-session`, capacity 1, is held until there is evidence of exit. `outcome-unknown`
  holds its reservation until Greg disposes of it. Recovery gets its own class, `recovery-resume`,
  released once the session is observed running, so neither consumer blocks the other.
- `launches.json`, the protocol's own bounded projection, which is read through the `wire.ts` block
  their Stage 3 appends.

## The design

### D1. Identity, three levels, none of them a boolean

| what | id | made of |
|---|---|---|
| job | `get-ready-to-deploy` | the definition's id |
| occurrence | scheduler `OccurrenceId` and launch `lo-<20 hex>` | `OccurrenceKey { jobId, scheduledAt, behaviourHash }`; the launch id is `occurrenceIdOf(scheduleOrigin(key))`, a hash of the same key |
| attempt | `lo-…-a1` | the protocol's correlation id |

`behaviourHash` is the **authorised definition revision**. It covers the prompt, the dispatch mode,
the run spec (D4), and the digest of every document as read *this tick*, so a document edited since
the last tick gives a different occurrence, and the pin gate refuses it before any key is minted.
The scheduler never stores the launch id. It recomputes it from the key, so the join between the two
cannot drift.

### D2. One ledger for a session job: the launch journal

The launch protocol's D10 said Scheduled dispatch *replaces* the scheduler's
`reserved → spawn → started` session arm; writing both would record every launch in two ledgers.
So:

- **A live session job writes nothing to `events.jsonl`.** The tick calls `launchOccurrence`, and
  the protocol's `plan()` is the first durable write. Rules keep their `events.jsonl` path unchanged.
- **The planner's history for session jobs is a projection of the launch fold.** A new pure function,
  `launchOccurrencesOf(fold, sessionJobIds)`, turns every schedule-origin `LaunchRecord` into an
  `Occurrence` of a new arm, `{ kind: "launch", …, launch: LaunchStanding }`. The scheduler merges
  those with the store's index before calling `planJobs`, and the preview does the same with the
  same function. `lastRunOf`, `lastSessionLaunchOf`, `newestAttemptOf` and `standingOf` each get the
  arm, and the exhaustive switches point to every place that needs it.
- **Standing of a launch occurrence:**
  - `planned`, `waiting-admission`, `reserved`, `launching`, `observed-running` and
    `outcome-unknown` are **open**. An open occurrence is a new `LastRun` arm, `launch-open`, which
    `due()` answers with `held`. **That is the no-overlap guard**, and it has no lease: the roadmap's
    "timeout alone is not proof" means an occurrence whose outcome is unknown holds its job until
    Greg disposes of it.
  - `completed` and `failed-before-launch` are settled, at the record's `updatedAt`.
- **Spacing** counts an occurrence that has at least one attempt (the launcher was invoked or may
  have been), timed at `plannedAt`. A `failed-before-launch` with no attempt does not count, the same
  way a `refused` does not count today.
- **The crash windows, and which record closes each:**
  - Tick decides, then dies before `plan()`: no record, nothing ran. The next tick plans a new key,
    which is correct.
  - Dies after `plan()`: the protocol's reconciliation settles it (their D4 table). My projection
    reads it as open, so the job holds until reconciliation moves it. It never launches twice:
    **a restart after a real launch but before receipt cannot duplicate, because the occurrence is
    open and `due()` holds its job**, and the protocol will not re-invoke an ambiguous attempt
    either.
  - A missed day: `due()` already gives one run, not a replay (`MISSED_RUN_POLICY = "one-run"`).
    Nothing here changes that. Tested again at the tick, with a day of downtime and an open
    occurrence settled in between.
- `dispatch.ts`'s `gjdRemoteDispatch` and `TickInput.spawn` are **deleted**, not left beside the
  new path. "Prefer simple": two ways to start a session job is the thing this stage removes.
  `jobsEnabled`/`JOBS_ENABLED_VAR` stay.

### D3. The material handed to the child is pinned

Today the session is told "follow `docs/…/x.md`" and reads the file from disk minutes later, which
leaves a window where an edited document runs under an old pin (plan 260910e § D3 named it).
`materialOf(job)`:

- reads each authorised document's bytes **once**;
- hashes them and compares with the digest the pin gate accepted this tick. If they differ, it
  refuses this tick (`material-moved`, which is a report and not an occurrence);
- builds the material: the job's `what`, then each document verbatim under a fenced header naming
  its path and sha256, then one sentence: *the documents above are the authorised text; follow them,
  not the copies on disk*.

The protocol then pins `material.txt`, re-hashes it before launch, and hands the child exactly
those bytes (their F5). The material's framing is code in `scheduler.ts`, not pinned, which is the
same boundary `rule-jobs.ts` states for the scheduler. What is pinned is what matters: the `what`
and the documents' digests.

### D4. The run spec is part of the job's authorised behaviour

`JobWork`'s session arm becomes `{ kind: "session"; run: RunSpec }`, and `behaviourHash` encodes it,
so a job's timeout and access are things Greg authorised, and moving either one re-pins. **This
moves every session job's pin**:

- `schedule-fixture`: re-pinned here, `{ timeoutMinutes: 5, access: "read-only" }`. It is
  dry-run and harmless, and schedule-preview pinned it new the same day.
- `get-ready-to-deploy` and `feedback-sweep`: **deliberately not re-pinned.** They will read
  `NOT AUTHORISED — behaviour moved` in the preview until Greg authorises a run spec. Both
  plausibly need `access: "write"` (they commit and push to `dev`, or dispatch agents), and an
  unattended job with write access is his decision (launch-protocol's caution). **Needs Greg**,
  with the proposed values in the debrief. The daemon is disarmed, so nothing that runs today loses
  anything; the preview just says so honestly.

### D5. Gates: no-overlap, admission, usage

- **No-overlap**: D2's `launch-open`, per job.
- **Admission**: the protocol's owner. A `waiting` outcome is reported as `admission-waiting` and
  is not a launch. The protocol records it as `waiting-admission` (open), so the next tick's
  `launchOccurrence` for the same key picks it up rather than planning a second one.
  **The key is kept stable across ticks for exactly this reason**: `scheduledAt` becomes the
  job's nominal due instant (`lastRun.at + everyMs`, or the first-eligible instant), not the tick's
  wall clock. That needs a `dueAt` on `due()`'s `due` arm. It also makes the key identical after a
  restart inside the same due window.
- **Usage and box health**: one shared pure leaf, written by Gradual recovery
  (`launchGate(...) → clear | held`), computed once per tick by the daemon and handed to the planner
  as a value. It adds one planner step for live session jobs, after spacing: `usage-held`, a new
  `JobPlan` and preview verdict. It holds on positive evidence (the account at or near a limit, or
  the box unhealthy) and treats unknown as clear with a note. The child's own `usageLimit` in
  `exit.json` catches a real refusal after the fact. (The semantics were proposed to Gradual
  recovery and are theirs to finalise; if they fail closed on unknown, it is a parameter.)

### D6. The result, observed rather than assumed

`tools/overseer/occurrence-result.ts`: one pure function from a launch record to an
`OccurrenceResult`. It is computed when read, never stored, because it is a reading of evidence
the journal already holds.

| result | from |
|---|---|
| `pending` | `planned`, `reserved` |
| `admission-waiting` | `waiting-admission` |
| `running` | `launching`, `observed-running` |
| `unknown` | `outcome-unknown` (with the protocol's `why`, and the `dispose` command) |
| `launch-failed` | `failed-before-launch` (its proof); or an exit record with `supervisor-failed` or `verdict.cause = spawn` |
| `timed-out` | `timedOut` or `verdict.cause = timeout` |
| `quota-refused` | `usageLimit` |
| `interrupted` | an ending of `signalled` that is not a timeout; `rebooted`; a disposition with no exit record |
| `permission-denied` | `permissionDenials > 0` |
| `missing-answer` | an exit of 0 with no usable answer, or `verdict.cause` of `no-result` or `empty-answer` |
| `failed` | any other non-zero exit, `cli-error` or `overflow`, with the wrapper's `why` |
| `succeeded` | an exit of 0, `verdict.ok`, a usable answer, no denials, no usage limit |

**Precedence is the table order**, top to bottom, and the whole ladder is tested. A permission
denial with a usable answer is still `permission-denied`. That is visibly failed on purpose: an
unattended job that could not do something it tried is the case somebody must look at, and "the
model worked round it" is invisible in the answer (`run-claude.ts` says so). **Nothing maps
`invoked` or a live tmux session to `succeeded`**, and a test asserts that.

The function is written against a small input type of my own, `ObservedLaunch`, because the
protocol's types are not on dev yet. When they land, an adapter `observedOf(record, exitRecord)` is
the only thing that reads the protocol's shapes. A type test pins the protocol's `LaunchRecord`
state list against the classifier's switch, so a new state is a compile error.

### D7. The occurrences projection and the page

- **`~/.overseer/occurrences.json`**, written by the daemon at every checkpoint, beside
  `schedule.json`. Per session job, in definition order, it holds `next` (copied from the same
  planner pass the preview uses in that checkpoint; `schedule.json` is where that fact lives, and
  this file restates it so the section needs one read), plus the newest 10 occurrences. Each carries
  the scheduler key, the launch id, the state, attempts, run spec, the result (D6), `answer` and
  `transcript` (bytes, usable, path), the tmux session for a running one, and the `dispose` command
  for an `unknown` one. Bounded and written atomically. The projection is pure
  (`occurrences-projection.ts`); the daemon line only writes it.
- **`wire.ts`**: one appended block, types only.
- **`tools/fleet/occurrences-parse.ts`**: a leaf with no imports, the one parser. The daemon, the
  route and the browser all use it, the way `schedule-parse.ts` works.
- **`GET /api/overseer/occurrences`** (`routes-occurrences.ts`, `occurrences-wiring.ts`): one
  bounded read of the file. **`GET /api/overseer/occurrences/<lo-id>/answer`** is the durable
  result link. The route builds the path from the validated id and the protocol's fixed layout
  (`launches/o/<id>/a<n>/answer.md`, the newest attempt), and never from a path in the file. It
  reads at most 256 KB and serves `text/plain` with `nosniff`. There is no transcript link: a
  transcript holds every file the job read. Its path is shown as text instead.
- **`server.ts`**: the import, the construction and the route line. That is three lines, not one;
  the brief said one, and this is the least it can be.
- **`ScheduledOccurrences.tsx`** plus `occurrences-client.ts`, mounted in `OverseerPanel.tsx`
  directly after `<SchedulePreview>`. Per job it shows: the last occurrence (a result pill, where
  failure kinds are red and name themselves; when it ran, London first; a link to the answer),
  timeout and access, a running occurrence's tmux session and its cancel command, and the next
  occurrence. The recent ones sit behind a disclosure. Every absence is stated, in the same six arms
  as the preview's section.
- **Cancellation is visible, not a button.** A running occurrence prints
  `tmux kill-session -t '=<name>'` (the child's run-claude then writes `exit.json` as `signalled`,
  which reads as `interrupted`). An unknown one prints the protocol's `dispose` command. A button
  would belong to `action-receipts`' vocabulary; the recovery panel made the same call.
- **The preview's two honest literals move.** `sessionTimeout: "not built"` becomes the run spec's
  minutes, and `sessionNoOverlap: "not enforced"` becomes `"enforced"`. These are wire, parser and
  label changes in schedule-preview's files, which are done and not live elsewhere.

### D8. The drill, which is the acceptance evidence

`scripts/scheduled-dispatch-drill.ts` uses a scratch store, a scratch admission owner and a
disposable tmux socket. A fake `claude` first on `PATH` prints a result event
(`schedule fixture ran`) and appends one line to a marker file per invocation. The fixture's
definition is the real one with `dispatch` overridden to `live` and authorised inside the scratch
only; the real pin stays dry-run.

The drill drives the scheduler tick and the daemon's reconcile, and **tears down and reopens every
store, the owner and the protocol at each boundary**: before plan, after plan, after reserve, after
`launching`, after invocation but before `start.json`, after `start.json` but before `exit.json`, and
after `exit.json` but before the next reconcile. Per boundary it asserts exact counts: marker lines
(the child's own count, independent of the protocol), tmux sessions on the socket, and reservations
held. The final state must be `completed` / `succeeded`, with the answer link resolving. It adds a
day-of-downtime row (one run, not a storm) and a negative control: a fake that writes an empty
answer must end `missing-answer`, never `succeeded`. It exits non-zero on any mismatch.

If the protocol's tmux-headless adapter cannot target a scratch socket, that is an ask of their
Stage 2, and it has been made. The drill does not start the real daemon, and it does not touch the
default tmux server or `~/.overseer`.

## What is deliberately not here

- No arming, no live job, no re-pin of the two standing jobs (D4).
- No retry of a failed occurrence. The next due instant is a new occurrence.
- No cancel or dispose button (D7).
- No box-wide admission. Capacity is the protocol's owner, and the Enforced launch admission stage
  decides more.
- No transcript served over HTTP.

**The simpler option passed over:** keep the `events.jsonl` session arm and add a
`job-occurrence-launched` event that points at the launch id. It is fewer lines in `jobs.ts`, but it
is two ledgers for one launch, a lease in one that disagrees with the reservation in the other, and
a crash window between them that needs its own reconciliation. D2's projection has none of those.

## Review dispositions: Sol, plan round 1 (these override D1–D8 where they differ)

Review: [260910f-scheduled-dispatch-plan-review-sol.md](260910f-scheduled-dispatch-plan-review-sol.md).
The full record is [260910f-scheduled-dispatch-plan-review-sol-findings.md](260910f-scheduled-dispatch-plan-review-sol-findings.md),
written by Sol to `/tmp` because the read-only sandbox refused the repository path, and copied here.
Verdict: refuse, with eight P1s and one P2. **All nine are accepted**, each checked against the code.
F1 is also my own finding M1, made independently while the review was running.

- **F1 (P1): `planned` and `waiting-admission` must not hold their own job. Accepted.**
  - Neither is a run. `lastRunOf` skips them, and the planner gets a new verdict,
    `resume { existing launch record }`, when the job's newest launch occurrence is in one of those
    states.
  - Every gate still applies: the pin, dry-run, spacing and usage.
  - A `dispatch` calls `launchOccurrence` with **the existing occurrence's origin**, not a fresh
    key. The protocol's `plan()` is idempotent for the same origin, and `drive()` continues from
    where the occurrence waited.
  - Only `reserved`, `launching`, `observed-running` and `outcome-unknown` block, as `launch-open`.
    `reserved` is transient inside one synchronous call; after a restart, the protocol's
    reconciliation makes it `failed-before-launch`.
  - If the behaviour hash moves while an occurrence waits, the waiting one is **superseded**: it is
    never asked again, it holds no slot, and the projection shows it as `admission-waiting` with a
    note that a newer revision replaced it. The new revision plans its own occurrence.
  - Tests: a restart after `planned`, and a wait followed by free capacity, must each invoke the
    launcher exactly once.
- **F2 (P1): history authority is per ledger. Accepted.**
  - `PlanInput.history` becomes a history per kind: rules read `events.jsonl`'s `OccurrenceHistory`,
    and session jobs read the launch journal's `JournalStatus`.
  - A lost `events.jsonl` history holds rules only. A launch journal in `history-lost` holds session
    jobs only, with the protocol's reason, and the preview says the same.
  - Carried occurrences after a `resolve-history` are projected under their job as held. The
    protocol's `CarriedEntry` keeps `origin` and `plannedAt` wherever its salvage can read them
    (`launch-protocol`, Stage 1b).
  - A carried entry with a null origin is **unattributable**. It holds every session job, and the
    page lists it at the top as "unattributable, held". It is never dropped. Only Greg's `dispose`
    moves it.
  - The checkpoint's `jobs` field, `overseer status`, `reconcile-jobs` and `UNKNOWN_RETENTION` stay
    about `events.jsonl`, which means rules, and say so. Session jobs' state is in
    `occurrences.json`, and `overseer status` gains one line pointing at it.
  - Tests: each ledger corrupted on its own, plus a schedule occurrence carried across a history
    reset.
- **F3 (P1): spacing is anchored to the launch, not the due instant. Accepted.**
  - The nominal instant is for identity only.
  - Spacing reads each occurrence's first attempt's `launchingAt`, the time of the `launching`
    event, asked of `launch-protocol`. An occurrence with no attempt does not count.
  - Test: a delayed admission, then a restart immediately after the launch.
- **F4 (P1): cadence runs from a stable ending time. Accepted.**
  - `LastRun.at` for a settled launch occurrence is the fold's `endedAt`: the protocol's Stage 1b
    puts it on `completed` and `failed-before-launch`, and it never moves on `released`.
  - `updatedAt` is for freshness and display only.
  - Test: a terminal append followed by a release six hours later.
- **F5 (P1): a disposition outranks the open states. Accepted, and already built** in Stage A's
  classifier.
  - D6's ladder, as built:
    1. evidence of an ending (exit record, reboot, failed-before-launch);
    2. then a disposition with no ending (`interrupted`);
    3. then the open states.
  - Within the endings, the table's order stands.
- **F6 (P1): stale pins must not stop a disarmed install. Accepted.**
  - Stage B changes `scripts/overseer-activate.ts`: an ineligible live session job is a **warning**
    when the resulting state is disarmed, and blocks `--arm` or an already-armed result.
  - Tests for all three.
- **F7 (P1): the answer link is bound to the result it belongs to. Accepted, and being fixed in
  Stage A.**
  - The route serves only an occurrence listed in `occurrences.json`, which holds schedule origins
    only.
  - It reads the attempt the projection names, not the newest one.
  - It opens with `O_NOFOLLOW | O_NONBLOCK`, `fstat`s the same descriptor for a regular file, and
    checks both the size and the sha256 against the projection's `answer`, which now carries its
    sha256 from `exit.json`. A mismatch gets 409.
- **F8 (P1): cancellation must leave a receipt. Accepted; `launch-protocol` builds the wrapper half
  in its Stage 2 (Overseer-approved, 2026-09-10).**
  - `runChild` catches SIGHUP (what `tmux kill-session` delivers) as it already does SIGTERM,
    forwards it to the child's process group, and waits within the existing grace period.
  - Under `--launch-dir`, the wrapper's finaliser writes `exit.json` with `ending: signalled` before
    it re-raises the signal. That also fixes a live bug: closing a pane used to orphan Claude.
  - The page prints exactly `tmux kill-session -t '=<name>'`.
  - The drill runs that exact command and requires `signalled`, then `interrupted`, then
    `released`.
  - Until Stages 1–2 are on dev, nothing prints the command, because nothing writes occurrences
    yet.
- **F9 (P2): the verified material crosses the tmux boundary intact. Accepted; asked of
  `launch-protocol`.**
  - The `tmux-headless` adapter writes the verified bytes to an attempt-private `prompt.md` (mode
    0600, synced), bound by sha256 and size in `intent.json`.
  - The wrapper re-hashes it immediately before it spawns the child, and refuses on a mismatch with
    `supervisor-failed`.
- **Other checks, agreed.** Unknown usage clears: Sol cites roadmap lines 1275–1289, and failing
  closed would be a new product choice. `succeeded` requires `permissionDenials === 0`, and a null
  is not evidence of none, as built.
- **Acceptance, as Sol read it.**
  - A restart after a launch and before its receipt is covered by the protocol.
  - A missed day is one occurrence.
  - No schedule licenses a push to `main` or a production write: `get-ready-to-deploy` ends at
    `dev`, and `feedback-sweep` grants no production write.

**My own amendments, beyond Sol's findings.**
- **M2**: `due()`'s `due` arm gains `dueAt`, which is deterministic from the job's state:
  - never run: `arming.at` + `initialDelayMs`;
  - settled or unresolved: `last.at` + `everyMs`.
- **M5**: the usage and health gate is Gradual recovery's `launchGate`
  (`tools/overseer/launch-gate.ts`, on dev at ce633d8c). The daemon calls it once per tick with
  `onUnknown: "clear"` and `usageStaleAfterMs` of 30 minutes, and the planner takes the result as a
  value.

**Stage A departures, as built and accepted.**
- A disposition is dated by its own `at`.
- The commands follow the result, not the bare state.
- An exit of 0 with a null verdict is `failed`, never `succeeded`.
- The parser checks each state is paired with a result the ladder can give it, so a file claiming
  `succeeded` on a running launch is an unreadable row.
- Jobs are rows as well as occurrences, so an unknown `next` or run spec spoils only its own job.

## Stages

Implementation is by Opus subagents in this worktree, in parallel where the file sets allow. The
brief puts Codex on a ration: one GPT Sol review per stage (`--effort high --timeout-minutes 90`,
findings first to `<answer>-findings.md`), an Opus subagent fixes, one narrow 20-minute check of
the P1 fixes, then Fable if anything is still open.

### Stage 0: this plan, reviewed

- [ ] Sol plan review, read-only.
- [ ] Plan sha to the Overseer.

### Stage A: built now, independent of the protocol

Files: `tools/overseer/occurrence-result.ts` (D6, against `ObservedLaunch`),
`tools/overseer/occurrences-projection.ts` (pure builder and bounded writer, fed by `ObservedLaunch`
rows), the `wire.ts` block, `tools/fleet/occurrences-parse.ts`, `routes-occurrences.ts`,
`occurrences-wiring.ts`, the `server.ts` lines, `web/src/ScheduledOccurrences.tsx`,
`web/src/occurrences-client.ts`, the `OverseerPanel.tsx` mount, and tests.

Red first:
- every row of D6's ladder, plus its precedence;
- the projection's bound;
- the parser's per-row `unreadable`;
- the answer route refusing a bad id, a traversal, an oversize file and a missing one;
- each of the section's six absences, and a red failure pill that names its kind.

### Stage B: the scheduler through the protocol (after the protocol's Stages 1–2 are on dev)

Files: `jobs.ts` (the `launch` arm, `launch-open`, `dueAt`, `RunSpec` in `JobWork`),
`schedule-plan.ts` (`usage-held`), `scheduler.ts` (the session arm to `launchOccurrence`, material,
merged index), `dispatch.ts` (delete the dispatcher), `standing-jobs.ts` (fixture run spec, re-pin),
`schedule-preview.ts` (the new arms, the literals), `scripts/overseer.ts` (`schedulerWiring` without
`spawn`), `launch-occurrences.ts` (D2 projection plus the `observedOf` adapter), the fleet
schedule-parse/`SchedulePreview.tsx` arms, the protocol's no-production-caller allow-list, and tests.

Red first:
- a restart after invocation and before receipt, then ten ticks: one invocation;
- `outcome-unknown` holds its job through a due instant;
- a day of downtime gives one launch;
- a material/digest race refuses;
- a `waiting` keeps its key across ticks;
- `invoked` is never `succeeded`;
- a moved run spec re-pins.

### Stage C: the daemon, the drill, the docs (after the protocol's Stage 3 is on dev)

Files: `daemon.ts` (pass the protocol value into the tick; the launch gate; write `occurrences.json`
at the checkpoint, next to the preview write and away from the usage pass),
`scripts/scheduled-dispatch-drill.ts`, a test that runs the drill where tmux is present, a
browser check at 1280 and 390 px, `docs/project/overseer.md` § standing jobs (one pointer), and the
roadmap stage's status.

## Status

**2026-09-10: plan drafted (888988e5).**

**2026-09-10: Stage 0 reviewed.**
- Sol refused, with eight P1s and one P2. All are accepted, with dispositions above.
- The protocol-side needs are agreed with `launch-protocol` by message: `launchingAt`, the carried
  origin, `endedAt`, the prompt file, and SIGHUP finalisation.
- A narrow Sol check of the P1 dispositions follows.

**2026-09-10: Stage A built and committed (ee213ec7).**
- Built by two Opus subagents in parallel: 198 focused tests and typecheck green.
- F7's evidence-bound answer route is being fixed on top of it.
- Stages B and C wait for the protocol's Stages 1–2, then 3, on dev.
