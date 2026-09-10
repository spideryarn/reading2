## Verdict

No P0 findings.

The core design is sound: an action-specific, server-minted preview; strict client parsing; frozen reviewed material; server-side equality checking; and fresh target revalidation are the right shape.

I would not build the plan unchanged, though. Several P1 gaps still allow either duplicate execution or execution under a confirmation that does not match what the operator saw.

## Findings

### P1 — Preview receipts are replayable

The table records whether a preview is known and unexpired, but not whether it has already been confirmed ([plan](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/docs/plans/260909h-box-contracts-kill-and-broadcast-reach-the-inputs-the-server-needs.md:173)). A receipt therefore remains valid for repeated runs during its five-minute lifetime.

In practice, a double-click, retry after a lost response, or two concurrent requests can execute the same confirmation twice. Broadcast’s cooldown usually masks this; Kill’s rate limiter does not establish one-time use, particularly when concurrent requests spend time awaiting process scans.

Smallest fix: give entries a `fresh | claimed` lifecycle and atomically change `fresh → claimed` before the first asynchronous re-probe. Keep a tombstone until expiry so a replay says “this confirmation was already submitted; inspect before acting again,” not “unknown—preview again.” Test sequential replay and two concurrent confirms.

Recommended order:

`origin/body → scope/mode/confirm → FLEET_ACT_ENABLED → complete envelope validation → rate/cooldown admission → atomic claim → fresh revalidation → effect`

Invalid envelopes must not consume rate-limit capacity. The acting gate should remain before envelope checks, as the plan already says ([plan](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/docs/plans/260909h-box-contracts-kill-and-broadcast-reach-the-inputs-the-server-needs.md:110)).

### P1 — The process identity is sound, but the signal is still PID-racy

`pid + startTicks + bootId` is sufficient to identify a Linux process. It is not sufficient to ensure that a later `kill(pid)` targets that process.

The proposed route reads `/proc/<pid>/stat`, compares the token, and then eventually executes `kill -TERM <pid>`. The existing plan builder targets only the numeric PID ([actions.ts](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tools/fleet/actions.ts:817)). The verified process can exit after the `/proc` read and its PID can be reused before the signal. The replacement then receives the signal even though its identity was never confirmed.

Smallest complete fix: make the final operation identity-bound—for example, open a Linux pidfd, verify the start token for the process bound to that handle, and signal through the pidfd. At minimum, the plan must stop saying start ticks “close” PID reuse if it retains a separate read followed by `kill(pid)`.

A vanished `/proc` entry is different: excluding that candidate with an explicit reason is correct. It is ordinary churn and should not cancel independently verified candidates. If every candidate vanishes, refuse `nothing-to-kill`. Failure to read the global boot identity should be a whole-request refusal because no candidate can then be verified.

### P1 — Overlapping preview requests can pair one action’s envelope with another action’s label

The current component holds `pending` and `preview` separately, and each async press writes them independently ([ActionButtons.tsx](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tools/fleet/web/src/ActionButtons.tsx:1748), [ActionButtons.tsx](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tools/fleet/web/src/ActionButtons.tsx:1765)). React’s `busy` update does not synchronously prevent a second event.

A quick press of A then B can produce:

1. `pending = B`
2. B’s response arrives
3. A’s older response arrives and replaces `preview`
4. The panel says “Confirm B” over A’s envelope
5. `boxConfirm(envelope)` correctly executes A

Freezing rows does not close this race.

Smallest fix: store `{requestGeneration, action, outcome}` as one state value, discard responses from older generations, and render/confirm only from that single value. Add a test with two deliberately out-of-order preview promises. The one-time server claim above separately handles two rapid Confirm presses.

### P1 — Broadcast’s speaker is not included in the bound material

The proposed broadcast material is only `broadcast { recipients[] }`, and the illustrated Confirm request carries no `speaker` ([plan](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/docs/plans/260909h-box-contracts-kill-and-broadcast-reach-the-inputs-the-server-needs.md:54)). But `speaker` changes the exact sentence and its authority. Today the client sends `greg` ([actions-client.ts](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tools/fleet/web/src/actions-client.ts:1097)); if Confirm omits it, the route parser currently defaults it to `overseer`.

