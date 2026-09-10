You are reviewing a PLAN, read-only. Do not edit files.

Repo: this worktree. The plan: docs/plans/260910e-schedule-preview-make-periodic-work-inspectable-before-launch.md
The roadmap stage it implements: docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md § "Stage: Schedule preview — make periodic work inspectable before launch" (around line 1510).
The runbook section: docs/project/overseer.md § "The standing jobs".

Read the code the plan leans on before judging it:
- tools/overseer/jobs.ts (due, lastRunOf, behaviourHash, AuthorisedJob, Arming)
- tools/overseer/scheduler.ts (schedulerTick, dispatch, eligibilityOf, schedulerStandingOf)
- tools/overseer/schedules.ts, tools/overseer/standing-jobs.ts, tools/overseer/rule-jobs.ts, tools/overseer/dispatch.ts, tools/overseer/arming.ts
- tools/overseer/daemon.ts around the scheduler timer (search `schedulerTick(`), scripts/overseer.ts `schedulerWiring` and the `status` case
- tools/fleet/admission-wiring.ts and tools/fleet/routes-admission.ts (the route pattern it copies), tools/fleet/web/src/OverseerPanel.tsx, docs/project/fleet-dashboard-modes.md

The conclusion I would least like to be wrong about: **gap 1 in the plan** — that a document edited after the daemon starts is dispatched without a re-pin, because `standingJobs()` digests once at start and the spawned session reads the document on disk. Check that claim against the code (is there anything that re-digests, or re-builds definitions, per tick? does the child really read the primary checkout's file?), and check that D3's fix (re-digest session-job documents per tick; leave rule jobs at load-time digests) is right and complete for this stage.

Also weigh specifically:
1. D2: refactoring `schedulerTick` onto a shared pure `planJob` — does any gate-order or spacing subtlety break (the spacing gate's in-loop `lastLaunchMs` update, the duplicate-id refusal, the history-lost early return, sweep running first)? Is the preview's "assume each dispatch succeeds" loop a faithful preview?
2. D5: `dispatch: live | dry-run` OUTSIDE the behaviour hash. Is that an unacceptable enlargement of unattended authority, given Greg's S8-1 decision that schedule edits must not need a re-pin? Should a dry-run job write nothing to the ledger (so it reads "due now" forever once eligible)?
3. D4: a second pin (full document digests) tied to the behaviour pin by a test — worth it, or ceremony?
4. D6: computing the preview on demand in the fleet server from the checkout + checkpoint + armed.json rather than in the daemon. What can the preview get wrong relative to what an armed daemon would actually do, and does the plan say so?
5. Anything in the roadmap stage's four checkboxes or its acceptance paragraph that the plan does not deliver, or claims to deliver without a mechanism.
6. Anything simpler that gets the same acceptance.

Answer with numbered findings, each P0/P1/P2/P3, each citing file:line for code claims, and end with a one-paragraph verdict: build as planned / build with these changes / rethink.
