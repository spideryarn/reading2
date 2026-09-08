## Findings

### R1 — P1: Future implementation work could be mistaken for permission to mutate live sessions

Plan sections: “Goal and scope” and “How to execute every stage,” especially [lines 39–42](/home/greg/code/spideryarn2/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:39) and [176–178](/home/greg/code/spideryarn2/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:176).

Observed facts:

- The plan correctly denies autonomous steering, killing, credential switching, and broad recovery.
- It nevertheless instructs implementers how to perform “live delivery proof” with a disposable session. Later stages also call for safe occurrences and service changes.
- The standing autonomy decision permits unattended scheduled jobs only; it does not authorize an implementation agent’s live steering test ([direction](/home/greg/code/spideryarn2/docs/project/orchestrator-direction.md:121)).

Hypothesis: An average implementer could reasonably read the plan itself as authorization to launch and steer the disposable session.

Correction: State globally that the roadmap is never contemporaneous permission for a live mutation. Fixture-backed executors or an isolated tmux socket are the default. Launching or steering a real session, killing a process, restarting/installing services, changing credentials/accounts, mutating production, or deploying requires separate explicit approval naming the target. The only exception is a scheduled definition Greg has specifically authorized for unattended dispatch.

Why it matters: This closes the exact authority ambiguity called out in the review brief.

### R2 — P1: Several early stages depend on a “full execution identity” that current code cannot provide

Plan sections: “Contracts to preserve,” “Overseer status,” and “Session continuity,” especially [lines 147–149](/home/greg/code/spideryarn2/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:147), [288–289](/home/greg/code/spideryarn2/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:288), and [344–367](/home/greg/code/spideryarn2/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:344).

Observed facts:

- `claudeSessionId` is pinned into the tmux environment at launch ([gjd-remote-tmux.ts](/home/greg/code/spideryarn2/scripts/gjd-remote-tmux.ts:33)).
- The Overseer explicitly documents that a fresh Claude started in the same pane can retain that old claim, so `session-replaced` does not fire ([diff.ts](/home/greg/code/spideryarn2/tools/overseer/diff.ts:288)).
- The browser currently keys detail state by the tmux session handle, while its purported conversation ID may be stale ([types.ts](/home/greg/code/spideryarn2/tools/fleet/web/src/types.ts:200)).
- `panePid` identifies the pane process, not necessarily a new Claude child inside an unchanged shell.

Hypothesis: Keying by the existing tuple would still let a replacement Claude inherit old drafts, transcript results, or historical durations, violating the stated acceptance criteria.

Correction: Add an explicit execution-identity foundation before Overseer joins and Session continuity. Define a discriminated `verified | claimed-only | unknown` identity derived from current process ancestry, an actual Claude process/session ID when verified, and a stable process-start token. Propagate it through the fleet wire, Overseer register, browser keys, and action guards. Until that lands, joins and resets must degrade to unknown rather than claim replacement detection.

Why it matters: The current dependency graph asks downstream stages to enforce an unavailable invariant.

### R3 — P1: Recovery survival is recognized but has no durable, bounded storage design

Plan section: “Recovery inventory,” [lines 591–608](/home/greg/code/spideryarn2/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:591).

Observed facts:

- `tmux-session-gone` deletes the complete `RegisterEntry` from the current register ([store.ts](/home/greg/code/spideryarn2/tools/overseer/store.ts:1219)).
- The gone event retains identity, name, reason, and generation, but not the last complete recovery entry ([diff.ts](/home/greg/code/spideryarn2/tools/overseer/diff.ts:336)).
- Earlier `session-seen` and change events may allow reconstruction by replaying history, but page-time full history scans conflict with the roadmap’s bounded-reader rule.

Hypothesis: “Preserve recovery candidates from the pre-restart register and retained disappearance events” could be implemented as either an unbounded event scan or a volatile in-memory projection that is lost at the next crash.

Correction: Name the durable mechanism and write order. For example, append a recovery-candidate event containing the final complete register entry before/in the same event batch that removes it, fold those events into a bounded recovery register, and expose that register in an atomic daemon-owned projection/checkpoint. Define retention, disposition/supersession, and backward treatment of old logs. Test the crash boundaries as well as the first accepted empty post-reboot snapshot.

Why it matters: Recovery is most likely to lose its evidence during the exact register deletion it is intended to survive.

### R4 — P1: Scheduler and recovery launch receipts are not yet a complete cross-process crash protocol

Plan sections: “Scheduled dispatch” and “Gradual recovery,” especially [lines 570–589](/home/greg/code/spideryarn2/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:570) and [610–623](/home/greg/code/spideryarn2/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:610).

Observed facts:

