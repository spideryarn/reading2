# Review: shipping the V4 Socratic question wording as `toc/7`, and keeping the eval's control alive

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval`, branch
`worktree-fb1v-socratic-v4-and-the-eval`. TypeScript + ESM, run with `tsx`, tested with vitest. This
is a reading app: it ingests an article, a model carves it into a nested table of contents ("the
tree"), and the reader sees one line per part — since a recent change, the Socratic *question* where
there is one and the one-sentence *gist* otherwise.

## The candidate

**Committed: `334988ad`** (parent `2c5b6e6b`, which is a merge of `origin/dev`).

```
git show 334988ad
git diff 334988ad^..334988ad
```

Changed paths, complete:

```
docs/plans/260907d-review-1-plan-answer.md          (new — your own previous review)
docs/plans/260907d-review-1-plan-prompt.md          (new)
docs/plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md  (new — the plan)
docs/project/hierarchy.md
docs/project/summaries.md
evals/README.md
evals/summaries/arms.ts
evals/summaries/run.ts
evals/summaries/variants-file.ts
evals/summaries/variants.md
src/hierarchy-prompt.ts
src/hierarchy.ts
tests/hierarchy-prompt-hoist.test.ts
tests/hierarchy-structure-request-parity.test.ts
tests/summaries-eval.test.ts
```

**Start with** `src/hierarchy.ts` (the `SYSTEM` QUESTIONS block, `questionFor`, `bareWords`) and
`evals/summaries/arms.ts`. That is where to begin, not the limit of scope — the manifest above is.

**The working tree is NOT the candidate and is moving underneath you.** Another agent is implementing
the next stage in `src/hierarchy-expand.ts`, `src/hierarchy-deepen.ts` and their tests *right now*.
None of those files is in the manifest. Read the candidate through `git show` / `git diff` against the
SHA above, and if a test run disagrees with the diff, trust the diff and say so. (Last round you
correctly discarded a test run for exactly this reason; this time the candidate is durable.)

## What it is meant to do

Greg asked for a Socratic question in the Summary panel and drew the shape himself:

> Computational functionalism - why isn't computation sufficient for consciousness? (4 arguments)

Four candidate rewordings were built as an eval (`evals/summaries/`) and measured over seven real
articles on 2026-09-05. **V4** — `<topic> — <question>? (<shape hint>)` — reproduced his example
almost verbatim, unprompted, on the exact node he wrote it about. He then said: *"Ship v4, then fix
the eval, and consider tweaks if you learn something useful from it."* This commit is the shipping.

Four things happen in it:

1. `src/hierarchy.ts` § `SYSTEM`'s QUESTIONS block is replaced with V4's, copied byte-for-byte out of
   `evals/summaries/variants.md` § V4.
2. `questionFor` gains a clause so a `?` followed by one short bracketed hint is a **finished** line
   (it used to append a second `?`), and `bareWords` strips a trailing bracket **before** the terminal
   punctuation so the gist-echo check still fires on `<gist>? (4 arguments)`.
3. `PROMPT_VERSION` `toc/6` → `toc/7`, which re-keys the structure checkpoint.
4. The eval keeps a pre-V4 control. `arms.ts` § `incumbent` slices the **live** `SYSTEM`, so from this
   commit it carries V4's questions; the block V4 replaced is pinned in `variants.md` § *The shipped
   QUESTIONS block, toc/6* and carried by a new `questions-toc6` arm. The `v4` arm is **removed**,
   because production took its block and that made it byte-identical to `gists-only`.

**Invariants that must hold:**

- The shipped QUESTIONS block is byte-identical to `variants.md` § V4. (Your F2 last round; there is
  now a test.)
- The eval can still return the answer *"the control was better all along"*.
- No two arms share a recipe except the declared noise-floor group.
- `questionFor`'s existing behaviours are unchanged for every shape that is not "?-then-bracket": in
  particular a trailing full stop is **not** evidence of mood (a rule you killed on 2026-09-05 and
  that must not come back), depth is enforced, and the gist re-asked is dropped.
- Nothing backfills. Existing articles keep their `toc/6` trees.

**Deliberately out of scope of this commit:** `EXPAND_SYSTEM` (that is the next stage, in flight);
any hand-tuning of V4's wording; any UI change; the eval's calibration gate, which is a later stage.

## What you can and cannot run

The tree is read-only; `/tmp` and the `node_modules` caches are writable. You can run one test file —
`npx vitest run tests/summaries-eval.test.ts` — and a script (`node --import tsx <script>`), and build
a throwaway harness under `/tmp`. You have **no network, not even loopback**, so anything needing
Postgres or a local service will skip.

**What I ran, and the raw results, so you do not have to take my word for it:**

- `npm run check` (typecheck, build, full suite, cycles, chain, conflicts): **all gates green**,
  `Test Files 800 passed | 1 skipped`, `Tests 14864 passed | 35 skipped`, `EXIT=0`. Log:
  `logs/tmux-jobs/check-stage1-1534-2228180.log` in this worktree.
- Red-first evidence, all on 2026-09-07:
  - the inverted P1-4 assertion against the pre-patch `questionFor`:
    `AssertionError: expected 'Computational functionalism — why isn…' to be 'Computational functionalism — why isn…'`
  - the gist-echo-with-a-hint assertion against the pre-patch `bareWords`:
    `AssertionError: expected 'Four independent arguments undermine …' to be undefined`
  - the byte-identity gate, with `"four arguments"` changed to `"4 arguments"` in `variants.md` § V4
    and nowhere else: `AssertionError: expected 'QUESTIONS (the root and depth-1 nodes…' to be 'QUESTIONS (the root and depth-1 nodes…'`
- A real model run against the local Postgres, article
  `what-if-we-had-bigger-brains-imagining-minds-beyond-ours`, 172 blocks. Stored `version: toc/7`;
  the structure checkpoint reported `found: 0, usable: false`. All nine depth-0/1 questions came back
  V4-shaped with no doubled `?`. Two of them:

  > bigger brains — what would minds far larger than ours actually be able to do? (a framework, not a forecast)
  >
  > abstraction — how far could bigger brains climb the tower of abstraction, and what limits remain? (a historical argument)

## Attack it

Independently, before you read my suspicions below.

The invariant to break: **something in this commit that reports success while doing something other
than what it claims.** This repo's recurring bug class is a check that passes while measuring
something else; the previous review of this harness found six of them in one sitting.

Concretely, worth your attention in whatever order you find useful:

- `questionFor`'s new regex `/\?(\s*\([^()]{1,40}\))?$/` and `bareWords`'s new
  `.replace(/\s*\([^()]*\)\s*$/, "")`. Find an input where the pair now does the wrong thing —
  a question that should have been dropped and is kept, one that should be kept and is dropped, a
  gist that no longer matches its echo, a line that gets a doubled mark anyway. The two functions
  interact: `bareWords` runs on both the question and the gist.
- The arm changes. Is `questions-toc6` genuinely a one-variable pair with `gists-toc6`? Is removing
  `v4` right, or does it destroy something a future run needs? Does the new duplicate-recipe test
  actually catch what it claims, or can two arms differ in a way the key it builds cannot see?
- `variants-file.ts`'s new parse. What does it do to a file where the section exists but is
  malformed, or duplicated, or where the fence has no language tag?
- The two re-pinned tests. Were they re-pinned to the right values, or was a pin moved to make a
  failure go away? The structure-checkpoint key went `9022c4cb6b7395b1` → `8e314a56003e9d89`.
- The V4 QUESTIONS block itself, read as a prompt: does anything in it contradict another rule in
  `SYSTEM`, or ask for something `questionFor` will then discard?
- The docs in the manifest — `summaries.md`, `hierarchy.md`, `evals/README.md`, the plan. Grade a doc
  defect by the consequence it will cause, not by the fact that it is prose.

For each finding give:

- an ID — **continue the numbering from last round, so the next new one is `F9`** — a severity
  (P0/P1/P2/P3), and whether it is **established** or **reasoned**
- (a) what shows it fails its own claim: the input or mutation I can run
- (b) the smallest change that closes it — a code block, or exact replacement wording

A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an **established** P0 or P1, and name what established it.

## Previous findings — this is round 2, and the fixes are unreviewed code

You reviewed the *plan* at base `83c17c29`. Treat every fix below as code written by someone else.

| ID | Finding, verbatim (abbreviated) | Disposition | What changed |
|----|-------------------|-------------|--------------|
| F1 | "the proposed control is not fully pinned, and `v4` is not production" | **fixed, and the real collision was worse** | `incumbent` vs `v4` differ in GISTS — correct, my error. But `v4` became byte-identical to **`gists-only`**, so `v4` is removed. `questions-toc6` now pins **both** blocks (`shippedGists: "toc/6"` + `shippedQuestions: "toc/6"`) and is `isolatedAgainst: "gists-toc6"`. New test enumerates every shared-recipe group and pins the list |
| F1(b) | "…and the pre-V4 `questionFor` rule" | **overruled, with a number** | The two rules differ on exactly one input: `?` then a short bracket. The toc/6 block never asks for one, and the 2026-09-05 run measured **0% bracketed hints across 183 questions** from the three arms carrying it. A pinned second normaliser adds a branch that cannot fire. Argue with the number if you disagree |
| F2 | "byte identity is an invariant without a byte-identity gate" | **fixed** | Your assertion, verbatim, in `tests/summaries-eval.test.ts`; mutation-checked |
| F3 | "the proposed anchor repair does not calibrate lookup-question rejection"; "the judge is stable" unsupported | **accepted, deferred to stage 3** | Not in this commit. The plan now carries the argument-demand rubric criterion, the replacement anchor 2, and a narrowed claim about what the anchors show. Also found independently: the 15th inversion is `anchor-4`, so repairing anchor 2 alone would not have cleared the gate |
| F4 | "stage 2 can finish without fixing the visible gap" | **accepted, in flight** | Plan's stage-2 acceptance condition rewritten; per-target marking and `candidate.depth + 1` seam adopted |
| F5 | "the expansion-stamp explanation is wrong" | **accepted, deferred to stage 2** | Explicit `expand/3` → `expand/4`, reason corrected to provenance |
| F6 | "stage 5 can truthfully report a cached zero, then price it by the wrong authority" | **accepted, deferred to stage 5** | Newly minted slug, `structureResumed: false`, ledger dollars not hand arithmetic |
| F7 | "stage 4's evidence rule is unfalsifiable" | **accepted** | Stage 4 may ship only exact prompt text that was an arm in a passing run |
| F8 | "stage 5 conflicts with the important-doc and open-question contracts" | **half taken** | `open-questions.md` is **not** one of the seven entry-point docs — the seven are listed in `CLAUDE.md` and it is a doc *beneath* `vision.md`. Substance moves to the owning doc; Q7's anchor stays (eight inbound links); the stage is not blocked on approval, because the brief commissions it and Greg is unreachable |

Spend most of the run on what has changed since — the code, which you have not seen.

## My own suspicions — read last

Already my doubts, so confirming them is worth less than anything you find yourself.

1. The `{1,40}` bound in the new `questionFor` regex is a judgement I made up. I think it separates
   "a shape hint" from "a parenthetical sentence", but I have no data behind the number.
2. `bareWords` is used for the gist-echo check on **both** arguments. Stripping a trailing bracket
   from the *gist* side may have consequences I have not thought about — a gist legitimately ending
   in a parenthetical now compares equal to one without it.
3. Removing the `v4` arm may be too aggressive. The alternative was to keep it and declare a second
   noise-floor pair.
4. I re-pinned two tests. Re-pinning is exactly how a real regression gets waved through, and I would
   like someone else to check the new values are what the change should produce.

Do not change any file.
