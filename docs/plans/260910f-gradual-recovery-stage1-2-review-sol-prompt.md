# Code review: gradual recovery, Stages 1 and 2 (read-only, findings only)

You are reviewing **code**. Read-only: do not change any file. This is a large stage, so this round
is findings only. An Opus subagent fixes what you establish, and a narrow check follows.

**Your sandbox cannot write to the tree.** Put the complete findings in your closing answer. The
runner writes that answer to the `--output` file.

## The candidate

- Branch `worktree-recovery-resume`. The commits under review are **STAGE-SHAS** (filled in at
  commit time). Read the diff with `git diff PARENT-SHA HEAD -- <paths>`. The complete list of
  changed paths is `git diff --name-only PARENT-SHA HEAD`. **Start with these files; the list does
  not limit your scope.**
- The plan: `docs/plans/260910f-gradual-recovery-resume-selected-interrupted-work-one-at-a-time.md`.
  **Its "Review dispositions: Sol, plan round 1" section overrides §1–§7**, and it is the contract
  this code must meet. Your own plan review is `docs/plans/260910f-gradual-recovery-plan-review-sol.md`
  (G1–G10). The builders' briefs are `docs/plans/260910f-gradual-recovery-stage1-task.md` and
  `…-stage2-task.md`.
- **Raw gate output**, which I ran and which is attached below: typecheck, the focused suites, and
  `build:fleet`. You may run one vitest file yourself. Your sandbox has no network, not even
  loopback, so anything needing a server is mine to run.

## What to attack

An independent pass first. The acceptance:

- **two taps cannot launch two copies**;
- **resources limit the pace**: the health and account gate, the one-at-a-time rule, the spacing;
- **unchanged unknowns remain visible**;
- **nothing resumes automatically**.

Look for any path that breaks one of those. In particular, attack these:

- **The synchronous stretch (G5).** Is there really no `await` between the recapture of the latest
  accepted observation and `port.launch`, and between `launch` and the move of the request files?
  Trace every function it calls.
- **The occurrence table (G1).** Is every state × reservation × disposition combination handled?
  Is it exhaustive by construction (a `never` check), or only by the tests?
- **Verification (G2).** Can a resumed session be counted verified without transcript growth, or
  can a stale transcript line from before the launch count as "after the launch"? What clock is
  compared with what?
- **The account (G4).** Can a resume launch with `auto`, with the wrong account, or with an account
  whose quota was never read? What happens when `reservations.ndjson` is huge, malformed, or holds
  two rows for one conversation?
- **The request leaf.** Torn writes, symlinks, junk in `pending/`, and a crash between `launch` and
  the move to `done/`. Does a replayed request ever reach `launch` a second time?
- **The fleet boundary.**
  - Can a malformed `resume` field in `recovery.json` ever hide or alter the records?
  - Does the POST route's origin check match `routes-new.ts`'s?
  - Does anything on the fleet side import a module that reaches `tools/overseer/store.ts`?
- **The panel.**
  - Can **Resume…** appear for anything but an interrupted, supported, pinned-account record
    under a wired launcher?
  - Is any manual-instruction text built from an unvalidated id or an unquoted path?
  - Does the footer tell the truth?

## Severity and form

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

For each finding, give:

- **An ID.** Number them **G11, G12, …** (G1–G10 are the plan round's).
- **The severity.**
- **Established or reasoned.** Established means direct evidence: a failing run, or an exact
  reachable source path. Reasoned means a load-bearing premise is still inferred.
- **The evidence**, with `file:line`.
- **The fix you would make.**

Refuse only on an established P0 or P1. End with a verdict: *accept*, *accept with changes*, or
*refuse*.

## My suspicions (already mine, worth less: spend most of the run elsewhere)

SUSPICIONS (filled in after reading the builders' reports).

## Raw gate output

GATES (attached at commit time).
