Reviewed revision `004a12eb60172faf0cb75214799dfdc6a86082e1`.

Verdict: block the plan. I found no definite P0, but eleven P1s. The most serious issue is architectural: prose gates cannot constrain an Overseer that retains unrestricted Bash, `tmux send-keys`, and passwordless sudo.

## Findings

### S1 — P1 — Gate 3 is circular and does not constrain indirect actions

**File:** [the plan](/home/greg/code/spideryarn2/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:146), [overseer-direction.md](/home/greg/code/spideryarn2/docs/project/overseer-direction.md:170)

**Failure sequence:** The Overseer creates an intent, adds it to a queue, then asks “is it in the queue?” The answer is yes, so it may send an innocuous-looking instruction such as “finish this work” to an unrestricted coding agent. That agent can deploy, mutate production, delete branches, alter system services, or remove a worktree. Gate 3 inspected the transport—a queued message—not its consequences.

The standing direction had the right objection: a prohibited list must be kept complete. The plan reverses that decision without adding a mechanism that can make the list complete.

Missing categories include:

- Telling another agent to perform a forbidden action.
- Destructive or history-rewriting Git operations; branch/tag deletion; force-pushes.
- Writes outside the branch: primary checkout, credentials, `.env`, home-directory state, systemd, provisioning and fleet configuration.
- External communications or account actions: email, issues, PRs, comments, publishing, credential rotation.
- Self-modification of the gates, queue, authorization records, logs, watchdog or action flag.
- Reboots, shutdowns and arbitrary process/service control.
- Closing a session before debrief, or while delivery is `partial`/`unknown`.
- Acting from a stale or subsequently changed scheduled-job definition.
- Any destructive action delegated through generic prose rather than an enacted action.

**Do instead:** Separate proposals from authorizations. An executable queue entry should have immutable provenance—authorizer, source revision/hash, scope, permitted capabilities, cost bound and expiry—and the Overseer must be unable to promote its own proposal into that queue. Unattended operation should use a narrow broker API; raw shell, raw tmux and sudo make the claimed gate non-mechanical.

### S2 — P1 — Gate 2 requires knowledge that does not exist at dispatch time

**File:** [the plan](/home/greg/code/spideryarn2/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:162)

**Failure sequence:** A task such as “add reader preferences” appears branch-local when dispatched. During implementation, the simplest design becomes a database field, prompt change or changed product promise. Gate 2 has already admitted the work. It either silently permits the lasting decision or must classify nearly every coding task as potentially lasting and escalate everything.

“Outlives the branch” is therefore not decidable at dispatch. All merged code can outlive its branch; the material distinction only becomes visible in a proposed design or diff.

**Do instead:** Use two gates: authorize investigation/planning first, then inspect a declared effect manifest and the actual proposed artifacts before implementation or push. Durable schema, prompts, policy text, public copy, reader data, external state and intentionally dropped cases should be conservative mechanical triggers. Unknown must wait.

### S3 — P1 — Gate 1 has no implementation stage and can silently disappear

**File:** [the gates](/home/greg/code/spideryarn2/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:157), [Stage 1](/home/greg/code/spideryarn2/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:221), [store.ts](/home/greg/code/spideryarn2/tools/overseer/store.ts:149)

**Failure sequence:** The Overseer makes a product assumption and sends work. No durable decision event is required before delivery; the current store only understands fleet/session events. The process then restarts or its console output rotates. The morning assumption log is empty, while Stage 1 can still be declared done because it only writes instructions and a skill.

Even the attribution statement is not literally true: [renderSpoken](/home/greg/code/spideryarn2/tools/fleet/actions.ts:522) intentionally emits slash commands such as `/compact` without the Overseer prefix.

**Do instead:** Add a typed durable event and a fail-closed append before dispatch: decision ID, speaker, source authorization, assumption/fact/decline, affected occurrence, status and supersession. Test that a failed append prevents delivery. Rendering the morning UI may remain separate; writing the record cannot.

### S4 — P1 — The existing four action gates are human-interface checks, not Overseer safety gates

**File:** [session action route](/home/greg/code/spideryarn2/tools/fleet/routes-actions.ts:1092), [kill-session planner](/home/greg/code/spideryarn2/tools/fleet/actions.ts:815), [box action route](/home/greg/code/spideryarn2/tools/fleet/routes-actions.ts:1396)

**Failure sequence:** A session has dirty or unpushed work. An autonomous caller posts `confirm: true`; run mode and `FLEET_ACT_ENABLED=1` are set, and the dashboard’s in-memory delivery queue is empty. `planKillSession` checks only the tmux identity/name pair, so the session is killed. Nothing verifies dirty state, unpushed commits, debrief completion or outstanding `partial` delivery.

`confirm: true` proves only that the caller sent a Boolean. Box actions do not even have the fourth queue gate. A new CLI could also call planners/executors below the HTTP policy layer.

