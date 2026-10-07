# Code review (write-capable): five more step budgets

Review, and you may fix, commit `02f3620e8` on branch `worktree-sweep7-five-more-budgets`
(`git show 02f3620e8`). The plan: `docs/plans/261007h-five-more-step-budgets-to-what-they-measure.md`.
It is item C6 of `docs/plans/261007g-raise-the-images-and-fetch-step-budgets-to-what-they-measure.md`,
which you reviewed.

**What it does.** `STEP_BUDGET_MS`: ideas 120→600 s, tweets 90→600 s, sketch 240→700 s, debate
120→360 s, illustrated 600→700 s. None of these steps has a timer of its own, so each budget is
derived from the token size of its largest request through the existing `deadlineFor` (tokens ÷ 95
per second × 1.25, the conversion the quiz row uses); the inline token numbers moved into exports
(`ideasAnswerTokens`, `threadAnswerTokens`, `SKETCH_ANSWER_TOKENS`, `ILLUSTRATED_ANSWER_TOKENS`) so a
test reads them. Illustrated's own token ceiling (948 s) exceeds the 740 s claim, so 700 s is a
reservation, named as a design question. Five new test cases; all red against the old numbers.

**Check:**
1. **Behaviour change.** With these numbers, which ordinary job shapes now hand back to a fresh claim
   where before they started in the same claim (Skim's `quotes → ideas → skim`: ideas now hands back
   only if quotes took > 140 s; `sketch → illustrated`: every real Sketch run now makes Illustrated
   wait for a new claim)? Is any of these a reader-visible slowdown (an extra request round trip, a
   wait for the queue) bigger than the failure it prevents (a step started late, discarded at our
   deadline, and repeated)? Say plainly whether the trade is right for each.
2. **The derivation.** Is `deadlineFor` the right converter for each of these calls (model, thinking
   headroom, streaming vs not)? Is the largest request for each step really the one the test reads
   (ideas has per-idea tokens × a count: whose count, and is it capped)? Debate's searches have no
   ceiling: is 360 s honest?
3. **The exports.** Moving inline numbers into exports: did every call site switch to them, so the
   test and the code cannot drift (grep each step's `max_tokens`/`budgetFor` call)?
4. **The illustrated tripwire** (the test asserts the brief's time is still ≥ the claim): is a test
   that passes because a known problem exists a good test, or should it be stated as a pinned known
   defect in the house's usual form?
5. Every rewritten comment and doc sentence is a claim; check each, including the corrected
   illustrated comment.

You may run `npx vitest run tests/jobs-lease-budget.test.ts tests/jobs-tier0-offline.test.ts`
(nothing outside the tree). No Postgres, no `npm test`.

**Fix what is inside this change**, narrowly, red-first. **Report, do not fix, anything wider.** Do
not change the lease, `REQUEUE_BUDGET`, any other budget or any token size. Do not commit.

**Reply format.** Findings C1, C2, …; P0–P3; the input; reproduced or reasoned; fixed or not. Then
files changed, what you ran, and a verdict (ship / ship with these fixes applied / do not ship).
