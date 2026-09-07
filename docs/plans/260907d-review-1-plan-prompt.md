# Review: the plan for shipping the V4 Socratic summary wording, repairing an eval's calibration gate, and answering a costed open question

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval` (a git worktree
of a larger repo), branch `worktree-fb1v-socratic-v4-and-the-eval`. TypeScript + ESM, run with
`tsx`, tested with vitest. This is a reading app: it ingests an article, has a model carve it into a
nested table of contents ("the tree"), and shows a reader one-sentence *gists* and one Socratic
*question* per top-level part.

**This is a plan review, not a code review.** Nothing has been implemented yet.

## The candidate

Live pre-commit; base `83c17c295ccd509a8d2c5ef0ee34a19789b3704b`.

Untracked, and the only file to review:

- `docs/plans/260907d-ship-socratic-v4-repair-the-eval-gate-and-answer-q7.md`

(Not durable — I will record the resulting commit SHA here once it lands.)

Start with that file. It is the whole candidate, but its claims are about code, and checking those
claims against the code is the most valuable thing you can do here. The files it makes claims about:

- `src/hierarchy.ts` — `SYSTEM` (the stage-4 prompt), `questionFor`, `bareWords`,
  `MAX_QUESTION_DEPTH`
- `src/hierarchy-prompt.ts` — `PROMPT_VERSION`
- `src/hierarchy-expand.ts` — `EXPAND_SYSTEM`, `renderTargetBriefing`, `EXPANSION_PROMPT_STAMP`
- `evals/summaries/` — `arms.ts`, `anchors.ts`, `variants.md`, `variants-file.ts`,
  `production-prompt.ts`, `score.ts`, `judge.ts`
- `tests/summaries-eval.test.ts`
- the predecessor plan,
  `docs/plans/260905f-socratic-summaries-eval-admin-page-gating-short-selections.md`, which is where
  every measured number in the candidate comes from

## What it is meant to do

Five stages, in a fixed order, each ending green and committed:

1. **Ship "V4"** — a rewritten QUESTIONS block for the stage-4 prompt, whose shape is
   `<topic> — <question>? (<hint>)`. It needs a two-line change to `questionFor`, which today appends
   a second `?` to any line not ending in one. Bump `PROMPT_VERSION`.
2. **Fix a real gap**: `EXPAND_SYSTEM` (the "deepening cascade", which builds parts of a tree in
   later waves) has no question field at all, so one top-level part can show a question while its
   sibling shows a bare gist.
3. **Repair an eval whose calibration gate failed**, so it can rank again.
4. **Tweaks only if stage 3 taught something**; otherwise write down that it did not.
5. Answer a costing question from one local ingest.

**The invariants that must not break:**

- The shipped QUESTIONS block must be byte-identical to the one the eval measured
  (`evals/summaries/variants.md` § V4). If they drift, production ships something nobody measured.
- The eval must retain the ability to return the answer *"the control was better all along"*.
- A missing question must stay non-fatal — no throw, no retry, no second model call.
- The calibration gate's tolerance (`MAX_ANCHOR_INVERSIONS = 0`) must not be loosened.

**Deliberately out of scope:** any backfill over existing articles; any hand-tuning of V4's wording
before it ships; any UI change that hides the inconsistency stage 2 is about.

## What you can and cannot run

The tree is read-only; `/tmp` and the `node_modules` caches are writable. You can run one test file
(`npx vitest run tests/summaries-eval.test.ts`) and a script (`node --import tsx <script>`), and you
can build a throwaway harness under `/tmp`. You have **no network, not even loopback**, so anything
needing Postgres or a local dev server will skip. Nothing in this candidate has been run yet — there
is no test output to hand you, because nothing has been built.

## Attack it

Independently, before you read my suspicions below.

The invariant to break: **a stage of this plan that would end "green and committed" while having
quietly failed at what it claims to do.** This repo's recurring bug class is a check that passes
while measuring something other than what it claims — the predecessor plan's own review found six of
them in one harness. Look for that shape in the plan.

Specifically worth your attention, in whatever order you find useful:

- Does stage 1's account of the eval's control (`§ The consequence nobody has written down yet`)
  actually hold once you read `evals/summaries/arms.ts`, `production-prompt.ts` and
  `variants-file.ts`? Is `shippedQuestions` the right mirror of `shippedGists`, or does the parse of
  `variants.md` make it awkward or impossible? Would the proposed `questions-toc6` arm really be a
  control, or does something else in the request also move when the live `SYSTEM` moves?
- Is the plan's diagnosis of the calibration-gate failure (stage 3) supported by the evidence it
  cites, or is it a story that fits? In particular: it concludes the judge is stable and one anchor's
  premise was wrong. What would that conclusion look like if it were false?
- Stage 2's design says the question is asked only for the children of the root, marked in the
  request. Read `EXPAND_SYSTEM` and `renderTargetBriefing`: is "the children of the root" actually
  identifiable there, and is a single shared `EXPAND_SYSTEM` compatible with a per-section rule? Does
  a request that batches several sections of different depths break the design?
- Ordering: the plan asserts stage 2 changes what stage 3's gap looks like, and stage 1 changes what
  the eval's control is. Are there ordering hazards it has not noticed — a stage that silently
  invalidates an earlier stage's evidence or tests?
- Is anything in the plan's "done looks like" unfalsifiable, or satisfiable without the work being
  done?

For each finding give:

- an ID (`F1`, `F2`, …), a severity (P0/P1/P2/P3), and whether it is **established** or **reasoned**
- (a) the concrete scenario the plan does not handle, or the authoritative contract in the code it
  contradicts — with file:line
- (b) the smallest change that closes it: exact replacement wording for the plan, or a code block

A finding with no (a) goes last.

Severity, graded by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

A defect in a doc that will cause a P1 to ship is not a P3 because it is made of prose.

Refuse only on an **established** P0 or P1 — direct evidence with no unresolved material inference —
and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself. Spend
most of the run elsewhere.

1. I think the weakest part is stage 3. The diagnosis was written by the previous session and I have
   adopted it. "The judge is right and the anchor was wrong" is a comfortable conclusion, and I would
   like to know what evidence would distinguish it from "the judge does not measure what we think".
2. I am unsure whether `questions-toc6` should be a new pinned arm or whether the existing
   `incumbent` arm should simply be pinned. I chose the former because it mirrors `shippedGists`.
3. Stage 2's marking of the root section in `renderTargetBriefing` changes the request payload, which
   is cache-keyed. I have said the stamp moves, but I have not checked whether anything else keys on
   the exact request text.
4. Stage 5 is the least specified. I do not yet know whether one ingest gives a representative
   number, or whether the caching numbers already in the doc make part of it redundant.

Do not change any file.