**Do instead:** Put HTTP, CLI and scheduler behind one execution broker. Give confirmation an unforgeable human authorization record. Define per-action preconditions; session termination should require fresh identity, repository/worktree state, pushed ancestry, debrief status and no `partial`/`unknown` input. Do not export a lower-level “run plan” path that bypasses these checks.

### S5 — P1 — The claimed occurrence identity is not provided by the store’s three-write ordering

**File:** [Stage 2](/home/greg/code/spideryarn2/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:232), [daemon take ordering](/home/greg/code/spideryarn2/tools/overseer/daemon.ts:786), [store append](/home/greg/code/spideryarn2/tools/overseer/store.ts:1729)

**Failure sequence:** The daemon durably writes “dispatched,” then crashes before spawning. Restart sees the occurrence and suppresses it: recorded once, ran zero times. If recovery retries such uncertain occurrences, a crash after the spawn succeeded but before acceptance/completion became durable produces two processes.

The existing three writes are:

1. Append and fsync fleet transition events.
2. Save a snapshot baseline.
3. Checkpoint the fold/cursor.

That ordering protects snapshot differencing. There is no job occurrence schema, executor claim or atomic relationship with process creation.

**Do instead:** Use a deterministic key such as `(job ID, scheduled instant, authorized-definition hash)` and states including `reserved`, `accepted/started`, `finished`, `refused` and `unknown`. The executor must durably claim the occurrence before side effects, ideally through an idempotent receiver or named systemd transient unit. Never automatically retry `unknown` external effects.

### S6 — P1 — Reusing the overlap promise permits permanent silent suppression

**File:** [scheduler design](/home/greg/code/spideryarn2/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:93), [daemon overlap guard](/home/greg/code/spideryarn2/tools/overseer/daemon.ts:1156)

**Failure sequence:** A scheduled job returns a promise that never settles—for example, a hung model subprocess. The in-memory running field remains non-null forever. Every later tick correctly “avoids overlap,” the daemon heartbeat remains healthy, and that job never runs again.

**Do instead:** Persist a lease with a deadline, expose overdue leases as `stuck`, and alarm. Time out or abort local work where safe; classify external side effects as `unknown` rather than retrying them blindly.

### S7 — P1 — Stage 4 can recreate the load-391 incident

**File:** [Stage 4](/home/greg/code/spideryarn2/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:264), [A13](/home/greg/code/spideryarn2/docs/project/overseer-direction.md:1073)

**Failure sequence:** Thirty deferred heavy jobs observe one low-load sample. Each independently passes “vitals now allow it,” and the drain launches all thirty before the next sample reflects their cost. The proposed acceptance check—watching a queued job drain after load falls—passes.

**Do instead:** Reserve capacity durably before launch. Use workload classes and hard global caps that count queued-to-start, starting and child processes; launch at most one new heavy job per settled observation window; use hysteresis and fail closed on stale/unknown telemetry. The safest first policy is one heavy test/browser/review workload globally.

### S8 — P1 — The existing resource broadcast skips the agents most likely to consume resources

**File:** [Stage 3](/home/greg/code/spideryarn2/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:246), [broadcast route](/home/greg/code/spideryarn2/tools/fleet/routes-actions.ts:1555), [queue gate](/home/greg/code/spideryarn2/tools/fleet/queue.ts:390)

**Failure sequence:** Several working agents run test suites. Resource pressure triggers a broadcast. `drainGate` classifies working sessions as held, so the broadcast reaches idle recipients while omitting the actual consumers. The route can return success because some deliveries succeeded; the held messages are not durably queued for later.

**Do instead:** Treat resource-control requests as durable per-recipient intents, or control identified test processes directly. Completion must be based on a later process/resource observation—not a successful HTTP response or a sent message.

### S9 — P1 — Kill actions can report success when every kill failed

**File:** [runPlan](/home/greg/code/spideryarn2/tools/fleet/routes-actions.ts:625), [kill route](/home/greg/code/spideryarn2/tools/fleet/routes-actions.ts:1503), [kill planner](/home/greg/code/spideryarn2/tools/fleet/actions.ts:866)

**Failure sequence:** Every SIGTERM step fails because the PID exited/reused, permission changed, or the invocation failed. The steps are `best-effort`, so `runPlan` still sets `completed: true`; the route returns the original PIDs as `killed`. Stage 3 can consequently log that it relieved pressure while doing nothing.

**Do instead:** Return per-PID `requested`, `gone`, `still-running`, `changed-identity` or `unknown`. Re-scan identities/processes after the grace period. Only call a PID killed when disappearance is observed.

### S10 — P1 — Stage 5 does not yet define a real reboot recovery protocol

**File:** [Stage 5](/home/greg/code/spideryarn2/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:273), [provisioning](/home/greg/code/spideryarn2/infra/hetzner/provision.sh:1496), [gjd-remote resume](/home/greg/code/spideryarn2/scripts/gjd-remote.ts:5548)

