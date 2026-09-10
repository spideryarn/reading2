# Review: plan 260910f — bounded judgement, proposals for the attention inbox

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/bounded-judgement`, branch
`worktree-bounded-judgement`. TypeScript, ESM, run with `tsx`; tests are vitest.

## The candidate

A plan, not code: `docs/plans/260910f-bounded-judgement-proposals-for-the-attention-inbox.md`,
committed on this branch (the latest commit touching it — `git log -1 -- <that path>`).

Start with the plan, then the code it builds on: `tools/overseer/attention-classify.ts`,
`tools/overseer/attention-pass.ts`, `tools/overseer/attention-memory.ts`, `tools/overseer/attention.ts`,
`tools/overseer/attention-cli.ts` (`attentionRunner`), `tools/fleet/wire.ts` (`AttentionItem`,
`AttentionList`), the three parsers of that list (`tools/overseer/store.ts` `parseAttentionItem`,
`tools/fleet/attention.ts` `parseItem`, `tools/fleet/web/src/types.ts` `parseAttentionItem`),
`tools/fleet/web/src/AttentionPanel.tsx`, `tools/overseer/reports.ts` (`readReports`, `ReportEvent`),
`src/spend-declarations.ts` (the `tools/overseer/attention-classify.ts` row) and
`tests/no-undeclared-spend.test.ts` (its ALLOWED entry). The spec is
`docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` § "Stage: Bounded judgement" (around
line 1652), and the rules it answers to are `docs/project/overseer.md` gate 4 and
`docs/project/overseer-direction.md` § "Route by who has the information". That list is where to
begin, not the limit of scope.

## What it is meant to do

Extend the existing prose-question detector, not build a second one: a typed proposal per surfaced
prose question naming who holds the information, a global per-day model budget with cooldown and a
loud exhausted state, a recorded right/wrong mark as the veto, and an evaluation that is allowed to
conclude "not worth it". **It must never send steering or approvals, and no proposal may read as
Greg's voice.** The new call is default-off until Greg has seen a per-day number. The acceptance
line: a prose question surfaced with evidence and model attribution under a hard budget; 36 sessions
do not mean 36 calls a minute.

Out of scope: any new HTTP route on the fleet server, the steer/action routes, `daemon.ts`'s usage
pass, the scheduler and recovery (which gate 4 says must share the budget eventually), and detecting
misdirection.

## What you can and cannot run, and what you may change

The tree is read-only. /tmp and the node_modules caches are writable; you can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`). No network.

**Write your findings FIRST to `/tmp/260910f-plan-review-findings.md`**, as you go and before any
long investigation, and put the same findings in your final answer. The runner overwrites the answer
file at exit, and reviewers have died at their time wall with nothing written.

## Attack it

Independently, before you read my suspicions below. The invariants to break:

1. **Nothing is sent, and nothing reads as Greg.** Find a path where a proposal could reach a pane,
   or a surface where it could be mistaken for Greg's decision.
2. **The budget is hard and the exhausted state is loud.** Find a pass that spends past the day
   ceiling, a restart or clock edge that resets it, a failure that is cached as a fact, or a state
   in which the inbox draws calm while nothing was judged.
3. **The three parsers and an older producer/consumer stay honest.** A new field on `AttentionItem`
   read by an old parser, and an old checkpoint read by a new one.
4. **The plan is the smallest version that answers the spec.** Name any stage or decision that costs
   more than it buys, or a simpler shape that gets most of the value — reframing or cutting is a
   legitimate finding.

For each finding give: an ID (F1, F2, …), a severity (P0/P1/P2/P3 — P0 data loss / security /
incorrect charging / service unusable; P1 user-visible wrong behaviour or an authoritative contract
violated; P2 design risk; P3 prose), whether it is established or reasoned, (a) the concrete scenario
it does not handle or the contract it contradicts, and (b) the smallest change — exact replacement
wording for the plan. Refuse only on an established P0 or P1.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- D3 departs from the roadmap's "execution + content hash + classifier version" key. Is the
  argument (the key must cover what the model is shown; the pass has no execution token) right?
- D10 joins a report to a pane by session name plus `execution: "same-verified-run"` at receipt. A
  claude relaunched in the same tmux session after the report was filed would inherit it.
- D6 adds a field to `AttentionList`; the same three-parser question as the item field.
- The proposals log and the marks file are two more append-only files in the store with writers
  that are not the daemon (the marks CLI).

Do not change any file in the repository.
