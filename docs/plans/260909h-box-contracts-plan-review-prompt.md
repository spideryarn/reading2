# Plan review: box contracts for the fleet dashboard's Kill and Broadcast

You are reviewing a **plan**, before any code is written. Read-only. Be adversarial about the design,
not about wording.

## Context

This repo is Spideryarn. `tools/fleet/` is an internal operations dashboard (the "fleet dashboard")
that shows the ~35 Claude agent sessions running in tmux on one Linux box, and offers a few actions
against them. Two of those actions are broken:

- **Kill** (`kill-test-suites`, `kill-safe-processes`) — a box-wide action that signals processes
  matching a named rule.
- **Broadcast** — a box-wide action that types one sentence into every steerable agent session, with
  a staggered resume time per recipient.

Both go press → server dry run → confirmation panel → second press → server run.

## What to read, in this order

1. `docs/plans/260909h-box-contracts-kill-and-broadcast-reach-the-inputs-the-server-needs.md` — **the
   plan under review**.
2. `docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` § "Stage: Box contracts — make the
   existing actions reach their intended inputs" (search for that heading) — the spec the plan is
   implementing, including a **Simpler alternative rejected** paragraph.
3. `tools/fleet/routes-actions.ts` — `parseBoxBody`, `boxRoute`, `killRoute`, `broadcastRoute`,
   `ActionIo`, `ActionDeps`, and the § "What a box action answers" header.
4. `tools/fleet/web/src/actions-client.ts` — `boxActionBody`, `BoxOutcome`, `parseBoxEffect`, and
   `makeActionsApi().box`.
5. `tools/fleet/web/src/ActionButtons.tsx` — `BoxActions`.
6. `tools/fleet/execution-identity.ts` — `readProcessStart`, `readBootIdentity`, `parseProcStat`.
7. `tools/fleet/instance.ts` — the per-run server instance id the plan reuses.
8. `tests/fleet-actions-route.test.ts` — especially `harness()`, `fakeIo()` and `browserFetch()`,
   which the new tests will build on.

## What I want from you

Rank findings P0/P1/P2/P3. For each: what is wrong, what would go wrong in practice, and the
smallest change that fixes it. Say explicitly if you think the plan is sound.

Specific questions, but do not stop at these:

1. **Is the preview envelope's check order right, and is it complete?** The plan checks instance →
   known → unexpired → action → revision → material, all before any effect. Is there a check missing,
   or one that is in the wrong place relative to the existing `FLEET_ACT_ENABLED` gate, the rate
   limiter and the fresh re-probe? Note the envelope is explicitly *not* an authorisation mechanism.

2. **Is "pid + start ticks + boot id" actually sufficient identity for a kill confirmation**, given
   that the run re-reads them from `/proc` while the process may be exiting? What does the route do
   with a candidate whose `/proc` entry has vanished between preview and run — and is the plan's
   answer (exclude it with a reason) the right one, or should that be a whole-request refusal?

3. **The five-minute TTL and the 32-entry bounded table.** With ~35 sessions and one operator, is
   FIFO eviction the right policy, or can a plausible sequence of presses evict the preview the
   person is about to confirm — and if so what should happen?

4. **`actionRevision` as a hash of the action definition.** Is hashing the definition the right
   granularity? The actions are static literals in `tools/fleet/actions.ts` (`ACTIONS`), so the hash
   only changes when the code changes and the server restarts — at which point the instance id has
   already changed. Does the revision earn its place, or is it dead weight the plan should cut?

5. **The client's freeze.** The plan puts the reviewed envelope in React component state and submits
   only from it. Is there a route by which a re-render, a poll, or a second press could still get an
   unreviewed set to the server?

6. **Stage 4's "no envelope means no Confirm" rule.** Does it fail safe in every direction — an old
   server that sends no envelope, a server that sends a malformed one, a network error mid-preview?

7. **Anything the plan is doing that is more work than the roadmap asked for**, and anything the
   roadmap asked for that the plan has quietly dropped.

Do not write code. Answer in markdown.
