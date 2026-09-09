# Review a plan: read the Codex subscription's usage limits and show them beside Claude's

You are the cross-family reviewer. Please review the plan doc at
`docs/plans/260909d-read-the-codex-subscription-usage-limits-and-show-them-beside-claude-s.md`
in this checkout (a git worktree of the spideryarn2 repo, branch `worktree-codex-usage`, commit
`863742d9`). It is untouched by anything else in the tree; `git show 863742d9 --stat` is the whole
change under review.

## What the work is for, in plain words

This repo runs a small fleet of AI coding agents on one always-on Linux box. One of them, "the
Overseer", decides on a 300-second timer which of two paid accounts to spend on the next piece of
implementation work: an Anthropic Claude Max subscription, or an OpenAI ChatGPT subscription reached
through the Codex CLI (`scripts/run-codex.ts` — you are running under it now).

The Claude side is already instrumented: `tools/overseer/usage.ts` reads how much of the weekly and
five-hour limits are used, appends one record per pass to `~/.overseer/usage.jsonl`, and a web
dashboard draws it. The Codex side is invisible, so the Overseer is rationing between one account it
can measure and one it cannot. Claude's weekly window is at 76% with six days to run, which is why
this is the fleet's top priority right now.

This plan's stage 1 (research) is **done**, and its findings are the substance of the doc. Stages 2-4
are a design not yet built. **Both halves are in scope for your review**, but weight the research
findings higher: they are load-bearing for everything downstream, and an error there is the expensive
kind.

## Context you need — the house rules the design is trying to satisfy

Read these three, in this order, because the plan's design decisions are all appeals to them:

1. `docs/reusable/silent-success.md` — the failure class this codebase fears most: something
   reporting success while doing nothing, with the obvious check agreeing because it shares an
   assumption with the code.
2. `docs/project/usage-history.md` — the Claude-side feature this one mirrors, especially
   § "What the chart may not claim".
3. `tools/fleet/usage-history-record.ts` — the persisted record's contract. Its header explains why a
   number is never stored without the instant that validates it, and why a window's absence is never
   a zero.

Also relevant: `tools/fleet/wire.ts` (where every shape crossing to the renderer is declared once),
`tools/overseer/usage.ts` (the module stage 2 mirrors), and `scripts/overseer.ts` around line 1183
(the composition root that joins the daemon to the store).

## What you can and cannot run here

You are under the repo's `review` permissions profile: read anywhere, write only to `/tmp` and a few
`node_modules` caches, **and no network at all, not even loopback**. So:

- `npx vitest run tests/<one>.test.ts` works for a single test file that needs nothing outside the tree.
- `node --import tsx <script>` works. `npm run typecheck` and `npm test` do **not** (they need a
  socket or a database); those are mine to run, and I will.
- **You cannot re-run my stage 1 measurements** — every one of them talks to OpenAI's backend or spawns
  `codex`. Treat the numbers as reported evidence and tell me where you would want an independent
  check; do not report a failure to reach the network as a finding about the plan.

## What I most want from you

The measurements in stage 1 are mine, taken today, and nobody has checked them. Specifically:

1. **Is "it is live, not cached" actually established?** My whole argument is that a 300-minute
   window's `resetsAt` advanced by nine seconds between two probes nine seconds apart, so the backend
   must be recomputing it from *now*. Is there an alternative explanation — a local clock-derived
   value, a cache keyed on something that changed, codex computing the field itself — that I have
   dismissed too quickly? This claim removes an entire arm from the design (Claude's `expired` window
   adjudication), so if it is wrong, stage 2 is wrong.

2. **Is the `primary`/`secondary` finding stated strongly enough, and is the proposed repair right?**
   I claim window identity must be derived from `windowDurationMins` rather than from the key. Is
   deriving a name from a duration itself a trap — what happens when a duration appears that maps to
   no name I know, or when two buckets disagree, or when OpenAI changes a window's length?

3. **The schema decision in stage 3.** I argue for adding an optional `codex` field to
   `UsageHistoryLine` and explicitly **not** bumping `SUMMARY_SCHEMA`, because a bump turns every line
   already on disk into `unsupported` and by that module's own contract breaks the series
   positionally. Check that against `decodeUsageHistoryLine` in
   `tools/fleet/usage-history-record.ts`. Is my reading of the decoder right? Is there a case where
   an unbumped schema with an optional field is the dishonest choice — a reader that cannot tell two
   states apart, or a downstream consumer I have not looked at? I claim three absences must stay
   distinguishable (line predates the field / reading failed / payload lacked the window); is three
   the right number, or is there a fourth?

4. **What in this design would let a bad number reach the Overseer's decision looking good?** That is
   the question the house rules exist for. A percentage with no reset instant, an absence rendered as
   a zero, a stale reading with no age on it, a bucket silently picked when the payload had several,
   a failed spawn read as "0% used". I have tried to close each; tell me the one I have not.

5. **Anything in stages 2-4 that is more complexity than the job needs.** The house style is
   "simplest version first" — a v1 working end to end, complexity added when something shows it is
   needed. If the reading should be simpler than I have drawn it, say so.

## How to report

For each finding: a severity (**P0** blocks the work / **P1** must be fixed before it lands / **P2**
worth doing / **P3** opinion), and then two things:

- **(a)** the input or condition under which the plan as written produces a wrong result — something
  I can actually run or construct. A finding with no (a) is an opinion; rank it last and say so.
- **(b)** the smallest change that closes it, as a code block or a precise edit to the plan.

Rank your findings by (a). Please do not hand me patches to apply to the tree — I want the mutation, so
I can watch it fail before I fix it.

Finally, and this matters as much as the findings: **state your overall verdict explicitly** — is this
plan ready to build, ready with changes, or not ready — and say which of my five questions above you
were and were not able to answer, and why. A review that could not check something must say so rather
than leaving me to infer agreement from silence.
