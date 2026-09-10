# Review: plan 260910f Stage 1 — the day budget and the `limited` inbox state

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/bounded-judgement`, branch
`worktree-bounded-judgement`. TypeScript, ESM, `tsx`; vitest.

## The candidate

Committed: f03d5571 (parent 8e67960b)
  git diff 8e67960b..f03d5571
  changed paths: `git diff --name-only 8e67960b..f03d5571`

Start with: `tools/overseer/model-budget.ts`, `tools/overseer/attention-pass.ts`,
`tools/overseer/attention-cli.ts`, then the `limited` arm in `tools/fleet/wire.ts` and its three
parsers (`tools/overseer/store.ts`, `tools/fleet/attention.ts`, `tools/fleet/web/src/types.ts`),
`tools/fleet/questions.ts`, `tools/fleet/web/src/AttentionPanel.tsx`. Where to begin, not the limit.

The plan is `docs/plans/260910f-bounded-judgement-proposals-for-the-attention-inbox.md` — Stage 1,
decisions D3–D6 and D12 — and your own plan-review findings are beside it
(`…-plan-review-sol-findings.md`, F1–F3 bear on this stage). Raw gate output: `logs/tmux-jobs/bj-s1-gates-1831-7821.log` (focused suites 872/872, typecheck
exit 0). Stage 1a, the labelled set, is the earlier commit `ac02c4c9` and is in scope too.

## What it is meant to do

- **Every paid attention call, daemon or CLI, goes through `model-budget.ts`**, which reserves the
  worst case under a `lock.ts` claim and persists it before the request, settles after, and can
  neither be exceeded nor reset: not by two processes, a crash between reserve and settle, a UTC
  midnight during a call, a deleted or corrupt ledger after initialisation, or a clock moving back.
- A 402/429 sets a cooldown (15 min doubling to 2 h).
- When the budget refuses at least one call, the pass publishes `kind:"limited"`; **no reader, old or
  new, may draw that as a calm inbox**, and the mechanical half (dialogs, counts) keeps working.
- A cached verdict from another prompt version is stale-not-absent; failures are never cached.

Out of scope: proposals (Stage 2), the daemon's composition in `scripts/overseer.ts`, the scheduler.

## What you may run and change

The tree is read-only for this review. /tmp is writable; you can run one test file at a time
(`npx vitest run tests/<one>.test.ts`) and `node --import tsx <script>`. No network.
**Write findings FIRST to `/tmp/260910f-stage1-review-findings.md`**, as you establish each, then put
them in your final answer — the runner overwrites the answer file at exit.

## Attack it

Independently first. Break: (1) spend past a ceiling by any route — two ledgers on one directory, a
reserve that returns before its fsync, a settle that frees a reservation it does not own, an unpriced
call; (2) re-grant a spent day; (3) make any of the three parsers, or `questions.ts`, or the panel,
read a `limited` list — or any budget refusal — as *nothing needs you*; (4) a cooldown that never
ends or never starts; (5) a stale verdict that is never re-read or a failure that is cached.

For each finding: ID (continue from F10), P0–P3, established or reasoned, (a) the input or mutation
that shows it, (b) the smallest fix. Refuse only on an established P0 or P1.

## My own suspicions — read last

These are the implementer's departures from its brief, which I accepted and which are listed in the
plan under Stage 1 — "1b–1e, as built". The ones I would least like to be wrong about:

- **The lock is held for reserve and for settle, not across the request.** Your F1 wording said
  "hold the lock through reconciliation"; D4 argues the persisted worst-case reservation gives the
  same guarantee without blocking the other process for a 30-second call. Is that statement accurate?
- **`unavailable`** (lock not taken, or the write failed) leaves the list a `list` with the tail
  counted unjudged, not `limited`. Is there a path where this reads as calm?
- **A new UTC day drops yesterday's unsettled reservations** with yesterday's ledger, and a `closed`
  day reopens at midnight. And a clock that jumps FORWARD past midnight grants a fresh day — which I
  believe is unavoidable, not a finding.
- **The `--no-write` hand run** is covered only by a structural test (only two files name
  `classifyTail`), not end to end.
- `WORST_CASE_CALL_USD` is $0.01 against a real call of ~$0.0004, so ~150 unpriced calls would close
  the day on cost alone. Is that the right direction to be wrong in?

Do not change any file in the repository.
