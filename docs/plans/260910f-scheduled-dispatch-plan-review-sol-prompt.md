# Plan review: Scheduled dispatch — one durable occurrence, one reconciled launch

You are GPT Sol, reviewing a **plan** (read-only; do not edit anything). Repo: the worktree you are
running in (`.claude/worktrees/scheduled-dispatch`, branch `worktree-scheduled-dispatch`).

## The candidate

- The plan: `docs/plans/260910f-scheduled-dispatch-one-durable-occurrence-one-reconciled-launch.md`
  (committed; `git log -1 -- <that path>` gives the sha). Read it whole.
- The spec it answers: `docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` § "Stage:
  Scheduled dispatch — one durable occurrence, one reconciled launch" (five checkboxes + acceptance),
  and § "Stage: Launch protocol" above it.
- The protocol it consumes is **not on this branch**: read it with
  `git show worktree-launch-protocol:docs/plans/260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md`
  and `git show worktree-launch-protocol:tools/overseer/launch-protocol.ts` (Stage 1, under review;
  the plan's section "What the launch protocol gives us" lists the Stage 2 additions agreed with
  that session by message, which are not yet in any commit).
- The code the plan changes, on this branch: `tools/overseer/scheduler.ts`, `jobs.ts`
  (`Occurrence`, `lastRunOf`, `lastSessionLaunchOf`, `due`, `standingOf`), `schedule-plan.ts`
  (`planJobs`), `dispatch.ts`, `standing-jobs.ts`, `schedule-preview.ts`, `scripts/overseer.ts`
  (`schedulerWiring`), `tools/overseer/daemon.ts` (the jobs ticker, ~line 1340, and the preview
  write, ~line 1060), `tools/fleet/routes-schedule.ts` / `schedule-parse.ts` /
  `web/src/SchedulePreview.tsx` (the pattern the new page copies), `scripts/run-claude.ts` (how a
  headless run ends), `infra/hetzner/systemd/overseer.service`.

## What to do

An independent attack first. The acceptance sentence is: *a restart after real launch but before
receipt cannot create a duplicate job; a missed day does not produce a storm; failed/answerless
jobs are visibly failed; no automatic `main` push or production mutation is licensed by a
schedule.* For each clause, does the design as written deliver it, and where is the crash window,
the race or the wrong join that breaks it? Then the rest: is D2's "one ledger — the launch journal
— for session jobs, projected into the planner's `Occurrence` index" sound against the planner and
preview code as it is; does D5's stable `scheduledAt` (nominal due instant) interact badly with
anything (`lastRunOf` ordering by `scheduledAt`, spacing, the fold's keys, occurrence id
collisions); is D6's precedence ladder right; can D7's answer route be made to serve a file it
should not; is anything the roadmap asks for missing.

**Write your findings FIRST to
`docs/plans/260910f-scheduled-dispatch-plan-review-sol-findings.md`** (before any closing summary;
the wrapper overwrites `--output` at exit), then your closing message.

## Rules

Severity by consequence: **P0** data loss / exploitable security / service broadly unusable;
**P1** user-visible wrong behaviour or an authoritative contract violated (the roadmap's acceptance,
the launch protocol's F1–F13, AGENTS.md); **P2** design or maintainability risk with no wrong
behaviour today; **P3** prose. Refuse only on an **established** P0/P1 — direct evidence (an exact
source path, a contract the plan contradicts), not an inference about reachability. IDs `F1`, `F2`,
… For each: the claim, the evidence (file:line), the consequence, and the smallest fix you would
make to the plan. End with a verdict: *proceed*, *proceed with the listed changes*, or *refuse*.

## The author's own suspicions (worth less; spend most of the run elsewhere)

- D2 deletes the `events.jsonl` session path. Is anything else (the checkpoint's `jobs` field,
  `overseer status`, `reconcile-jobs`, the store's `UNKNOWN_RETENTION`, `lastSessionLaunchOf`'s
  reliance on the definitions) left reading a ledger that session jobs no longer write to?
- D5's `usage-held` treats unknown usage as clear. Is that the wrong default for an unattended
  paid job?
- D4 leaves the two standing jobs unauthorised until Greg re-pins. Does anything (the activation
  preflight, `eligibilityOf`, a test) turn that into a failure rather than a visible refusal?
