# Findings

## F1 — P1: `planned` and `waiting-admission` occurrences can never be continued

**Claim.** D2 makes both states an open `LastRun` that `due()` holds, while D5 expects the next
planner pass to call `launchOccurrence` again. The planner returns immediately on `held` and never
calls launch. Reconciliation cannot continue it either: when owner lookup says `none`, it does
nothing.

**Evidence.** The plan makes these states open/held
(`docs/plans/260910f-scheduled-dispatch-one-durable-occurrence-one-reconciled-launch.md:91-96`) and
then promises another call for the same key (ibid.:151-157). The planner stops at `held` and reaches
launch only from `due` (`tools/overseer/schedule-plan.ts:384-410`, ibid.:444-449). Protocol
reconciliation records only a reservation found by lookup; `none` returns no decision
(`worktree-launch-protocol:tools/overseer/launch-protocol.ts:1433-1445`) and otherwise leaves these
states alone (ibid.:1468-1472).

**Consequence.** A crash after `plan()` but before reservation, or an ordinary admission wait,
permanently holds the job after capacity returns. This violates the ordered launch contract.

**Smallest fix.** Add a resumable planner state for `planned`/`waiting-admission` that retains the
existing `dueAt`, re-runs applicable gates, and calls `launchOccurrence` with the same origin. Only
`reserved`, `launching`, `observed-running`, and `outcome-unknown` should block. Test restart after
`planned` and waiting followed by free capacity; each must invoke exactly once.

## F2 — P1: D2 merges records, but not ledger authority or reset state

**Claim.** `planJobs` has one global `OccurrenceHistory`, and tick/preview pass the `events.jsonl`
history. D2 only merges launch records into the occurrence index. It neither supplies launch-journal
status for session jobs nor limits legacy history loss to rules. It also projects only
`LaunchRecord`s, while protocol history-reset entries lack the schedule origin needed for the join.

**Evidence.** One lost `PlanInput.history` holds every definition
(`tools/overseer/schedule-plan.ts:299-309`, ibid.:340-346). Tick and preview pass
`store.occurrenceHistory` (`tools/overseer/scheduler.ts:498-508`;
`tools/overseer/daemon.ts:1067-1078`). D2 changes only the merged index
(`docs/plans/260910f-scheduled-dispatch-one-durable-occurrence-one-reconciled-launch.md:83-90`), and
Stage B names no store/history migration (ibid.:296-312). The protocol refuses lost history and
forever refuses a carried id (`worktree-launch-protocol:tools/overseer/launch-protocol.ts:1105-1119`),
but `CarriedEntry` retains only id, last kind, and owner slot (ibid.:310-331).

**Consequence.** Corrupt legacy events block session jobs that no longer write that ledger; corrupt
launch history can leave preview saying due while launch refuses. A carried scheduled id is absent
from D2's projection and can be retried/refused forever without a cadence anchor. The checkpoint
`jobs`, `overseer status`, `reconcile-jobs`, and `UNKNOWN_RETENTION` session semantics remain undefined.

**Smallest fix.** Make history authority per kind: rules consume events/reconcile-jobs; sessions
consume launch status, records, and carried entries. Preserve enough immutable origin in carried
state to attribute and visibly hold scheduled occurrences. Specify checkpoint/status migration and
test each ledger corrupted independently plus a schedule occurrence across `resolve-history`.

## F3 — P1: persisted spacing is anchored to due time, not launch time

**Claim.** D2 times an attempted launch at `plannedAt`. Admission may delay the actual launch for
hours, so after restart the persisted clock may allow another session immediately.

**Evidence.** The proposed anchor is explicit (scheduled-dispatch plan:98-100). Current spacing uses
reservation time because it is the durable commitment to launch (`tools/overseer/jobs.ts:853-872`,
ibid.:887-895). In-memory spacing moves to `nowMs` on launch
(`tools/overseer/schedule-plan.ts:444-449`), exposing the disagreement only after restart.