**Failure sequence:** On reboot, the repository’s Overseer service may start, but provisioning deliberately does not enable the fleet dashboard it reads from. The daemon can heartbeat while receiving no current snapshots. Meanwhile `gjd-remote resume` only attaches to an existing tmux session; it does not run `claude --resume` after all tmux sessions disappeared. The recovery system is alive but deaf and restores nothing.

There is also no Stage 5 “Done when” test.

**Do instead:** Define service dependencies and source-freshness health, then build a purpose-specific launcher using the verified conversation ID, repository, worktree, branch and authorization revision. Recovery should be capacity-limited and start in inspect/propose-only mode.

### S11 — P1 — An on-box systemd timer is not the A27 dead-man

**File:** [Stage 2](/home/greg/code/spideryarn2/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:240), [A27](/home/greg/code/spideryarn2/docs/project/overseer-direction.md:1075)

**Failure sequence:** The host loses power, networking, kernel scheduling or systemd itself. The daemon and its watcher disappear together. No failure is recorded and nobody is notified.

**Do instead:** Keep the systemd timer as a local watchdog, but use at least one off-box check for A27. It is minimally sufficient if it checks externally observable freshness, delivers an alert through an independent path, and is periodically tested by deliberately stopping the service or host endpoint.

### S12 — P2 — Gate 4 is not an executable budget

**File:** [Gate 4](/home/greg/code/spideryarn2/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:173)

**Failure sequence:** Multiple scheduled jobs, question routes and recovery items each make a locally “bounded” number of model calls, but together launch dozens in one tick. Every component satisfies the prose rule while the total spend and load are unbounded.

**Do instead:** Define global concurrency, token/cost and wall-time budgets shared across scheduling, routing and recovery, with durable reservations and an explicit exhaustion state.

## Occurrence crash windows

| Crash window | Actual result |
|---|---|
| Before the occurrence append completes | No durable decision; restart may recompute the due run. |
| After pre-dispatch append, before spawn | **(a)** Recorded as dispatched, never ran. |
| After spawn may have succeeded, before a post-spawn acknowledgement | Retry gives **(b)** two runs; no retry leaves an uncertain or lost occurrence. |
| After the child performed effects, before completion was recorded | Exactly the same ambiguity, now potentially involving non-idempotent effects. |
| “Ran once but recorded never dispatched” | The plan appears to prevent **(c)** only by naming the pre-spawn intent “dispatched.” With truthful states, this is a `reserved` occurrence whose execution outcome is unknown. |

The three-write ordering does not make the external spawn window rarer. It makes the pre-spawn record durable.

## Recovery eligibility

Never automatically resume:

- Finished, killed, abandoned, cancelled or superseded work.
- Shell and batch sessions without a resumable Claude conversation.
- Missing or mismatched repositories, worktrees, branches or HEADs.
- Work already merged/landed, unless explicitly authorized again.
- Jobs whose authorization definition or prompt revision changed.
- Sessions with duplicate/stale claimed conversation IDs.
- Sessions left with `partial` or `unknown` steering delivery.
- Work stopped at an unknown external side-effect boundary.
- Manual/human sessions.

For candidates, verify the filesystem and Git state, conversation identity, authorization revision and absence of a newer successor. Resume one at a time under admission control, initially with permission only to inspect and propose.

## What is already built versus implied

Already built:

- The action catalogue and guarded dashboard routes—but for human-triggered use, not autonomous authorization.
- Pane identity, dialog/input guards and `none | partial | unknown` delivery.
- The session event store and its snapshot/checkpoint ordering.
- Attention/usage passes and an in-memory overlap guard.
- Process classification and narrow safe-kill rules.
- A strong worktree check and sweep path.
- The Overseer systemd unit and provisioning enablement.
- The launch-mode default correction.

Not built:

- Scheduler/job occurrence storage.
- Exactly-once or honestly-at-least-once execution semantics.
- Durable resource-admission/deferral queue.
- Durable decision and assumption log.
- Autonomous authorization boundary.
- External dead-man.
- Post-reboot Claude launcher.
- Unified CLI/HTTP/daemon execution broker.

Potentially misleading:

- [`forceRemoveThrowawayWorktree`](/home/greg/code/spideryarn2/scripts/worktree-admin.ts:48) is expressly for process-created throwaway worktrees, not agent worktrees.
- [`worktree-check.ts`](/home/greg/code/spideryarn2/scripts/worktree-check.ts:999) openly does not prove preservation of reflog-only commits, ignored file modes or work held only in session context.
- The existing queue is volatile and refuses enacted actions; it is not the Stage 4 queue.
- `gjd-remote resume` attaches; it does not reconstruct a dead Claude session.
- Stage 6’s rename is filler. The CLI is not: it is a security boundary and should be specified earlier as the single broker, or deferred entirely.

I checked occurrence identity and the action-delivery path hardest. What would change my mind is a concrete state machine with fault injection at every append/spawn/ack boundary, plus a single capability broker whose authorization cannot be minted by the Overseer and whose success conditions are observed effects rather than accepted commands. Without those, the plan’s strongest-sounding gates are precisely the ones that permit everything.