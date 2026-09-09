# Apply the stage-3 code review findings

You implemented stage 3. It went to the cross-family reviewer, which returned **five findings — one P1,
four P2 — and the verdict "land with changes"**. This task is to apply them.

Work in this checkout (git worktree, branch `worktree-codex-usage`). The tree is committed and clean at
`605fbbca`, so `git diff` afterwards is exactly your work. **Do not commit**; I read the diff and commit
from outside.

## The findings

**`docs/plans/260909d-codex-usage-stage3-code-review-sol-r1.md`** — read it in full and work from it
directly. It is relayed unedited: nothing renumbered, merged, split or reordered.

Each finding carries **(a)** an input that breaks the current code and **(b)** a suggested change. **The
rule is: apply (a) first and watch it go red, then apply (b), then watch (a) get caught.** Never apply a
(b) whose (a) you could not make fail — say so and leave it alone instead. Report per finding:
*reproduced / could not reproduce / disagree*.

## My decisions, which override the review where they differ

I verified all five against the source. Four are to be applied as given. **Finding 4 is the exception.**

**Findings 1, 2, 3, 5 — apply as Sol gives them.**

Finding 1 is the P1 and the important one: the persisted validator checks only that the reset follows
`readAt`, not that it falls within `windowMinutes`, though both values are to hand. Note *why* this
matters more than it looks — stage 3 introduced independent persisted validation precisely so that a
producer regression or a differently-written schema-1 line could not resurrect stage 2's timestamp bug,
and as written it does not do that job.

Finding 2 has a second half that matters as much as the fix: the current "six absences" test manufactures
its legacy case **by passing a line through today's encoder**, so it cannot fail for the reason it names.
Construct legacy input as old bytes — `JSON.stringify` a line with the key deleted — as Sol shows.

Finding 5 is the same class: a substring match that a comment satisfies. Use the AST form. We already
depend on TypeScript, so this costs nothing.

**Finding 4 — do NOT implement the preservation. Fix the over-claim instead.**

Sol is right that an otherwise-valid reading with no general `codex` bucket collapses to a top-level
`unknown`, so absence 3 is representable in the format but **not reachable from the producer** — and that
the test and report therefore claim more than production delivers.

I am deferring the code change deliberately, and the reason is worth writing down: preserving those
buckets moves the responsibility for finding general headroom to the consumer, and the consumer picking
the wrong bucket is exactly the substitution bug your own stage-2 finding 7 was written to prevent. The
decision is safe either way today — an absent general bucket yields `unknown`, never false headroom — so
trading a safety property for diagnostic detail is the wrong way round at this stage.

So: **stop claiming it.** Change the test and any comment or report wording so they say absence 3 is
representable in the persisted format but not currently producer-reachable, and that a reading with no
general `codex` bucket persists as `unknown` carrying its reason. Do not weaken the test into vacuity —
it should still assert what the *format* distinguishes, while being honest that the producer cannot
currently emit that state.

## Constraints

- Files: `tools/fleet/usage-history-record.ts`, `scripts/overseer.ts` (the composition helper only),
  `tests/fleet-usage-history-record.test.ts`, `tests/fleet-usage-history-wiring.test.ts`, and the other
  stage-3 tests if a finding needs them.
- **Nothing under `tools/fleet/web/`, nothing in `UsagePanel.tsx`, nothing in `usageLines()`** — stage 4.
- **Do not import `scripts/subagent-cli.ts` or anything reaching `src/env.ts` from a file under
  `tools/`** — `tests/fleet-imports.test.ts` forbids it and this already reddened the suite once.
- No new dependency. TypeScript is already present for finding 5.
- Do not weaken or delete a test to make a change fit. Say which tests you changed and why.

## How to run things

- `npx vitest run tests/<one>.test.ts` and `node --import tsx <script>` work.
- **`npm run typecheck` and `npm test` do not** — I run those. Note that your own "direct TypeScript
  check" does **not** cover the test projects: last round it passed while the real typecheck failed on a
  test file, so please reason carefully about types in tests rather than relying on that check.
- **No network.** Do not attempt a live reading.

## What to report

- Per finding: reproduced / could not reproduce / disagree, with the red output then the green.
- Any (b) you think is wrong, and what you did instead. You have caught a wrong instruction from me in
  each of the last two rounds; keep doing it.
- Anything stage 4 will get wrong, beyond the eight cautions you already listed.
- Anything you could not check.
