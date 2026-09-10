# Code review: gradual recovery, Stages 1 and 2 (read-only, findings only)

You are reviewing **code**. Read-only: do not change any file. This is a large stage, so this round
is findings only. An Opus subagent fixes what you establish, and a narrow check follows.

**Your sandbox cannot write to the tree.** Put the complete findings in your closing answer. The
runner writes that answer to the `--output` file.

## The candidate

Both commits are on `dev` (pushed in `f72a4a7e`).

- **`cfc963eb`**: Stages 1 and 2 together. Its parent in this branch is `b04c2930` (a plan commit).
  `git diff b04c2930 cfc963eb` is exactly this stage's diff, and
  `git diff --name-only b04c2930 cfc963eb` lists its paths.
- **`1704334e`**: the wiring after the merge from `dev`. The daemon's own `accountUsage` feeds the
  pass, and `launch-gate.ts` re-exports `dev`'s account-usage types in place of local copies. See it
  with `git show 1704334e`.
- **Do not diff across the merges** (`bef22460`, and two later doc-only merges). They carry other
  sessions' work.
- Start with the paths in those two commits. The list does not limit your scope: read whatever
  they call.

The plan is `docs/plans/260910f-gradual-recovery-resume-selected-interrupted-work-one-at-a-time.md`.
**Its "Review dispositions: Sol, plan round 1" section overrides §1–§7**, and it is the contract
this code must meet. Its Stage 1 and Stage 2 status paragraphs record the builders' own
decisions. Your plan review is `docs/plans/260910f-gradual-recovery-plan-review-sol.md` (G1–G10).
The briefs are `docs/plans/260910f-gradual-recovery-stage1-task.md` and `…-stage2-task.md`.

**Raw gate output, from the manager's runs on the merged tree:**

```
npm run typecheck                      TYPECHECK_EXIT=0
npx vitest run <15 files: overseer-account-quota-gate, overseer-launch-gate,
  overseer-recovery-resume, overseer-daemon-recovery-resume, overseer-daemon-recovery,
  overseer-recovery, overseer-recovery-view, fixture-ids, fleet-recovery-feed,
  fleet-recovery-route, fleet-recovery-panel, fleet-recovery-wiring,
  fleet-recovery-resume-route, fleet-recovery-resume-panel, fleet-attention>
                                       VITEST_EXIT=0   Test Files 15 passed (15)   Tests 437 passed (437)
npm run build:fleet                    BUILD_FLEET_EXIT=0
```

You may run one vitest file yourself. The sandbox has no network, so do not start servers.

## What to attack

An independent pass first. The acceptance:

- **two taps cannot launch two copies**;
- **resources limit the pace**: the health and account gates, one at a time, and the spacing;
- **unchanged unknowns remain visible**;
- **nothing resumes automatically**.

Find any path that breaks one of those, or that contradicts a disposition. In particular:

- **The synchronous stretch (G5).** Is there truly no `await` between the recapture of the latest
  accepted observation and `port.launch`, and between `launch` and the file moves? Trace every
  callee, including the store write.
- **The occurrence table (G1).** Is every state × reservation-held × disposed combination handled,
  and is it exhaustive by construction?
- **Verification (G2).**
  - Can the next request launch before all four facts hold?
  - Can a transcript line from before the launch count as after it?
  - Which clock is compared with which?
- **The account (G4).** Could a launch reach the port with no pinned account, with the wrong
  account, or on a reading about some other account? How does it cope with a huge or malformed
  `reservations.ndjson`?
- **The quota gate's codename-window rule** in `launch-gate.ts`. Can it be abused? For example,
  could a named window arrive under a different spelling?
- **The request leaf.** Torn writes, symlinks, junk, a crash between launch and move, and a replay.
- **The fleet boundary.**
  - Can a malformed `resume` field hide or alter the records?
  - Does the POST route's origin check match `routes-new.ts`'s?
  - Does any fleet import reach `tools/overseer/store.ts`?
- **The panel.**
  - Can **Resume…** appear except for an interrupted, supported, pinned-account record under a
    wired launcher?
  - Is any manual-instruction text built from an unvalidated id or an unquoted path?

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

1. The Stage 1 builder says `store.ts` **filters** the `resume` projection against the file at
   the one write point, so that Stage 2's strict parser accepts it. A filter that silently drops an
   inconsistent request or preview could hide a pending request from the page. Is anything dropped
   that the page should instead show as unreadable, or refuse?
2. Occurrences in `planned`, `waiting-admission` or `reserved` defer, per the G1 table. If the
   launch protocol never re-drives them itself, the queue waits forever. Is that visible on the
   page with a way out, or silent?
3. An `attempts/<id>.json` file is written synchronously before each launch, to judge transcript
   growth after a crash. Is it written before or after `port.launch`? If after, a crash between
   them loses the baseline.
4. `pendingFor`'s `cannot-tell` lets the route write anyway. Harmless, because the occurrence is
   the guarantee. Correct?
