# Make the Overseer and fleet dashboard useful, dependable, and cheaper to run

Status as of 2026-09-08: **researched proposal; implementation has not begun**. This is a plan-only
change. The baseline inspected was `4adcdfd62703b6565a27a03c50f20f8a215f1bd8`; the shared checkout
may advance underneath it. The original reconciliation checked `3e2e3bd4`; the Fable revision also
checked subsequent dictation integration at `3ba58fc5` (see below). Evidence includes source inspection, two independent subsystem audits,
a focused test run, a read of the real checkpoint's metadata, and primary technical references.
Review results and limitations are recorded at the end. An unchecked box below does not imply that
its entire subsystem is absent: many stages deliberately connect machinery that already exists.

Up: [plans.md](../project/plans.md). Governing direction:
[orchestrator-direction.md](../project/orchestrator-direction.md).

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
> — Greg, 2026-09-08, [direction](../project/orchestrator-direction.md#the-order-of-work)

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
| [Direction and constraints](../project/orchestrator-direction.md) | Ownership seam, Greg's priorities, autonomy, observed failure modes, and existing wide-review backlog. Read especially Two tenses, Attention, Order of work, and Backlog. |
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

These are dated findings, not permanent descriptions. **S** means confirmed by source inspection;
**T** means exercised in a test/command; **H** means a hypothesis requiring a failing reproduction.
No real session was steered, killed, launched, or resumed in this investigation.

| ID | Evidence and consequence | Confidence / next proof |
|---|---|---|
| E-actions | `boxActionBody` sends `actionId`, `mode`, `confirm`, `speaker` but no `pids` or `recipients`. `killRoute` intersects current candidates with supplied PIDs; `broadcastRoute` refuses no recipients. The browser therefore cannot complete these advertised paths. | S; audit also ran body through parser. First regression must drive real browser serializer into real route with fake execution. |
| E-confirm | `BoxActions` displays warnings for unknown/non-dry-run previews but its Confirm condition only requires `preview.ok` and a non-null result. Failure heading is always `Nothing happened.` | S; render malformed/surprising responses and a lost reply after fake execution. |
| E-queue | `deliverOne` settles partial/unknown delivery as refused, removing that item. A later drain can reach the next instruction despite an uncertain input buffer. `FleetQueues` hides queues with only unreadable items and describes leases as unsent. Queue counters restart at `q1`. | S; reproduce on fake transport, including stale recovery request after restart. |
| E-seam | `OrchestratorPanel` still explains that no Overseer process/store exists. `server.ts` exposes no checkpoint projection. The actual store and daemon are in the tree. | S. Live checkpoint metadata read was schema **1**, `writtenAt=2026-09-08T12:09:05.298Z`; checked-in store contract is schema **2**. This proves version disagreement, not its cause. |
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

- [ ] Read current direction and both original plans. Compare their remaining checkboxes with
  current callers/tests, especially the work classifier and systemd installation. Keep a small
  shipped / built-not-wired / proposed table in this plan; retire contradictory roadmap prose only
  when the replacement is based on evidence.
- [ ] Record `git rev-parse HEAD`, Node version, installed service ExecStart/WorkingDirectory,
  process start time, client build revision if available, checkpoint schema and its two clocks.
  Use `systemctl show/status` and bounded logs read-only. Do not print environment files or transcripts.
  If service access is unavailable, say unknown; a file in `infra/` proves no installation.
- [ ] Reproduce the two baseline freshness failures. Inspect the `state()` fixture and test clock;
  freeze/reset the clock or generate intentionally fresh fixture times. Add a distinct assertion
  that receiving an **old** cached snapshot does not clear the stale banner. Do not increase timeout
  thresholds just to satisfy a stale fixture.
- [ ] Reuse `browserFetch(routes)` and `makeActionRoutes` in `tests/fleet-actions-route.test.ts`
  for real client→route tests. That join already exists; do not extract the whole HTTP handler merely
  to repeat it. Composition/URL-prefix checks belong to Access review when needed.
- [ ] Bring forward two small client repairs, each with a failing regression first. In
  `NewSessionPanel`, apply the absolute discovery deadline to failed polls too; preserve the created
  id/manual refresh and never relaunch because discovery failed. In `useRecentMessages`, re-read on
  a changed claimed `claudeSessionId` under the same row id, clear the old view, and prevent an old
  in-flight response from replacing the new view (including manual reads). An unchanged snapshot
  must not trigger another transcript read. This fixes an observable claim change; it does **not**
  prove that an unchanged launch claim still identifies the current execution.
- [ ] Capture focused suite output and run one deliberate wrong-request negative control. Fix only
  scoped defects; baseline failures elsewhere are recorded and investigated separately.

**Acceptance:** another agent can distinguish code under test from the serving process; the existing
client→route harness remains usable, perpetual failed discovery stops, and a changed conversation
claim cannot retain the old transcript view. Runtime inspection has not restarted anything.
**Cost ceiling:** one small stage; no instrumentation platform.

### Stage: Execution identity — distinguish a running process from an old launch claim

This is a foundation for verified continuity and writes, not a prerequisite for a read-only status
card or an explicitly claimed observation. Develop it alongside those earlier deliveries.

- [ ] Reproduce a new Claude child started under an unchanged shell/pane whose tmux
  `CLAUDE_SESSION_ID` still names the old conversation. Current `diff.ts` documents this blind spot;
  concatenating current row fields does not fix it. Also test PID reuse and tmux server restart.
- [ ] Add a browser-safe discriminated identity reading: `verified` (current harness process plus
  process-start token and verified conversation id if observable), `claimed-only` (launch metadata
  with no current corroboration), or `unknown` (cause). Keep conversation verification separate from
  process verification: a known child process does not prove which transcript it is writing.
- [ ] On Linux, derive process identity from boot identity + PID + process start ticks, using the
  existing ancestry/probe machinery. Validate that the expected harness is still the pane's live
  descendant and compare its actual session-id argument/authoritative harness observation with the
  launch claim. Missing or ambiguous evidence stays claimed-only/unknown; do not guess by title.
  Treat unavailable platform evidence as unsupported, not as permission to use PID alone.
- [ ] Propagate this reading through fleet state, its browser parser, and the daemon register/event
  boundary. Plan schema compatibility explicitly. Reuse the same identity derivation in fresh
  action revalidation; never promote a cached verified identity into current write authority.
- [ ] Key component/draft ownership to verified execution. A changed or unverifiable execution must
  quarantine the previous draft/results, show why continuity cannot be established, and disable
  identity-dependent writes. Transcript display needs a verified conversation claim; otherwise show
  it as unverified history, not the current conversation. Re-establishing the same verified identity
  can recover its draft. A process replacement does not inherit the previous duration as measured.
- [ ] Test the actual row→wire→browser/register round trip, including old producers that omit the
  new reading. They stay inspectable with unknown continuity; do not cast them into verified state.

**Acceptance:** a fresh Claude under the same shell is detected or explicitly unverifiable; it never
silently inherits a draft, transcript attribution or historical age. This stage supplies the invariant
used by the later status, continuity and confirmation stages. Keep tmux identity and process identity
distinct: a pane survives more than one execution.

### Stage: Box contracts — make the existing actions reach their intended inputs

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
  arm that conflates transport with process outcome. Preserve route `delivery` details. Inspect `PlanRun.completed` and actual step results: `killRoute` currently labels intended PIDs as killed even when the run is incomplete. Report attempted versus observed effects explicitly. Never show `Nothing happened` for a
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

- [ ] Add a single-flight latch around owned collection attempts: a caller deadline does not release
  the underlying attempt. Repeated refreshes report the stuck child and retain old data, with no
  second child started until the first settles. Test never-settling, late-success and late-failure
  probes; late results must not overwrite a newer observation. Full cancellation follows later.
- [ ] For SSE, use the simplest bounded policy first: after `write(false)`, close/destroy that
  subscriber and remove it. The next connection receives the latest cached snapshot. Prove no
  further heartbeat/snapshot writes or retained subscriber remain; do not call false a dropped frame.
- [ ] Cancel unsuccessful SSE response bodies or keep a short deadline while consuming them, so
  error headers plus an unfinished body cannot prevent the Overseer's polling fallback. Bound
  incomplete frame and poll body sizes. Test each with a controlled source and raw Writable.
- [ ] Surface these conditions through existing error/age UI. Keep the later responsiveness and
  transport stages for comprehensive lifecycle work; do not turn this small repair into a rewrite.

**Acceptance:** repeated failure cannot accumulate collectors or unlimited socket/parse buffers,
and an error stream cannot trap supervision forever. This advances Sol's early priority advice
without postponing useful attention behind full performance optimisation.

### Stage: Overseer status — replace the placeholder with real history

- [ ] Add a fleet-owned read-only boundary module for `current.json` and a cached `/api/overseer`
  projection. Define `missing | unreadable | unsupported-schema | available`; no catch→empty fleet.
  Cache on bounded refresh/file metadata, not a full event-log scan on every HTTP request.
- [ ] Support the current declared schema, explicitly refusing unknown versions. The live schema-1
  observation must appear as incompatibility, not be coerced to schema 2. If supporting an old schema
  is useful, write an explicit adapter that labels old durations as unknown/lower bounds; never cast.
- [ ] Render heartbeat age, source snapshot age, and status durations with observed versus `≥` lower
  bound formatting. Show a stale-source warning even if the daemon's heartbeat is advancing. Missing
  or unreadable history must not hide the independently available fleet rows.
- [ ] First ship global heartbeat/source status without a row join. For optional history matching,
  require the existing generation tuple (`tmuxServerPid`, `paneId`, `panePid`) and matching claimed
  conversation id; label this as **claimed history**, not verified current execution. A child can
  change while that tuple stays fixed. Show the observation interval rather than asserting that the
  current child has worked/blocked for that duration. Missing/mismatched evidence remains separate
  history; it must not hide current fleet rows. Upgrade joins only after Execution identity lands.
- [ ] Replace `OrchestratorPanel`'s hardcoded daemon-absent narrative/roadmap with this status card,
  existing queue controls, and short explanations. Do not invent a chat recipient: a daemon/store
  existing still does not mean there is an agent capable of receiving a message.
- [ ] Contract tests: real serialized checkpoint fixtures (current, old, future schema), torn/absent
  file, healthy daemon/deaf source, stopped heartbeat, genuine empty fleet and generation mismatch.
  Browser-check all states with injected fixtures.

**Acceptance:** the web page can say *Overseer last updated 12 minutes ago; fleet source last updated
15 minutes ago* honestly. Claimed history is clearly distinct from a verified current duration;
*blocked for at least 20 minutes* needs evidence of continuity. Failure of this projection leaves
Sessions usable. This is the cheapest major new capability and the first delivery's stop line.

### Stage: Work evidence — connect the classifier that is already written

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

- [ ] Revalidate the direction doc's locally observed usage sources against installed CLI output.
  Read only fields needed for account label/window utilization/reset and transcript rate-limit events;
  never export credentials, tokens or entire config. Use bounded incremental transcript offsets.
- [ ] Model actual observed rate-limit events separately from cached utilization hints, with source,
  observed time and reset time. Expired cache entries become stale/unknown; no fabricated percentage.
  Distinguish 5-hour and 7-day windows and account identity; a post-reset old 429 is history.
- [ ] Show a small usage card with uncertainty and a source timestamp. Group sessions affected by the
  same account/window incident. Connect only reliable blocking evidence to *new-job* deferral;
  do not rotate credentials or pause running work from an uncertain hint.
- [ ] Test malformed/missing cache, account change, 429 event, expired reset, clock correction and
  overlapping limits. Prefer sanitized fixtures; do not perform paid requests to measure headroom.
- [ ] Recheck official provider documentation if proposing a new usage API. The already researched
  Admin API measures a different billing system; do not ask Greg for an admin key for Max headroom.
  Unsupported OAuth endpoints are not the v1 dependency.

**Acceptance:** the page says what it knows about the current account and what it cannot tell;
thirty sessions affected by one quota window create one incident. Multiple-account rotation remains
medium-term and outside this batch. No unattended credential changes.

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

- [ ] Preserve recovery candidates from the pre-restart register and retained disappearance events
  when tmux generation changes. The current register removes gone sessions, so reading only
  `current.json` after the first empty post-reboot snapshot loses the very work recovery needs.
  Append a `recovery-candidate` event containing the final complete RegisterEntry and generation
  before appending the corresponding removal event, in the same ordered daemon transaction/batch.
  Idempotently key it by previous execution + disappearance event; replay after a crash between those
  appends cannot duplicate it. Fold recovery events into a daemon-owned recovery register/checkpoint
  and expose a read-only projection comparing that evidence with current verified inventory. Distinguish ended-before-reboot, interrupted, present-but-unmatched and unknown.
  Inventory absence during failed collection is not proof of interruption.
- [ ] Persist explicit candidate disposition: unresolved, resumed (replacement execution), dismissed
  by operator, or superseded with evidence. Unresolved candidates never expire silently. Keep a
  bounded first page (for example 100) with older-count/pagination; reconstruct the index once at
  daemon startup, not on page requests. Cap accepted record sizes; if safe capacity is exceeded,
  preserve the journal and report degraded/overflow instead of dropping recovery evidence. Archive
  resolved entries only under a stated retention policy; v1 need not delete journal history.
- [ ] For logs predating recovery events, perform a one-time offline/startup replay to recover last
  complete entries where evidence suffices. Missing evidence becomes unknown, not a fabricated
  candidate. Test crash before candidate append, between candidate/removal, and before checkpoint.
- [ ] Show transcript existence, recorded working directory/worktree, last observed activity,
  latest available evidence and whether the harness supports resume. Paths come from the register,
  checked for existence; never synthesize a resume command from a display title.
- [ ] Keep shells/manual jobs as manual recovery with an SSH path; do not pretend they have resumable
  agent state. Provide a bounded checklist/report first, no execute button.
- [ ] Test a missing directory, transcript absent, valid Claude transcript, already-live matching
  execution, empty rebooted fleet, and old schema. Include the first accepted empty post-reboot snapshot and prove candidates survive register removal.
  No `worktree:check` or filesystem read may be treated as proof of work completion.

**Acceptance:** after a simulated reboot Greg sees recoverable work and missing evidence, with zero
sessions automatically started. This stage can land earlier alongside the status projection.

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