**Consequence.** Planned 09:00, launched 15:00, restart 15:01 can read the last launch as 09:00 and
start another job inside the separation interval.

**Smallest fix.** Keep nominal time for identity only. Project spacing from durable reservation or
launch-intent time. Test delayed admission followed by immediate post-launch restart.

## F4 — P1: cadence uses a timestamp mutated after termination

**Claim.** D2 settles at `record.updatedAt`; D5 derives the next due time from `lastRun.at`.
`updatedAt` is later overwritten by reservation release.

**Evidence.** The proposed rules are at scheduled-dispatch plan:97 and :155-158. Every transition
replaces `updatedAt` (`worktree-launch-protocol:tools/overseer/launch-protocol.ts:440-452`), including
release (ibid.:546-555).

**Consequence.** Terminal at 10:00 and delayed release at 16:00 moves the next run from 10:00 +
interval to 16:00 + interval. Cadence follows cleanup availability rather than completion.

**Smallest fix.** Retain a stable terminal event time and use it for `LastRun.at`; reserve
`updatedAt` for freshness/display. Test terminal append plus delayed release.

## F5 — P1: D6 precedence hides disposed launches as running or unknown

**Claim.** Disposition is orthogonal to protocol state. D6 tests open states before “disposition
with no exit,” so a disposed record remains `running` or `unknown`, never `interrupted`.

**Evidence.** Open results precede disposition and table order is declared precedence
(scheduled-dispatch plan:173-192). Protocol `disposed` preserves state and only adds disposition
(`worktree-launch-protocol:tools/overseer/launch-protocol.ts:557-560`).

**Consequence.** An attributed operator resolution is not reflected in the visible result, violating
the result and visibly-failed contracts.

**Smallest fix.** Order valid terminal/exit evidence first, disposition-without-exit second, and
nonterminal state last. Test disposition on all three launch-capable open states, with and without a
valid exit.

## F6 — P1: stale pins stop activation, even for a disarmed install

**Claim.** D4 says the two real jobs merely look unauthorised in preview. The supported activation
command hard-fails on any ineligible standing job before considering the requested armed state.

**Evidence.** The plan's claim is at scheduled-dispatch plan:134-147. Activation evaluates all jobs
with full capabilities and stops on any ineligible result (`scripts/overseer-activate.ts:257-280`),
then computes `armedAfter` later (ibid.:296-312). Stage B neither changes activation nor re-pins
(scheduled-dispatch plan:296-312).

**Consequence.** Greg cannot install/restart this version through the supported tool even with
`--disarm`. This is a failure, not the promised visible refusal.

**Smallest fix.** Add activation and tests to Stage B. Stale live-job pins may be warnings when the
result is disarmed, but must block `--arm` or an already-armed result.

## F7 — P1: the answer route authorises by filename shape, not occurrence/evidence

**Claim.** Validating `lo-…` prevents lexical traversal but does not prove the id is a projected
schedule occurrence. Nor does the plan bind served bytes to the regular file/size/hash in exit
evidence. It can serve another launch origin's answer or a later replacement/symlink.

**Evidence.** D7 constructs directly from validated id and “newest attempt” (scheduled-dispatch
plan:212-217); tests omit wrong-origin, symlink, and mutation (ibid.:289-294). The existing route uses
`O_NOFOLLOW | O_NONBLOCK`, verifies regular file and size, then reads the same descriptor
(`tools/fleet/routes-schedule.ts:86-123`). Every API segment is attacker-controlled
(`docs/project/security-map.md:13-17`).

**Consequence.** This is not a durable link to the result shown. A valid recovery id crosses the
intended join; replacement changes the judged result; a symlink can serve another readable file.

