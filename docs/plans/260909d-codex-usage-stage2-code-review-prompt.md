# Code review: the Codex usage reading (stage 2)

You reviewed the plan behind this a few hours ago and returned eight findings. This is the code built
from your review. **Weight this round higher than that one**: a plan-stage review reads prose, so it
could not have found a `spawn` that leaks a credential or a parser that turns the one state we care
about into `unknown`. Those bugs did not exist until this code was written.

## The change under review

Repository: this checkout, a git worktree of spideryarn2, branch `worktree-codex-usage`.

```
git diff 980e789f..f801be5c -- tools/overseer/codex-usage.ts tests/codex-usage.test.ts tools/fleet/wire.ts
```

Three files, +975/-1: the new module `tools/overseer/codex-usage.ts`, its tests
`tests/codex-usage.test.ts`, and additive types in `tools/fleet/wire.ts`. Nothing else in the diff is
mine.

Implemented by GPT-5.6-Sol under `workspace-write`; I reviewed it, ran the checks, and committed it.

## Context, in the order worth reading

1. **`docs/plans/260909d-read-the-codex-subscription-usage-limits-and-show-them-beside-claude-s.md`** —
   the plan. **Stage 2 is the specification this code is judged against.** Stage 1 is the measured
   evidence: what the source is, that it is a real fetch every time, and the traps. Read stage 1
   properly — several findings there are the reason the code looks as it does.
2. **`docs/plans/260909d-codex-usage-plan-review-sol-r1.md`** — your own previous review. Findings 3,
   6, 7 and 8 are directly implemented here; please check they are implemented *correctly*, not merely
   present.
3. **`docs/plans/260909d-codex-usage-stage2-codex-task.md`** — the brief the implementer received,
   committed before dispatch. It contains one instruction that was wrong, annotated in place.
4. **`tools/overseer/usage.ts`** — the Claude-side module this mirrors.
5. **`tests/fixtures/codex-usage/README.md`** — which fixtures are real, which synthetic, and what each
   degenerate bucket is for.

## What this module is for, in one paragraph

A fleet of agents rations work between two paid accounts — an Anthropic subscription and a ChatGPT one
reached through the Codex CLI. The Claude side is instrumented; this is the Codex side. A daemon will
call `collectCodexUsage` every 300 seconds and a dashboard will draw it, so **a wrong number here
becomes a wrong rationing decision**, and a number that looks fine while being stale or belonging to
the wrong account is worse than no number at all.

## Checks already run, so you need not reason about them

- `npx vitest run tests/codex-usage.test.ts` — 17 passed.
- `node --import tsx scripts/typecheck.ts` — exit 0, no errors.
- `npx biome check` on all three files — clean.
- The full `npm test` suite is running as I write this; I will not land this without it.

The red-first evidence, from the implementer's own report: the positional-mapping test failed with
`AssertionError: expected 10080 to be 300` against a naive `primary → weekly` mapping, then passed
17/17 after the slot-plus-duration implementation.

## Where I would look first

These are my own suspicions. Per your usual practice they go last in your ranking if you cannot
produce an input that breaks them — but I would rather hand them over than have you rediscover them.

1. **`usedPercent > 100` is rejected as unusable** (`buildWindow`). If the backend ever reports over
   100 — being *over* the limit — the module turns the single most decision-relevant state into
   `unknown`. `rateLimitReachedType` carries the limit-reached signal separately, so I do not think
   the state is lost, but I am not confident this boundary is right.
2. **`isDeepStrictEqual(bare, rawTarget)` decides bucket disagreement.** Semantically identical
   snapshots that differ by one present-but-null field would be called a disagreement and make the
   reading `unknown`. Fails in the safe direction, but a card that is permanently `unknown` in
   production is still a broken card. The real fixture's two snapshots *are* deep-equal (a test
   covers it), so this is about drift, not today.
3. **`resetInstantMs` treats a value over `1e12` as already-milliseconds.** I convinced myself this is
   safe — plausible seconds are ~1.8e9 and plausible milliseconds ~1.8e12 — but it is a heuristic on
   external data.
4. **The timeout kills the process group** (`process.kill(-pid)`). I would like it checked that this
   cannot kill the wrong group, and that the child is genuinely group leader in every path.

## What I most want from you

- **Can a wrong number reach a rationing decision looking good?** A stale reading with no age, an
  absence rendered as a zero, the Spark bucket standing in for general headroom, a reading from the
  wrong account, a partial parse published as complete. The plan's stage 1 lists what the payload can
  do; the question is whether this code holds under it.
- **Does the child environment actually withhold `CODEX_API_KEY`?** The module uses the repo's existing
  `sanitisedEnv` (`scripts/subagent-cli.ts`), whose contract is that passing no `passThrough` withholds
  the CLI's own key. A test asserts the child env. Please check the assertion actually proves what it
  claims, and that nothing else in the spawn path puts the key back — a login shell, an inherited
  descriptor, anything.
- **Is the protocol handling right under failure?** Stage 1 established that stdin must stay *open*
  (the inverse of `run-codex.ts`'s rule), the reply must be matched by its own JSON-RPC id because a
  notification arrives in between, and `initialized` must precede the call. What happens on a partial
  line, a split UTF-8 sequence across chunk boundaries, an early exit, two replies with id 2, or a
  reply that never comes?
- **Are the tests real tests?** 17 green is a number, not evidence. Are any of them capable of failing
  for the reason they name? Is anything asserted so loosely that a broken implementation passes?
- **Anything simpler.** 585 lines for one reading may be more than the job needs.

## How to report

For each finding: a severity (**P0** must not land / **P1** fix before landing / **P2** worth doing /
**P3** opinion) and then:

- **(a)** the input or condition under which this code fails its own claim — something I can run or
  construct. Rank by this; a finding with no (a) goes last and please say so.
- **(b)** the smallest change that closes it, as a code block.

Please do not patch the tree — I want the mutation so I can watch it fail before applying the fix.

You can run one test file (`npx vitest run tests/codex-usage.test.ts`) and `node --import tsx <script>`.
You have **no network at all**, so you cannot take a live reading; the fixtures exist so you need not.
Do not report an inability to reach the network as a finding, and remember a red test inside your
sandbox may be the sandbox rather than the code — say so if you cannot tell.

Finally: **state an explicit verdict** — land as is, land with changes, or do not land — and say which
of my four suspicions above you were able to check and which you were not, and why. A review that
could not check something must say so rather than leave me to read silence as agreement.
