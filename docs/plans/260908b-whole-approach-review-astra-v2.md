**The direction is worth pursuing, but the live write path has outgrown the original security argument.** I would keep the daemon, the fleet view and one collector. I would change the assumptions around authorisation, approval context, delivery receipts and recovery before adding autonomous coordination.

I read the specified revision, `35e4d36834dc66ca2f2603dfb0e888fb1f36750e`. I changed no files and sent nothing to live sessions. I also ran a small, in-memory experiment against the pinned question parser, described in A9. I have not verified the deployed firewall or tailnet policy.

Value means expected benefit here; effort includes the verification needed to trust the change.

These foundational choices should mostly stand:

| ID | Judgement | Value | Effort |
|---|---|---|---|
| **A1** | **Keep the daemon, with model sessions as bounded actions.** This is the right choice. Let systemd own restart; let the daemon own durable state and reconciliation. A persistent model conversation would introduce another thing whose apparent continuity you have to distrust. | High | Small |
| **A2** | **Build the fleet layer, selectively.** Cross-session attention, resource coordination and history justify custom software. Reimplementing a complete remote terminal or every harness’s conversation UI does not. Keep a handoff to existing tools for complicated interactions; Claude’s documented [Remote Control](https://code.claude.com/docs/en/remote-control) already serves that narrower purpose. | High | Medium |
| **A3** | **Keep one collector, but remove the direct-collection fallback initially.** An unreachable HTTP server can still be collecting. SSE → poll → `collect()` can therefore create two collectors during precisely the failure you wanted to survive. Record the gap and restart the producer. Add shared collection exclusion only if experience justifies the fallback. | High | Small |
| **A4** | **JSONL is defensible for O1, conditionally.** Events plus a checkpoint are reasonable at this scale. “SQLite when a query needs an index” is too narrow a migration criterion: transactional job claims and action bookkeeping may justify it first. Do not build a miniature transactional database merely to avoid a dependency. | Medium | Medium |

The following are **corrections to the thinking**, rather than additional features.

**A5 — “Reachability is enough” needs a much narrower definition. Value: high. Effort: small.**

Access through explicitly authorised devices and SSH credentials is defensible. “Anything on my tailnet may steer every agent” is a poor standing default for this write surface.

The cheapest improvement is a device-specific tailnet policy permitting the dashboard port from Greg’s phone and laptop, while retaining the SSH-forward route. Verify the actual policy: Tailscale supports narrow grants, but also documents a permissive default policy. [Tailscale grant examples](https://tailscale.com/docs/reference/examples/grants).

There is a revealing omission in your borrowed architecture: the dashboard-plan appendix says the reference system **also checks the caller against `owner-logins.txt` before POSTs**. Its write boundary was never reachability alone. Device restriction is more useful than an owner check when every device belongs to Greg.

No login page is required. If you later introduce an internet-facing route, require a device credential or authenticated gateway before writes; a hidden URL is insufficient.

**A6 — Treat the dashboard as a privileged renderer of hostile content. Value: high. Effort: small.**

The current React text rendering is a good decision. Preserve it: no agent-generated HTML, automatic remote images, arbitrary embedded pages or clickable action markup. If links arrive, validate their schemes and make navigation explicit.

Add a restrictive Content Security Policy and anti-framing protection before answer buttons arrive. Origin checks do not stop a malicious page framing the genuine dashboard and tricking someone into clicking it. XSS also defeats CSRF protections. [OWASP clickjacking guidance](https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html), [CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

I am identifying an architectural exposure, not claiming an XSS exploit exists in the current client.

**A7 — Network controls reduce entry points; they do not contain a compromised agent. Value: high. Effort: medium.**

The [box documentation](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/docs/project/hetzner-remote-server-box.md) states that agents share one Unix user with passwordless sudo. Consequently, one compromised coding agent can already reach peers, files and control machinery. A dashboard token stored under that same user would not establish an isolation boundary.

The first meaningful containment work is reviewing which production credentials and privileged operations routine agents actually need. Keep control-service configuration and its deployment out of ordinary writable worktrees. Removing broad sudo requires more care, but it changes the possible damage far more than additional HTTP header checks.

This does not require user accounts or RBAC in the product.

**A8 — Preserve client observations, but stop treating them as evidence of human intent. Value: high. Effort: medium.**

The stale-target design is substantially right: replacing the displayed identity with freshly discovered values would defeat the comparison.

However, **server-side lookup is not inherently wrong**. Looking up an immutable observation previously issued to this client is different from looking up the latest target. An observation ID could bind the target generation, permitted action, displayed question and expiry. The browser pins it while Greg reads; the server compares that observation against live state.

This simplifies the contract and prevents accidentally assembled combinations of fields. It still cannot prove that a human read the page, or detect a malicious client obtaining and submitting a fresh observation. Authorisation must remain separate.

**A9 — “Same question” is not necessarily “same proposed action.” Value: high. Effort: medium.**

This is the strongest concrete finding.

Using the pinned file-write fixture, I changed the proposed file contents from `hello` to `goodbye` in memory. The actual [parser](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/fleet/pane.ts) returned **identical questions and options**: it preserves “Do you want to create notes.md?” and discards the diff.

Therefore the present comparison can accept an answer after the material being approved has changed. The phone can also ask Greg to approve without showing that material.

Approval must bind to the command, diff, destination and permission scope—not merely the final question sentence. If the capture is incomplete, offer a terminal handoff. “Yes once” and “enable auto-approval for this session” deserve visibly different treatment.

**A10 — A live Claude descendant does not prove a safe input state. Value: high. Effort: medium.**

[The message path](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/fleet/steer.ts) accepts working, idle and needs-you statuses, verifies process ancestry, then sends text and Enter. It does not establish that an empty Claude input box currently owns those keystrokes.

Possible consequences include appending to an existing draft, interacting with a modal, or reaching a foreground program. The file acknowledges part of this gap.

For now, make arbitrary prose a narrower capability than answering recognised dialogs. Require a recognised input state, account for existing draft text, and retain a visible refusal when uncertain. Terminal inspection reduces risk; it cannot make check-and-send atomic.

**A11 — Delivery needs an “uncertain” state, not just success or refusal. Value: high. Effort: medium.**

The nonce experiment proves that the transport can work. It does not establish what happened to every subsequent request.

A phone can lose connectivity after keys arrive but before receiving the response. Text can arrive while Enter fails. An identical-looking dialog can recur. The current rate limiter does not deduplicate these cases.

Give each action an ID and distinguish **accepted, keys submitted, reception observed, refused, and outcome unknown**. Repeating the same request should retrieve its receipt rather than send again. Where execution remains ambiguous after a crash, require inspection; never automatically retry keystrokes.

**A12 — Overseer messages must not acquire Greg’s authority by entering as user turns. Value: high. Effort: medium.**

Your successful delivery test establishes that the receiving Claude sees a user turn. That becomes dangerous once the sender is another model.

A worker can encounter malicious instructions, report them to the Overseer, and receive them back as apparently authoritative steering. This is a plausible future failure, not something I observed happening.

Record and display the distinction between **Greg requested**, **Overseer proposed**, and **policy authorised**. A model’s recommendation must not mint approval for itself. Keep authorisation enforcement outside the judgement session, and do not give that session unrestricted write credentials merely because it is called the Overseer.

**A13 — Resource admission should move ahead of richer triage. Value: high. Effort: medium.**

After a load-391/OOM incident, the next useful automation is **declining to start more expensive work**.

Begin with limits on concurrent heavy tests, browser jobs and reviews, plus no-overlap defaults for scheduled work. Attribute consumption to jobs, including children; counting Claude sessions alone misses where much of the resource use occurs.

Use pressure, available memory and swap activity with sustained thresholds and cooldowns. Linux’s [pressure-stall metrics](https://cdn.kernel.org/doc/html/latest/accounting/psi.html) measure time lost waiting for resources and can complement load averages. Defer clever automatic killing. Sleeping an agent or sending SIGSTOP does not release its resident memory.

**A14 — JSONL is not crash-safe “by construction,” and replaying today is wrong. Value: high. Effort: medium.**

The [O1 plan](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/docs/plans/260908b-overseer-store-and-clock.md) rebuilds from today’s events. A restart shortly after midnight loses yesterday’s session register and blocked-since times if those sessions have not changed today.

Use a checkpoint containing the full derived state and last applied event ID, then replay subsequent events across file boundaries. Define tolerated loss on power failure and the corresponding sync policy. A torn tail must also be repaired or sealed before further appends.

Test midnight rollover, disk-full behaviour and actual reboot recovery—not only `kill -9`.

**A15 — Observed state is insufficient for reboot recovery. Value: high. Effort: medium.**

Knowing what was running does not establish what should restart.

You need a logical job ID, an execution-attempt ID, launch recipe, working directory, harness/account context and restart policy. tmux handles and PIDs are current addresses. Claude conversation IDs are useful continuity identifiers, but do not describe how to resume shells or Codex jobs.

Extend the existing `gjd-remote` launch records and start markers rather than inventing another launcher. Also fix the data seam: the current `FleetRow` loses the full directory and metadata that O1 says its register will preserve.

**A16 — “Non-empty” is not a completeness test. Value: high. Effort: small.**

A drained box and a freshly rebooted box can legitimately have zero sessions. Rejecting every empty snapshot can preserve a fleet of ghosts forever.

Distinguish **collection succeeded with zero rows**, **collection incomplete**, and **not collected yet**. The existing sentinel and row-count machinery provides a stronger foundation than plausibility.

Likewise, distinguish source generation and sequence from wall-clock timestamps. “Timestamp advanced” is not a complete freshness contract across clock corrections, restarts and source changes.

**A17 — Alarm semantics must match normal operating conditions. Value: high. Effort: small.**

The pinned client declares data stale after 30 seconds, while collection waits 60 seconds after a roughly 12-second run. Healthy operation therefore spends much of its time alarming. That teaches Greg to ignore the alarm.

Publish the expected refresh deadline and distinguish connection age, observation age and completeness. Keep the two Overseer clocks.

Also collect cheap box health independently of expensive fleet collection: currently health refresh sits after successful fleet collection, so the failure that most needs explaining can prevent a fresh health reading. Preserve one owner, with separate collection schedules.

**A18 — Model confidence should not control authority. Value: high. Effort: small.**

Importance followed by self-reported confidence is a weak basis for deciding whether to interrupt or proceed. Confident mistakes are exactly the ones this rule would promote into action.

Rank primarily by consequence, reversibility, deadline, affected work and evidence. Treat confidence as an annotation until you have measured its usefulness. A high-impact decision deserves scrutiny even when several models agree; a low-impact reversible choice should not automatically interrupt Greg because a model expresses uncertainty.

The following are **additional opportunities** worth considering.

**A19 — Make the phone a decision inbox; keep sessions as a secondary view. Value: high. Effort: medium.**

A ranked list of 36 sessions still makes Greg reconstruct the work.

The main phone screen should answer: **What needs my decision, what happens if I wait, and what changed since I last looked?** Each item should contain the task, blocker, relevant evidence, proposed next step and consequences.

Let Greg open one stable decision card. Do not reorder or replace its options while his finger is approaching them. Preserve drafts and deep links across phone suspension. On desktop, add the broader fleet/resource view and evidence alongside the decision.

**A20 — Interrupt for consequences, not agent impatience. Value: high. Effort: small.**

My proposed default:

- **Wake Greg:** suspected destructive activity, imminent data loss, or an explicitly urgent incident with a useful human response.
- **Notify during waking hours:** a decision blocking valuable work, or persistent loss of fleet visibility.
- **Digest:** completed work, routine failures that safely stopped, quota exhaustion without a deadline, and ordinary resource deferrals.

Group correlated events. Thirty agents hitting one quota limit should produce one incident, not thirty notifications. Acknowledgement and snoozing need durable state. Keep secrets and transcript excerpts out of lock-screen notifications.

**A21 — Grant narrow operational actions before conversational authority. Value: high. Effort: medium.**

After explicit policy approval, the earliest unattended actions should be: defer new jobs, reduce monitoring frequency, deduplicate alerts, and restart a failed dashboard or Overseer under bounded restart policies.

Next, allow bounded diagnostic/review jobs with resource budgets and durable results.

Keep destructive remote-data changes, privilege expansion, deletion of unverified worktrees, and killing uncertain work behind human approval. Cancelling a specifically identified disposable job could eventually be preauthorised.

Do not make generic “keep going,” “pull latest,” “remove the worktree,” or “approve the prompt” unattended buttons. Their consequences depend too heavily on context.

**A22 — Add a small event protocol before agent-to-agent command routing. Value: high. Effort: medium.**

The reference vocabulary is useful, but the first payoff is structured reporting.

Start with `progress`, `blocked`, `decision`, and `completed`, carrying event ID, logical job/attempt ID, short explanation and artifact references. Distinguish self-reported claims from independently observed facts.

A tiny CLI can durably deposit messages into an inbox; the Overseer alone appends the canonical log. It should work while the daemon restarts.

Defer a full READY/LAND/GATE state machine until those transitions have precise meanings. In particular, READY must not silently mean “reviewed, tested, merged and safe to deploy.”

**A23 — Coordinate shared resources and integration, not just conversations. Value: high. Effort: medium.**

Worktrees do not isolate the shared database, dev server, test capacity or Git integration.

Add lightweight declarations such as “using shared test database,” “changing server configuration,” and “ready to land revision X.” Queue heavy checks and integration where contention is costly. Reuse existing commit/merge machinery.

This may save more work than getting agents to exchange more messages. A claim file is initially a coordination aid, not an enforced lock; display that distinction honestly.

**A24 — Record provenance and sparse telemetry, not only status transitions. Value: high. Effort: small.**

Useful records include source identity, observation time, event sequence, task/attempt IDs, action requester, authorisation reference, receipts, deployment version and artifact revisions.

Resource history needs periodic samples as well as threshold events. Otherwise you either lose trends or rename every changing measurement a `health-change`. One sample per box is inexpensive; retain interval peaks to preserve incidents between samples.

Avoid copying whole transcripts or credentials. Store bounded decision evidence where needed, with deliberate retention and restrictive file permissions. Define checkpoint and backup retention before deleting daily event files.

**A25 — A scheduler needs occurrence identity and reconciliation. Value: high. Effort: medium.**

A `dispatched` flag cannot close the crash window between recording a launch and performing it.

Give each scheduled occurrence an ID, record launch intent, and reconcile it against `gjd-remote`’s observed execution. Track completion separately from process creation.

Choose explicit defaults: no overlapping run; bounded retries; skip or coalesce missed occurrences rather than replaying an overnight backlog. Pin the job definition/revision that was authorised, so a document edit does not silently enlarge unattended authority.

Build this when scheduling arrives; reserve the identifiers now.

**A26 — Recovery should produce a recovery queue, not resurrect everything. Value: high. Effort: medium.**

After reboot, show which tasks were interrupted, where their files and transcripts are, what evidence survives, and the proposed next step.

Resume gradually, with resource admission and checks that the worktree still exists and the task remains wanted. Give terminal shells a manual recovery path rather than pretending they are resumable agents.

“Restore 36 sessions” may recreate the incident. The useful target is restoring valuable work with understood state.

**A27 — Something outside the box must notice the box disappearing. Value: high. Effort: small.**

Two local heartbeats cannot report total host failure when Greg’s browser is closed.

Use a minimal external dead-man check through an existing service: the box sends a heartbeat; absence produces an alert. It needs no transcript or task data. Test the alert path deliberately.

Keep SSH as the recovery route and make the operational note sufficient to restart the control services without asking a model on the failed box.

**A28 — Design identifiers for accounts and harnesses now; defer rotation. Value: medium. Effort: small.**

Add explicit `machineId`, harness, account/config reference and capabilities. State separately whether a session can accept messages, answer dialogs, resume, or expose usage.

Do not use the currently logged-in default account as the identity of every existing process.

A transcript 429 is ground truth about a particular event, not permanently current quota state. Its timestamp, account/window and reset still matter. Keep visibility first; defer automatic subscription rotation and unsupported quota APIs.

**A29 — Deploy the control services from a stable, versioned location. Value: high. Effort: medium.**

The dashboard, client bundle and daemon need compatible API versions and a known deployed revision. The visible revision should identify the built artifact, not merely whatever HEAD happens to be when someone asks.

A disposable agent worktree is a poor long-term service installation. Use a stable release location and retain a last-known-good version. Refuse incompatible mutation contracts while preserving diagnostic reads.

This is especially valuable when two agents are independently evolving the producer and consumer.

**A30 — Put a budget and a success measure on the Overseer itself. Value: high. Effort: small.**

Measure interruptions per day, time valuable work spends blocked, completed tasks requiring rework, and resource time spent on supervision.

Bound judgement calls by time, tokens, concurrency and escalation rounds. Cache judgements against unchanged evidence. Thirty-six sessions should not trigger thirty-six model reviews every minute.

Defer exhaustive transcript mining, a general multi-agent chat network, a custom terminal, predictive quota optimisation and multi-box scheduling. Keep polling if it is adequate. None of those is necessary to find out whether this system actually saves Greg attention.

**A31 — Recommended build order. Value: high. Effort: small.**

1. **Constrain and clarify live writes:** A5–A12, especially complete approval context and uncertain-delivery handling.
2. **Prevent another resource collapse:** admission limits and accurate freshness/health signals, A13 and A17.
3. **Build a corrected O1:** checkpoint/replay, complete snapshot semantics and recoverable identities, A14–A16.
4. **Deliver the phone decision inbox and grouped notifications:** A19–A20, with the small reporting protocol from A22.
5. **Add bounded scheduling and guided recovery:** A25–A26.
6. **Expand autonomous coordination only when the receipts, resource limits and observed outcomes justify it.**