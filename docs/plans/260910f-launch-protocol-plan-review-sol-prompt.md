# Review: a plan for one crash protocol shared by scheduled launches and recovery launches

Repo: this worktree (`.claude/worktrees/launch-protocol`), branch `worktree-launch-protocol`.
TypeScript + ESM, run with `tsx`; the Overseer is a long-running daemon on a Linux box
(`tools/overseer/`), the fleet dashboard is `tools/fleet/`.

## The candidate

Committed: the plan file `docs/plans/260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md`
(`git log -1 -- <that path>` gives the commit). It is the only changed path. No code yet.

Start with: the plan; then the spec it answers, `docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md`
§ "Stage: Launch protocol" (line ~1475) and the two consumers § "Stage: Scheduled dispatch" and
§ "Stage: Gradual recovery"; then the code the plan builds on: `tools/overseer/scheduler.ts`
(`launch()`), `tools/overseer/jobs.ts` (`OccurrenceKey`, `Occurrence`), `tools/overseer/dispatch.ts`,
`tools/overseer/store.ts` header, `tools/overseer/lock.ts`, `tools/overseer/jsonl.ts`,
`scripts/gjd-remote.ts` (`metaFlags`, `cmdNewClaude` around lines 2606–2830, `startUnderAdmission`),
`scripts/run-claude.ts`, `scripts/run-codex.ts`, `scripts/subagent-cli.ts` (`runChild`,
`sanitisedEnv`, `answerIsUsable`). The receipt journal it borrows concepts from is
`tools/fleet/receipt-journal.ts`. Those are where to begin, not the limit of scope.

## What it is meant to do

Give the scheduler and (later) recovery one launch protocol such that a daemon crash at any boundary
cannot launch an occurrence twice, cannot lose it, and leaves evidence a restarted daemon can find
without a live tmux session or a transcript scan. The roadmap's acceptance: *one occurrence has at
most one automatic launch attempt while its outcome is ambiguous, one reconciled reservation, and
discoverable evidence even if its child exited before collection.* This stage launches nothing for
real; the only thing driven end to end is a dry-run fixture job on scratch stores and a disposable
tmux socket.

## What you can and cannot run, and what you may change

The tree is read-only. /tmp and the node_modules caches are writable; you can run one test file or a
tsx script, and build a throwaway harness under /tmp (tmux 3.4 is installed if you want to probe
`new-session -e` yourself). No network.

**Write your findings FIRST, as you go, to `/tmp/260910f-launch-protocol-plan-review-sol-findings.md`**
(the repo is read-only for you), and then give the full review as your final answer. The final
answer is what I read; the /tmp file is insurance against your time wall.

## Attack it

Independently, before you read my questions below. The invariant to break: **after any crash at any
point, a restarted daemon never invokes the launcher a second time for an occurrence whose first
invocation may have had an external effect, never holds two reservations for one occurrence, and
never releases a reservation without evidence or Greg's attributed decision.** Walk D4's crash table
and find a row that is wrong or missing; find an ordering in D4/D6 where the evidence the table
relies on is not actually durable at the moment it is relied on; check D6's launcher changes against
the actual scripts (would they break an existing guarantee — stdin, sanitised env, answer
validation, the `-p -` prompt path, `gjd-remote`'s job-script guards?); check that the plan's
refusals (holed journal refuses `plan()`; `cannot-tell` never moves a record) do not wedge the
system with no way out; and say whether any stage is bigger than it is worth — including D5's
separate admission store, which the plan names as the first thing to cut.

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the concrete scenario the plan does not handle, or the authoritative contract it contradicts
  - (b) the smallest change that closes it — exact replacement wording for the plan

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1, and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

1. D4's "crash after `reserved`" row calls it `failed-before-launch` because the launcher is only
   invoked after `launching` is durable. Is that ordering actually enforceable in the code shape I
   describe, or can a launcher be invoked from a path that skipped the append?
2. D7's identity check uses `/proc/<pid>/stat` start ticks plus the boot id. Is `gone` safe to act on
   (it releases the reservation), e.g. for a tmux job script whose recorded pid is the script's own
   `bash` rather than Claude — if the script `exec`s or its pid is reused?
3. D10 leaves `schedulerTick` untouched. Is that a defensible cut for this stage, or does the
   roadmap's acceptance ("Both Scheduled dispatch and Gradual recovery consume this foundation")
   require the scheduler to route through it now?

Do not change any file in the repo.
