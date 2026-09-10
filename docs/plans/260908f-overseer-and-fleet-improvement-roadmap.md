# Make the Overseer and fleet dashboard useful, dependable, and cheaper to run

Status as of 2026-09-09 01:00 UTC: **implementation in progress, run by the Overseer** — landed on `dev`: Baseline (2aed1a48, census table below), Overseer status (5cf9a7ee), Failure containment (857ca301), **Usage visibility (af1ec002: `usage-feed.ts`, `zones.ts` UTC/London/Athens, `UsagePanel.tsx`, session closed; the new-job deferral half of its checkbox 3 deliberately not built — the signal is `unknown` on this box most of the time; live on 8787 after the next dashboard restart)**; **Execution identity (8ed9ae59: `execution-identity.ts`, `FleetRow.execution`, `session-execution-changed`, `RegisterEntry.verifiedExecution`; no schema bump; live only after the dashboard and daemon restart; session closed)**; next for dispatch when usage allows: Work evidence (its probe machinery now has a production caller), Responsive collection (the identity pass costs 236 ms over 26 sessions); Delivery uncertainty is with the `claude-agents-dashboard` session (its Stages 1–3: 0b2fee1e, 082d91aa, 854fac4b); dispatched 2026-09-08 22:50 UTC: Execution identity (session `260908f-roadmap-exec-identity`) and Usage visibility (`260908f-roadmap-usage`, which also carries Greg's London/Athens clock). Attention inbox and Attention completeness are **already met** per the census (attention-pass.ts, model-driven detector, AttentionPanel) and will not be dispatched; Work evidence waits for Execution identity because both use the same probe machinery. The log is [260908i](260908i-overseer-decision-log-for-the-two-astra-plans.md). Status as of 2026-09-08 evening: **implementation started, run by the Overseer** — Overseer status
**landed** (5cf9a7ee, session closed); **Baseline landed** (session `260908f-roadmap-baseline`);
Failure containment is with `260908f-roadmap-failure-containment`; the log is
[260908i](260908i-overseer-decision-log-for-the-two-astra-plans.md). Earlier status: researched
proposal; implementation had not begun.

**Start at [§ Shipped / built-not-wired / proposed](#shipped-built-not-wired-proposed-at-77c7a502)**,
which Baseline produced — the picture of the code at `77c7a502`, superseding the dated findings table
wherever the two disagree. Four stages turned out to be finished already, and the scheduler to be
built and merely disarmed; that section says which, and what it does to the order.

The baseline originally inspected was `4adcdfd62703b6565a27a03c50f20f8a215f1bd8`; the shared checkout
may advance underneath it. The original reconciliation checked `3e2e3bd4`; the Fable revision also
checked subsequent dictation integration at `3ba58fc5` (see below). Evidence includes source inspection, two independent subsystem audits,
a focused test run, a read of the real checkpoint's metadata, and primary technical references.
Review results and limitations are recorded at the end. An unchecked box below does not imply that
its entire subsystem is absent: many stages deliberately connect machinery that already exists.

Up: [plans.md](../project/plans.md). Governing direction:
[overseer-direction.md](../project/overseer-direction.md).

## Goal and scope

> Write a rich many-step plan to improve the orchestrator-and-web-interface code and functionality
> (prioritising the various suggestions by a combination of ease and value), with enough research
> and detail that another less-capable agent could follow it correctly.
>
> — Greg, 2026-09-08

Make the web page answer four practical questions: **what needs my attention, what actually
happened when I pressed that, is supervision still working, and can the box afford more work?**
Then add usage visibility and dependable periodic work. The actor is the **Overseer**; the web
interface is the **fleet dashboard**. Existing code still uses `OrchestratorPanel` and the
`orchestrator` URL fragment. There is no reason to rename those as part of this work.

Preserve Greg's explicit ordering:

> attention triage, then perhaps box vitals and throttling, then account usage limits, then scheduler
> (ideally we'd build a bunch of these in parallel with engineering-manager.md)
>
> — Greg, 2026-09-08, [direction](../project/overseer-direction.md#the-order-of-work)

The first repairs make existing buttons and monitoring trustworthy; they are not a new security
programme ahead of attention. Put a useful attention view in Greg's hands before building durable
receipts, a job admission framework, or model-driven coordination. Each stage has a stopping point.
The later stages are a menu after those milestones, not permission to build every possible feature.

**Executable default after Fable's review:** use these delivery cuts, then consult each named stage
for its tests and acceptance criteria. Section order is a reference order, not a single dependency chain.

- **First useful delivery:** Baseline's small fixes → Failure containment → the read-only Overseer
  status card. Stop and ship a page that honestly reports supervision and stale data. Full execution
  identity, process kills, work classification and prose inference do not gate this delivery.
- **Attention delivery:** render the daemon's mechanical Attention list, then integrate Wave 2's
  prose detector. Wire Work evidence alongside it as enrichment. Ship the mechanical slice as useful
  but incomplete; only the prose slice completes the commissioned attention milestone.
- **Parallel control repairs:** Delivery uncertainty can start independently. Fix Box contracts with
  its identity safeguards before enabling repaired destructive/targeted confirmations; keep these
  prerequisites off the read-only path. Session continuity follows verified execution identity.
- **Next product delivery:** Resource history → Admission visibility → Usage visibility. Measure
  whether enforcement is needed; it is not an automatic prerequisite for showing usage. Continue
  the already commissioned Wave 2 work in parallel and integrate anything already proven.
- **Later, when needed:** durable receipts and launch admission → scheduling; selected recovery and
  proposed assistance follow their stated dependencies. There is no obligation to build the menu.

Each delivery is a valid stopping point. Finishing the status card does not claim that attention,
the repaired controls, or the active Wave 2 commitments are complete.

**This plan does not authorise autonomous steering, permission approval, arbitrary process kills,
account switching, or automatic resumption of all sessions.** The standing autonomy decision permits
scheduled jobs only. **This document is not an instruction to start implementation or mutate live
sessions.** A later implementation request authorises the reversible, isolated test work within its
scope; use fixture executors and a separate disposable tmux socket by default. Changing an existing
shared session/service, account, or production system requires the target-specific authorisation
applicable to that action. Carry forward authorisation already given; do not repeatedly ask for it.
A scheduled definition must have been specifically authorised for unattended dispatch. Prepare a concrete proposal
before asking for a new product choice; do not ask Greg to approve routine implementation details.

## Reconciliation with work already landing

At the final fetch, `dev` had advanced to `3e2e3bd4`; it was fast-forwarded without changing peer
work. The findings table remains a dated baseline, while these corrections govern implementation:

- `1534a908` introduced **`tools/fleet/wire.ts`** and migrated queue shapes to it. Extend that
  types-only, import-free leaf; do not create a competing contract module. Other endpoint migrations
  are still work, and a browser-parsed view may deliberately be weaker than its wire type.
- `65c89b96` / `4d5cc454` added attention types, and `f1c34e96` added pause distinctions. A type is not
  a running detector. Reuse and strengthen their identity/freshness contracts rather than creating
  another Attention/Pause vocabulary; check production callers before marking capability complete.
- `a07b9528` reorganised session detail/action disclosure and lifted `useRecentMessages` to one shared
  reading. Preserve that layout and single read. Handle-only effect dependencies, missing box
  request fields, and the review's execution-identity issue were still present on inspection.
- `93cf4628` extracted **`tools/overseer/lock.ts`**. Reuse its tested one-writer machinery for approved
  new local stores; do not copy a simplified lock from an old version of `store.ts`.
- The current [Wave 2 plan](260908f-orchestrator-wave-2-write-path-usage-limits-box-health-history-attention-inbox-codex-adapter.md)
  already assigns attention, usage, 24h health history, harness visibility, and dictation to active
  workstreams. **This roadmap refines/integrates those commitments; it does not cancel or postpone
  them.** Check their landed artifacts first, complete missing joins/tests, and skip work already
  proven. The Attention completeness slice below preserves Wave 2's explicit requirement to find
  prose questions; the first mechanical inbox alone does not satisfy that commitment.
- Health history is now being built in the **dashboard**, at `~/.fleet-health/`, as recorded in the
  direction doc's ownership divergence. Integrate that one owner and show gaps; do not also build an
  Overseer health-history writer. A durable ownership rule change remains Greg's decision.
- Direction now closes A5 and makes **Tailscale Serve plus an owner check on proxied writes a
  precondition for widening loopback access**. Preserve that decision; do not reopen an ACL rewrite
  or widen raw binds under this plan.

The running services were not restarted after this merge. Neither an upstream commit nor a type
file proves deployment. If `dev` advances again, repeat this small reconciliation at Baseline;
there is no reason to restart the whole investigation or discard earlier regression evidence.

**Fable-revision reconciliation, `3ba58fc5`:** dictation code has now landed for New session and
steering, with transcription routes and the explicit browser-leaf import exception enforced by
`tests/fleet-imports.test.ts`. Preserve those controls and the narrowed boundary; do not port them
again. Wave 2 records that real microphone/phone success remains unverified and plain tailnet HTTP
is not a secure context. Its Stage F also now defines the realtime partner as a separate model
briefed about the selected session, which may hand that agent a message. Reuse that product decision.
These commits do not repair the two early client findings: the failed-poll deadline and recent
messages' handle-only effect remain. This later integration was not in Fable's reviewed candidate.

## Start with these references

| Reference | Why the implementing agent needs it |
|---|---|
| [Direction and constraints](../project/overseer-direction.md) | Ownership seam, Greg's priorities, autonomy, observed failure modes, and existing wide-review backlog. Read especially Two tenses, Attention, Order of work, and Backlog. |
| [Original dashboard plan](260907e-agent-fleet-dashboard.md) | What the dashboard slices intended, what was actually delivered, and earlier review findings. |
| [Overseer store/clock plan](260908b-overseer-store-and-clock.md) | Recovery contracts and evidence for the existing daemon. Do not implement O1 from scratch. |
| [Whole-approach Astra review](260908b-whole-approach-review-astra-v2.md) | Original A9–A30 findings. Recheck against current code; several are already closed. |
| [Write-route Sol review](260908c-fleet-dashboard-write-routes-review-sol.md) | Review history behind the privileged operations; not evidence that every browser path joins correctly. |
| [Fleet reusable guide](../reusable/agent-fleet-dashboard.md) | Local operational conventions and UI constraints. |
| [Engineering manager](../reusable/engineering-manager.md), [worktrees](../project/worktrees.md) | Delegate bounded work, stage it, review it, commit it, and land on `dev`. |
| [Quality gates](../project/code-quality-overview.md), [silent success](../reusable/silent-success.md) | Check actual effects, not agreement between two mocks; distinguish skipped from passed. |
| [Browser control](../project/browser-control.md), [browser testing](../project/browser-testing.md) | Browser work belongs in a Sonnet agent; this box uses Playwright with system Chrome. |
| [Resource diagnosis](../reusable/diagnose-box-resources.md), [adaptive test limits plan](260908b-adaptive-test-resource-limits-so-concurrent-suites-cannot-exhaust-the-box.md) | Existing memory admission and what counts as useful resource evidence. |
| [Host setup](../project/hetzner-remote-server-box.md), [infra README](../../infra/hetzner/README.md) | Services, provisioning, tailnet access, and why persistent machine changes belong in provisioning too. |

### Code map: read symbols, do not recreate them

| Area | Existing entry points |
|---|---|
| HTTP composition and collection cadence | `tools/fleet/server.ts`: `handler`, `refresh`, `refreshLoop`; `refresh.ts`: `refreshOnce`; `state.ts`: `fleetState`, `readAttemptClock` |
| Inventory and identity | `tools/fleet/collect.ts`: `collect`, `collectWithDeadline`, `readPanes`, `snapshotFrom`, `generationDrift`; `scripts/gjd-remote-tmux.ts`: `buildSessionScript` |
| Live/poll transport | `tools/fleet/live.ts`: `subscribe`, `safeWrite`, `broadcastFrame`; `web/src/transport.ts`: `pollingTransport`; `tools/overseer/source.ts`: `fleetSource`, `sseFrames` |
| Shared wire declarations | `tools/fleet/wire.ts`: types only, no imports/runtime values; queue, attention and pause shapes already started |
| Existing write vocabulary | `tools/fleet/actions.ts`, `steer.ts`, `routes-actions.ts`: `makeActionRoutes`, `killRoute`, `broadcastRoute`; `routes-steer.ts`, `routes-new.ts`, `routes-rename.ts` |
| Queue and delivery | `tools/fleet/queue.ts`, `drain.ts`: `deliverOne`; shared queue wiring is owned by `routes-actions.ts` |
| Web orchestration and actions | `web/src/App.tsx`, `OrchestratorPanel.tsx`, `ActionButtons.tsx`: `BoxActions`, `FleetQueues`; `actions-client.ts`: `boxActionBody`; `useActions.ts` |
| Session interaction | `SessionsPanel.tsx`, `SessionDetail.tsx`, `RecentMessages.tsx`, `NewSessionPanel.tsx`, `steer-client.ts`, `messages-client.ts` under `tools/fleet/web/src/` |
| Durable observation | `tools/overseer/daemon.ts`, `observation.ts`, `diff.ts`, `admissible.ts`, `store.ts`, `jsonl.ts`, `lock.ts`, `notes.ts`; `scripts/overseer.ts` is the CLI |
| Work classification already built | `tools/overseer/work.ts`: `classifyPaneWork`; `work-probe.ts`: `probeProcessTable` |
| Existing admission and supervision | `vitest-admission.ts`, `vitest.config.ts`, `scripts/subagent-cli.ts`; `infra/hetzner/systemd/{fleet-dashboard,overseer}.service` |

Paths and symbols here refer to the inspected revision. If a symbol moved, search before adding a
new one. `tools/fleet/web/src/` is the browser root, not `src/web/`.

## Findings that determine the order

**Re-checked at `77c7a502` on 2026-09-08 and kept as history**: E-tests is repaired, E-seam's schema
disagreement is gone (both ends read `2`), E-confirm is partly repaired, E-stream and E-blocking are
half repaired, and E-session's two client faults are fixed by the Baseline stage. E-actions, E-work
and E-queue stand unchanged. The per-row evidence is in
[§ Shipped / built-not-wired / proposed](#shipped-built-not-wired-proposed-at-77c7a502), which is
the row to trust where the two disagree. This table stays because the rest of the plan's prose was
written against it.

These are dated findings, not permanent descriptions. **S** means confirmed by source inspection;
**T** means exercised in a test/command; **H** means a hypothesis requiring a failing reproduction.
No real session was steered, killed, launched, or resumed in this investigation.

| ID | Evidence and consequence | Confidence / next proof |
|---|---|---|
| E-actions | `boxActionBody` sends `actionId`, `mode`, `confirm`, `speaker` but no `pids` or `recipients`. `killRoute` intersects current candidates with supplied PIDs; `broadcastRoute` refuses no recipients. The browser therefore cannot complete these advertised paths. | S; audit also ran body through parser. First regression must drive real browser serializer into real route with fake execution. |
| E-confirm | `BoxActions` displays warnings for unknown/non-dry-run previews but its Confirm condition only requires `preview.ok` and a non-null result. Failure heading is always `Nothing happened.` | S; render malformed/surprising responses and a lost reply after fake execution. |
| E-queue | `deliverOne` settles partial/unknown delivery as refused, removing that item. A later drain can reach the next instruction despite an uncertain input buffer. `FleetQueues` hides queues with only unreadable items and describes leases as unsent. Queue counters restart at `q1`. | S; reproduce on fake transport, including stale recovery request after restart. |
| E-seam | **Closed 2026-09-08 by the Overseer status stage.** Was: `OrchestratorPanel` still explains that no Overseer process/store exists. `server.ts` exposes no checkpoint projection. The actual store and daemon are in the tree. | S. Live checkpoint metadata read was schema **1**, `writtenAt=2026-09-08T12:09:05.298Z`; checked-in store contract is schema **2**. This proves version disagreement, not its cause. |
| E-work | Production search for `classifyPaneWork` and `probeProcessTable` finds definitions but no daemon caller. The expensive research and fixture tests already exist; users do not receive the result. | S. Do not promise that all foreground reviews currently look idle: the direction doc's later measurement explicitly disproved that broad claim. |
| E-blocking | Inventory's main bash call is async, but pane enumeration/capture and health subprocesses still use synchronous calls. Health includes a real interval sample. `collectWithDeadline` races a promise without cancelling its child. | S for code; H for end-to-end latency and orphan accumulation under representative load. |
| E-stream | `safeWrite` returns `res.write`'s boolean and `broadcastFrame` ignores it. Further snapshots/pings are still written to a slow socket. `source.ts` clears its deadline then awaits `response.text()` on unsuccessful SSE HTTP responses. | S; actual bounded-memory and hanging-body regressions still required. |
| E-session | Detail keyed by `row.id` alone can retain state across a replaced execution; `RecentMessages` effect also depends on `row.id`, not full identity. New-session lookup returns early on failed fetch before its give-up check. | S; test replacement with same handle/different execution and all-polls-fail. |
| E-tests | Four focused suites ran: **362 passed, 2 failed**. Both failures are existing freshness expectations in `fleet-web.test.tsx`; `state()` fixes collection at 12:00Z but the suite never freezes `Date.now()`. At this run the fixture was 9 minutes old; Header correctly kept it stale. | T; see raw [baseline](260908f-overseer-and-fleet-improvement-roadmap-baseline.txt). Do not loosen real freshness rules to make these green. |
| E-existing | CSP/anti-framing, action speaker attribution, collection attempt clocks/deadline, volatile queue warnings, adaptive Vitest admission, service files, and work classifier tests already exist. | S; these are foundations to extend, not stages to recreate. Service installation/live revision was not verified through systemd in this sandbox. |

### Priority method and stopping points

Value is 1–5: frequency, avoided lost work, and reduction in Greg's attention. Effort is 1–5:
1 = a small, local change; 2 = roughly half a focused agent-day; 3 = roughly one day; 4 = several
stages/days; 5 = uncertain or substantial. These are planning estimates **including tests and review**,
not promises of wall time. Score is `value / effort`; dependencies and Greg's ordering beat the score.
Do not promote an easy peripheral task merely because its ratio is high.

| Stage label | Value | Effort | Score | Depends on / placement |
|---|---:|---:|---:|---|
| Baseline | 5 | 1 | 5.0 | First; establish versions and failing controls |
| Execution identity | 5 | 3 | 1.7 | Baseline; required for verified continuity and newly enabled identity-dependent writes, not read-only status |
| Box contracts | 5 | 2 | 2.5 | Execution identity; repair existing functionality |
| Delivery uncertainty | 5 | 2 | 2.5 | Baseline; queue quarantine can ship independently of Box contracts |
| Failure containment | 5 | 1 | 5.0 | Baseline; small bounds before new UI |
| Overseer status | 5 | 2 | 2.5 | Failure containment; global status and explicitly claimed history need no verified execution |
| Work evidence | 4 | 2 | 2.0 | Overseer status; enrichment alongside attention, not its gate |
| Attention inbox | 5 | 3 | 1.7 | Status + daemon Attention producer; inspect first, guard any answer separately |
| Attention completeness | 5 | 3 | 1.7 | Inbox + current Wave 2 detector; **first complete attention milestone** |
| Responsive collection | 5 | 3 | 1.7 | Baseline; measure before/after |
| Resource history | 4 | 2 | 2.0 | Work + responsive collection |
| Admission visibility | 5 | 2 | 2.5 | Resource history; reuse existing admission |
| Enforced launch admission | 5 | 4 | 1.25 | Visibility; limited to integrated launchers |
| Usage visibility | 4 | 3 | 1.3 | Status + bounded readers; **second product milestone** |
| Session continuity | 4 | 2 | 2.0 | Execution identity; parallel UI work if file ownership permits |
| Bounded transport | 4 | 2 | 2.0 | Responsive collection for combined stress check |
| Source ordering | 4 | 3 | 1.3 | Status; before durable inference depends on ordering |
| Maintainable seams | 3 | 2 | 1.5 | Contracts stable; incremental extraction only |
| Durable action receipts | 5 | 4 | 1.25 | Delivery uncertainty; before wider unattended actions |
| Launch protocol | 5 | 4 | 1.25 | Admission + durable receipts; shared by scheduling/recovery |
| Schedule preview | 4 | 2 | 2.0 | Usage + admission; keep scheduler after those capabilities |
| Scheduled dispatch | 5 | 3 | 1.7 | Preview + launch protocol + admission |
| Recovery inventory | 4 | 2 | 2.0 | Status; read-only inventory can be developed earlier |
| Gradual recovery | 4 | 3 | 1.3 | Inventory + launch receipts + admission; human-selected |
| Work reports and decisions | 4 | 3 | 1.3 | Stable source identity + inbox; no model mining yet |
| Bounded judgement | 4 | 4 | 1.0 | Reports + usage + admission; proposal-only |
| Access review | 3 | 2 | 1.5 | Scheduled after core usefulness, per Greg |
| Operational finish | 5 | 3 | 1.7 | Each shipped service slice; off-box monitoring needs destination |
| Optional convenience | 2–4 | 2–5 | varies | Only after use identifies the next bottleneck |

Follow the delivery cuts under Goal and scope. Fable estimated the old first batch at roughly
eighteen agent-days; it hid a much earlier useful stop. Do not turn those cuts back into one
release. After attention, do only the responsive-collection work required to take useful vitals,
then history, admission visibility and usage. Full transport/source-ordering/refactoring follows
usage unless a specific failure promotes it. Launch protocol and recovery are later consumers.

## Contracts to preserve throughout

- **Ownership:** fleet owns collection, current pane facts, HTTP writes, delivery, and rendering;
  Overseer owns observation history, work interpretation, scheduling, and proposed coordination;
  the currently agreed dashboard-owned health-history exception is described above. The daemon is
  the single writer of its store. Fleet parses `current.json` at its own boundary; it does not import
  `tools/overseer/store.ts` and create a cycle. Extend existing `tools/fleet/wire.ts` for shared types only (no imports or runtime values),
  with independent runtime validation and contract fixtures in their owning modules.
- **One collector:** reuse the dashboard feed; do not add another full inventory poll for attention,
  quota, history, each viewer, or each job. Bounded process/transcript probes have one owner/cadence.
- **Identity:** retain tmux generation, pane, session creation/execution identity and Claude session
  id where available. Display names are labels. Missing identity means unverifiable, never a reason
  to substitute current values into an old confirmation. A process PID alone is not durable identity.
- **Knowledge:** observed, inferred, claimed, unknown, and not supported remain distinguishable all
  the way to the browser. `keys submitted` is not `read`, and `read` is not `obeyed` or `completed`.
- **Authority:** `speaker` is required; preserve `renderSpoken` attribution and slash-command limits.
  Transcript text cannot grant permissions. Harness permission dialogs continue to require the
  established terminal/launch-repair path. Do not reopen the rejected screenshot-approval design.
- **Storage:** JSONL + atomic checkpoints remain sufficient. Do not put host-control state in the
  product database, or introduce SQLite until a measured query requires it. A dashboard-owned action
  journal is separate from the daemon-owned observation journal: never two writers to either.
- **Simplicity:** keep polling in the browser unless measurements justify SSE. No custom terminal,
  new web framework, generic workflow engine, login UI, distributed locks, or multi-box scheduler.

## How to execute every stage

- [ ] Before code edits, create a worktree and run `npm run worktree:setup`; fetch and merge `dev`
  according to [version control](../project/version-control.md). If a merge conflicts, show the
  proposal before editing. This plan-only document may remain in the primary checkout.
- [ ] Give one implementer a stage, its named files, exclusions, and acceptance criteria. Delegate
  bounded independent investigations; never have two agents replacing the same large client file.
  The parent owns shared server wiring, schema changes, integration gates, reviews and commits.
- [ ] For each suspected bug, delegate root-cause research, reproduce the failure first, and write
  the postmortem when fixed: named bug class, introducing commit, durable repair, prevention.
  Proposed investigations here are not incident postmortems and do not claim unrun reproductions.
- [ ] Run the named focused tests, then required `npm test`, `npm run typecheck`, touched-file lint,
  and `npm run check` at the integrated stage finish. One parent runs the broad gates, sequentially;
  child agents run focused tests. Honour existing memory admission, do not override it to get a tick.
  A denied/DB-skipped check is recorded as such. Use `node --import tsx` when sandboxed `tsx` IPC fails.
- [ ] For UI stages, Sonnet reads the browser docs and checks desktop and phone widths with system
  Chrome. Use a fixture-backed server/fake executors for mutations. Delivery proof defaults to a disposable session on an isolated test socket, with a nonce absent
  from the sender transcript and target-side evidence. A test against the shared live fleet needs
  explicit authorisation naming its target; this roadmap supplies none.
- [ ] Ask Sol for a scoped review of actual diff and raw results before committing. Confirm nonempty
  answer and exit status; resolve findings with evidence. Follow the two-round limit in the manager
  guide. Update the plan and relevant evergreen docs in the same stage; rule changes need Greg's
  before/after approval, signposts do not.
- [ ] Commit only named files after `npm run check:staged-revert`, push to `dev`, and record the SHA.
  Deployment of host services is a separate operational action; pushing `dev` does not restart them.
  Check worktrees before removing them. Never use a cleanup/reset to dispose of uncertain state.

### Stage: Baseline — know which code is actually running

**Done in the commit that carries this paragraph — session `260908f-roadmap-baseline`, 2026-09-08.**
The census below replaces
the dated findings table as the current picture; the findings table stays because it is what the
rest of the plan's prose was written against. **The headline is that much more has landed than the
roadmap knows**: the attention inbox is shipped end to end *including* the model-driven prose
detector, health history is shipped, the scheduler is built and would dispatch real agents if it
were armed, and the schema disagreement in E-seam is gone. Three of the six deliverables
turned out to be already done by peers on `dev` — recorded below rather than rebuilt. What was still
broken and is now fixed: the two client repairs, both red first.

- [x] Read current direction and both original plans. Compare their remaining checkboxes with
  current callers/tests, especially the work classifier and systemd installation. Keep a small
  shipped / built-not-wired / proposed table in this plan; retire contradictory roadmap prose only
  when the replacement is based on evidence.
- [x] Record `git rev-parse HEAD`, Node version, installed service ExecStart/WorkingDirectory,
  process start time, client build revision if available, checkpoint schema and its two clocks.
  Use `systemctl show/status` and bounded logs read-only. Do not print environment files or transcripts.
  If service access is unavailable, say unknown; a file in `infra/` proves no installation.
- [x] Reproduce the two baseline freshness failures. Inspect the `state()` fixture and test clock;
  freeze/reset the clock or generate intentionally fresh fixture times. Add a distinct assertion
  that receiving an **old** cached snapshot does not clear the stale banner. Do not increase timeout
  thresholds just to satisfy a stale fixture.
  <br>**Already repaired on `dev` before this stage ran** — `tests/fleet-web.test.tsx` § `state()`
  now computes `collectedAt: new Date().toISOString()` and carries the reasoning ("a fixture that
  means *fresh* has to be computed from the clock the component reads"); `messagesWire()` got the
  same repair on `lastModified`. All 312 passed on arrival. The distinct old-snapshot assertion was
  the part still missing, and is now `staleness › does not clear the banner when the snapshot that
  arrives is itself old` — the rendered counterpart to `recovers`, which on its own is passed by an
  implementation that clears whenever a 200 arrives. It is a **guard, not a reproduction**: it was
  green when written — so it needed evidence that it discriminates, and the first attempt at that
  was too weak: mutating the fixture's age to 1s fails the test, but the separate `10m old`
  assertion guarantees that anyway, so it proved nothing about the banner. **The mutation that does
  is in `freshness` itself** — `stale: true → false` in the age branch — and under it the page still
  printed `10m old` while `toContain("STALE")` failed. Sol's doubt, and it was right.
- [x] Reuse `browserFetch(routes)` and `makeActionRoutes` in `tests/fleet-actions-route.test.ts`
  for real client→route tests. That join already exists; do not extract the whole HTTP handler merely
  to repeat it. Composition/URL-prefix checks belong to Access review when needed.
  <br>**Also already on `dev`:** seven `browserFetch` joins, including both halves of the
  `kill-test-suites` pair (preview, and the confirmed run refused `nothing-to-kill` with the gap
  named in the test). What was missing was the same treatment for the **broadcast**, whose every
  existing test hand-writes a `recipients` array the browser never sends — added as
  `refuses the body the page really sends, because the browser carries no recipients`, asserting the
  400 rather than papering over it. That is the wrong-request negative control for this stage.
- [x] Bring forward two small client repairs, each with a failing regression first. In
  `NewSessionPanel`, apply the absolute discovery deadline to failed polls too; preserve the created
  id/manual refresh and never relaunch because discovery failed. In `useRecentMessages`, re-read on
  a changed claimed `claudeSessionId` under the same row id, clear the old view, and prevent an old
  in-flight response from replacing the new view (including manual reads). An unchanged snapshot
  must not trigger another transcript read. This fixes an observable claim change; it does **not**
  prove that an unchanged launch claim still identifies the current execution.
- [x] Capture focused suite output and run one deliberate wrong-request negative control. Fix only
  scoped defects; baseline failures elsewhere are recorded and investigated separately.
  <br>Full `npm test`: **895 files passed, 2 failed** — `tests/pdf-bundle-trace.test.ts` and
  `tests/cold-start-lazy-imports.test.ts`, both the fresh-worktree failures `npm run worktree:setup`
  predicts on the way in (no `api-dist/` until `npm run build`). Neither is in this diff's blast
  radius. Typecheck clean; lint on the touched files produces only the pre-existing `useLiteralKeys`
  infos the test files already carried.

**The review round, and what it changed.** GPT Sol reviewed the built code and found **six P1s, five
of them reproducible bugs in this stage's own repairs** — which is the argument for the second review
in [engineering-manager.md](../reusable/engineering-manager.md), because a plan-stage review could
not have found any of them. All five are fixed here, each with a regression **and a mutation check
that the regression really discriminates**:

1. **The deadline was still a poll's, not the clock's.** Moving the give-up out of the success branch
   covers a poll that *fails*; a `poll()` whose promise never settles reaches no branch at all, so a
   deadline evaluated after `await` never runs — the original bug down a different door. The interval
   now decides, and one ask at a time: without single-flight the mutation check stacked up **81
   requests** against a route answering none.
2. **The `unreachable` sentence was chosen from the last poll alone**, so four healthy minutes plus
   one `ECONNRESET` printed *"for four minutes it could not reach the server at all"*. The
   discriminator is now *did anything ever answer*; the last failure is a footnote.
3. **`setGaveUp(null)` at the top of `start` erased the previous launch's warning** before anybody
   knew whether a new launch would replace it — and the box refuses exactly when somebody presses
   twice. Only an accepted launch may retire it.
4. **`setView(null)` in an effect is one commit too late.** React commits, and can paint, the render
   in which the row is B and the view is still A's; only the test's `act` hid it. The reading now
   carries the identity it is a reading *of*, so the wrong pairing is refused during render.
5. **Identity equality is not an ordering.** Widening the guard from `row.id` to the full identity
   closed the cross-agent door and left A→B→A open: a held read of A, taken before the round trip,
   overwrote one taken after. A monotonic token fixes it. **The general lesson is worth more than the
   fix: a freshness check written as an equality cannot tell two of the same thing apart.**

The sixth was this document overclaiming the served revision, corrected above. Sol's P2s are also
applied: the broadcast negative control now uses the dry-run press the panel can actually reach, and
the usage and scheduler rows say what is really left.

**Round 2 found three more P1s, and two of them are about the same failure as the code's.** Recorded
because the pattern is the point:

- **`unreachable` was a name that claimed more than its evidence.** `PollOutcome.ok` is false for a
  dead socket, an HTTP 500 **and** a body that is not this API, so four minutes of the dashboard
  answering 500 printed *"could not reach the server at all (the server answered 500)"* — a sentence
  contradicting itself inside its own parenthesis. The arm is now `no-answer` and the copy says
  *never got a usable status answer*, which is what the page actually knows. **A name that overclaims
  is the same bug as a sentence that overclaims, and harder to notice.**
- **The paint-order regression did not test paint order.** It read the DOM after `act`, which
  flushes passive effects — so the very implementation round 1 had condemned passed it, and it was
  therefore not evidence for the repair it was cited for. There is now a `Profiler`-based test that
  records **every committed frame** and asserts none carries A's turns under B's identity. Under the
  old implementation it is the only one of the six identity tests that fails.
- **The runtime headline still said "neither is on `dev`'s tip"** three paragraphs above the text
  retracting exactly that. Now "neither can be shown to be".

Sol's round-2 P2s are applied too: a test pins that a poll answering **after** the give-up is
ignored rather than quietly rewriting the card under the banner, and the three flags in the polling
effect are one, since they were always checked together. Two rounds is the limit, and nothing was
overruled — every finding in both rounds was reproducible.

**Acceptance:** another agent can distinguish code under test from the serving process; the existing
client→route harness remains usable, perpetual failed discovery stops, and a changed conversation
claim cannot retain the old transcript view. Runtime inspection has not restarted anything.
**Cost ceiling:** one small stage; no instrumentation platform.

#### The runtime record, 2026-09-08 ~21:45 BST

Read-only. Nothing was restarted, no environment file or transcript was printed.

| | |
|---|---|
| Primary checkout `HEAD` | `77c7a502` (2026-09-08 21:41:18), `/home/greg/code/spideryarn2` |
| Node | `v26.8.1` |
| Dashboard | **systemd, and it is installed and running** — `fleet-dashboard.service` `enabled`/`active`, `MainPID=123208`, `ExecStart=/home/greg/code/spideryarn2/node_modules/.bin/tsx tools/fleet/server.ts`, `WorkingDirectory=/home/greg/code/spideryarn2`, `FragmentPath=/etc/systemd/system/fleet-dashboard.service`, started **21:25:22**. Bound `127.0.0.1:8787` and `100.92.255.119:8787` (tailnet). Not in tmux. |
| Overseer daemon | **systemd unit installed but `disabled` and `inactive`; the daemon actually running is a hand-started one** — `npm exec tsx scripts/overseer.ts run`, pid 4190432→4190544, cwd `/home/greg/code/spideryarn2`, started **20:51:48**, in tmux session `overseer5-2051-4190361`. |
| Client build revision | **None is reported anywhere.** The only observable revision is vite's content hash in the filename: the served artifact is `tools/fleet/web/dist/assets/index-CjrhG43M.js`, mtime 21:25, built by the unit's own `ExecStartPre=/usr/bin/npm run build:fleet`. Nothing on the page or in any API says which revision it is. |
| Checkpoint | `~/.overseer/current.json`, **schema `2`** — matching `STORE_SCHEMA` in `tools/overseer/store.ts` and `KNOWN_SCHEMA` in `tools/fleet/attention.ts`. Twelve top-level fields, all twelve declared in the checked-in `Checkpoint` type, none missing either way. |
| The two clocks | `writtenAt=2026-09-08T20:45:50.840Z`, `lastGoodSnapshotAt=2026-09-08T20:45:17.152Z` — 33s apart, i.e. alive and hearing. `heartbeat={pid:4190544, instanceId:6bc44a90…, startedAt:19:51:49.970Z, lastTickAt:20:45:50.840Z, ticks:161}`. |

**The finding this stage exists to produce: neither running service reports the revision it is
running, and neither can be SHOWN to be on `dev`'s tip.** What can honestly be said, after GPT Sol
pushed back twice on stronger drafts of this paragraph:

- **Neither process records its revision.** That is the fact, and it is the gap the Operational
  finish stage names.
- **The primary's `HEAD` at each launch is knowable from the reflog**, which is better evidence than
  the commit timestamps this paragraph first used: `HEAD` was `b93f45db` from 21:16 to 21:41, and the
  dashboard started at 21:25:22. The daemon started at 20:51:48, before `7c65318d`, `46a70cc5` and
  `77c7a502` landed.
- **The bytes that were loaded are still unknown**, and that is the part the first draft overclaimed.
  `tsx` and `build:fleet` read the working tree, not `HEAD`, and this is a shared checkout in which
  several agents have uncommitted edits at any moment. *"It is serving `b93f45db`"* is therefore not
  something this evidence supports; *"`HEAD` was `b93f45db` when it started, and what it loaded on
  top of that is unrecorded"* is.

So the only honest answer today to *is this fix live?* is *restart it and see*. Four things would
change that, and they are cheap: capture `git rev-parse HEAD` **and the dirty state** at service
start; inject the revision into the client build; expose the server's revision on its own; and write
the daemon's revision into its checkpoint or start event. Retrospectively, a clean rebuild and a hash
comparison could identify a likely client commit, but cannot rule out uncommitted source.

**`~/.overseer/` has six files, not five.** The direction doc's seam table lists five; the sixth is
`attention.json` (`ATTENTION_MEMORY_SCHEMA = 1`, keys `epoch`/`waits`/`verdicts`), the attention
pass's own memory — it holds each session's first-seen wait time and the model's cached verdict per
`tailFingerprint`, so a restart neither forgets how long somebody has waited nor pays for the same
classification twice. It is the daemon's private state in the same sense `last-snapshot.json` is.
**Not yet added to that table** — `overseer-direction.md` is outside this stage's file set and
another agent is live in `tools/overseer/`. Adding the row is a signpost rather than a rule change,
so it needs no approval; it needs an owner.

#### Shipped / built-not-wired / proposed at 77c7a502

Verdicts are about **this tree**, not about the running processes above. *Shipped* means a
production caller reaches it and, for anything reader-facing, the browser draws it.

**Read the date on this table, and then read this paragraph.** It was taken at `77c7a502`, and by the
time the stage that produced it was ready to land, `dev` had moved **52 commits** — including
`5cf9a7ee`, which shipped the whole Overseer status stage and deleted the panel sentence this census
had just named as its second-most-valuable finding. That row is corrected below and marked; **the
other rows have not been re-checked against those 52 commits**, so treat this as a picture of
`77c7a502` plus one correction rather than of `74ee7559`. Saying so is the point: on a trunk with
three agents on it a census is a photograph, and a photograph presented as a live view is exactly the
failure this plan is about. **Re-take the rows you are about to depend on; do not re-take all of
them.**

| Stage | Verdict | Evidence |
|---|---|---|
| Baseline | shipped | This section, and the code it landed. `tests/fleet-web.test.tsx` 326 pass; `tests/fleet-actions-route.test.ts` 80 pass. **The rest of this table describes `77c7a502`; this row describes the commit that adds the table** |
| Execution identity | partial — write path only | `verifyTarget` (`tools/fleet/steer.ts:1067`) returns `{paneId, sessionId, panePid, claudePid}`, parsed as `VerifiedReading`/`not-told` (`web/src/steer-client.ts:172-206`). No verified/claimed reading on fleet rows, and `RegisterEntry` (`tools/overseer/store.ts:336-360`) has no start-ticks or boot token |
| Box contracts | built-not-wired — server half only | `parseBoxRequest` accepts `pids` and `recipients` (`routes-actions.ts:486-544`); `boxActionBody` still sends four fields (`web/src/actions-client.ts:781`). Both gaps now pinned by browser→route tests (`fleet-actions-route.test.ts`, `nothing-to-kill` and `a broadcast needs recipients`) |
| Delivery uncertainty | partial | Steering has it: `Delivery = "none" \| "partial" \| "unknown"` (`steer.ts:347`), through route (`routes-steer.ts:139`) to client (`steer-client.ts:129`). The queue does not: no uncertain arm in `drain.ts:218-232`, and ids are still `q${seq}` from 1 per process (`queue.ts:618`) |
| Failure containment | proposed | `collectWithDeadline` still `Promise.race`s without cancelling the child (`collect.ts:649-663`); no single-flight latch in `collect.ts`/`refresh.ts`. The daemon's half **is** done (`overseer/source.ts:251,288,306`) |
| Overseer status | **shipped — while this census was being written**; at `77c7a502` it was partial and the panel was factually wrong | At `77c7a502`: no `/api/overseer`, a projection of `attention` only, and `OverseerPanel.tsx:130-141` telling the reader the Overseer *"is not running, and there is nothing on this box that would receive a message"* while a daemon had been writing a checkpoint for an hour. Landed in `5cf9a7ee` and merged here: `tools/fleet/overseer-status.ts` § `readCheckpointFeeds` projects `attention` **and** an `overseer: OverseerStatusFeed` — two clocks, heartbeat, scheduler line and a bounded register projection — out of the same bytes, onto the same payload. Still no separate route, and `wire.ts:1106` now argues for that: *one payload, one clock, one staleness*, and one file read so the inbox and the clock beside it cannot come from two versions of the file. The panel's three false sentences are gone, and `OverseerPanel.tsx:421` marks the spot: *"NOT 'the Overseer is not running', which the evidence does not"* support |
| Work evidence | built-not-wired | `classifyPaneWork` (`overseer/work.ts:693`) and `probeProcessTable` (`work-probe.ts:58`) have **zero non-test callers**; every hit outside the definitions is `tests/overseer-work.test.ts` or a comment. `RegisterEntry` has no `work` field, which is why the live register has none. **E-work stands unchanged.** Same shape for its sibling `classifyPaneHarness` (`harness.ts:655`) |
| Attention inbox | **shipped** | `runAttentionPass` (`overseer/attention-pass.ts:128`) → `buildAttentionList` (`attention.ts:220`) → `Checkpoint.attention` (`store.ts:427`); production caller `attentionRunner` (`attention-cli.ts:293`) wired at `scripts/overseer.ts:801` on a 2-minute ticker (`daemon.ts:608-634`); read at the fleet boundary and drawn by `AttentionPanel.tsx` (678 lines) from `App.tsx`. Live checkpoint carries a real item |
| Attention completeness | **shipped** | The prose detector is model-driven and running: `attention-classify.ts:66`, `openai/gpt-5.6-luna` over OpenRouter, one call per distinct `tailFingerprint`, `DEFAULT_MAX_CALLS = 12`; `attentionRunner` returns `null` with no key so a keyless daemon publishes *not yet run* rather than an empty list. Excerpt drawn behind a disclosure (`AttentionPanel.tsx:673`); `sessionsScanned`/`sessionsUnreadable` carried and rendered. **The roadmap's ordering assumed this was ahead; it is behind us** |
| Responsive collection | proposed | `execFileSync` still on the request process at `collect.ts:463` (pane capture), `collect.ts:607`, `health.ts:505` |
| Resource history | **shipped** | Writer `openHealthHistory` composed in `health-wiring.ts:41`, called `server.ts:134`, appended per turn `server.ts:241`; route `/api/health/history` (`routes-health-history.ts:34`) mounted `server.ts:313`; drawn `HealthHistory.tsx` → `HealthPanel.tsx:217`. Live `~/.fleet-health/health.jsonl` 280 KB, `writer.lock` present |
| Admission visibility | proposed | `vitest-admission.ts` is read only by `vitest.config.ts:12` and two tests; no dashboard or CLI reader |
| Enforced launch admission | proposed | No admission call in any launcher; the only reservation is the scheduler's occurrence lease, which is not a resource slot |
| Usage visibility | built-not-wired in the browser | Producer shipped and running: `collectUsage` (`overseer/usage.ts:1336`) on its own 300-second timer (`daemon.ts:380`, wired `scripts/overseer.ts:835`), stored (`store.ts:457`), printed by CLI `usageLines` (`scripts/overseer.ts:512`); live checkpoint carries a full report. Wire types exist (`fleet/wire.ts:206-478`) and **nothing renders them** — the fleet reader drops `usage` by design (`tools/fleet/attention.ts:41`), so the remaining work is a boundary projection, a parser, client state and a panel. The prepared join is dead too: `readPause` takes an optional `rateLimit` (`pause.ts:786`) and `readPauses` never passes one (`collect.ts:771`) |
| Session continuity | proposed | No draft persistence anywhere in `tools/fleet/web/src/` |
| Bounded transport | partial | Server unrepaired: `safeWrite` returns the boolean (`live.ts:96`) and `broadcastFrame` discards it (`live.ts:134`), with the "drop, don't queue" rationale stated at `:129`. Daemon repaired |
| Source ordering | proposed | `fleetState` writes `schema: 1` with no producer instance or sequence (`state.ts:73-93`) |
| Maintainable seams | partial | Real extraction happened — `wire.ts`, `attempt-clock.ts`, `health-wiring.ts`, `routes-health-history.ts`, `state.ts`. The named targets grew: `ActionButtons.tsx` 1498 lines, `routes-actions.ts` 2031, `actions-client.ts` 1091 |
| Durable action receipts | proposed | Four `receipt` hits in `tools/fleet/*.ts`, all comments saying there is no receipt for a keystroke. No dashboard-owned journal |
| Launch protocol | partial — Overseer side only | `schedulerTick` (`overseer/scheduler.ts:196`) does append-`reserved`→fsync→spawn→append-`started`, with a durable lease and a `stuck` sweep. Not shared with any dashboard action; no admission step |
| Schedule preview | shipped in CLI, proposed in browser | `describeStandingJobs` printed by `overseer status` (`scripts/overseer.ts:334-342`); definitions pinned by `authorisedHash` per tick. Nothing in the browser reads `scheduler` |
| Scheduled dispatch | **built and wired, disarmed** | `gjdRemoteDispatch` (`overseer/dispatch.ts`) really spawns `gjd-remote new-claude … --no-attach -p -`; handed to the daemon only when `OVERSEER_JOBS_ENABLED === "1"` (`dispatch.ts:50`), and `daemon.ts:563` writes `scheduler.kind = "off"` otherwise — which is exactly the live checkpoint's `{kind:"off", why:"OVERSEER_JOBS_ENABLED is not \"1\"…", definitions: get-ready-to-deploy, feedback-sweep}`. **Arming this dispatches real agents; it is not a display flag.** And `infra/hetzner/systemd/overseer.service:37` neither sets the variable nor reads an env file with it in, so exporting it in a shell and starting the unit arms nothing — durable arming is a unit or drop-in, a reload, a restart, and the same change in provisioning |
| Recovery inventory | proposed | No `RecoveryCandidate` anywhere. *(Superseded 2026-09-10: the daemon side has been built, in plan 260910e; see the stage below.)* |
| Gradual recovery | proposed | Depends on the above |
| Work reports and decisions | proposed | Event kinds are only `session-*` and `job-occurrence-*` (`scripts/overseer.ts:246-277`). The decision log that landed in `46a70cc5`/`77c7a502` is documentation, not events |
| Bounded judgement | partial | The detector and its call budget run, but there is no typed *proposal* with a recipient and no routing to Sol or Fable |
| Access review | mostly shipped | `applySecurityHeaders` before every response path (`server.ts:283`), `origin.ts`, loopback-only `parseBinds`, `tests/fleet-headers.test.ts`, `tests/fleet-origin.test.ts`. `handler` still binds at import (`server.ts:484-491`), so composition checks stay source-level |
| Operational finish | partial | `scripts/overseer-watchdog.ts` + its test ship a **local** watchdog, and say so in their own header: closing A27 needs the off-box dead-man, which does not exist. No client build revision anywhere — see the runtime record |

**What this changes about the order.** Four things, all of which move work earlier or delete it:

1. **The attention milestone is already met.** Both attention stages are shipped, prose detector
   included. The roadmap's "Attention delivery" cut is finished; do not re-plan it. What is left
   there is enrichment (Work evidence) and the panel's lie below.
2. ~~**`OverseerPanel` telling the reader there is no Overseer is now a correctness bug, not a stale
   placeholder**, and it is the cheapest high-value fix on the board.~~ **Fixed by `5cf9a7ee` while
   this census was being written**, along with the rest of Overseer status. Left visible rather than
   deleted, because *how quickly it went stale* is the finding: this was written and overtaken inside
   one evening.
3. **Usage visibility is boundary wiring and rendering; there is no collection work left.** The
   report is collected on its own 300-second timer (not every daemon tick) and stored. What is
   missing is a projection and parser at the fleet boundary — `tools/fleet/attention.ts` drops
   `usage` deliberately — plus the client state and the panel. Smaller than its 3-effort estimate
   assumed, but not free, and Sol was right to say the first draft of this line understated it.
4. **Scheduled dispatch is built; what remains is arming, and arming is not one shell variable.**
   `gjdRemoteDispatch` really spawns agents. The **hand-started** daemon is one inline
   `OVERSEER_JOBS_ENABLED=1` away, but `infra/hetzner/systemd/overseer.service` neither sets it nor
   reads an environment file that would, so durable arming needs a unit or drop-in, a daemon-reload
   and a restart — **and, per the box's own rule, the same change in provisioning for the next box.**
   The decision itself is Greg's, about unattended dispatch, not an implementation task.

### Stage: Execution identity — distinguish a running process from an old launch claim

This is a foundation for verified continuity and writes, not a prerequisite for a read-only status
card or an explicitly claimed observation. Develop it alongside those earlier deliveries.

**Status, 2026-09-09 (worktree `260908f-exec-identity`).** Built: the reading, its derivation, and
its propagation through fleet state, the browser parser, the Overseer's observation boundary, the
differ and the register. Checkbox 5 is done to the scope cut — the quarantine and its explanation
exist as `continuityOf` and `identityWriteGate`, and draft recovery is a named follow-up below.

The reading is `ExecutionReading` in `tools/fleet/wire.ts`: `verified` (a durable
`ExecutionToken` of boot id + pid + `/proc/<pid>/stat` field 22, plus a separate
`ConversationReading`), `claimed-only`, or `unknown` with one of eight causes. It is derived in the
new `tools/fleet/execution-identity.ts`, which **reuses `probeProcessTable` and
`classifyPaneHarness` rather than writing a second probe** — and in doing so gives
`classifyPaneHarness` its first production caller, closing half of the Baseline census's
"zero non-test callers" finding. (`classifyPaneWork` is still uncalled; that is the Work evidence
stage, not this one.) One `ps` and one boot-id read per collection, then one small `/proc` read per
pane: the pass is `readExecutions` in `collect.ts`, beside `readPanes` and `readPauses`.

**The blind spot is latent, not firing — which is the argument for building the reading now.** A
read-only census of all 11 tmux sessions at 22:46 UTC on 2026-09-08 found 7 claudes whose tmux
`CLAUDE_SESSION_ID` matched the `--session-id` on the live process, 0 conflicting, 4 shells with no
claim. Re-measured through the production code path at 00:40 on 2026-09-09: 11 of 11 `verified`, no
`claimed-only` and no `unknown`, and the `Overseer`'s own token
(`96e5c266-…:4039575:72055933`) identical to the one derived by hand off `/proc` an hour and a half
earlier — two independent joins agreeing.

**Three things the plan did not know.**

1. **`ProcessStart` in `work.ts` cannot be the token.** It is derived from `ps etimes`, counts whole
   seconds, and its own comment forbids comparing it for equality. The exact value is
   `/proc/<pid>/stat` field 22, which is a bounded read (one per pane, not the ~1000 `work-probe.ts`
   rejected) and is what actually closes pid reuse.
2. **A live, working Claude can be `claimed-only`.** `quiet-claude-pane.txt` is a real capture of a
   session launched before `new-claude` wrote `--`, whose prompt runs past the option region, so
   `claude-argv.ts` refuses the command line and the harness is `ambiguous-harness`. Every current
   launch reads cleanly, but the arm is not hypothetical and is covered by a test against the
   unedited fixture.
3. ~~**The differ has a sampling gap it cannot close cheaply.**~~ **This was wrong, and GPT Sol
   disproved it with a reproduction (P1-1, 2026-09-09).** I had argued that
   `verified(A) → unknown → verified(B)` emitting no event cost history and not correctness, because
   continuity is decided by comparing tokens rather than by asking whether an event fired. Two things
   were wrong with that:

   - **`statusSince` is an existing event-dependent consumer.** A missed event left the register
     holding run A's token *and A's measured age*, so the attention projection ranked a fresh Claude
     by its predecessor's hours — which is precisely what this stage's acceptance line forbids.
   - **On the upgrade path nothing fired at all.** Sessions already in the register when the field
     shipped are never `session-seen` again, so their `verifiedExecution` would have stayed null
     indefinitely. Sol reproduced it against the checked-in fixtures: six of six entries null.

   **Fixed by comparing against the register rather than against the previous snapshot.** `diff()`
   now takes a third input, `KnownExecutions` — a `ReadonlyMap` of last-verified tokens, passed by
   the daemon, so no import and no cycle. The register's token survives a collection that could not
   look, which is what closes both cases. `previousToken` is now nullable: null is a **first
   sighting** of an identity, which records the token and deliberately does NOT reset `statusSince`,
   because learning what a session has been running all along is not evidence that it restarted —
   otherwise the deploy itself would wipe every measured age on the box.

4. **A `verified` reading could be assembled from two different processes** (Sol's P1-2). The harness
   kind and conversation come from `ps`; the start token from a `/proc` read taken afterwards. A pid
   reused in between yielded the old conversation stapled to the new process's token, stamped
   `verified`, and the write gate allowed it. Closed with a free falsifier: `ps` already reported the
   process's elapsed time, so with one `/proc/uptime` read the table and `/proc` are **two
   independent measurements of one start instant**, and a replacement is off by the whole of the
   previous process's life. Disagreement is `process-changed-under-read`; an unreadable uptime is
   `uptime-unreadable`, because an unmade check is not a passed one.

**Named follow-up, deliberately not built:** draft *recovery* — re-establishing the same verified
identity restoring a quarantined draft. There is no draft persistence in `tools/fleet/web/src/` yet
(that is the Session continuity stage), so there is nothing to recover; the invariant it will need,
and the function that decides it, are here.

**Decided but not yet applied — narrow `claimed-only`'s conversation.** `ExecutionReading`'s
`claimed-only` arm is typed as carrying a full `ConversationReading`, but it can only ever produce
`not-claimed` or `unverifiable`: that arm means *the walk ran and could not name what it found*, and
an unnamed process is one whose command line was never read, so there is no observation to conflict
with the claim. **`conflicting` is reachable from `verified` and nowhere else.**

This is not theoretical. On 2026-09-09 the `dashboard-titles-descriptions-detail` session read this
file specifically to check my claims, inferred from the type alone that `conflicting` was reachable
from both arms, and was about to build a rendering branch that could never fire — *"a dead branch
guarding the exact hazard the P1 is about would have been worse than no branch, because it would
have looked like the hazard was handled."* The inference was made under the most favourable
conditions the type is ever going to get, which is the strongest available evidence that the type
is too wide.

The invariant is documented on the arm for now. Making it **unrepresentable** — an
`UnobservedConversation` alias off `Extract<ConversationReading, …>` — is the house rule and is the
right end state, but it changes runtime behaviour in both parsers, so it is held rather than churned
in late. GPT Sol reached the same area independently from the other side ("`claimed-only` with
`conversation: not-claimed` is semantically odd, and no current consumer benefits from this
distinction"), so there are now two signals and it should be applied by whoever next opens this file.

**Sol's over-building note, recorded rather than argued away.** Its verdict was that "the core token,
collection pass and conservative wire field are proportionate", and that the event/sticky-register
layer and the exported policy helpers are ahead of their consumers — *"they add substantial state and
contract surface, yet currently contain the two main correctness gaps"*. That is fair and it is worth
saying plainly: both P1s were in the layer this stage added on top of the reading, not in the reading
itself. The layer stays, because the Overseer's register is the thing that has to survive a restart
and the dashboard-descriptions session is already building on the reading — but a later stage should
weigh whether `claimed-only` plus nine unknown causes is more taxonomy than any consumer uses.

**Rejected, with the argument recorded** so nobody re-derives it wrongly: when a harness IS named and
only its start ticks cannot be read, the reading is `unknown`/`process-start-unreadable` and the
conversation verdict it briefly held is discarded. Promoting that to `claimed-only` carrying the real
verdict would rescue a real observation — and would be wrong, because a failed `/proc` read almost
always means the process exited between the `ps` and the read, so naming the conversation a dead
process was running is a false alarm rather than a rescued fact.

- [x] Reproduce a new Claude child started under an unchanged shell/pane whose tmux
  `CLAUDE_SESSION_ID` still names the old conversation. Current `diff.ts` documents this blind spot;
  concatenating current row fields does not fix it. Also test PID reuse and tmux server restart.
- [x] Add a browser-safe discriminated identity reading: `verified` (current harness process plus
  process-start token and verified conversation id if observable), `claimed-only` (launch metadata
  with no current corroboration), or `unknown` (cause). Keep conversation verification separate from
  process verification: a known child process does not prove which transcript it is writing.
- [x] On Linux, derive process identity from boot identity + PID + process start ticks, using the
  existing ancestry/probe machinery. Validate that the expected harness is still the pane's live
  descendant and compare its actual session-id argument/authoritative harness observation with the
  launch claim. Missing or ambiguous evidence stays claimed-only/unknown; do not guess by title.
  Treat unavailable platform evidence as unsupported, not as permission to use PID alone.
- [x] Propagate this reading through fleet state, its browser parser, and the daemon register/event
  boundary. Plan schema compatibility explicitly. Reuse the same identity derivation in fresh
  action revalidation; never promote a cached verified identity into current write authority.

  **Schema compatibility, decided rather than inherited.** No bump on either schema, by each file's
  own stated rule (*bump when a consumer that ignored the change would be WRONG*): a reader that
  ignores `execution` draws no continuity, which is poorer rather than wrong. Concretely — the
  fleet payload gains a field and `OBSERVATION_SCHEMA` stays 1, because a producer without it parses
  to `unknown`/`not-reported` and its rows stay inspectable; `STORE_SCHEMA` stays 2, and
  `verifiedExecution` is **the one field in `parseRegisterEntry` whose ABSENCE is forgiven** (an old
  `current.json` would otherwise be discarded on the first restart after the deploy, and the
  register is the thing there is no second copy of) while a **malformed** one still fails the
  checkpoint whole. Both are covered in `tests/overseer-store.test.ts`.

  **Fresh revalidation:** `verifyTarget` in `steer.ts` already re-derives against the live box on
  every write and never trusts a cached reading, which is the invariant this checkbox is about;
  `identityWriteGate` takes a reading rather than returning authority, and says so in its own
  comment. Giving `Verified` a durable token is a nice-to-have left for the write-path stage that
  owns `steer.ts`.
- [~] Key component/draft ownership to verified execution. A changed or unverifiable execution must
  quarantine the previous draft/results, show why continuity cannot be established, and disable
  identity-dependent writes. Transcript display needs a verified conversation claim; otherwise show
  it as unverified history, not the current conversation. Re-establishing the same verified identity
  can recover its draft. A process replacement does not inherit the previous duration as measured.

  **Done: the quarantine and the explanation.** `continuityOf(previousToken, reading)` returns
  `same` / `replaced` / `unverifiable`, each carrying the sentence a reader is shown, and
  `identityWriteGate(reading)` allows a write only when the execution AND the conversation are both
  verified — every other arm refuses with prose naming what is wrong. *"A process replacement does
  not inherit the previous duration as measured"* is enforced in the register fold: the
  `session-execution-changed` arm resets `statusSince` to a `lower-bound`, so a fresh Claude cannot
  be credited with its predecessor's hours.

  **Not done, on the stage's scope cut:** draft recovery, and the transcript-display arm — both
  belong to client components owned by another session, and there is no draft persistence in
  `tools/fleet/web/src/` to quarantine yet.
- [x] Test the actual row→wire→browser/register round trip, including old producers that omit the
  new reading. They stay inspectable with unknown continuity; do not cast them into verified state.

  The old-producer half uses **real old bytes**: every file in
  `tests/fixtures/overseer-snapshots/` was captured before this field existed, so all ten are
  genuine producers that omit it, checked through both independent readers.

**Acceptance:** a fresh Claude under the same shell is detected or explicitly unverifiable; it never
silently inherits a draft, transcript attribution or historical age. This stage supplies the invariant
used by the later status, continuity and confirmation stages. Keep tmux identity and process identity
distinct: a pane survives more than one execution.

### Stage: Box contracts — make the existing actions reach their intended inputs

**Status, 2026-09-10 (session `box-contracts`, queue item qi-qsxergb4): landed on `dev` at 1e7c8528; plan and
both review artefacts under `docs/plans/260909h-*`.** Every checkbox below is done except `actionRevision`,
which was cut on GPT Sol's finding that it cannot fire: `ACTIONS` is a static literal, so a changed
definition needs a restart, which mints a new `serverInstanceId`, which refuses the preview before any
revision is compared — a check that cannot fail is a claim, not a reading. The kill's identity (pid +
start ticks + boot id) does **not** close pid reuse between a candidate's own `/proc` read and its
signal; the durable fix is a pidfd, which Node cannot open without a native dependency, so it is a
recorded residual to revisit the day a kill acts on anything but test suites and orphaned browsers.
Also landed: Broadcast on the Box Health tab, which had never worked because `HealthPanel` was never
given rows. Accepted by the Overseer, 2026-09-10 00:00Z.


- [ ] First add failing tests passing `boxActionBody` through real `makeActionRoutes` with fake
  probe/run/steer dependencies. Cover kill preview→confirm and broadcast preview→confirm. Assert on
  recorded execution/recipient calls, not only HTTP 200.
- [ ] Extend existing `tools/fleet/wire.ts` with browser-safe action request/response shapes
  (types only, no imports, no runtime values). Give kill and broadcast distinct request arms.
  Runtime parsers still reject malformed inputs; compile-time sharing does not validate network data.
- [ ] Define the preview envelope explicitly: schema, previewId, serverInstanceId, actionId,
  actionRevision (hash of the action definition), expiresAt and typed canonical material. Keep a
  bounded in-memory preview table; expiry or server restart invalidates it. A run request must
  name that previewId/instance/revision and match the reviewed target material. The route checks
  these before any effect; an unknown preview requires previewing again. This binds material, not
  caller authority, and does not replace origin checks or fresh target revalidation.
- [ ] Preserve `op` and `action` in the parsed client outcome instead of discarding them. Test wrong
  operation/revision, expired preview and restart between preview and run.
- [ ] For kill, retain the preview's candidate identities in component state and submit only that
  reviewed set. The route re-probes and acts only on still-valid matches. Extend identity beyond PID
  to start time/boot context before enabling destructive confirmation; a reused PID is a new process.
- [ ] Pass displayed fleet rows through `HealthPanel`/`OrchestratorPanel` into broadcast preview.
  Capture exact target claims/status at preview; freeze them through confirmation. Do not refresh
  identities behind Greg's back. Return explicit per-recipient exclusions and reasons.
- [ ] Require a recognised action-specific preview with explicit `dryRun: true`, complete material,
  and matching action/target before rendering Confirm. Missing `dryRun`, false, malformed payload,
  and mismatched action must show a refusal/unknown state without an executable confirm control.
- [ ] Replace generic `RawValue` confirmation for these operations with candidate/recipient lists,
  exact action words, and explicit counts. Keep RawValue as diagnostic detail only.

**Acceptance:** the two real client→route happy paths produce exactly the fake effects reviewed;
changing a candidate generation, recipient identity, or preview shape prevents the unreviewed effect.
`FLEET_ACT_ENABLED` remains an operational gate; repairing code does not silently turn it on.
**Simpler alternative rejected:** adding `pids` alone fixes today's refusal but leaves PID reuse and
unknown previews as valid confirmation targets. Fable suggested PID plus elapsed age; that is also
insufficient: preview a one-second-old process, replace it, and leave the preview open until the
replacement is two seconds old. Its age passes that comparison although its identity differs.
Retain the bounded volatile preview binding and actual process-start evidence, but do not make
read-only status wait for them. This is local request binding, not a durable workflow engine.

### Stage: Delivery uncertainty — stop saying that failure means no effect

- [ ] Reproduce lost HTTP response after successful fake execution, partial text/failed Enter,
  unknown send result, and partial broadcast. Assert distinct display and next-drain behaviour.
- [ ] Change response/UI outcomes into operation-specific variants: steering has refused-before-effect, keys-submitted, partial and
  outcome-unknown; process actions distinguish command-exited from effect-observed, plus partial
  and unknown; broadcasts aggregate those per recipient. Do not reintroduce a generic submitted/Done
  arm that conflates transport with process outcome. Preserve route `delivery` details. Inspect `PlanRun.completed` and actual step results: `killRoute` currently labels intended PIDs as killed even when the run is incomplete. *(Corrected 2026-09-08 by the dashboard agent building this stage: `run.completed` is always true on that route, because `planKillProcesses` makes every step best-effort and `judgeStep` never maps best-effort to failed. The real defect was one level down — the intent list was reported while the per-step evidence sat discarded in the same response. Fixed in 854fac4b; do not look for a `completed:false` path.)* Report attempted versus observed effects explicitly. Never show `Nothing happened` for a
  network error or unreadable response. Show per-recipient counts for broadcasts.
- [ ] Quarantine a queue target after partial/unknown delivery; later items cannot drain into an
  uncertain input buffer. Preserve target generation and the uncertain item for inspection. Manual
  reconciliation may confirm/abandon with an explicit warning; it is not an automatic retry.
- [ ] Show queued, leased/in-flight, held, stale, unreadable and uncertain states in `FleetQueues`.
  Include queues whose only items are unreadable; do not label a lease as definitely unsent.
- [ ] Prefix queue item ids with a process instance UUID now. A stale cancel/revive/abandon request
  from the previous server instance must never resolve to its new `q1`. Full persistence comes later.
- [ ] Keep the volatile queue warning explicit. Preserve enough local outcome state to stop repeated
  taps within this server lifetime, without claiming restart-safe deduplication yet.

**Acceptance:** a partial first message prevents the second one from being submitted on the next
refresh; late error/timeout never invites a blind retry. Test cancel/revive against a new instance.
**Stop here:** existing controls become materially more trustworthy without durable storage work.

### Stage: Failure containment — the smallest bounds before richer monitoring

**Status, 2026-09-08: built, and reviewed by GPT Sol twice.** (An earlier draft of this line claimed the work had landed on
`dev`, twice, while it was still uncommitted. Sol caught it both times; the second attempt at a
self-verifying wording — *"in the commit that carries this paragraph"* — names a commit but says
nothing about whether it was pushed, which is the part that was false. So: no claim here at all, and
`git log -- tools/fleet/refresh.ts` is the answer.) Four bounds, each with a test that was watched red first — most of them by
mutating the fix back out and re-running, since the tests were written alongside the code.
**The running dashboard and daemon still serve the old code until they are restarted**; nothing
here is live until then.

**Sol's review changed the answer, not just the wording, and the P1 is the thing to read.** The
first draft destroyed an SSE subscriber the moment `res.write` returned `false`. That is wrong in a
way no test in this repo could have caught, because every test drove a double that returned `false`
because it was told to: a real `ServerResponse` has a **16 KB high-water mark** and a fleet snapshot
is **~59 KB**, so `false` is what a perfectly healthy client returns on its first frame, every time.
That draft would have disconnected every subscriber on every collection — **the Overseer daemon
included**, which would have recorded a genuine `sse-stream` degraded edge and dropped to polling for
sixty seconds, over and over. Sol measured it against a real response object (`writableLength: 60524`
after one 59 KB write) rather than arguing about it. The lesson is the one
[silent-success.md](../reusable/silent-success.md) keeps making: *the double agreed with the code
because it shared the code's assumption.*

- [x] Add a single-flight latch around owned collection attempts: a caller deadline does not release
  the underlying attempt. Repeated refreshes report the stuck child and retain old data, with no
  second child started until the first settles. Test never-settling, late-success and late-failure
  probes; late results must not overwrite a newer observation. Full cancellation follows later.
  <br>`singleFlightCollect` in [`tools/fleet/refresh.ts`](../../tools/fleet/refresh.ts), wired at
  module scope in `server.ts` (a latch built per call latches nothing). It keeps the child promise,
  races `collectWithDeadline` over that *same* promise rather than making a second call, and refuses
  to start a sibling while one is in flight — the caller gets `collectionStillRunning`, which
  `refreshOnce` puts in `lastError` beside the previous snapshot.
  **A late child's answer is logged and dropped, whichever way it went** — and the first draft of
  this got it wrong, which is worth recording. Handing a late SUCCESS to the next caller looks like
  thrift: it is a real snapshot that cost twelve seconds, and `collectedAt` carries its real age.
  But `refreshOnce` gives whatever `collect()` resolves with to `drain()`, which aims tmux
  keystrokes at the panes those rows name and decides *whether to send now* from each row's
  `status` — and `refresh.ts` already has the rule for that, six lines from the bottom of the file:
  **stale rows are how the right text reaches the wrong session.** A snapshot that arrived eight
  minutes after it was asked for is stale rows by construction. Using it for the page but not for
  the drain would mean teaching `refreshOnce` a third kind of outcome, which is a mechanism, and
  this stage is the smallest bound rather than a rewrite. Twelve seconds is cheaper than that.
  So the plan's *"late results must not overwrite a newer observation"* holds in its strongest
  form — **a late result never reaches an observation at all** — and there is no sequence counter,
  because there is nothing to sequence. `tests/fleet-refresh.test.ts` asserts it as *a late snapshot
  never reaches keep, publish or the drain*, and the assertion bites: putting the delivery path back
  turns it red.
- [x] For SSE, use the simplest bounded policy first: after `write(false)`, close/destroy that
  subscriber and remove it. The next connection receives the latest cached snapshot. Prove no
  further heartbeat/snapshot writes or retained subscriber remain; do not call false a dropped frame.
  <br>**Built as written, then corrected: the plan's own instruction was the P1.** *Close/destroy on
  `write(false)`* is wrong for the reason in the status paragraph above — `false` is the normal case
  for a 59 KB frame, not a symptom. What landed is the policy that reads Node's contract literally:
  `writeUnlessFull` in [`tools/fleet/live.ts`](../../tools/fleet/live.ts) marks the subscriber
  `waitingToDrain` and **writes nothing more until `drain`**, which is the memory bound (at most one
  outstanding frame per subscriber); `DRAIN_DEADLINE_MS` (30s, two heartbeats) is what turns that
  from a hope into a bound, destroying a socket that has not moved a byte. `destroy()`, not `end()`:
  `end` writes a final chunk and waits for it to flush, and the client we are giving up on is the one
  that is not flushing. It is still true that `writeUnlessFull` is the **one** place a `false` is
  acted on — `broadcastFrame` and `subscribe` each used to have a path that ignored it.
  **Measured in three runs, not one — and the third is the one that matters**, because measuring only
  the wedged case is how the destroy-on-false draft looked good. 5,000 × 59 KB snapshots:
  **(A)** a wedged socket, as shipped — one frame, **58.9 KB**, then destroyed at the deadline;
  **(B)** the old skip-and-keep policy — **287.8 MB** and still climbing;
  **(C)** a *healthy* socket whose `write` returns `false` every single time — **200 of 200 frames
  delivered, never disconnected.** (C) is the control Sol asked for; under the destroy-on-false draft
  it delivers one frame and hangs up. (`heapUsed` under-reports (B) badly — V8 keeps the
  concatenations as rope strings — so `writableLength` is the honest measure.)
- [x] Cancel unsuccessful SSE response bodies or keep a short deadline while consuming them, so
  error headers plus an unfinished body cannot prevent the Overseer's polling fallback. Bound
  incomplete frame and poll body sizes. Test each with a controlled source and raw Writable.
  <br>[`tools/overseer/source.ts`](../../tools/overseer/source.ts): `discardBody` cancels rather
  than drains on both unsuccessful paths, `readBounded` replaces `response.text()` on the poll
  (`MAX_POLL_BYTES`, 4 MB), and `sseFrames` now takes a bound and throws on an incomplete frame that
  passes it (`MAX_FRAME_CHARS`, 4 M characters) — thrown rather than flagged, because its one caller
  already catches into *this stream is broken, close it and fall back*.
  **The frame bound was wrong the first time and the test could not have seen it.** It checked the
  whole newly-appended chunk before extracting complete frames, so four small valid frames arriving
  in one TCP segment were an "overflow" — while every test in the file pushed one frame per `push`.
  Sol found it with 136 characters of four good frames under a 64-character limit. The rule is now
  per-frame and per-tail: a single frame whose terminator lies beyond the bound is refused, and the
  bound is applied to what is *left over* once every complete frame has been taken out.
  **The stream half was a genuine indefinite park, and the test shows it:** with a 503 whose body
  never ends, the fallback was never reached at all — the run took the test's own 5,000 ms abort and
  produced one message. The silence deadline is cleared one line above that `await`, so nothing was
  left to fire. The poll half was bounded but wasteful: it burned the whole 3 s poll timeout waiting
  for a body it never reads, which on the fallback transport is the difference between one late
  observation and none.
- [x] Surface these conditions through existing error/age UI. Keep the later responsiveness and
  transport stages for comprehensive lifecycle work; do not turn this small repair into a rewrite.
  <br>**No new channel, and no new code for this bullet** — which is the intended answer for three
  of the four, and an honest gap for the fourth.
  The stuck child becomes `lastError` and renders in the error-and-age UI that already exists. The
  source's new sentences ride the existing `stream-closed` / `poll-failed` messages, which
  `daemon.ts` already turns into `sse-stream` / `poll` condition edges carrying `why` verbatim.
  **`attemptedAt` keeps its meaning, and that took two goes.** The first draft advanced it on every
  loop turn, on the argument that *the loop is turning and getting nowhere* is worth distinguishing
  from *the loop has stopped*. Sol's round-2 P1 killed it with the consequence: **five things read
  that field as the moment a collection began** — `web/src/Header.tsx`, `attempt-clock.ts`, and the
  Overseer's `daemon.ts`, `observation.ts` and `notes.ts` — so with a child wedged for seven minutes
  the page would have rendered *a collection was started 0s ago* while `lastError` said the opposite.
  Changing a field's meaning means migrating its consumers, and those consumers are five files in
  three ownership areas, which is a bigger change than this whole stage.
  So the latch got an `onStart` callback and `server.ts` writes `attemptedAt` from that: the field
  advances exactly when a child actually starts, every existing reader stays correct, and **not one
  file outside this stage's set had to be touched.** A wedged collector now reads: `attemptedAt`
  frozen at the wedged child's start, the page saying *started 7 minutes ago*, `lastError` saying
  why. All three true at once.
  **The gap, stated precisely on the third attempt:** a subscriber that is *destroyed* is observed
  downstream perfectly well — the Overseer sees its stream end and opens an `sse-stream` condition
  like any other closure — but **the backpressure-specific cause is not distinguishable**, and a
  *pause* that drains within thirty seconds is not surfaced at all. The first draft here claimed it
  showed in the live count `server.ts` logs (false: `refreshOnce` reads that count *before*
  `publish()`, the call that can drop one); the second overcorrected to "not surfaced anywhere"
  (too broad, per Sol's round 2). A short pause does not need surfacing — it is bounded and
  self-healing — and giving `live.ts` a logger would hand a module with deliberately no import side
  effects a dependency. What is genuinely missing is only the *why*.

**Not built, deliberately:** cancellation. The latch bounds the *number* of children at one, which
is the cheap half; killing the wedged one is a later stage, and a `SIGTERM` to a child in
uninterruptible IO proves nothing anyway (`source.ts`'s own header, 2026-09-08).

**Acceptance:** repeated failure cannot accumulate collectors or unlimited socket/parse buffers,
and an error stream cannot trap supervision forever. This advances Sol's early priority advice
without postponing useful attention behind full performance optimisation.

### Stage: Overseer status — replace the placeholder with real history

**Status 2026-09-08 evening: built, reviewed by GPT Sol, and landed on `dev` in the commit that
carries this paragraph.** Session `260908f-overseer-status-card`, worktree of the same name. The page
now says *Overseer last wrote 30s ago; its fleet source last updated 45s ago*, warns on a stale source
while the heartbeat advances, and refuses schema 1 by name. The three decisions the brief left open
are recorded under the checkboxes; Sol's findings and what was done about them are at the end.

- [x] A fleet-owned read-only boundary for `current.json`: [`tools/fleet/overseer-status.ts`](../../tools/fleet/overseer-status.ts),
  a sibling of `attention.ts` that **shares its file read** (`loadCheckpoint`, split out of it). Four
  outcomes in this file's existing vocabulary: `checkpoint-absent | checkpoint-unreadable |
  unsupported-schema | published`, plus `not-asked` as the parse default. No catch→empty anywhere.
- [x] **Served on `/api/state`, not as `/api/overseer` — and this is the decision to notice.** The
  brief allowed either; one payload wins because the card's central sentence puts the inbox's clock
  and the checkpoint's clock side by side, and a second endpoint is a second `servedAt` to
  skew-correct, a second cache, and a second thing that can be down while the page looks fine. It is
  also **one file read**: `readCheckpointFeeds` projects both feeds from the same bytes, so the two
  clocks cannot come from two versions of a file that is replaced by atomic rename. **No cache, on
  purpose**: ~10KB read per payload, exactly as the inbox already was; nothing reads `events.jsonl`.
- [x] Supports schema 2 and refuses anything else by name (`saw` and `known` both on the arm, because
  this is the one failure with an action attached). The live schema-1 file renders as incompatibility.
  No adapter was written: schema 1's `statusSince` is a bare timestamp, so every duration would be a
  guess, and the daemon on the box now writes 2.
- [x] Heartbeat age, source age, and `≥`-marked durations, copying `describeStatusAge`'s rule from
  `scripts/overseer.ts`. The stale-source warning is drawn whenever the source is stale, **including
  when the write is fresh** — the case a heartbeat-only watchdog blesses. The card carries the
  daemon's own `snapshotStaleAfterMs` rather than restating a constant (the watchdog/daemon drift,
  GPT Sol's C6, one consumer further out); it names its fallback when the daemon did not say.
- [x] Global status only — **no row join was built**, per "ship it without one first". The register is
  drawn as the Overseer's history, under its own heading, saying on screen that it is not matched to
  the Sessions tab. So there is no *claimed history* label to earn yet, and the generation tuple stays
  the Execution identity stage's problem. The register is bounded (longest-waiting 8) with the total
  beside it, so the payload grows by a few hundred bytes rather than by the fleet.
- [x] `OverseerPanel.tsx`'s daemon-absent narrative and hard-coded roadmap are **deleted**. The queue
  controls and the broadcast are unchanged. The refusal to draw a message box stays and is re-argued
  on today's facts: a daemon that publishes a checkpoint is still not an agent that can receive a
  message.
- [x] Contract tests: [`tests/fleet-overseer-status.test.ts`](../../tests/fleet-overseer-status.test.ts)
  (27) and [`tests/fleet-overseer-panel.test.tsx`](../../tests/fleet-overseer-panel.test.tsx) (25),
  plus one join test in `fleet-web.test.tsx` for the `App` → panel hop. **The happy paths run against
  a checkpoint the real store wrote** — `openStore` → real events → `store.checkpoint()` — because a
  hand-written fixture only proves the test and the reader agree, and this reader deliberately does
  not import the producer's parser. The pathological cases (schema 1, a future schema, torn, empty,
  a widened `scheduler.kind`, a bare schema-1 `statusSince`, a half-written register entry) are
  hand-written, since a producer cannot be asked to emit them. Three mutations were run against the
  reader — accept any schema, unknown scheduler kind → `off`, drop bad register entries — and each
  turned the expected tests red.

**Two things the plan did not know.** (a) `scheduler.kind` degrades to *cannot read this part* rather
than failing the card, at 260908g's request and rightly — but an ABSENT scheduler line degrades the
same way rather than to `not-said`, because `not-said` is the daemon's claim that nobody decided and
an old checkpoint made no claim at all. (b) The wire types went in as one block at the **end** of
`wire.ts` at the dashboard agent's request, to merge cleanly with its own additions the same night.

**Files outside the stage's declared set that the design required**, all additive and named here
rather than assumed: `web/src/types.ts` (the client parse — a required wire field cannot reach the
browser without it), `web/src/App.tsx` (three attributes on one element), `server.ts` (one import and
one field, made last after merging `origin/dev`), and the five test files whose `fleetState(…)` call
sites the new required parameter broke, which is the mechanism working as designed.

**GPT Sol's review (`gpt-5.6-sol`, high effort), and what it changed.** No P0. Three P1s, all
accepted and fixed:

1. **The browser accepted any nested checkpoint schema.** The server refuses an unknown version — but
   a NEWER server sending schema 3 inside a `published` arm would have been drawn by an old tab, off
   fields whose meaning had moved, and it would have looked healthy. The client now checks the
   version too (`KNOWN_CHECKPOINT_SCHEMA` in `web/src/types.ts`), which is what the second parser is
   for. The three mutations run before the review had all been on the server boundary, and so missed
   this entirely.
2. **An unbounded `snapshotStaleAfterMs` could bless a dead source for ever** — a fresh `writtenAt`,
   a source from 2020 and a deadline of `1e300` rendered as *supervision is running*. Both boundaries
   now refuse a deadline outside a fleet-owned ceiling of an hour and fall back to the page's own,
   naming it.
3. **`not-asked` collapsed two silences.** It meant both *no payload yet* and *a payload from a server
   that does not report supervision*, and drew nothing for both — so a rollback put the tab back to
   its pre-stage appearance with nothing saying why. `null` now means the first and draws nothing;
   `not-asked` says the server did not report it.

**Round two**, on the fixes. No P0. One P1 and it was right: refusing an *absurd* deadline still let
a *malformed* one become **the daemon did not say** — so a four-minute-old source with a deadline of
one hour and one millisecond read as healthy off a number nobody could have meant. Absent and invalid
are now different: absent falls back and **the card says whose deadline it is using, on the healthy
path as well as in the warning**; invalid fails the reading, because the deadline is part of the
health judgement rather than a decoration on it. Of round two's P2s: the client now reads the
checkpoint's version **before** parsing the body, so a future schema whose shape has also changed
still produces the diagnostic naming both versions instead of a shrug; the end-to-end join runs with
a browser clock **twenty** minutes fast rather than four (at four, deleting the skew correction left
every assertion green, because both thresholds are five) and asserts the exact ages; and the
*never throws* comment now says what it actually guarantees — no value `JSON.parse` can produce can
throw out of it, which is not the same as every value of type `unknown`, and Sol demonstrated the
hostile Proxy that escapes it.

Of round one's four P2s: the *never throws* guarantee was made true rather than narrated (`JSON.stringify`
throws on a cyclic value and on a `bigint`, inside the one function that promises not to); the
"one read" test was measuring nothing, so the real property — **one read per payload** — is now
counted against `statePayload`, and the old test renamed to the weaker thing it proves; the
end-to-end join now runs with a browser clock four minutes fast and asserts a `≥` floor survives
the browser parser; and the status line above no longer claims to be on `dev` before it is.

**Acceptance:** the web page can say *Overseer last updated 12 minutes ago; fleet source last updated
15 minutes ago* honestly. Claimed history is clearly distinct from a verified current duration;
*blocked for at least 20 minutes* needs evidence of continuity. Failure of this projection leaves
Sessions usable. This is the cheapest major new capability and the first delivery's stop line.

### Stage: Work evidence — connect the classifier that is already written

**Status, 2026-09-10 (session `work-evidence`, queue item qi-z8ascd78): landed on `dev` at 99dbefaa; plan
`docs/plans/260909h-wire-the-work-classifier-into-the-overseer-daemon.md` carries four review rounds
and a live measurement.** Every checkbox below is done: one process-table read per inventory that
reaches a checkpoint (below the `held` check, not "accepted" — an accepted inventory can still be
held and thrown away), a timestamped `work` field beside pane status, *cannot tell* on a failed
probe, the evidence in session detail, and a daemon integration test for the once-per-checkpoint
probe. The measured ceiling, written into `overseer-direction.md`: on the live box the two sessions
carrying work (`codex exec` reviews at depth 5, 27m and 13m) already read as `shell`, so this
enriches busy rows rather than revealing idle-but-working ones. GPT Sol's placement of the classifier
in `tools/fleet/collect.ts` is queued as qi-b4kthmn5. Daemon and dashboard restarted by the
Overseer 2026-09-10 00:28Z.


- [ ] Add a daemon integration test proving `probeProcessTable` is called once per accepted fresh
  inventory, and `classifyPaneWork` results reach persisted projection and browser. A helper unit
  test alone does not close E-work.
- [ ] Probe once for all panes; inject the reading and clock. Retain process start identity and
  unknown ancestry results. Add a separate timestamped `work` field; do not overwrite pane status.
- [ ] Show review/test/browser/other work with elapsed age when known, and explanatory evidence in
  session detail. Use existing recognisers first. A shell's actual foreground command is useful;
  avoid an unbounded recogniser catalogue or raw environment/command-secret display.
- [ ] Test deep wrapper trees, foreground and background review, missing process table, exited child,
  PID reuse, and no child work. Use existing process-tree fixtures and one disposable positive control.
- [ ] Preserve the direction doc's empirical caveat: foreground reviews often already look working;
  the value is richer explanation and catching background/stuck work, not fixing every idle row.

**Acceptance:** browser fixture shows `pane: idle; work: review running 18m`; a failed process probe
says cannot tell rather than idle. No new full fleet collector or model call exists.

### Stage: Attention inbox — a useful first version without model calls

- [ ] The **daemon** produces question/dialog and duration evidence using the existing `AttentionList`
  type and the checkpoint integration commissioned in Wave 2 Stage A. The type exists; check whether
  its producer/persistence has landed before wiring it. Fleet's `/api/overseer` boundary validates/projects it;
  the browser renders it. Fleet may add visibility cards for a stale heartbeat/source or unreadable
  checkpoint, but must not build a second question detector from `needs-you`. Reuse `wire.ts`.
  Work evidence enriches these cards when available; a missing classifier does not hide questions.
- [ ] Derive attention cards from verified current questions, historical duration, stale supervision,
  permission/launch defects, and explicitly reported completion when available. Start with the
  first four; absent completion evidence is not a completed task.
- [ ] Separate `question for Greg`, `harness/launch problem`, and `visibility problem`. Show why
  each card is here, age/evidence quality, affected session, and its existing detail/terminal path.
  Prose questions remain **not yet detected** rather than silently counted as covered.
- [ ] Use a small deterministic priority tuple: consequence/reversibility category, then waiting
  age, then stable id. Do not introduce a numeric model-confidence score. A never-observed start
  time cannot outrank measured duration by pretending it is exact.
- [ ] Freeze an opened card's identity, wording and options. Incoming changes show an Update available
  marker and invalidate the old submission; they must not move a button under a finger. Answering
  uses the existing guarded route and only supported agent-question dialogs. Claimed/unverifiable
  cards remain inspectable through detail/manual terminal paths; they cannot acquire answer authority
  from a read-only history join. Only expose an answer control whose fresh target checks establish
  the required identity. Full continuity improvements must not gate viewing the list.
- [ ] Do not remove a card when Send is pressed. Mark submission pending/uncertain, and resolve only
  on fresh matching evidence that the question changed/disappeared. Preserve an unresolved outcome
  if the session vanishes. Group one shared outage separately from its affected sessions.
- [ ] As an optional follow-on after the question inbox, add cheap work-context hints only when current evidence supports them: observed current work
  in the primary checkout, or elapsed time since a verifiable push. Treat them as context for human
  review, not proof of misdirection. `meta.dir` is a launch directory and can remain primary after
  `EnterWorktree`; do not use it as current-directory evidence. A commit time is not a push time.
  If the needed evidence is absent, record unknown and defer the hint instead of adding a collector
  or fabricating a warning. Read-only/planning work in primary is allowed and must not be called a bug.
  Wave 2 explicitly defers misdirection; these hints must not expand its completion criteria or delay
  its already commissioned prose-question detection.
- [ ] Add desktop and phone tests for keyboard focus, reordered background list, changed dialog,
  one affected session disappearing, and stale source. Review with Greg after a working v1 exists;
  continue independent reliability work while awaiting optional presentation feedback.

**Acceptance:** Greg can identify and handle a real supported question from a stable card, and see
why permission defects or unknown supervision need a different action. This mechanical slice costs zero model calls at idle. **It is not the complete Wave 2 attention
commitment.** Add the next slice before claiming attention triage is complete; push remains deferred.

### Stage: Attention completeness — integrate the prose questions already commissioned

- [ ] Inspect Wave 2's attention producer and existing `AttentionEvidence`/`AttentionList` first.
  Integrate its detector if landed; otherwise complete that workstream using its agreed seam. Do
  not start a second independent transcript classifier merely because this plan names the outcome.
- [ ] Test a small labeled/sanitized set including a final decision without a question mark, a
  rhetorical question, finished work, permission defect and background review. Publish coverage
  (`sessionsScanned`, evidence age, unsupported/unreadable counts) so zero findings is interpretable.
- [ ] Feed bounded changed-turn evidence into short-lived classification only where mechanical
  observations cannot answer. Reuse wrapper timeouts, strict output validation and cached results
  keyed by verified execution + content hash + classifier version. A conservative initial budget
  is one classification in flight, at most four changed sessions per five-minute batch, and an
  explicit daily token/call ceiling in configuration. Tune from measured useful yield; these are
  proposed starting bounds, not provider quota facts. Exhaustion leaves unclassified evidence visible.
- [ ] Use the existing `scripts/run-claude.ts` wrapper for an out-of-session Claude classifier.
  Record its configured model and credential/account source without secrets. The machine login may
  share the Max quota being monitored: a quota refusal becomes an explicit classification-unavailable
  state with retained last-good evidence/age and backoff, never a successful zero-result scan.
  Mechanical supervision remains independent of model availability. Do not silently fall back to
  paid API credentials or another account; a different provider follows the agreed gateway policy.
- [ ] Render inferred prose cards distinctly, with exact bounded evidence and why they were surfaced.
  Their first action is opening detail/manual response, not automatic routing or steering. Preserve
  immutable card material and draft identity. Do not turn a detector into authority to answer Greg.
- [ ] Measure recall/false positives on the labeled examples and compare a read-only sample against
  what the mechanical inbox missed. Keep already authorised concurrent work moving; if inference
  cannot meet useful precision/cost, explicitly record the unmet requirement and get the product
  choice rather than silently declaring the mechanical subset complete.

**Acceptance:** a real-shaped prose-ending question missed by `needs-you` reaches the inbox with
attributed inference and bounded cost; a rhetorical question does not. Paid classification does not
run on unchanged evidence. Later Bounded judgement extends this with proposed assistance/routing;
it must reuse this detector, not replace it with another per-session mining loop.

### Stage: Responsive collection — monitoring must keep answering while it measures

- [ ] Measure collection duration and cached state endpoint latency during a real interval sample
  and fake slow pane probes. Record median/p95, fixture size/session count and command. Historical
  12-second grepping is context, not a current benchmark.
- [ ] Convert remaining synchronous collection/health subprocesses on the fleet request process to
  asynchronous bounded probes. Preserve per-field unknown results and separate health failure from
  fleet failure. Run cheap independent probes with a small concurrency limit, not one process per
  session simultaneously. Keep swap's since-boot sample excluded.
- [ ] Replace deadline-as-abandonment with owned child lifecycle: timeout/abort, bounded termination
  grace, and observation of exit. Do not start replacement collectors while an old owned collection
  is still alive. A child stuck in uninterruptible I/O becomes degraded/stuck, not infinite retries.
- [ ] Reuse the process-group lifecycle ideas in `scripts/subagent-cli.ts` without importing its
  product dependencies into fleet. If extracting shared code, keep the helper small and pure at the
  seam. Never kill a group without proving it belongs to this probe.
- [ ] Optimise `buildSessionScript` title lookup using a bounded tail or identity/size/mtime cache.
  Missing title in the tail is unknown/previous-known, not evidence the title was removed. Preserve
  pinned manual names, provisional-name semantics, transcript relocation and title changes.
- [ ] Keep the chain from collection end and failure backoff. Publish attempted/failed/last-good
  state even when a probe cannot complete. Include all probes in the total deadline/cost measurement.

**Acceptance:** a fake 30-second probe does not hold `/api/state` or health rendering open; on the
controlled fixture cached requests stay below a provisional 250ms p95, with realistic results
recorded separately. Repeated timeouts do not multiply live owned children. No collection-speed
improvement is claimed without before/after output.

**Status (2026-09-10, Overseer): landed on dev at e0e82fca, session `responsive-collection`, plan
[260910c](260910c-responsive-collection-monitoring-must-keep-answering-while-it-measures.md).**
Measured with its own instrument (`scripts/fleet-collect-bench.ts`) on the 25-session fixture under
a 30 s capture: `/api/state` p95 went from 30,018 ms to 7.2 ms, and a production collection turn
holds the request thread for about 40 ms where it held it about 1.6 s a minute. Wall times are
unchanged; the claim was a free thread, not speed. `tools/fleet/child.ts` is the owned child
(freed at timeout plus grace, SIGTERM then SIGKILL to a process group proved at spawn, pid reuse
checked by `/proc` start time before every signal, a per-key refusal ended only by an observed exit
or kernel proof); health, the tmux probes and captures, and the two `ps` calls of `readExecutions`
all go through it. The finding that reshaped the plan: `execFileSync`'s timeout signals and then
waits without bound (1,000 ms asked, 20,019 ms measured), met twice before and fixed only where it
hit — postmortem `260910a-a-timeout-that-signals-and-then-waits-is-not-a-bound.md`; the remaining
synchronous sites are queued (qi-xdvh82cs). Also found: the collector's this-box `selfCheck` has
been inert in production since the systemd move (qi-j4jyf3ab, postmortem 260910b); a concurrency
limiter bounds pending calls, not the children that outlive a timed-out call (twice). The title
cache checkbox was dropped on measurement (dec-wyaanpzm; revisit condition in the plan). Known, not
fixed: the owner's registry is in memory, so a restart forgets a stuck survivor; `routes-new.ts`
still takes the synchronous quick health on session creation. The daemon still calls the synchronous
`probeProcessTable`.

### Stage: Resource history — show what was happening when load rose

- [ ] Integrate the dashboard-owned Wave 2 health history at `~/.fleet-health/` first. Preserve its
  single-writer lock. Use existing health reports and work ancestry to display a bounded 24h trend for load per
  core, available memory, swap activity and disk. Store changes/events at a deliberate cadence;
  derive a small current summary, avoiding history scans by every browser. A restart/source gap is
  a visible gap, never an interpolated healthy line; a 20-minute history must not imply 24h coverage.
- [ ] Show top contributing job groups including children; explain attribution uncertainty and
  avoid double-counting a wrapper plus its leaf process. Use WorkReading/probe ownership already
  added rather than a second `ps` per pane. Keep raw command lines out of routine UI/logs.
- [ ] Surface current expensive work, time running and any missing readings. Retain thresholds in
  one policy module with evidence; unavailable memory is not zero load or unlimited capacity.
- [ ] Test one job with several descendants, missing/partial process data, stale vitals, normal
  swap residency without current swapping, and expired history. Browser-check readable small trends.

**Acceptance:** the page can relate a resource spike to observed concurrent work with its timestamp
and uncertainty. v1 has simple trend charts/tables, no metrics backend or forecasting model.

**Status (2026-09-10, Overseer): landed on dev at 111b2062, session `resource-history`, plan
[260910a](260910a-resource-history-what-was-running-when-load-rose.md).** The half that already
existed was the 24h health store and its chart; the half that was missing was a *stored* work
history, because the checkpoint's `work` is overwritten every pass and could not answer the
acceptance sentence at all. Now: one policy module for the cutoffs (the collector and the browser
had five separate copies), a fourth `work` projection out of the one checkpoint read, a
byte-bounded work summary written onto each five-minute health sample, disk as a fifth series, a
"work beside the load" section, and a live `currentWork` never derived from the history. Rendered
sentence at 400px: peak load, the load sample's timestamp, the nearest work scan and how far off
it was, and the memory attribution from the same survey turn. Found on the way: a rotation bypass
older than the branch (`sample-omitted` records skipped the size check, so the file could grow
without bound — fixed, mutation-verified); capping the number of groups capped no bytes (Sol);
rows labelled with session UUIDs rather than names, and one line per observation making the page
5,713px tall — both found only in a browser, both passing every test. Names are now stored beside
the key because a history outlives its sessions. Left standing: `fleetState` takes ten positional
arguments (pre-existing).

### Stage: Admission visibility — reuse the gate already present

- [ ] Read `vitest-admission.ts` and its tests before designing caps. It already checks memory and
  resolves workers; the missing capability is shared visibility and broader launch coordination.
- [ ] Expose the same decision/policy revision as a read-only explanation: what would be admitted,
  reduced, refused, or unknown now. Do not independently reimplement thresholds in the browser.
- [ ] Show active heavy tests/reviews/browser jobs and the last refusal. Explain whether a signal
  is an enforced admission decision or an advisory resource claim. A claim file is not a lock.
- [ ] Add a typed admission request shape (`kind`, estimated cost class, owner/execution, requested
  time), starting with test/review/browser categories. No system-wide enforcement claim yet.
- [ ] Test low available memory, missing probe, concurrent visible jobs, and policy version mismatch.

**Acceptance:** an agent and Greg can find out why work should wait. This stage has value even if the
next one never ships. Keep the cheap practice: parent runs integrated gates once per finished stage.

**Status (2026-09-10, Overseer): Stages 1–3 on dev (e4206867, b1a2feaa, 4ebd60b5), session
`admission-visibility`, plan
[260910a](260910a-admission-visibility-explaining-why-heavy-work-should-wait.md); Stage 4, the
census of live process roots, dispatched to a fresh session `admission-census` from the task file
the first session wrote.** `GET /api/admission` answers what the vitest gate would say now, with
its policy revision, as a forecast in neutral colour (a hypothetical refusal is not a live
incident); the section lives on Box Health, not a tab (Greg's to move); a refusal writes one file
per refusal, published by atomic rename. That last design replaced an append scheme whose
load-bearing claim was false: a sub-`PIPE_BUF` `appendFileSync` is not atomic on a regular file
(reproduced with `RLIMIT_FSIZE`: sixty bytes of a JSON object left on disk, and the next append
joins it so the reader loses both records) — it had borrowed `health-history.ts`'s scheme without
its single-writer lock. Recurring defect across every stage: a true number under a label claiming
more (twenty-one P1s across four reviews). The would-refuse replay was cut rather than fixed; its
design survives in the plan's §6. Evidence not in the plan: the box killed the session's
background processes twice at 17–20 GB available with 13.4 GB swapped, leaving no trace.

**Stage 4 landed (2026-09-10, Overseer): on dev at 11189395, session `admission-census`, plan
[260910d](260910d-admission-census-recognised-process-roots.md); the stage is complete.** The
admission section's third block, "Recognised live process roots", counts vitest runners, Codex
batch jobs and browsers observed during the census's last pass over `/proc`, with the pass's start
and end, per-class uncertain, changed-under-read and unreadable counts, and claims presence only
(never "heavy", never "active", and a Codex run is never called a review; even "alive right now"
was too strong over a 0.3–0.6 s async pass). The worst bug was found by measuring on the box, not
by any test or reviewer: Codex's sandbox sees a three-process pid namespace, so every fixture was a
tidy table, while the real box returned 387 of 876 rows unreadable (kernel threads and zombies with
empty cmdlines). Reuse surfaced a live Kill bug: `isVitestRunner` matched any argv token naming a
vitest path, so the test-suites kill policy could have killed an editor; it now matches the
executable position only and refuses strictly more. Final measurement: 875 processes, a 428 ms
pass, 12.6 ms worst loop stall on a 30 s end-chained cadence. Reservation: the section's browser
refresh grew ~130 lines of lifecycle code in review, the first thing to simplify if it moves.

### Stage: Enforced launch admission — bound work we actually launch

- [ ] Decide with evidence whether existing memory admission plus serial parent gates is sufficient.
  If so, stop at visibility. Otherwise implement a small host-local admission owner with atomic
  reservations, not independent check-then-spawn files that race.
- [ ] Integrate known launchers (`run-codex`, `run-claude`, scheduled jobs, controlled browser/test
  jobs) gradually. Preserve timeout/cancellation, record process start identity and descendants,
  release only on observed completion, and reconcile abandoned reservations after restart.
- [ ] Use conservative no-overlap by class/job for v1, with bounded waiting/cancellation and displayed
  reason. Test two simultaneous launch requests against one slot and a parent dying after admission.
- [ ] Clearly label unmanaged shell jobs as observed/uncontrolled. This is not a guarantee that no
  user can launch work from SSH. Do not use `SIGSTOP` as memory relief or auto-kill unrelated work.
- [ ] Show queue position/reason in dashboard and CLI; provide an explicit manual override with
  recorded actor if Greg wants it. New unattended pause/kill/steer behaviours require his decision.

**Acceptance:** two controlled requests cannot both claim one slot; a wedged/unknown child does not
silently release capacity. Starting the admission owner costs no model calls and little idle work.
**Trade-off:** this is real coordination machinery; do not introduce it without measuring need.

### Stage: Usage visibility — one account, honest freshness

**Status 2026-09-09 (session `260908f-roadmap-usage`): built, under review — not yet on `dev`.**
(This line says "landed" only once a sha exists; GPT Sol caught it claiming so while every file was
still uncommitted in a worktree.) Boundary wiring, as the brief
predicted — `collectUsage` already ran on its own 300 s timer and stored a report every tick, and
nothing rendered it. What arrived: `projectUsage`/`groupUsageIncidents` in a new
`tools/fleet/usage-feed.ts`, a third projection out of the one `loadCheckpoint` read in
`readCheckpointFeeds`, `UsageFeed`/`UsageSummary`/`UsageIncident` at the end of `wire.ts`, a browser
parser and a card, and the three-zone clock Greg asked for as a leaf formatter, `tools/fleet/zones.ts`.

Four things the plan did not know, each found by running it rather than by reading:

- **Anthropic's `resets_at` is not `toISOString()` form.** `~/.claude.json` writes
  `2026-09-09T02:50:00.313670+00:00`; a strict round-trip check on that field rejected every cached
  window, which failed the cache, which degraded the whole report to *no usage pass has run*. A page
  confidently reporting an absence off a file that was fine. `instant()` in `usage-feed.ts` parses
  permissively and emits canonically; the fixture pins the awkward form.
- **"Not reset" is not "in force", and the card may not upgrade one to the other.** An earlier draft
  drew **IN FORCE seven_day** over a live verdict of **UNKNOWN**. `computeUsageVerdict` classifies
  every unexpired rejection three ways — `ours`, `contradicted`, `unattributable` — and only the
  first may set `limited`, because a `/login` swap leaves the previous account's 429s in the
  transcripts and a transcript rejection carries no account id. The verdict is the only thing on the
  card that claims the account is blocked; the incident row states whether the window has reset.
- **Nine incidents, eight of them history.** Drawn as nine equal rows the one that matters is the
  middle of a wall of dates, so both renderers show the unreset ones in full and count the rest.
- **`~/.overseer/` has six files, not five.** `attention.json` added to the direction doc's seam
  table, as the brief assigned.

**Why the wire carries a narrowed `UsageSummary` rather than the stored report**, measured on the
live checkpoint by session `usage-limits-tab` while planning the history tab on top of this: the
`usage` blob is 61 KB of a 99 KB checkpoint, and `rateLimits` is **96%** of it — 140 hits that group
to **9 incident clusters**, 4.2 KB against 58.4 KB, a 14× reduction. Its third argument is the one
neither session had at first and is the strongest: a raw hit carries `transcriptPath` and `message`,
so anything storing raw reports copies project and worktree names, and API error prose, into a
long-lived file that nothing prunes. Grouping before the data crosses is what keeps the field a few
hundred bytes whether the box hit one limit or thirty.

Deliberately not built: any connection to *new-job* deferral. The measurement that would drive it —
whether a rejection is attributable to the logged-in account — is `usage.ts`'s and is `unknown` on
this box most of the time, so a gate hung off it would defer work for a limit that is not ours.
Named here so the next stage decides it rather than inherits it.

- [x] Revalidate the direction doc's locally observed usage sources against installed CLI output.
  Read only fields needed for account label/window utilization/reset and transcript rate-limit events;
  never export credentials, tokens or entire config. Use bounded incremental transcript offsets.
- [x] Model actual observed rate-limit events separately from cached utilization hints, with source,
  observed time and reset time. Expired cache entries become stale/unknown; no fabricated percentage.
  Distinguish 5-hour and 7-day windows and account identity; a post-reset old 429 is history.
- [x] Show a small usage card with uncertainty and a source timestamp. Group sessions affected by the
  same account/window incident. ~~Connect only reliable blocking evidence to *new-job* deferral~~ —
  **not built, deliberately**; see the status note above. No credential is rotated and no running
  work is paused by anything here: the card is read-only.
- [x] Test malformed/missing cache, account change, 429 event, expired reset, clock correction and
  overlapping limits. Prefer sanitized fixtures; do not perform paid requests to measure headroom.
  (`tests/fleet-usage-feed.test.ts`, `tests/fleet-usage-card.test.tsx`, `tests/fleet-zones.test.ts`;
  no paid request was made — the only live commands run were `overseer status` and one bounded
  `overseer usage --since-hours 24 --max-transcripts 40`, both local reads.)
- [x] Recheck official provider documentation if proposing a new usage API. **None is proposed**: the
  reading rules and their evidence are `tools/overseer/usage.ts`'s and were reused unchanged. No
  admin key is asked for.

**Acceptance:** the page says what it knows about the current account and what it cannot tell;
thirty sessions affected by one quota window create one incident. Multiple-account rotation remains
medium-term and outside this batch. No unattended credential changes.
**Met** — the acceptance line is `tests/fleet-usage-card.test.tsx` § "the join, all five hops": ninety
rejections across thirty conversations in a checkpoint the real store wrote, through `statePayload`
and `parseFleetState`, arriving as one row reading *30 conversations, 90 rejections*.

### Stage: Session continuity — protect drafts and keep context current

- [ ] Test replacing an execution under the same tmux handle. Key detail state and transcript reads
  by the verified execution identity introduced earlier; clear outcomes that belong to the old execution. Fix the
  `answeringOff` lifecycle to match the actual new-dialog/new-target reset policy.
- [ ] Store unsent drafts per execution and input purpose. Prefer sessionStorage for v1; handle
  denied/full storage, provide Clear, and do not retain secrets/whole transcripts. If restoring
  after complete browser termination needs localStorage, make retention/expiry a product choice.
- [ ] Refresh recent messages on meaningful new snapshot/turn evidence, with one request in flight,
  cancellation on identity change, and an explicit last-read clock/error. Keep the existing bounded
  reader and manual refresh; do not start transcript polling per row.
- [ ] Preserve Baseline's discovery deadline and conversation-claim refresh regressions; extend
  them for late discovery, component unmount and duplicate tap. Do not redo those earlier fixes.
- [ ] Give `useActions` the state transport's visibility/online behaviour, pending refresh handling,
  fetch abort and last-good age. Keep its separate data cost/clock and never refresh target identity
  as a side effect of confirming an action.
- [ ] Add small text search/filter to Sessions only if the current list makes finding a known task
  cumbersome; preserve selection and URL parameters. Keyboard labels, focus and touch targets are
  acceptance criteria for existing controls, not a new design-system project.

**Acceptance:** suspend/resume preserves the right draft; a replacement session never inherits it;
creation polling terminates under permanent failure; recent messages cannot display a previous
execution as the current one. Browser-check 390px and desktop, keyboard-only and offline return.

**Status (2026-09-10, Overseer): landed on dev at 7741259a, session `session-continuity`, plan
[260910c](260910c-session-continuity-protect-drafts-and-keep-context-current.md); the stage is
complete and the four acceptance sentences hold.** Everything the browser holds about a session now
follows the run (and the verified conversation) rather than the tmux handle: a replaced Claude
inherits no half-typed message, outcome card or refusal; drafts are keyed by conversation in
sessionStorage with a generation ticket so a success clears only the exact text it sent; the
recent-messages and actions feeds carry a last-read clock, keep their errors and re-read on
evidence; one tap on Start is one launch. Fable's ruling replaced Sol's "withhold everything while
unverified": cannot-tell keeps live controls behind a caveat, a conflicting conversation disables
Send and Queue (dec-qbxkb4wt, pending Greg). Two postmortems: React batching erasing a transport
event (every transition test had pushed payloads in separate acts), and a mutable text hook
erasing the submission it produced. The Stage 2+4 Sol review died at its 45-minute wall having
found and fixed four real defects; an independent Opus agent verified them red-first rather than
a Codex rerun. Browser-checked at 390 and 1280 px, keyboard-only and offline return, against
fixtures. Named, not built: F31 (a draft re-offered after an unmounted-mid-request send) and F81
(an aborted transcript read still finishes on the box) — qi-9rzdddrn; the Sessions text filter,
measured "mildly cumbersome" — qi-b42kp8rf, Greg's; localStorage for drafts and the touch-target
heights, Greg's. Same-conversation relaunch remains qi-q7ckxxms at low priority.

### Stage: Bounded transport — stalled consumers must not stall supervision

- [ ] Reproduce SSE backpressure with an actual Node Writable that delays callbacks and small
  highWaterMark. Assert its pending bytes and write count across many snapshots/pings. A fake
  `write() => false` with no buffering semantics is not enough evidence.
- [ ] On backpressure, either pause further writes until drain while retaining at most the newest
  snapshot, or close that subscriber and let it reconnect. Start with close-and-reconnect if it
  remains stable under a short phone stall; do not build a replay log for replaceable snapshots.
  Clean up subscriber listeners/socket on teardown and verify unaffected subscribers continue.
- [ ] Reproduce an SSE response with error headers and a never-ending body in `overseer/source.ts`.
  Cancel or boundedly consume error bodies without dropping the deadline; ensure polling fallback
  happens. Bound buffered frame bytes and incomplete lines in `sseFrames` too.
- [ ] Audit stop/abort through both polling paths; an unmounted page must abort owned fetches and
  remove listeners. Manual refresh during an in-flight request should schedule one fresh attempt,
  not disappear or launch overlapping requests.
- [ ] Keep browser polling unless measurements show it is inadequate. If later adding EventSource,
  handle named snapshot/ping events, loss/reconnect, initial cached state, phone wake and fallback;
  a ping proves connection life, never a fresh fleet snapshot.

**Acceptance:** a slow subscriber and hostile/incomplete stream have bounded memory/time; a failed
stream moves to polling; closing the view leaves no active owned requests/listeners. See technical
sources below for the stream semantics the current comments get wrong.

**Status (2026-09-10, Overseer): landed on dev at def984a3, session `bounded-transport`, plan
[260910c](260910c-bounded-transport-stalled-consumers-must-not-stall-supervision.md).** Most of
checkboxes 1–3 were already met by the E-stream work of 2026-09-08; the real work was three narrow
defects and the evidence in the form asked for. `live.ts`: a subscriber whose socket drains gets the
newest snapshot it missed (one retained frame, pings dropped, listeners detached on teardown).
`source.ts`: `readStream`'s `finally` no longer awaits `reader.cancel()`, which ran on every exit
and could park the generator after `stream-closed` with the poll fallback unreachable; bare-CR line
endings accepted. `transport.ts`: `stop()` aborts the in-flight fetch and a mid-flight refresh
yields exactly one fresh attempt. Two new test files: the polling transport's first sixteen, and
seven streams cut at every position against a whole-stream oracle. Corrections the branch had to
make to itself: a false `res.write` return means the frame IS buffered (the loss is only snapshots
published while blocked, a narrow race, and no browser reads `/api/live` today); a "no defect"
probe that could not fail; a held-back trailing CR that lost the last frame of a CR-only stream.
Both Sol rounds ran where the sandbox could not bind loopback, so the seventeen HTTP-backed
`overseer-source` tests were run on the box, not by the reviewer. A third fresh-worktree red exists:
`fleet-decisions-route` until `npm run build:fleet`. Checkbox 4's "both polling paths" was read as
the transport's tick and its refresh; `useActions` is Session continuity's.

### Stage: Source ordering — distinguish a new observation from a new timestamp

- [ ] Add producer instance id and monotonic sequence to fleet state, shared by poll and stream.
  Distinguish a state publication from a new successful inventory: health/error/heartbeat updates
  must not count as new session observations. Retain wall-clock timestamps for human ages.
- [ ] Add daemon tests for duplicate poll/SSE payloads, out-of-order messages, clock moving backward,
  server restart, and a genuine empty fleet. Compare source generation/sequence for ordering,
  not increasing `collectedAt` alone. Do not silently delete all sessions on an inadmissible sample.
- [ ] Design an explicit old-producer state before deploying either side; new consumer and old
  producer must not look like a stuck collector. Unknown schemas remain unknown. Document whether
  this is additive or needs a schema bump based on whether an old reader would be wrong.
- [ ] Repair the CLI/store parsing gaps noted in the previous plan: known event payload validation,
  short reads in JSONL, and `readNotes` error→empty. Keep lock-free bounded readers for UI; no full
  history parse per page load. Test truncated final versus corrupt interior record separately.

**Acceptance:** restart and clock corrections produce no phantom state transitions or identical-age
reset presented as measurement. Malformed history becomes a named degraded condition, not a CLI
crash or empty-success report. This is maintenance supporting later inference, not a new event bus.

**Status (2026-09-10, Overseer): landed on dev at e07102eb, sessions `source-ordering` (draft plan)
and `source-ordering-2`, plan
[260910d](260910d-source-ordering-distinguish-a-new-observation-from-a-new-timestamp.md); the stage is
complete.** Every `/api/state` and `/api/live` payload carries `producer: {instance, publication,
inventory}` (a kept success advances both, a kept failure only `publication`); additive at schema 1,
proven by running the pre-change parser on a stamped payload. The daemon orders by run and
collection when both payloads are stamped (a late payload from a replaced run refused; a same-run
collection below the last refused as out of order; a new run or newer collection accepted whatever
the clock did) and falls back to today's clock rules otherwise; an unstamped producer is the
explicit old-producer state; an unreadable stamp opens a new `ordering` condition and never fails
the parse. Store and CLI readers: short JSONL reads, identity checks on every event, a torn final
line kept apart from a corrupt interior one, `readNotes` with an unreadable arm, `overseer notes`
and `overseer events` exiting 1 on malformed history, and a log that cannot be repaired refusing
daemon startup instead of crashing it. Found on the way: `parseAttempt` never read `schema`, so a
schema-2 payload could restore `collector`; `/api/live` withheld its first frame after a failed
first collection. Sol's sentinel: a stamp disagreeing with its snapshot serves `instance: "invalid"`
and an alarm, never a throw. Known limits, recorded in the plan: `retired` bounded at 16; a torn
notes line reads as "cannot tell" for one read; the freshness watchdog still measures from
`collectedAt`; the CLI readers are lock-free but unbounded.

### Stage: Maintainable seams — reduce the cost of the next change

- [ ] After request/outcome contracts stabilise, extract `ActionButtons.tsx` by behaviour: session
  action UI, queue/reconciliation UI, and box preview/receipt UI. Keep public props typed and one
  shared confirmation primitive only where behaviours really match. Do not rename concepts.
- [ ] Split `routes-actions.ts` into corresponding handler factories while preserving the one
  shared queue/drainer runtime, origin/body validation and injected execution dependencies. Keep
  routing in one composition point; importing a module must not bind ports or start timers.
- [ ] Split `actions-client.ts` into pure boundary parsing and transport if that reduces circular
  knowledge. Delete obsolete provisional-contract comments; keep explanations of actual intent,
  rejected options and tricky runtime guarantees. Replace duplicate declarations with the new
  dependency-free contract, never unchecked casts to make it compile.
- [ ] Organise the large fleet UI suite around behaviours and keep a few strong real-client/route
  joins. Extract fixtures once, freeze clocks explicitly, and retain negative controls. Do not copy
  large synthetic feeds across new files or replace effect assertions with matching mock arguments.
- [ ] Run focused tests, typecheck, cycles and build:fleet after each extraction. Stage pure moves
  separately from behaviour changes where that makes review clearer; use a reference-sweep subagent
  for moves/renames. No target line count and no broad cleanup in unrelated product code.

**Acceptance:** an agent can change one action's typed request, route and UI without navigating
unrelated queue/box behaviours; existing integration tests exercise the same execution owner.
**Simpler option:** leave the files alone if extraction makes the dependency graph more complicated.


### Stage: Durable action receipts — restart without guessing or repeating a write

- [ ] Define durable action instance id, actor, target identity, request hash, accepted time and
  outcome state. This id differs from action vocabulary id (`compact`) and queue position. Repeating
  the same id+body returns its receipt; the same id+different body is rejected.
- [ ] Journal acceptance before delivery in a dashboard-owned single-writer store outside worktrees,
  using existing proven atomic append/checkpoint techniques. Persist pending/held/quarantined state;
  never make the fleet server a second writer of the Overseer store.
- [ ] Model accepted → attempted/keys-submitted → observed-reception, or refused/outcome-unknown.
  A crash between sending and recording cannot be made exactly-once with tmux; recovery marks that
  attempt unknown and requires reconciliation. No auto-retry of keystrokes, even with an id.
- [ ] Expose a bounded recent receipt list and target detail. Keep uncertainty after queue removal,
  and distinguish operator abandonment from proven non-delivery. Avoid copying full sensitive text
  into every audit record; retain necessary material deliberately with local permissions/retention.
- [ ] Crash-test before append, after append before send, between text/Enter, after send before result,
  during final journal line, and before HTTP response. Test duplicate HTTP request after restart.
  Include process/worktree actions with external effects, not just spoken messages.

**Acceptance:** restarting cannot silently drop acknowledged queued work or send an ambiguous message
again. A receipt explains what is proven and unknown. **Simpler option:** a volatile warning was
acceptable for v1; durable receipts become worth it before broader unattended work and recovery.

**Status (2026-09-10, Overseer): landed on dev at c1117570 (code at 82c5088f), session
`action-receipts`, plan
[260910d](260910d-durable-action-receipts-for-the-fleet-dashboard.md); the stage is complete, all
five checkboxes met, live since the 2921634d restart.** A single-writer receipt journal beside the
hold ledger under one lock, over a JSONL core extracted from it; queued work journals `accepted`
before it enters memory, the drain writes `attempted` before any keystroke and refuses to send if
that cannot land, and a restart restores queued work under its original ids, concludes an
interrupted attempt as outcome-unknown and never re-sends it. A client-minted request id bound to
the route and body replays the receipt for the same request and refuses a different body; keyed
kills and worktree removals are never run twice, even after a restart with the preview gone;
broadcasts have one parent receipt only as certain as its least certain child; the browser keeps
one envelope per intention for an explicit Check that resends the same bytes; a reconcile route
records a person's statement without changing an outcome. Learned: nothing on the box observes
reception, so keys-submitted is the strongest message state; a fail-open journal defeats idempotency,
so keyed accepts fail closed (503 when the stores cannot open). Left: a per-session filter on the
receipts list; the dialog-answer buttons and the run/box confirms still send unkeyed (their keyed
client methods exist); a pending envelope is memory-only. Defaults pending Greg: queued work
survives a restart and goes out without re-arming; receipts kept seven days and a queued message's
text in a 0600 file until it resolves; whether the hold ledger should stop failing open for durable
sends; whether a 503 client should offer to resend without an id.

### Stage: Launch protocol — give scheduling and recovery one crash protocol

- [ ] Define durable occurrence and attempt records owned by the Overseer: `planned`,
  `waiting-admission`, `reserved`, `launching`, `observed-running`, `completed`, `failed-before-launch`
  and `outcome-unknown`. Reuse dashboard action receipt concepts, but do not make the daemon write
  the dashboard journal. A scheduler occurrence and a human-selected recovery share this protocol.
- [ ] Use this order, with durable writes at each boundary: append occurrence intent with pinned
  material → obtain an idempotent admission reservation keyed by occurrence → record reservation →
  record launching intent with correlation id → invoke launcher once → record discovery/result.
  These are **not one atomic operation**. An admission reply lost before local recording is recovered
  by looking up the same reservation key; it must not consume a second slot.
- [ ] Extend the existing launcher with a validated correlation id carried in its first external
  effect. For tmux, use initial session environment/start metadata at creation (verify supported tmux
  flags locally before coding), rather than setting a field later after the child can already run.
  Keep a durable launcher artifact keyed by occurrence so a quickly completed/disappeared session is
  discoverable too. Do not rely on the ordinary `gjd-remote` log written after successful startup.
- [ ] For headless wrappers, create a private per-occurrence artifact directory/intent before spawn,
  pass the id into child/wrapper metadata, and write start/exit/answer records there through the wrapper.
  The daemon must be able to discover these without a live tmux session or complete transcript scan.
  Preserve stdout/answer/exit validation and credential sanitising already in the wrappers.
- [ ] On restart reconcile journal, reservation owner, launcher artifact and observed process identity.
  A `launching` record with inconclusive evidence stays unknown, holds its reservation conservatively,
  and is never automatically relaunched. Give Greg explicit inspection/reconciliation/disposition
  controls so unknown does not mean an unexplained permanent hold. Release only on evidence or an
  attributed operator decision; timeout alone is not proof that the child stopped.
- [ ] Fault-inject between every arrow, including after external spawn before start-artifact update,
  a child completing before first collection, reservation owner restarting, and duplicate recovery
  requests. Separate failed-before-launch from crash-after-possible-launch. Document each launcher's
  remaining ambiguity; tmux and a journal cannot deliver universal exactly-once execution.

**Acceptance:** one occurrence has at most one automatic launch attempt while its outcome is
ambiguous, one reconciled reservation, and discoverable evidence even if its child exited before
collection. Both Scheduled dispatch and Gradual recovery consume this foundation; neither invents
its own volatile launch-record map.

### Stage: Schedule preview — make periodic work inspectable before launch

- [ ] Define a small versioned job list: id, approved document path and pinned content/revision hash,
  interval/timezone, enabled flag, resource class, no-overlap key, timeout and missed-run policy.
  Start with interval scheduling; human display can use Europe/London while durable times use UTC.
- [ ] Show next due, last attempt/result, disabled reason, and what exact prompt revision will run.
  Editing the referenced document invalidates or requires reauthorising the approved definition;
  it cannot silently enlarge unattended authority.
- [ ] Add a pure due-occurrence planner, tests for startup, time jump, interval boundary, missed
  intervals and one already-running occurrence. Default to one due run rather than replaying a day's
  missed jobs in a burst. Scheduling is for agent maintenance work, not product database cleanup.
- [ ] Start with a harmless fixture job in dry-run mode. Show proposed job definitions to Greg if
  their schedule/scope is not already authorised; this is the final product choice before enabling.

**Acceptance:** the dashboard/CLI can say exactly what would run next and why, without launching
anything. A changed job document is visible. No cron hidden inside a Claude session.

**Status (2026-09-10, Overseer): landed on dev at c8490211, session `schedule-preview`, plan
[260910e](260910e-schedule-preview-make-periodic-work-inspectable-before-launch.md); the stage is
complete and launches nothing (`OVERSEER_JOBS_ENABLED` stays Greg's).** One pure list-wide planner
shared by the tick and the preview; duplicate job ids refused before planning (the old loop
dispatched the first); session-job documents re-digested every tick with the ARMED headline from the
same reading (before, a doc edited after daemon start ran under the old pin until a restart); a
hashed live/dry-run switch per job; both scheduled prompts forbid the session creating its own
recurrence; per-document pins so a refusal names which doc moved; a dry-run fixture job. The daemon
writes `~/.overseer/schedule.json` every checkpoint, armed or not; `overseer status` prints it and
says whether the running daemon holds the list this checkout builds; `GET /api/overseer/schedule`
reads one bounded regular file; the section sits under the Overseer status card, browser-checked at
1280 and 390 px. Learned: a dry-run job needs its own eligibility arm or the preflight can never arm
a box carrying it; a disarmed preview must count a proposed launch or it hides the spacing arming
would apply; any new `tools/fleet` import of `tools/overseer` belongs in the focused list with
`fleet-attention.test.ts`, the only test that walks the whole import closure. Needs Greg: the
get-ready-to-deploy doc still tells its runner to recur via a session loop or cron (a rule doc);
and whether the inert `schedule-fixture` job goes live for Scheduled dispatch's first run.

### Stage: Scheduled dispatch — one durable occurrence, one reconciled launch

- [ ] Instantiate the Launch protocol for each due job: occurrence identity is distinct from job
  id/attempt id and includes job id + scheduled instant + authorised definition revision. Use its
  ordered intent/reservation/launch/discovery records, not an imagined atomic launch operation.
  Pin the actual job material supplied to the child.
- [ ] Close crash windows by reconciliation: carry occurrence id into launcher metadata/artifact;
  after restart search for that identity before considering a retry. If existence cannot be proven
  either way, hold as unknown. A `dispatched: true` boolean is not enough.
- [ ] Observe result using wrapper exit status **and** nonempty answer/artifact where applicable.
  Record permission denials, quota refusal, timeout, launch failure, missing answer and interrupted
  state separately. Do not call a successful spawn a completed job.
- [ ] Honour no-overlap, admission and usage evidence; make job-specific timeout/cancellation visible.
  Run one safe occurrence end-to-end, restart the scratch daemon at every launch boundary, then
  enable only the specifically authorised maintenance jobs.
- [ ] Show last/next occurrence and durable result link in the web page. A successful automatic
  dispatch is within existing autonomy; its job still must obey production-write/deploy rules.

**Acceptance:** a restart after real launch but before receipt cannot create a duplicate job; a
missed day does not produce a storm; failed/answerless jobs are visibly failed. No automatic
`main` push or production mutation is licensed by a schedule.

### Stage: Recovery inventory — show interrupted work without resuming it

**Status, 2026-09-10 (plan
[260910e](260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md), worktree
`recovery-inventory`, queue item `qi-z4q4rkg3`).** The daemon side is built and reviewed: Stage 1,
the journal and the fold, and Stage 2, the view, the dispositions and the dismissal CLI. Two things
the plan did not know:

- **The first empty post-reboot snapshot closes sessions as `absent-from-snapshot`**, with a null
  generation, not as `tmux-server-changed`. So the candidate rule keys on the world relation, and
  not on the gone reason.
- **tmux can get the same pid after a reboot.** So the daemon reads the host's boot id itself.

**Stage 3, the page, is done as well**: `GET /api/recovery`, and the *Interrupted work* section below
the Overseer panel. It was reviewed by Sol, narrow-checked, and settled by Fable. The acceptance is
shown below. Nothing is live until the daemon and the dashboard are restarted on this code.

- [x] Preserve recovery candidates from the pre-restart register and retained disappearance events
  when tmux generation changes. The current register removes gone sessions, so reading only
  `current.json` after the first empty post-reboot snapshot loses the very work recovery needs.
  Append a `recovery-candidate` event containing the final complete RegisterEntry and generation
  before appending the corresponding removal event, in the same ordered daemon transaction/batch.
  Idempotently key it by previous execution + disappearance event; replay after a crash between those
  appends cannot duplicate it. Fold recovery events into a daemon-owned recovery register/checkpoint
  and expose a read-only projection comparing that evidence with current verified inventory. Distinguish ended-before-reboot, interrupted, present-but-unmatched and unknown.
  Inventory absence during failed collection is not proof of interruption.
- [x] Persist explicit candidate disposition: unresolved, resumed (replacement execution), dismissed
  by operator, or superseded with evidence. Unresolved candidates never expire silently. Keep a
  bounded first page (for example 100) with older-count/pagination; reconstruct the index once at
  daemon startup, not on page requests. Cap accepted record sizes; if safe capacity is exceeded,
  preserve the journal and report degraded/overflow instead of dropping recovery evidence. Archive
  resolved entries only under a stated retention policy; v1 need not delete journal history.
- [x] For logs predating recovery events, perform a one-time offline/startup replay to recover last
  complete entries where evidence suffices. Missing evidence becomes unknown, not a fabricated
  candidate. Test crash before candidate append, between candidate/removal, and before checkpoint.
- [x] Show transcript existence, recorded working directory/worktree, last observed activity,
  latest available evidence and whether the harness supports resume. Paths come from the register,
  checked for existence; never synthesize a resume command from a display title.
- [x] Keep shells/manual jobs as manual recovery with an SSH path; do not pretend they have resumable
  agent state. Provide a bounded checklist/report first, no execute button.
- [x] Test a missing directory, transcript absent, valid Claude transcript, already-live matching
  execution, empty rebooted fleet, and old schema. Include the first accepted empty post-reboot snapshot and prove candidates survive register removal.
  No `worktree:check` or filesystem read may be treated as proof of work completion.

**Acceptance:** after a simulated reboot Greg sees recoverable work and missing evidence, with zero
sessions automatically started. This stage can land earlier alongside the status projection.

**Shown, 2026-09-10.** `scripts/overseer-recovery-drill.ts` drives the real daemon into a disposable
store:
- boot B1, generation G1, with four sessions;
- an empty snapshot after the reboot, under B2;
- G2, with one session back under a new run.

The page then shows:
- *interrupted*: the session whose directory is **missing**, and the shell job (manual, "on <host>,
  in <dir>");
- *stopped before the world change*: the Claude that had already exited;
- *resolved*: the session that came back, marked *resumed*, with both run tokens.

There are no buttons, no links and no command text, and nothing was started. It was checked at
1280 px and 400 px.

**Status (2026-09-10, Overseer): landed on dev at 3dc65697, session `recovery-inventory`, plan
[260910e](260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md); the stage is
complete (the drill above is the acceptance).** The candidate record goes into the same write as, and
immediately before, its tmux-session-gone, keyed by previous execution plus removing collection; the
daemon reads the host boot id itself because tmux can reuse a pid after a reboot; records are
classified against the trusted inventory and are all unknown after any refused, failed or held
collection; resumed and superseded come only from a verified conversation; dismissal is a CLI through
`~/.overseer/recovery-inbox/`. Found on the way: a daemon stopping on an exception could loop forever
settling in-flight views while timers kept requesting them, holding the store lock so systemd could
not replace it — fixed on both exit paths, now also clearing work-reports' drain timer. Two first
review rounds timed out mid-fix; read-only findings-only rounds plus a separate fixer converged; one
same-user file-system race was overruled through Fable with a narrowed, tested guarantee. Follow-ups
queued as qi-59skznz8; live since the 16:49Z restarts.

### Stage: Gradual recovery — resume selected valuable work

- [ ] Offer user-selected resume from Recovery inventory through existing launcher/resume support.
  Revalidate directory/transcript/current identity at execution and use the Launch protocol occurrence/attempt records.
  Present previous objective and uncertainty; do not resume all prior sessions by default.
- [ ] Apply admission and quota deferral. Start one selected session, verify metadata/pane/transcript
  identity, then allow the next. If the harness cannot safely resume, offer manual instructions.
- [ ] Use a recovery occurrence id to detect duplicate taps/restarts. Test launch succeeded but response
  lost, already resumed elsewhere, missing transcript after preview, and partial success across a list.
- [ ] Keep any broader automatic recovery policy as a separate Greg decision. Run reboot/crash drills
  in a disposable store and isolated tmux socket; do not reboot the shared box as a test.

**Acceptance:** two taps cannot launch two copies of the same selected recovery; resources limit the
pace; unchanged unknowns remain visible. Recovery restores valuable work, not the previous load spike.

### Stage: Work reports and decisions — a small event vocabulary

- [ ] Add a CLI/report endpoint for `progress`, `blocked`, `decision`, `completed` with event id,
  job/execution identity, actor, timestamp and artifact references. Resolve ownership so the daemon
  remains the single writer of its store; clients submit to the owner rather than append directly.
- [ ] Label self-report as a claim. A completed report may name reviewed/tested/merged revisions,
  but absence of that evidence is unknown; do not infer a broad READY/LAND/GATE state machine.
- [ ] Put decisions in a searchable bounded log: consequence, reversibility, product/technical,
  alternatives, recommendation, author, consulted reviewer, evidence and whether Greg was asked.
  Rank consequence/reversibility before confidence; confidence can be optional annotation only.
- [ ] Show unreported sessions as unreported. Introduce the reporting convention in launch prompts
  for controlled jobs first. Any new mandatory AGENTS rule needs Greg's approved before/after edit.
- [ ] Test duplicates, stale execution, untrusted artifact text, unknown event kind, nonexistent
  artifact, and contradictory later report. Keep an attributed correction rather than rewriting history.

**Acceptance:** Greg can inspect what an agent claimed and which decision was made, with links to
actual artifacts. No model pass over all transcripts and no automatic authority from a report.

**Status (2026-09-10, Overseer): landed on dev at 2de954f5, session `work-reports`, plan
[260910e](260910e-work-reports-and-decisions-a-small-event-vocabulary.md); done enough to stop — the
machinery is complete and reviewed, and the convention that gets agents to use it is now in the
Overseer's dispatch briefs, with the standing-job prompt suffix (a re-pin) waiting on Greg in
[the convention proposals](260910e-work-reports-convention-proposals.md).** `overseer report
progress|blocked|decision|completed` drops a validated file in `~/.overseer/report-inbox/`; the
daemon, sole writer of `reports.jsonl`, drains it every 30 s, freezing enrichment (execution token
against the register; artefacts on dev / found / not found) before appending so a crash replays the
same bytes; every pass is bounded (1,000 entries, 50 files, 1 MiB, 200 probes, 5 s); entries that can
never become a report go to quarantine, which the daemon never deletes from and never lists in its
loop — their counts and the oldest age are shown, capped (Overseer's default pending Greg). Claims
stay claims: "claimed by", "not stated" for evidence not named, corrections explicit. Decisions
schema 2 separates author from recorder, adds consequence, reversibility, domain, recommendation,
evidence and gregAsked-as-claim, folds old rows as `legacy-unrecorded`, and the Decisions tab shows
them with search and evidence links; a Claims section shows every session's latest claim or
"unreported". Learned: "delete under a listing" was the source of unbounded daemon work three times,
and the answer each time was to stop deleting and read under a cap; a type-only import across the
fleet/overseer seam counts. Left small: a pass that only quarantined logs nothing; over 1,000 failing
processing records could fill every window; not seen in a real browser.

### Stage: Bounded judgement — find prose questions and propose help

- [ ] Extend Attention completeness's labeled evaluation set rather than creating a second detector: prose question
  without `?`, rhetorical question, concluded work, background review, permission defect and working
  confidently on the wrong task. Record false positives/negatives and compare to mechanical inbox.
- [ ] Invoke a short-lived model only for changed, relevant evidence not resolved mechanically.
  Cache by execution + content hash + classifier version; set per-tick/day concurrency/token/cost
  limits, cooldown and quota-aware refusal. State remains outside the model transcript.
- [ ] Return a typed proposal with evidence excerpt/reference, reason and proposed recipient. Route
  technical questions to Sol, product wording/defaults to Fable where available, and actual Greg
  decisions according to the direction doc. Missing model capability is visible, not substituted.
- [ ] Present proposals in the existing inbox, attributed and vetoable. This stage **does not send**
  steering or approval automatically. Before such a later extension, get a concrete autonomy change
  from Greg and preserve speaker attribution/durable receipts.
- [ ] Evaluate useful questions surfaced, false alarms, attention time, cost and avoided waiting.
  If the model cannot improve on explicit reports at reasonable cost, retain reporting/manual triage.

**Acceptance:** a prose question can be surfaced with its evidence and model attribution, under a
hard budget; 36 sessions do not imply 36 model calls each minute. No proposal becomes Greg's voice.

### Stage: Access review — the bounded hardening Greg requested

- [ ] Recheck actual bind addresses and SSH fallback against the updated access section/A5 closure.
  Keep loopback as the default. If widening is authorised, follow its Tailscale Serve + owner-check
  precondition; validate proxy/header trust so a direct client cannot impersonate that identity.
  Do not reopen the deferred whole-ACL rewrite or expose a new public listener for a test.
- [ ] Verify existing origin checks, CSP/anti-framing and action attribution on real composed routes,
  including failures/static responses. Fix exact-path/method handling for state/messages/live as
  appropriate; a prefix match must not unintentionally widen an API route.
- [ ] If composition tests need it, extract `handler` construction with injected state/routes/static
  root, leaving binding/timers in the executable entry point. Prove production composition shares the
  queue with the refresh drainer. Reuse existing route tests; no framework rewrite or duplicate harness.
- [ ] Verify hostile transcript strings render as text, unknown action variants remain disabled and
  unsupported permission dialogs do not acquire an answer path. Do not replace this with generic
  token authentication that every same-user agent can read.
- [ ] Review only the access changes actually needed. Unix-account isolation, credential containment,
  broad sudo reduction and public multi-user access remain in the direction doc's deferred appendix.

**Acceptance:** the intended devices can reach the page, other reachability is understood, SSH still
works, and existing guards are tested at the HTTP/browser boundary. This is not a top-priority
security rewrite and does not override Greg's explicit deferrals.

### Stage: Operational finish — prove failure, restart, and recovery visibility

- [ ] Add a cheap diagnostics/status command and web summary naming producer instance/revision,
  client build revision, checkpoint schema, store path label, health age and last collector attempt.
  Display mismatch/unknown; do not claim client+server revisions match merely because HEAD matches.
- [ ] Keep service builds/versioning consistent with serving code. Existing unit rebuilds fleet on
  start; measure before changing this to release directories or conditional builds. Preserve known-good
  rollback material; do not delete the only bundle/store while the service still needs it.
- [ ] Test service crash recovery, bad/missing client build, failed bind, source unavailable, stale
  heartbeat, malformed final record and a restart without double dispatch on scratch instances.
  Do not set `WatchdogSec` without implementing progress-driven notifications; restart policy alone
  detects exit, not a live-but-wedged event loop.
- [ ] Prepare one off-box dead-man monitor proposal: exact existing host/service, destination, privacy,
  interval, grace period and test plan. Greg selects/authorises the external destination before
  activation. A same-box daemon cannot prove the host is reachable from elsewhere.
- [ ] Default notifications to host/Overseer failure and serious externally visible/data-loss risk;
  no push for every blocked agent. Keep transcript text off notification previews. Test monitor
  failure and lost heartbeat on a disposable target, then recovery/deduplication.
- [ ] Run the integrated gates once, a representative desktop/phone smoke, and a bounded soak with
  resource/latency records. Consolidate redundant newly added tests in a subagent without discarding
  seam/crash coverage. Record live deployment revision separately from the `dev` commit.
- [ ] Ask about persistent host changes only when needed: now, provisioning, or both. Apply the
  agreed change, verify units and advancing clocks, then update factual docs. Do not restart/stop
  other agents' sessions as cleanup. Run `worktree:check` before removing implementation trees.

**Acceptance:** failure becomes visible through a channel that survives it; restart preserves
honesty and avoids duplicate side effects. The SSH/manual path remains complete. A green test suite
without an observed stopped-clock/failed-source control is insufficient evidence.

**Status (2026-09-10, Overseer): done enough to stop, on dev at 33f99bbe; session
`operational-finish`, plan 260910f, worktree `ops-diagnose` left standing.** Boxes 1 and 3 are
built and reviewed: `npx tsx scripts/overseer.ts diagnose [--json]`, `GET /api/diagnostics` and a
Diagnostics section in Box health report each service's recorded start HEAD, checkpoint schema,
clocks, boot ids and job-list agreement, never inferred from HEAD; crash, bad-build, failed-bind,
SIGKILL-takeover and restart-without-double-dispatch all proven on scratch instances. Box 2 is
measured, not changed (the unit's rebuild-on-start stays). Box 4 is a proposal, not a build: the
destination is **Greg's** (Healthchecks.io recommended over Better Stack and Cronitor). Boxes 5–7
wait on that choice and on the two restarts the Overseer owes (dashboard, then daemon) for the
stamps and the route to show; until then unstamped services read `unknown`, which is honest. Sol:
plan review 9 findings (5 P1), stage reviews 3 P1 + 1 P2 then 6 P1, all taken; the narrow check
closed eight of ten, and Fable ruled the other two documented limits (store listing stops at 200
entries; a pid reused within 2 s of the lock still reads RUNNING, needing an identity token, queued).
One regression of its own, `fleet-work-evidence-e2e` red on dev for 84 minutes, root-caused in
`docs/postmortems/260910d-a-literal-new-url-…` (vitest's normalize-url plugin rewrites a `new URL("../..",
import.meta.url)` literal under jsdom; three more such literals are queued). Contracts that outlive
the branch: an optional `revision` on the daemon-started note, `dist/build-stamp.json`, and the
`/api/diagnostics` payload.

## Parallel commitments and optional convenience

Wave 2 already commissions harness visibility and dictation; integrate those active workstreams in
parallel rather than delaying them behind this roadmap. The other entries remain ranked candidates.
Each needs its own thin implementation stage, contract tests and browser acceptance once selected.

| Candidate | Small useful version | Why later / decision trigger |
|---|---|---|
| Read-only Codex/harness visibility | Show wrapper receipt/process evidence as batch work; explicitly no stdin steering. Reuse WorkReading. | Already assigned in Wave 2: integrate its adapter, inspect installed output and official docs, and keep batch steering explicitly unsupported. |
| More useful broadcast | Editable exact message and selected recipients, queued through the same target guards, with per-recipient receipt. | Current broadcast is specifically resource staggering. Add after its existing path works; decide whether selected-only suffices before arbitrary filters. |
| Dictation in message boxes | Preserve the landed New/Steer controls; deliberate Send remains separate. | Wave 2 code landed by `3ba58fc5`; integrate its secure-context/real-device verification. Reuse the tested browser-leaf import exception, not an absolute no-`src/` rule. Rename is deliberately excluded. Any additional input follows its own frozen identity/material contract. |
| Live conversation about the selected session | Reuse Wave 2 Stage F's separately briefed realtime model, which can read context and propose a message to the selected agent. | Already described by Greg and gated on working dictation; do not reopen who the partner is. Define the bounded handoff and authority using existing guarded delivery, and never imply that a daemon itself converses. |
| Richer session navigation | Saved filters, grouping by repository/worktree, clear links to receipt/artifacts. | Add only after search/selection and phone continuity solve observed friction; no kanban/project management system. |
| Multi-account operation | Show explicitly configured account identities first; controlled job/account assignment second. | Medium-term by Greg. Verify isolated config directories empirically, never migrate credentials or round-robin live conversations automatically. |
| Browser SSE | One transport implementation preserving fallback/lifecycle/freshness semantics. | Existing 5s polling is adequate until measurements say otherwise. Server SSE is already needed by the daemon and is repaired independently. |

**Explicitly defer:** high availability, a second box, custom terminal emulation, predictive quota
optimisation, exhaustive transcript mining, generic agent chat, automatic approval of permission
screens, automatic worktree removal, and an unbounded long-running coordinator model.

## Research notes and technical sources

The codebase and Greg's recorded decisions are the primary product evidence. External references
were checked on 2026-09-08 only for load-bearing runtime semantics; they do not establish whether a
local feature is deployed.

- **Node writable backpressure:** `write(false)` means stop further writes until `drain`; data has
  already been buffered, and continued writes accumulate memory. This supports E-stream and the
  bounded-transport stage, not a claim that a live OOM was reproduced here.
  [Node stream documentation](https://nodejs.org/api/stream.html#event-drain).
- **Node subprocesses:** synchronous child APIs block the event loop; abort/timeout signals a
  child and does not prove all descendants have exited. This supports owning probe lifecycle and
  measuring request latency while probes run.
  [Node child-process documentation](https://nodejs.org/api/child_process.html).
- **SSE:** named events need their own listeners; event-stream reconnection does not establish that
  the producer collected new data. Keep receipt time and collection time distinct.
  [HTML Standard, server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html).
- **systemd:** restart and watchdog handling are separate service mechanisms. Inspect installed
  version and units before proposing settings; a functioning watchdog needs notification from the
  process, not just a unit-file field.
  [systemd's service manual source](https://github.com/systemd/systemd/blob/main/man/systemd.service.xml).

### Reproducing the research baseline

From the repository root, with installed dependencies:

```bash
git rev-parse HEAD
rg -n 'classifyPaneWork|probeProcessTable' tools scripts
rg -n 'boxActionBody|pids|recipients' tools/fleet/web/src/actions-client.ts tools/fleet/routes-actions.ts
node node_modules/vitest/vitest.mjs run tests/fleet-live.test.ts tests/fleet-actions-route.test.ts tests/fleet-web.test.tsx tests/overseer-store.test.ts --maxWorkers=1
```

The focused run at 12:09 UTC (13:09 Europe/London) took 20.66 seconds, with 362 passing and 2 failing tests. It is evidence
about those four suites only. No browser session, live write, reboot, paid usage API call or full
repository correctness claim follows from it. The checkpoint metadata read found schema 1 while
source expects 2; identify the running binary/service before diagnosing migration failure or death.

### Review and handoff record

- [x] Inspected current direction, both subsystem implementations, tests, service definitions,
  existing resource-admission code, and previous review findings.
- [x] Delegated independent Overseer and dashboard audits; verified principal findings in source.
- [x] Ran focused tests and saved raw baseline; recorded existing failures without fixing code in a
  plan-only task.
- [x] Sol reviewed the complete plan; [first review](260908f-overseer-and-fleet-improvement-roadmap-review-sol.md)
  returned R1–R7. All were addressed; the [second review](260908f-overseer-and-fleet-improvement-roadmap-review-sol-followup.md)
  marked all seven resolved and returned **APPROVE** (both wrapper exits 0, nonempty answers).
- [x] Reconciled subsequent upstream changes at `3e2e3bd4` as described above, preserving the active
  Wave 2 commitments and its now-existing wire/lock seams. This factual reconciliation followed the
  second review; it is not a claim that Sol inspected a later live snapshot.
- [x] Document-link checks passed (14 tests). Direct typechecking passed at the original baseline and again after reconciliation (1,669 source files covered).
  [Validation evidence](260908f-overseer-and-fleet-improvement-roadmap-validation.txt) records the
  full-suite memory refusal and broad-check limitations: sandbox IPC/database access and an existing
  client/API build-revision mismatch. No full-repository green result is claimed.
- [x] Committed the seven named plan/review/evidence artifacts as `acc13c1f9cc05cd4d4ac69faedf15ec63b72787b` and pushed to `origin/dev`. Review artifacts record candidate closure; no runtime code or services were changed by this work.
- [x] At Greg's request, [Fable reviewed](260908f-overseer-and-fleet-improvement-roadmap-review-fable.md)
  the complete committed plan via the Claude wrapper (`claude-fable-5-1`, exit 0, successful result,
  nonempty answer). Its **REVISE** verdict prompted earlier status delivery, explicit attention
  ownership, and two small client fixes brought forward. The
  [disposition](260908f-overseer-and-fleet-improvement-roadmap-review-fable-disposition.md) records
  every finding, the retained kill/preview safeguards, and validation of this plan revision.

When implementation starts, record each completed stage's commit, focused tests, integrated gate
result, browser evidence (where applicable), deployment revision, and any remaining unknown. Update
facts in their owning evergreen doc; leave this file as the dated reasoning and implementation map.
