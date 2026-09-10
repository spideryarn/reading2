# Review: Schedule preview Stage 3 (the Overseer tab's section) — and Stage 2's final state

Repo: /home/greg/code/spideryarn2/.claude/worktrees/schedule-preview, branch worktree-schedule-preview. TypeScript,
ESM, tsx, vitest, React for the fleet dashboard client. The Overseer daemon's scheduler is OFF; nothing here may
launch anything.

## FIRST: write your findings to a file as you go

Before anything else, and again every time you add or change a finding, write your findings so far to
`docs/plans/260910e-schedule-preview-stage3-review-sol-findings.md` (overwrite it whole each time). run-codex overwrites
the `--output` file with your closing message at exit, and the last two reviews on this box died at their time limit
with nothing written — so the findings file is the record, and your closing message only needs to point at it. You have
30 minutes; spend the first two on the findings file's skeleton.

## The candidate

Committed: commits STAGE2_SHAS and STAGE3_SHA — fill-in below
            Stage 2's final state: git diff 27310eb3 STAGE2_LAST   (6b5ce4a9 built it; b0b8ee80 kept a timed-out review's
                                   unreported edits; STAGE2_FIX fixed what an independent check of those found)
            Stage 3:               git show STAGE3_SHA
            changed paths:         git diff --stat 27310eb3 STAGE3_SHA

Start with: tools/fleet/routes-schedule.ts, tools/fleet/schedule-wiring.ts, tools/fleet/web/src/schedule-client.ts,
tools/fleet/web/src/SchedulePreview.tsx, the mount lines in tools/fleet/server.ts and
tools/fleet/web/src/OverseerPanel.tsx — then tools/overseer/schedule-preview.ts, tools/fleet/schedule-parse.ts,
tools/fleet/zones.ts, and the daemon's checkpoint ticker in tools/overseer/daemon.ts. Not the limit of scope.

## What it is meant to do

Plan: docs/plans/260910e-schedule-preview-make-periodic-work-inspectable-before-launch.md (§ D6, D7, Stages 2 and 3).
Task given to the Stage 3 implementer: docs/plans/260910e-schedule-preview-stage3-task.md. Your Stage 1 review:
docs/plans/260910e-schedule-preview-stage1-review-sol.md (findings F1–F3; number new findings from F4).

The contract, stated at its true strength — **is this statement accurate?**, not "is it sound":

> `schedule.json` is what THIS daemon's planner would decide for each job at `writtenAt`, from the list it loaded, the
> documents as they were at that tick, its in-memory ledger, its arming and the capabilities it holds — assuming each
> proposed live session launch in the pass succeeds, including on a disarmed daemon (where the row says it cannot launch
> now). `overseer status` and the Overseer tab both print that file faithfully and say which absence they are looking
> at (no file, another daemon instance's file, an unreadable file, an unknown schema, a route the page could not
> reach). The one parser reads every shape the writer can produce and turns anything else into an explicit unreadable
> arm. The route reads one bounded file and nothing else; writing the file never stops the daemon, dispatches, or touches
> the checkpoint or event log.

## What you can run, and what you may change

You may edit this worktree. Fix what is inside Stages 2–3 — each finding red-first, with the test that reproduces it —
and leave anything wider as a finding for me. Do not commit. List every file you changed at the end. Focused runs only:
`npx vitest run tests/fleet-schedule-route.test.ts tests/fleet-schedule-preview-section.test.tsx tests/fleet-schedule-parse.test.ts tests/fleet-zones.test.ts tests/overseer-schedule-preview.test.ts tests/overseer-daemon.test.ts tests/fleet-imports.test.ts tests/fleet-compile-guards.test.ts`,
`npm run build:fleet`, and the typecheck (`node --import tsx scripts/typecheck.ts` if tsx IPC is refused; judge by exit
code). Never start, signal or reconfigure the dashboard on 8787 or the Overseer daemon; never write to ~/.overseer.
My runs are recorded in the commit messages.

## Attack it

Independently, before the notes below. Break the contract: a file, a store directory, a response or a clock under
which the page or the CLI says something the file does not, calls one absence by another's name, draws a changed
document as unchanged, or throws during render (an instant out of `Date`'s range blanks a whole panel). The route: is
anything read that is not the one file, and is the size bound enforced before the read?

For each finding: ID from F4, severity (P0/P1/P2/P3), established or reasoned; (a) the input I can run; (b) the smallest
change that closes it. P0 data loss / exploitable / broadly unusable; P1 user-visible wrong behaviour or an
authoritative contract violated; P2 design risk, nothing wrong today; P3 prose. Refuse only on an established P0 or P1.

## Known, and my own suspicions — read last

Known and accepted: Finding 4 of the independent check (a throwing document reader leaves the previous `schedule.json`
in place, and the jobs ticker's reader is unguarded) — the real reader returns a result and never throws.

Suspicions: whether the section's row text can be satisfied in tests by a tooltip's `sr-only` span rather than the
thing under test; whether the 60 s poll keeps running when the Overseer tab is not the one showing; whether a very
long prompt or path scrolls the page sideways at 390 px.
