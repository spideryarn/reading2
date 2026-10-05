# Code review, with fixes: three robustness bugs (261005h)

You are reviewing committed code in this worktree and **fixing what you find inside the three
stages**, narrowly and red-first (write the failing test, see it fail, fix, see it pass). Anything
wider that you notice, report and do not fix. Commit nothing; leave your changes in the working
tree, which is clean as you start, so your diff is exactly yours.

Do not attribute any sentence to Greg that is not already quoted, with a date, in the repo.

## The candidate

Branch `worktree-qi-three-robustness-bugs`. Three commits, each one stage of
`docs/plans/261005h-three-robustness-bugs-unknown-wire-values-rootless-children-list-chain-timer.md`
(read it, including "What GPT Sol's plan review changed" and "Progress"):

| Stage | Commit | See it with |
|---|---|---|
| B: a stored tree with no `children` list | `56ef1be7c` | `git show --stat 56ef1be7c` |
| A: tables read by a wire value; temml recovery | `d96aa2e5a` | `git show --stat d96aa2e5a` |
| C: the step chain reads a fact, not a clock | `9b71c5b54` | `git show --stat 9b71c5b54` |

`git show --stat` on each gives the complete list of changed paths. Start with
`src/web/tree.ts`, `src/web/article/access.ts`, `src/web/lib/own-label.ts`, `src/web/maths.ts`,
`src/web/keynav.ts` § `Chain` and § `beginJump`, `src/web/DiagramPanel.tsx` § `stepTo`,
`src/web/reader/Reader.tsx` § `followTo`, and the new tests `tests/tree-missing-children*.test.ts*`,
`tests/own-label.test.ts`, `tests/maths-stale-chunk.test.ts`, `tests/step-chain.test.tsx`. That
list does not limit scope.

The plan review of this work was yours (`docs/plans/261005h-three-robustness-bugs-plan-review-sol.md`,
P-1 to P-8). Every finding was accepted; check that each was actually built as accepted.

## What to do

An independent pass first: for each stage, does the code do what the plan says, what does it
break, and do the tests test it. Run the test files yourself; these need nothing outside the tree.
Mutate the finished code where a test's worth is in doubt. Check the doc edits against the code
(`docs/project/web-client.md`, `maths.md`, `keyboard.md`, `diagram.md`, the postmortem's dated
note). You have no network, not even loopback: anything needing Postgres or a browser is mine to
run, so say what you would want run rather than skipping it silently.

Severity, fixed: **P0** ships a regression or loses data; **P1** wrong or incomplete in a way a
reader would meet; **P2** worth doing, not blocking; **P3** note. Give every finding an id
(`C-1`, …), say *established* (reproduced or traced) or *reasoned*, and say for each whether you
fixed it or only reported it. End with a verdict per stage: ship / ship with your fixes / do not ship.

## What I ran, as raw facts

- The implementers' targeted runs were green: stage B 43 tests in its two new files; stage A 285
  tests across 13 files; stage C 347 tests across 21 files. `npm run typecheck` passed all four
  projects after stage C. The full `npm test` has not been run yet on this tree.
- A browser measurement before stage C found the timer bug 0 times in 436 trials (in the plan).
  No browser check has been run on the finished code yet.

## My own doubts, last, and only doubts

- Stage C: the aim now stands after a settled jump for as long as `scrollY` is unchanged, with no
  upper bound. Is there a way for the reader's true row to change with `scrollY` unchanged (content
  above reflowing with scroll anchoring off, a fold or unfold, a mode change, a re-render that
  renumbers rows) so that a later press steps from a stale aim? `useArrowNav` drops the chain when
  its effect re-runs; the Diagram's does not have the same dependency list.
- Stage C: `canStep` reads `window.scrollY` during render.
- Stage C: the default `onFollow` in `DiagramPanel.tsx` calls `ended` at once.
- Stage A: `renderArticleMaths` returns the article immediately after a reload was requested
  (LazyPage holds for a 5 s grace). Can the reader type into it in that instant, and does it matter?
- Stage A: `maths.ts` now statically imports `stale-shell.ts`. Any cycle or eager-graph cost?
- Stage B: `withChildLists` runs before `sanitizeArticle`. Does the sanitiser or anything between
  rebuild the tree in a way that could drop the mend, and is the public (visitor) path really
  through the same line?
