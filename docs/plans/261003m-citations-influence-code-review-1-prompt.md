# Review and fix: stage 1 of 261003m — a citation's influence is a number only when the model is confident, else unknown

Repo: this worktree (branch worktree-citations-influence-unknown), TypeScript + ESM.
You may WRITE in this worktree. Fix what is inside this stage, narrowly and red-first (write or
adjust the test, see it fail, then fix). Report, do not fix, anything wider. Do not commit. Do not
touch evals/results/. Do not start stage 2 (no new model call, no migration).

## The candidate

Committed: commit 2b2dc6b7e (stage 1), on top of 4a9452699 (the plan and the before arm).
  git diff 4a9452699..2b2dc6b7e
  changed paths: git diff --name-only 4a9452699..2b2dc6b7e

Start with: src/citations.ts (the `influence` paragraph of SYSTEM, CITATIONS_OUTPUT_SCHEMA,
influenceCounting), src/web/CitationsPanel.tsx (influenceOf, priorityOf, orderWorks,
influenceIsUnknown, the row), src/chat-tools.ts. That is where to begin, not the limit: every reader
of `influence` anywhere in src/ is in scope (public DTO, export, visitor's page, chat, marginalia,
the hover card, any sort or threshold, tests/fixtures).

## What it is meant to do

The plan: docs/plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md,
§ Stage 1, items 1–7, with your own plan review beside it
(docs/plans/261003m-citations-influence-plan-review-sol.md). Greg's decision is quoted at its top.
In short: the list prompt returns influence as a number only when the model is confident it knows
the work, else null; null is stored as an absent `influence` and counted as `influenceUnknown`; the
row says "influence unknown" in place of a bar; a row with unknown influence is thresholded on its
relevance alone (F8's imputation is accepted and documented); the influence order puts unknown rows
after known ones, by relevance; chat's tool, Help and docs/project/citations.md say the same.
Out of scope, deliberately: stage 2 (Dig deeper filling it in); a stored discriminated union for
unknown; changing the formula for rows with both scores.

## What I want

1. An independent attack first. Is anything now wrong for a reader: a list made by an older prompt,
   a visitor's page, a list where every row is unknown, a list where none is, the threshold bar's
   starting position and its "n of m hidden" line, `canPrioritise`/`effectiveOrder`, `barTop`/`barMax`,
   the URL state (`?citeby=influence` on a list with no influence at all), the tooltip on touch.
2. Is the prompt paragraph clear and consistent with docs/project/prompting-guide.md and with the
   rest of SYSTEM (nothing elsewhere in the prompt still implies a number is always required)? Does
   the schema match what the strict-schema rules there require for the wire this call uses?
3. Is every sentence added to docs/project/citations.md, Help and the source comments true of the code?
4. Run the tests that need nothing outside the tree yourself: tests/citations.test.ts,
   tests/citations-panel.test.tsx, tests/chat-citations-tool.test.ts. Say which you ran and the raw
   result line. Anything needing Postgres or the network is mine to run; say what you want run.
5. Mutate two lines of the finished code and say whether a test noticed.

Severity: P0 data loss / security / wrong charging; P1 user-visible wrong behaviour or a contract
violated; P2 design or maintainability risk; P3 prose. IDs continue the chain: start at F10. For
each: established (file:line evidence or a failing run) or reasoned; and fixed-by-you or reported.
End with a list of every file you changed and one verdict line: "land", "land after fixes" or
"do not land".

## My own suspicions (already mine, worth less)

- An old row whose influence was dropped as out of range now reads "the model was not confident".
- A list with every influence unknown used not to be prioritisable and now is.
- The tooltip's wording about the threshold when the order in force is not *prioritised*.
