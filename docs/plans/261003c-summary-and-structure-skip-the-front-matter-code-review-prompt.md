# Code review: 261003c, Summary and Structure skip the front matter

You are reviewing the code built from a plan, in a worktree, with `--sandbox workspace-write`.
**Fix what you find inside this change's scope** (src/paperwork.ts, the four version stamps and
their comments, the tests that pin them, evals/paperwork/run.ts, the prompting-guide line, the
plan). Report anything wider for me to decide rather than fixing it. Do not commit, do not
touch git state, and do not run paid model calls (no `evals/paperwork/run.ts generate`).

Read first:

- `docs/plans/261003c-summary-and-structure-skip-the-front-matter.md`, the plan, revised after
  your plan review
- `docs/plans/261003c-summary-and-structure-skip-the-front-matter-plan-review-sol.md`, your plan
  review
- `docs/plans/261003c-summary-and-structure-skip-the-front-matter-code-review.diff`, the scoped
  diff: the committed change plus the uncommitted harness fix to the scaling-hypothesis range

The evidence:

- `evals/results/front-matter/{before,before-2,after,after-2}/*.json`, the four arms
- `npx tsx evals/paperwork/run.ts report --set front-matter`, which is free; it prints the screens
  per arm
- the blind pairs and keys under `evals/results/front-matter/pairs-*`. The judges' verdicts are not
  in yet, so do not wait for them.

My reading of the result is this. In both `after` arms, every abstract-only node is a label and
none has a question, against 2 to 3 questions and 4 to 6 content gists in the `before` arms. The
closing `8. Summary` and Conclusions sections keep content gists. Brief's mean is 147.8 and 138.5
words against 146.5 and 138.8. **Check the conclusion as well as the code.** In particular:

1. Does `paperwork("structure")` read coherently as one section now that it has two exceptions?
   For example, "Every other gist, the root's included, ignores it" beside "Other gists may still
   draw on what it says".
2. In the `after` trees, a depth-1 node that is title, authors and abstract together now comes out
   as one label at the top of the tree. Is that a loss, given Structure's coarse zoom? Look at
   what the root gist and the first content part say in those arms.
3. Is the "by position" screen in `run.ts` right? Check the `ABSTRACT` ranges against the local
   blocks; the range end is compared only on a node's last block. Could it count a node that runs
   into the body, or miss one?
4. Are the tests honest? Each pin should be able to go red, and nothing should pin a value it
   computes from the code under test.
5. Is anything stale: a comment, a doc line, a version note that describes the dropped
   Summary/Tweets ids rule, or "the only exception"?

Write your findings as P0/P1/P2, with file:line, saying for each one whether you fixed it. End with
a one-line verdict.