**Smallest fix.** Resolve id/attempt from the parsed schedule projection, require schedule origin,
and obtain expected bytes/hash from exit evidence. Open fixed `answer.md` with
`O_NOFOLLOW | O_NONBLOCK`, fstat regular/bounded, read the same descriptor, and verify hash/size.
Test positive control, non-schedule id, symlink/FIFO, mutation, and path swap.

## F8 — P1: `tmux kill-session` is not an observed cancellation protocol

**Claim.** D7 says killing the session makes `run-claude` write signalled `exit.json`, but current
wrapper machinery does not guarantee final classification on termination. Its only hooks are SIGINT
and SIGTERM, and they immediately re-signal the wrapper. The protocol addition names
`process.exit`, not this signal path.

**Evidence.** The claim is at scheduled-dispatch plan:226-229. `runChild` catches only SIGINT/SIGTERM
and re-raises them (`scripts/subagent-cli.ts:307-317`). The protocol's outer finaliser promise is at
`worktree-launch-protocol:docs/plans/260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md:306-310`.
D8 has no cancellation row (scheduled-dispatch plan:234-249).

**Consequence.** The printed command can leave no exit receipt, so reconciliation correctly reports
`outcome-unknown`, not `interrupted`. Cancellation is visible text but not a reliable observed result.

**Smallest fix.** Make cancellation a tested protocol operation: use a cooperative signal that is
forwarded, awaited, and finalized, or explicitly handle the signal from destroying the tmux session.
Run the exact printed command in the drill and require signalled exit, `interrupted`, and release.

## F9 — P2: verified-material handoff is unspecified at the tmux boundary

**Claim.** Protocol passes verified bytes, but `tmux-headless` uses `--prompt-file <material>` without
saying how those bytes become an attempt-private file or how the wrapper verifies them.

**Evidence.** See scheduled-dispatch plan:44-49 and :116-132. Protocol re-reads/hashes then passes
bytes to the launcher (`worktree-launch-protocol:tools/overseer/launch-protocol.ts:1248-1259`,
ibid.:1285-1289).

**Consequence.** Passing mutable `material.txt` recreates a verification/use race.

**Smallest fix.** Durably write `VerifiedMaterial.bytes` to an attempt-private prompt, bind hash/size
in intent, and have the wrapper safely verify immediately before spawn. Fault-inject mutation.

# Acceptance attack

- **Restart after real launch before receipt:** the intact launch journal prevents a second attempt;
  D2 preserves that ordinary window. F1/F2 still make the complete integration unsound.
- **Missed day:** one nominal due occurrence avoids replay, so no storm. F4 must supply the stable
  terminal cadence anchor. Nominal `scheduledAt` itself is sound with `lastRunOf`; the key remains job
  + due instant + behaviour revision, with no new collision problem.
- **Failures/answerless visibly failed:** the exit/empty-answer arms are present, but F5 and F8 leave
  disposed/cancelled work incorrectly visible.
- **No scheduled main/prod authority:** delivered. `get-ready-to-deploy` ends at dev
  (`docs/reusable/get-ready-to-deploy.md:3-7`, ibid.:143-150); feedback grants no production write and
  never deploys (`docs/project/feedback-reports.md:52-63`, ibid.:244-248). Timing grants no authority.

# Other checks

- D6 is otherwise sensible, but success should explicitly require `permissionDenials === 0`, not
  treat `null` as evidence of no denial.
- Unknown usage clearing is not a finding: usage attribution is unknown most of the time and the
  roadmap deliberately declined to defer new work on that (`260908f-overseer-and-fleet-improvement-roadmap.md:1275-1289`).
  Positive evidence holds and an actual refusal is recorded. Failing closed would be a new product
  choice.
- Roadmap topics are present, but the continuation path, per-ledger health/reset join, activation
  behavior, evidence-bound serving, and real cancellation drill are missing obligations.

# Verdict

**Refuse.** F1 is an established launch liveness break; F2-F8 add established P1 contract failures.
Revise and re-review the plan. F9 may be fixed in that revision or made an explicit Stage B invariant.
