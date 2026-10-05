Review this code, and fix what you find inside its scope. You may edit files in this worktree.

**The candidate** is the single commit at HEAD of this worktree (`git show --stat HEAD` lists every
path; `git show HEAD` is the diff). It is built from the plan
docs/plans/261005a-topic-pills-on-each-shelf-card-and-table-row.md, which your earlier plan review
(docs/plans/261005a-topic-pills-plan-review-sol.md) changed; the plan's § What the plan review
changed says what was done about each of your five findings. Check that each was really done.

What it is: Greg (an admin) asked, "On the logged in home page, for each article show its
topic-pills. If there's lots, then maybe only show the first three." Each card and table row on the
signed-in shelf now shows the topics its article is in.

Start with: src/web/article-topics.ts, src/web/ShelfRowTopics.tsx, src/web/Library.tsx,
src/web/ShelfTerms.tsx, src/web/ShelfEntry.tsx, src/web/library-columns.tsx,
src/web/help/help-topics.tsx, tests/shelf-row-topics.test.ts, tests/shelf-topics.test.tsx (the
describe "an article's topics on its card and its table row"), docs/project/shelf-terms.md (the new
§ On each card and table row), docs/project/library.md. That is where to start, not a limit.

**Rules for fixing.** Fix defects inside this change, narrowly, and red-first where a test can show
it. Report, do not fix, anything wider you notice. Do not commit. Do not add a quotation attributed
to Greg anywhere: the only words of his are the ones quoted above. You have no network, not even
loopback, so run only tests that need nothing outside the tree: `npx vitest run
tests/shelf-row-topics.test.ts tests/shelf-topics.test.tsx tests/shelf-topics-detail.test.tsx
tests/eager-client-graph.test.ts` and `npm run typecheck` are safe. I am running the full suite and
a real-browser check (desktop, iPad and phone widths; pressing every part of the pills line)
myself.

**First, an independent pass.** Attack the change: correctness, React behaviour (the context, the
memoised columns, stale table cells, the render loop of docs/postmortems/260827e), the stretched
card link and touch, accessibility, the eager-client-graph seam, whether the tests would notice a
regression, and whether the docs and the /help paragraph are true of the code (the /help Topics
paragraph was rewritten to describe model-named topics; check it against docs/project/shelf-terms.md
and the code).

**Then my own suspicions, worth less than what you find yourself:**

1. `articleTopics` returns the shared `NO_ARTICLE_TOPICS` for an empty list, and Library memoises on
   `terms.data?.terms`. Is there any path where the context value changes identity every render?
2. In the table, the pills line is a `<ul>` inside the title cell. Is that valid where it sits, and
   does it disturb the title's row card or the rename editor (the cell returns early while
   renaming, so the pills vanish during a rename; the card keeps them)?
3. `tw:sr-only` for "and N more": is that utility available under this repo's `tw:` prefix?
4. Is the conclusion in the plan and the docs overstated anywhere, in particular about the layout
   moving and about what a press does?

Severity, by consequence: P0 data loss, exploitable security, wrong charging, service unusable;
P1 user-visible wrong behaviour or an authoritative contract violated; P2 design or maintainability
risk with no wrong behaviour today; P3 prose or comment defect. Give every finding an id (C1, C2…),
and say for each whether you fixed it.

End with one verdict line: `VERDICT: ship` / `VERDICT: ship with the fixes I made` /
`VERDICT: do not ship`.
