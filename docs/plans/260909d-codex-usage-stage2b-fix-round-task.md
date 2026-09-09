# Apply the stage-2 code review findings

You implemented `tools/overseer/codex-usage.ts` earlier today. It went to a cross-family reviewer,
which returned **seven findings — two P1, five P2 — and the verdict "land with changes"**. This task is
to apply them.

Work in this checkout (git worktree, branch `worktree-codex-usage`). The tree is committed and clean at
`f801be5c`, so `git diff` afterwards is exactly your work. **Do not commit**; I read the diff and commit
from outside.

## The findings

**`docs/plans/260909d-codex-usage-stage2-code-review-sol-r1.md`** — read it in full and work from it
directly. It is relayed to you unedited: I have not renumbered, merged, split or reordered anything,
because doing so has previously lost a finding while the count still matched.

Every finding carries **(a)** an input that breaks the current code and **(b)** a suggested smallest
change. **The house rule is: apply (a) first and watch it go red, then apply (b), then watch (a) get
caught.** Never apply a (b) whose (a) you could not make fail — if a reproduction will not reproduce,
say so and leave that finding alone rather than changing code on faith.

Report per finding: *reproduced / could not reproduce / disagree*.

Also read, for what the code is judged against:

- `docs/plans/260909d-read-the-codex-subscription-usage-limits-and-show-them-beside-claude-s.md` —
  the plan; stage 2 is the specification.
- `docs/plans/260909d-codex-usage-plan-review-sol-r1.md` — the earlier plan review, still binding.
- `tests/fixtures/codex-usage/README.md` — which fixtures are real and which synthetic.

## Decisions I have made, which override the review where they differ

I have checked all seven findings and accept all seven. Two need a decision from me rather than a
straight application:

**Finding 1 — go further than the suggested fix.** Sol proposes failing the decision bucket closed
until `spendControlReached` and `individualLimit` are modelled, and notes that modelling them is the
better follow-up. **Do both, now**: carry both fields onto `CodexUsageBucket` so that nothing the
payload said is discarded, *and* fail the general `codex` bucket closed when either indicates a limit
we do not fully model. Nothing is lost, and the decision still refuses to look healthy when it cannot
prove it is. Also take Sol's point that an **absent** `rateLimitReachedType` must not become `null` —
absent is unknown, for the decision bucket at least.

**Finding 5 — accept it as written.** Drop the upper bound on `usedPercent` entirely. A number above
100 is the account being over its limit, which is the single most decision-relevant state there is;
turning it into `unknown` is the wrong direction. Validate `>= 0` and non-null only. If a progress bar
ever needs clamping, that is the renderer's job, not the data's.

The other five: apply as Sol gives them. Finding 2's replacement `resetInstantMs` bounds the instant by
the window's own duration, which also means it now needs `windowMinutes` — check the call order in
`buildWindow` still makes sense and say so if it does not.

## Constraints

- **Scope is the same three files**: `tools/overseer/codex-usage.ts`, `tests/codex-usage.test.ts`,
  `tools/fleet/wire.ts`. Nothing else. Stages 3 and 4 are not yours.
- **Every finding gets a test** that fails before the fix and passes after — Sol's "Important missing
  cases" list is precisely the set of tests to add.
- No new dependency. `node:string_decoder` is a builtin and is fine.
- Do not weaken or delete an existing test to make a change fit. If an existing test has to change,
  say which and why.

## How to run things

- `npx vitest run tests/codex-usage.test.ts` works.
- `node --import tsx <script>` works.
- **`npm run typecheck` and `npm test` do not** — the sandbox denies the socket they need. I run those.
- **No network at all.** The fixtures exist so you do not need one. Do not report an inability to reach
  the network as a finding, and if a test goes red in a way that might be the sandbox rather than the
  code, say you cannot tell.

## What to report

- Per finding: reproduced / could not reproduce / disagree, with the red output and then the green.
- Any finding whose (b) you think is wrong, and what you did instead. I would much rather have a
  disagreement with reasons than a faithful application of a bad suggestion — Sol's findings are
  claims, not instructions, and one of my own earlier instructions to you was wrong in exactly that way.
- Anything you noticed that stages 3 or 4, as the plan writes them, would get wrong.
- Anything you could not check.
