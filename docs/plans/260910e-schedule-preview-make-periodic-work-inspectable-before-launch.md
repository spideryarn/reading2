# Schedule preview — make periodic work inspectable before launch

The roadmap stage of the same name in
[260908f § Stage: Schedule preview](260908f-overseer-and-fleet-improvement-roadmap.md#stage-schedule-preview--make-periodic-work-inspectable-before-launch),
dispatched by the Overseer on 2026-09-10 as queue item `qi-2yk4gxas`, session `schedule-preview`.

**This stage launches nothing.** `OVERSEER_JOBS_ENABLED` stays unset and remains Greg's switch. What
it builds is the ability to say, in the browser and on the CLI, exactly what the scheduler *would*
run next, when, under which pinned revision, and why not — before anybody arms it.

> Yes, I'm thinking get-ready-to-deploy every 6h, and feedback-sweep every 3h (perhaps offset so
> they don't bump into each other). Ideally these would be written in some config somewhere that
> would be easy to edit, with an idempotent script to update them.
>
> — Greg, 2026-09-08 (quoted in `tools/overseer/schedules.ts`)

**Status:** plan written; awaiting Sol's plan review.

## What already exists, and so what this stage is

Most of the machinery the roadmap asks for is built and disarmed (`overseer.md` § The standing
jobs). Jobs are data (`standing-jobs.ts`, `rule-jobs.ts`), their behaviour is pinned by
`authorisedHash` with each job's document digest inside it, cadence/lease/first-run delay live
unhashed in `schedules.ts` behind `validateSchedules`, `due()` is state-based and already runs a
missed job **once** rather than replaying it, a durable lease releases a stuck run, and a durable
30-minute spacing gate separates session launches. `overseer status` prints one line —
`scheduler OFF — …` — naming the definitions.

What is missing is **the per-job answer** (next due, last attempt, why not, what would run), a
**browser** reader of any of it, and two gaps found while reading the code for this plan:

1. **A document edited after the daemon starts is dispatched without a re-pin.** `standingJobs()`
   digests each document once, at start, and its comment argues this is safe because "nothing
   dispatches the edited document either, because the definition in memory still names the old
   digest". That is false: the definition names the old digest, *matches its pin*, and the session
   it launches is told to follow the document **on disk** (`dispatch.ts` spawns in the primary
   checkout, where every agent's push to `dev` lands). So between a doc edit and the next daemon
   restart, unattended authority grows silently — exactly the roadmap's "cannot silently enlarge
   unattended authority". It is not live harm today (the scheduler is OFF), and it would make any
   preview that reads documents fresh disagree with the daemon it previews.
2. **No per-job enabled switch.** The only switch is global. The roadmap asks for a harmless
   fixture job "in dry-run mode", and a job cannot be in the list without being live when armed.

## Decisions

### D1. No second job list — the existing one, with each roadmap field mapped

The roadmap lists fields. A new "job list" file beside `standing-jobs.ts` would be a second home for
the same fact, so each field is either already there, derived, or honestly absent:

| roadmap field | where it lives |
|---|---|
| id | `JobBehaviour.id` — exists |
| approved document path + pinned content hash | `JobBehaviour.documents` + `authorisedHash` — exists; **plus** a per-document pin (D4) so the preview can name *which* document moved |
| interval | `ScheduleConfig.everyMs` — exists |
| timezone | **none, deliberately.** Interval scheduling has no wall-clock boundary, so a zone would change nothing the scheduler does. Durable instants are UTC ISO; display goes through `tools/fleet/zones.ts` (London first). A zone field arrives with the first calendar schedule |
| enabled flag | **new**: `ScheduleConfig.dispatch`, `live` or `dry-run` with a reason (D5) |
| resource class | **derived** from `work.kind`: `session` = a Claude session on the box (rationed by the spacing gate), `rule` = in-process, no model. Not a knob, because nothing would read a knob |
| no-overlap key | **derived**: the job id (an in-flight run holds its own next run) plus the box-wide session spacing. A configurable key would be a field nothing enforces |
| timeout | **the lease** (`leaseMs`), which bounds the *launcher*, shown as that. There is no session run-time limit and the preview says so — the Scheduled-dispatch stage owns watching the child |
| missed-run policy | **a named constant**, `MISSED_RUN_POLICY = "one-run"`: however many intervals were missed, one occurrence on the next tick. It describes `due()`; a planner test holds it |
| versioned | the preview carries `schema: 1`, and a **`listRevision`** — a hash over every job's id, pin, schedule and dispatch mode — so any change to the list is visible as a changed revision. Derived, so it cannot drift from the list |

### D2. One pure per-job planner, used by the tick AND the preview

New `tools/overseer/schedule-plan.ts`, pure: `planJob(job, context) → JobPlan`, where the context is
the occurrence index, arming, the ledger's history state, the last session launch, the launch
separation, a document reader and `now`. It returns what a tick would do with this job **now**:
`history-lost`, `unauthorised` (with the document diff), `dry-run` (would dispatch), `held`
(in flight), `waiting` / `not-yet-eligible` (with the absolute next-due instant), `spacing-held`, or
`dispatch`. The four-gate order is `scheduler.ts`'s own and does not change.

`schedulerTick` is refactored to call `planJob` for its decision and keep only the side effects
(sweep, reserve, spawn, record). The preview calls the same function in a loop that assumes each
`dispatch` succeeds, which is the only difference and is named in the preview's own sentence. **The
simpler option passed over** was a separate preview function beside the tick; it would be a second
copy of the gate order, and the gate order is the thing a preview must not get wrong.

Planner tests, red first where the behaviour is new: **startup** (arming absent → held; armed →
not-yet-eligible until `armedAt + initialDelayMs`, due at exactly that instant); **interval
boundary** (`last + everyMs − 1` waiting, `last + everyMs` due); **missed intervals** (three days
down on a 3h job → exactly one dispatch across repeated ticks, then held while in flight);
**forward time jump** (one run, not a burst); **backward time jump** (next due stays the absolute
`last + everyMs`, never sooner); **an already-running occurrence** (held; released as stuck after
its lease, never retried).

### D3. A session job's documents are re-digested on every tick

`TickInput` gains a **required** `readDocument(path)` (a default would be silent). For `work.kind
=== "session"` the planner digests the job's documents now and compares
`behaviourHash({...behaviour, documents: current})` with the pin; an unreadable document refuses the
job with a sentence. **Rule jobs keep their load-time digests**, deliberately: a rule's "documents"
are the source files of code already loaded into the daemon, so re-reading them would refuse a rule
whose running code has not changed. The false comment in `standingJobs()` is corrected.

What this does **not** close, named: a document edited between the tick's digest and the moment the
session reads it (seconds), or during the session's life. Pinning the material actually handed to
the child is the Scheduled-dispatch stage's first bullet.

Wiring: `daemon.ts`'s scheduler call site passes `readDocument` (one line, not the usage pass), and
`scripts/overseer.ts`'s `schedulerWiring` supplies it.

### D4. Per-document pins, so a changed document is named

`AuthorisedJob` gains `authorisedDocuments: readonly JobDocument[]` — the full sha256 of each
document as it was when pinned. The gate is still the behaviour hash; the document pins exist so a
refusal can say *"feedback-reports.md: pinned 1a2b…, now 9f8e… — edited since it was authorised"*
rather than *"the fingerprint moved"*. A test ties the two pins together:
`behaviourHash({...behaviour, documents: authorisedDocuments}) === authorisedHash` for every shipped
job, so a half-done re-pin is red. Rule jobs get the same field from `ruleJobs()` (their load-time
digests), so the type needs no optional.

**The simpler option passed over:** keep one pin and say only "the fingerprint moved; its document
is X". With one document per job that is usually right and never provable, and "a changed job
document is visible" is the roadmap's acceptance sentence.

### D5. `dispatch: live | dry-run`, outside the fingerprint, and one fixture job

`ScheduleConfig.dispatch` is `{ kind: "live" } | { kind: "dry-run"; why: string }`. A dry-run job
goes through every gate; where a live one would reserve and spawn, it reports **`dry-run`** —
*"due now; dry-run, so nothing is reserved or launched"* — and writes nothing to the ledger, so it
also never counts against the spacing gate. `eligibilityOf` calls it ineligible, so the `ARMED`
headline cannot be earned by a job that will never launch. The existing two jobs are `live` (no
behaviour change); the rules in `rule-jobs.ts` are `live`.

**Outside the hash, and that is a trade-off to name.** Flipping a job from dry-run to live enlarges
what runs unattended without a re-pin. It is outside because it is a *when/whether* knob like the
schedule (Greg's S8-1 decision: a schedule edit must not need a re-pin), because hashing it would
re-pin both of Greg's jobs for a field that does not change what they do, and because the flip is
itself a reviewed commit to `schedules.ts`. Sol is asked to weigh this.

**The fixture: `schedule-fixture`.** A session job whose document is
`tools/overseer/schedule-fixture.md` — one paragraph telling a session to reply one line and stop,
touching nothing — `dispatch: dry-run`, every 24h, lease 1h, first run 2h after arming. It exists so
the preview has a harmless job to show in every state, so editing its document demonstrates the
changed-document display end to end, and so the Scheduled-dispatch stage has a pre-pinned "one safe
occurrence" to flip to live. Flipping it is not this stage's call (see *Needs Greg*).

### D6. The preview is computed on demand, not written by the daemon

`tools/overseer/schedule-preview.ts`: a pure `schedulePreview(input) → SchedulePreview` plus one
reader, `readSchedulePreview({ repoRoot, storeDir, now })`, which gathers the inputs: the job
definitions built from the checkout **now** (`standingJobs` + `ruleJobs`), the occurrence index and
history from the checkpoint (`jobs.occurrences`, as of its `writtenAt`), `armed.json`, and the
daemon's own scheduler sentence. Bounded reads of files whose size we know (the checkpoint is
~110 KB today), so it may run inside a route handler.

**The simpler-looking option passed over:** have the daemon compute the preview each tick and put it
in the checkpoint. It would be exactly the daemon's view, but a disarmed daemon has no scheduler
timer to compute it on, and it touches `store.ts`'s checkpoint schema, `daemon.ts` and the pushed
payload — three shared files — for a panel that is read rarely.

**What the on-demand preview cannot know**, said in its own headline: which capabilities the running
daemon holds (`rules-only` vs `all`) beyond the daemon's own sentence, which it quotes. Per-job
verdicts are *"if armed with every capability, now"*.

### D7. Surfaces: `overseer status` and a section on the Overseer tab

- **CLI.** `overseer status` gains a `schedule` block after the scheduler line: per job, the
  verdict, next due (UTC and London), last attempt and result, dispatch mode, and the prompt
  revision (behaviour hash, pin, and each document's digest). `schedulePreviewLines` lives in
  `schedule-preview.ts`; `scripts/overseer.ts`'s `status` case calls it.
- **Browser.** A **section on the Overseer tab**, directly under the status card that already
  carries the scheduler line — not a new tab, which is six registrations in three files for
  something that is one card. `SchedulePreview.tsx` fetches `GET /api/overseer/schedule` through a
  typed client with an injectable seam (`schedule-client.ts`, the `HistoryApi` shape), on mount and
  every 60 s. Wire types appended to `wire.ts`. The route lives in `tools/fleet/routes-schedule.ts`
  with a pure payload function and a `makeSchedule()` composition in `schedule-wiring.ts` so a join
  test drives the same construction `server.ts` mounts (the admission pattern).
- **Outside the brief's file set, named:** `server.ts` gets the composition line and one mount
  line; `OverseerPanel.tsx` gets a defaulted `scheduleApi` prop and one mount line, merged after
  `action-receipts`' ReceiptList if that has landed.

Absence is stated: a checkpoint that is absent or unreadable, an unreadable document, an armed.json
that is missing (the daemon is off, so first runs are dated *"2h after it is armed"*), and "this page
could not reach the route" are each their own sentence.

## Stages

Implementation goes to Opus/Fable subagents, not Codex — the brief's account note of 2026-09-10:
Codex is the tighter budget. Sol does the plan review and one review per stage.

### Stage 1 — the planner, dry-run, re-digest, document pins, the fixture, the CLI

- [ ] `schedule-plan.ts` `planJob`; `schedulerTick` refactored onto it; the planner tests of D2.
- [ ] `ScheduleConfig.dispatch` + validation; `dry-run` report arm; `eligibilityOf` treats dry-run
  as ineligible; rules and the two standing jobs `live`.
- [ ] Required `readDocument` on `TickInput`; session documents re-digested per tick; the false
  comment corrected; wired through `schedulerWiring` and `daemon.ts`'s tick call.
- [ ] `authorisedDocuments` on `AuthorisedJob`; the pins-agree test.
- [ ] `schedule-fixture` job, its document, its pins; the shipped-jobs tests updated.
- [ ] `schedule-preview.ts` (`schedulePreview`, `readSchedulePreview`, `schedulePreviewLines`,
  `listRevision`, `MISSED_RUN_POLICY`) with tests; `overseer status` prints it.

### Stage 2 — the browser section

- [ ] `wire.ts` block; `routes-schedule.ts` + `schedule-wiring.ts` + mount; `schedule-client.ts`
  parser and seam; `SchedulePreview.tsx`; `OverseerPanel` mount.
- [ ] Tests: route payload over a fixture store and repo; the join through `makeSchedule()`; the
  parser (every arm, unknown kinds unreadable rather than thrown); the section drives the seam, draws
  each absence, and times go through `zones.ts`.

### Stage 3 — docs and close-out

- [ ] `overseer.md` § The standing jobs: the preview, the fixture, dry-run, per-tick re-digest.
  Factual, not a change to a rule. `cron-scheduler.md` untouched (it says the box scheduler is not
  the app's, which stays true).
- [ ] Full suite through `tmux-job`, typecheck, lint of touched files; the roadmap row updated;
  debrief to the Overseer.

## Not doing

Launching anything; arming; calendar schedules and a timezone field; a configurable no-overlap key;
a session run-time limit; recording dry-run occurrences in the ledger (a new event kind in the store
for a job that never runs); a new dashboard tab.

## Needs Greg

- **The fixture job's definition** — prompt, daily cadence, dry-run — is a job definition he has not
  seen. It is inert as written; making it `live` for the next stage's first end-to-end run is his.
- **Whether `dispatch` should be inside the fingerprint** (D5), if Sol argues it should.