- Recording intent, reserving admission, and launching cannot be one atomic operation across the daemon store, admission owner, and tmux/wrapper.
- Existing tmux metadata has only version, kind, repo, and directory ([gjd-remote-tmux.ts](/home/greg/code/spideryarn2/scripts/gjd-remote-tmux.ts:61)); there is no occurrence/correlation ID.
- `gjd-remote` records its ordinary launch log only after creating and confirming the session ([gjd-remote.ts](/home/greg/code/spideryarn2/scripts/gjd-remote.ts:2600)).
- The dashboard’s new-session launch records are volatile ([routes-new.ts](/home/greg/code/spideryarn2/tools/fleet/routes-new.ts:94)).
- Current Vitest admission explicitly describes itself as a valve rather than an atomic bound ([vitest-admission.ts](/home/greg/code/spideryarn2/vitest-admission.ts:41)).

Hypothesis: A crash after spawn but before the correlation artifact becomes discoverable could either duplicate a job or hold it unknown forever. “Durable launch receipts” used by gradual recovery also has no clearly named owning stage.

Correction: Add a launch-protocol foundation shared by scheduling and recovery. Specify:

- durable occurrence intent first;
- idempotent admission reservation keyed by occurrence;
- a validated correlation ID carried atomically into each launcher’s initial external effect;
- per-launcher discovery evidence, including completed-and-disappeared jobs;
- explicit journal states at every boundary;
- reservation reconciliation and unknown-without-retry behavior.

For tmux launches, this likely requires a metadata/start-marker change. For headless wrappers, name their correlation artifact separately. Replace “atomically record intent, reserve admission, launch” with the actual ordered protocol.

Why it matters: The current wording promises a property that the described operations cannot provide atomically.

### R5 — P2: Preview-to-commit binding should be an explicit wire invariant

Plan section: “Box contracts,” [lines 211–235](/home/greg/code/spideryarn2/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:211).

Observed facts:

- Current responses have no preview schema, preview ID, expiry, producer instance, or action revision ([routes-actions.ts](/home/greg/code/spideryarn2/tools/fleet/routes-actions.ts:329)).
- The client currently discards `op` and `action` when producing `BoxOutcome` ([actions-client.ts](/home/greg/code/spideryarn2/tools/fleet/web/src/actions-client.ts:907)).
- The plan does correctly require stable process identity, frozen recipients, and re-probing.

Hypothesis: A local component-state implementation could satisfy most bullets while still allowing a preview from one server/action revision to confirm against another after restart or deployment.

Correction: Define the exact preview and commit envelopes. Bind commit to action revision, producer instance, expiry, and a digest or server-issued ID for the canonical reviewed material. The server must reject unknown, expired, restarted, or mismatched previews before effect. Keep the fresh kill re-probe and delivery guards as separate checks.

Why it matters: Destructive confirmation should bind to what the server presented, not only what React remembers.

### R6 — P2: `submitted` is too broad for the proposed outcome vocabulary

Plan section: “Delivery uncertainty,” [lines 237–256](/home/greg/code/spideryarn2/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:237).

Observed facts:

- Queue delivery distinguishes proven-none, partial/unknown, and successful keystroke submission ([drain.ts](/home/greg/code/spideryarn2/tools/fleet/drain.ts:357)).
- Kill currently reports intended PIDs as killed even when the command plan stops, which the plan correctly identifies ([routes-actions.ts](/home/greg/code/spideryarn2/tools/fleet/routes-actions.ts:1547)).
- The plan’s global knowledge contract correctly says keys submitted are not read or completed.

Correction: Replace the shared `submitted` arm with operation-specific unions: keys submitted, command exited, effect observed, partial, refused-before-effect, and outcome unknown. UI copy and counts should narrow on those arms rather than translate one generic state.

Why it matters: Otherwise the implementation can recreate the misleading claims this stage exists to remove.

### R7 — P2: The linear stage order delays resource admission behind lower-value refactoring

Plan sections: priority table and stages after Attention, beginning [line 105](/home/greg/code/spideryarn2/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:105).

Observed facts:

- Greg’s feature order is attention → resources/admission → usage → scheduler.
- After Attention, the document linearly places Session continuity, full Responsive collection, Bounded transport, Source ordering, and Maintainable seams before Resource history and Admission visibility.
- Minimal collection/SSE containment is already scheduled before Attention.

Correction: Provide an explicit executable sequence, not only scores. After Attention and the minimum responsive-collection dependency, move Resource history and Admission visibility forward. Decide whether enforcement is needed. Full transport hardening, source ordering, and maintainability extraction can proceed in parallel or later unless a named dependency requires them.

Why it matters: A less-capable agent is likely to follow document order and spend several stages on infrastructure before the next feature Greg prioritized.

## Verdict

**REVISE**

The overall direction is strong: it reuses current foundations, preserves the one collector and single-writer boundaries, treats uncertain effects honestly, and keeps usage and scheduling behind attention and resources. There is no P0 flaw.

Resolve **R1–R4 before handing the roadmap to an implementation agent**. R5 should also be settled before the destructive-action stage begins. R6–R7 are meaningful roadmap improvements but need not block unrelated early reliability work.

I did not rerun tests: the supplied 364-test baseline was sufficient for this plan-only review, and no files or live state were changed.