That could make the displayed words differ from the delivered words. More generally, any request field affecting rendered text but living outside the equality check defeats the envelope.

Smallest fix: canonical broadcast material must contain:

- `speaker`
- every recipient target claim and declared status
- recipient order, because it determines stagger position
- the preview inclusion/exclusion and computed pause assignment

Confirm must echo that complete material, and no effect-determining value may be taken from an unbound sibling request field.

The Kill material also needs an explicit shape separating confirmable identities from display-only exclusions. As written, incomplete candidates must simultaneously appear in the envelope for rendering, be omitted from submission, and still pass “material matches.”

### P1 — The Health tab’s Broadcast remains broken

The roadmap explicitly requires passing rows through both panels ([roadmap](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:701)). `OverseerPanel` already supplies them ([OverseerPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tools/fleet/web/src/OverseerPanel.tsx:567)), but `HealthPanel` does not ([HealthPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tools/fleet/web/src/HealthPanel.tsx:159)), and `App` does not give HealthPanel rows ([App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/tools/fleet/web/src/App.tsx:381)).

Consequently, Broadcast on Box Health still previews with no recipients and is refused. The plan’s file list omits all three relevant files.

Smallest fix: add `rows` through `App → HealthPanel → BoxActionsCard`, list those files in scope, and add a Health-tab integration test equivalent to the existing Overseer hop test.

### P2 — “Recognised preview” does not explicitly validate `op`, and the core negative tests are missing

The roadmap asks for a wrong-operation test ([roadmap](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md:696)). The current plan preserves `op` but only explicitly rejects bad schema, `dryRun`, and envelope action ID ([plan](/home/greg/code/spideryarn2/.claude/worktrees/box-contracts/docs/plans/260909h-box-contracts-kill-and-broadcast-reach-the-inputs-the-server-needs.md:205)).

A contradictory answer such as a Kill preview carrying `op: "ran"` or a Broadcast envelope under `op: "dry-run"` should never acquire a Confirm button merely because `dryRun: true`.

Smallest fix: require the whole response to agree:

- expected preview `op`
- top-level `action`
- `dryRun === true`
- envelope `actionId`
- material discriminator matching the action effect
- complete, all-or-nothing material parsing

Also add the negative tests the roadmap’s acceptance depends on: mutate one candidate token, one recipient identity/status, recipient order, speaker, and preview schema; each must record zero effects. Add the poll/rerender and out-of-order-response tests as well.

### P2 — `actionRevision` is dead weight and hashes the wrong boundary anyway

Within a running `makeActionRoutes`, `ACTIONS` is static. A code change requires a server restart, and the new `serverInstanceId` already rejects every old preview before revision is examined. Therefore a known preview cannot encounter a changed action definition.

It also hashes selected literal fields, not the actual Kill semantics in `selectForKill`, `SAFE_KILL_RULES`, or the renderer implementation. It would look stronger than it is.

Smallest fix: remove `actionRevision`, its hashing code, refusal arm, and tests from both plan and roadmap. Instance identity plus stored canonical material already supplies the invariant. If live action mutation is introduced later, revisioning can return with a concrete use case.

## The TTL and bounded table

Five minutes is reasonable. Thirty-five sessions do not imply thirty-five entries: these are box-action previews, not one preview per session.

A press storm or many browser tabs can create a 33rd preview and evict one still awaiting confirmation. FIFO is still the right simple policy because the oldest entry is closest to expiry. The safe response is exactly a named refusal requiring a new preview—never silent regeneration. Purge expired entries before capacity eviction, and distinguish `already-used` from `evicted/unknown` so a lost response does not invite an unsafe repeat.

## Stage 3 fail-safe assessment

With strict, all-or-nothing parsing and the async state race fixed:

- Old server with no envelope: no Confirm.
- Malformed envelope: no Confirm.
- `dryRun` absent or false: no Confirm.
- Network failure during preview: no Confirm.
- Poll changing `rows`: safe, because Confirm uses only the frozen envelope.

Without the response-generation guard, an older successful preview request can still arrive after one of those failures and repopulate the panel, so the current freeze proposal is not yet fail-safe in every direction.