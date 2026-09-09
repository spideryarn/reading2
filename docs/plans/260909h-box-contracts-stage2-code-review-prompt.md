# Review: a box action's confirmation now names the preview it confirms, and can only be spent once

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/box-contracts`, branch
`worktree-box-contracts`. TypeScript + ESM, run with `tsx`, tests are vitest. `tools/fleet/` is an
internal operations dashboard for the ~35 Claude agent sessions running in tmux on one Linux box.

## The candidate

Committed: `2c9a6d9a` (the stage), with `08ff1bc1` before it (the red tests) and `c86d786d` (the
plan).

```
git diff c86d786d..2c9a6d9a
git diff --name-only c86d786d..2c9a6d9a
```

Changed paths: `tools/fleet/routes-actions.ts`, `tools/fleet/wire.ts`,
`tests/fleet-actions-route.test.ts`, and one new plan doc.

Start with `tools/fleet/routes-actions.ts` — `validatePreview`, `boxRoute`, `killRoute`,
`broadcastRoute`, `mintPreview`, `purgeExpired`, `parseBoxBody`, `parseActionMaterial`,
`parsePreviewClaim`. That is where to begin, not the limit of scope.

The plan is `docs/plans/260909h-box-contracts-kill-and-broadcast-reach-the-inputs-the-server-needs.md`
and the roadmap stage it implements is
`docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` § "Stage: Box contracts". The plan's
§ "What GPT Sol changed about this plan" records an earlier review of the *plan*; those decisions are
settled and are not what I am asking about.

## What it is meant to do

Two box-wide actions — a **kill** (signal every process matching a named rule) and a **broadcast**
(type one staggered sentence into every steerable agent session) — go press → server dry run →
confirmation panel → second press → server run.

Before this stage the second press carried nothing identifying what the first press had shown, so:
the kill's confirm sent no candidate list at all and was always refused, and the broadcast's confirm
described whatever the fleet looked like at that instant rather than what was reviewed.

The contract this stage adds:

- A dry run **mints a receipt** — `schema`, `previewId`, `serverInstanceId`, `actionId`, `expiresAt`,
  and the **canonical material** — holds it in a bounded 32-entry table for five minutes, and answers
  with it beside the existing `result`.
- A run must hand that receipt back **with the material echoed verbatim**, and the route checks it
  **before any effect**.
- **Everything that determines the effect is inside the checked material.** Broadcast: the speaker,
  each recipient's claim and raw status, the order (it decides the stagger position), and the pause
  each row was shown. Kill: `confirmable` (pid + start ticks + boot id) separated from `excluded`
  (display-only, never submittable).
- **A receipt is spent once.** `fresh → claimed` is one synchronous assignment with no `await` above
  it in the route, and the claimed entry stays as a tombstone until expiry so a replay is told it was
  already submitted rather than that it is unknown.
- Admission order: origin/body → scope/mode/confirm → `FLEET_ACT_ENABLED` → envelope validation →
  rate/cooldown → claim → fresh re-probe → effect. A malformed envelope must not spend rate-limit
  capacity; the acting gate must stay where it is so repairing this code cannot turn acting on.

**Deliberately out of scope, and not a finding:**

- The client half. `tools/fleet/web/src/**` is untouched; the three tests in
  § "a box action confirms the preview it was given, and nothing else" are **meant to be red**, and
  the seven `boxPreview`/`boxConfirm` typecheck errors are those same three tests. Stage 3 does that.
- `actionRevision`. The roadmap names one; the plan review established it cannot fire and cut it.
- A pidfd. See the accuracy question below.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside the stage under review — each finding red-first, with
the test that reproduces it — and leave anything wider as a finding for me to decide. **Do not
commit.** List every file you changed at the end.

Do not touch `tools/fleet/web/src/**`, `tools/fleet/routes-new.ts`, `tools/overseer/**`, or
`scripts/gjd-remote.ts`; other sessions are live in those right now.

`npx vitest run tests/fleet-actions-route.test.ts tests/fleet-actions.test.ts
tests/fleet-broadcast-route.test.ts tests/fleet-imports.test.ts` works. `node --import tsx
scripts/typecheck.ts` works. You have no network and no Postgres, so the wider suite will not
collect. My run: 262 of 265 passed, the three failures being the intentional Stage 3 tests.

**Never touch a live tmux session, the dashboard on port 8787, or a real process table.**

## Attack it

Independently, before you read my questions below.

**The invariant to break: cause an effect — a `kill` argv reaching `ActionIo.runStep`, or a
recipient reaching `SendCoordinator` — that differs in any way from what the matching preview
described, or cause one preview to produce two effects.**

Some shapes worth trying, and this list is not the boundary: a receipt confirmed twice; two confirms
interleaved around an `await`; a material that deep-equals the stored one but denotes something else
(prototype pollution, `undefined` vs absent key, `-0`, duplicate object keys, a `status` object whose
shape differs but compares equal); an oversized or deeply nested body; a preview minted by one action
and confirmed by another with the same material shape; eviction racing a confirm; the broadcast's
per-recipient stagger differing from the bound `minutes`; a kill whose fresh scan finds a superset.

For each finding give:
- an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is **established** or **reasoned**
- (a) the input or mutation I can run that shows it fails its own claim
- (b) the smallest change that closes it
A finding with no (a) goes last.

Severity by consequence: **P0** data loss, exploitable security, or the tool broadly unusable; **P1**
user-visible wrong behaviour or an authoritative contract violated; **P2** design or maintainability
risk with no wrong behaviour today; **P3** non-behavioural prose or comment defect. Refuse only on an
**established** P0 or P1, and name what established it.

## One accuracy question rather than a soundness question

`killRoute` re-reads each confirmed candidate's start ticks and the boot id as the last thing before
`planKillProcesses`, and the comment beside it says this closes the minutes-wide case where a preview
stays open while the box turns over, and explicitly does **not** close the gap between that read and
the `kill` itself.

**Is that statement accurate, at that strength?** I am not asking whether the mechanism is sound —
without a pidfd it is not, and that is written down. I am asking whether the sentence overclaims or
underclaims what the code actually establishes, and whether any other comment or refusal message in
the diff makes a claim the code does not support. This repo treats an inaccurate comment as a defect
in its own right, because the next person builds on the sentence.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

1. `validatePreview` folds seven distinct checks into one `preview-mismatch` with one sentence.
   Correct, but a person reading it cannot tell *the material changed* from *you confirmed the wrong
   action*. Does that matter enough to split?
2. `isDeepStrictEqual` between a freshly parsed material and a stored one. Is that the right equality
   for a value that crossed JSON in both directions, given `status` is `unknown` and comes off a
   snapshot?
3. The 32-entry cap can evict a `claimed` tombstone under sustained preview creation, which turns a
   replay's answer from `preview-already-used` back into `preview-unknown`. The stage report names
   this. Is it worth fixing, or is it correctly a bounded-memory trade?
4. `MAX_KILL_PIDS` is now enforced at preview time with a `plan-refused` code. Is refusing to preview
   at all the right answer, or should it preview and mark the excess unconfirmable?
