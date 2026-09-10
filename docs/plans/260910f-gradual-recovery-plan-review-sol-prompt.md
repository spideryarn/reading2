# Plan review: gradual recovery — resume selected interrupted work (read-only)

You are reviewing a **plan**, not code. Nothing is built yet. Read-only: do not change any file.

**Write your findings FIRST to `docs/plans/260910f-gradual-recovery-plan-review-sol-findings.md`**
(create it as soon as you have your first finding and append as you go), then give your closing
answer. The runner overwrites the `--output` file with your closing message at exit, so the findings
file is the durable record if you run out of time.

## The candidate

- Commit `e1615d30` on branch `worktree-recovery-resume`, one file:
  `docs/plans/260910f-gradual-recovery-resume-selected-interrupted-work-one-at-a-time.md`.
- Read it in full first.

## The spec and the context it builds on (read what you need; this does not limit scope)

- The spec: `docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` § "Stage: Gradual
  recovery — resume selected valuable work" (four checkboxes and an acceptance paragraph), plus that
  file's "Contracts to preserve throughout".
- What it consumes, on `dev` and in this tree: the recovery inventory, plan
  `docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md`, code
  `tools/overseer/recovery.ts` (candidates, `deriveDispositions` → `resumed`),
  `tools/overseer/recovery-view.ts` (`classifyRecord`, evidence, `ResumeEvidence`),
  `tools/overseer/recovery-inbox.ts` (the drop-directory shape), `tools/overseer/daemon.ts`
  (`recoveryTick`, the usage pass), `tools/fleet/recovery-feed.ts`, `tools/fleet/routes-recovery.ts`,
  `tools/fleet/web/src/RecoveryPanel.tsx`, `scripts/overseer-recovery.ts`,
  `scripts/overseer-recovery-drill.ts`.
- What it will consume, **not on dev**: the launch protocol, on branch `worktree-launch-protocol`.
  Read it with `git show worktree-launch-protocol:<path>`:
  `docs/plans/260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md` (its
  "Review dispositions" override its D-sections) and `tools/overseer/launch-protocol.ts`
  (`plan`, `launchOccurrence`, `LaunchOutcome`, the retry rule). The plan's §6 records what that
  session agreed by message: a `tmux-resume` launcher kind carrying `resume: {conversationId, dir}`,
  an admission class `recovery-resume` released on `observed-running`, and consumers holding
  `composeLaunchProtocol(...)`'s `launchOccurrence` rather than `LaunchParts`.
- Existing launch and admission paths: `tools/fleet/routes-new.ts` (health gate, `checkRequest`,
  cooldowns), `scripts/gjd-remote.ts` ~2700–2830 (the `new-claude` job script),
  `tools/fleet/claude-argv.ts` ~230–240 (why `--resume` is unreadable today),
  `tools/fleet/execution-identity.ts`, `tests/fleet-attention.test.ts` ~425 (what `tools/fleet/` may
  import from `tools/overseer/`), `tools/overseer/usage.ts` (`computeUsageVerdict`).

## What to attack

An independent pass first. The acceptance is: **two taps cannot launch two copies of the same
selected recovery; resources limit the pace; unchanged unknowns remain visible** — and nothing
resumes automatically. Look for any path that breaks one of those, and for anything in the plan
that would not build, contradicts the code it names, or contradicts the launch protocol's contract.
In particular, walk the crash and race windows: the tap, the request file, the daemon's pass, the
revalidation, the synchronous launch call, the move to `done/`, a daemon restart at each point, a
dashboard restart, a version skew between the daemon and the dashboard.

Also say whether a materially **simpler** design would meet the spec (the plan names the ones it
passed over; argue with them if you think they are wrong).

## Severity and form

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Mark each finding **established** (direct evidence: an exact source path, a contract the plan
contradicts) or **reasoned** (a load-bearing premise is inferred). Refuse the plan only on an
established P0 or P1. Number findings **G1, G2, …** (the `F` series belongs to other plans in this
area). For each: severity, established/reasoned, the evidence with file:line, and the fix you would
make to the plan. End with a verdict: *ready*, *ready with changes*, or *not ready*.

## My suspicions (already mine, worth less — spend most of the run elsewhere)

1. §2.3's pace rule waits for the inventory's `resumed` disposition. That needs a verified
   conversation from argv, which needs Stage 3's `claude-argv.ts` change. Is there a gap where a
   resumed session is `observed-running` in the launch journal, never `resumed` in the inventory,
   and the queue stalls silently rather than visibly?
2. The request file is named by candidate id, and `refused/` frees the name. Can a refusal race a
   re-tap so that a second request lands while the first is still being decided?
3. §2.6's "synchronous last step" claims nothing can change between the check and the launch. Is
   that true given the transcript search before it is async?
4. Is a second projection file (`recovery-resume.json`) really better than a field in
   `recovery.json`?
