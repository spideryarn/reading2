Code review of plan docs/plans/261018k-six-topic-pills-by-default-above-the-shelf.md, built in
commit c23c46456 (the diff is docs/plans/261018k-six-topic-pills-code-review.diff; your plan review
is docs/plans/261018k-six-topic-pills-plan-review-sol.md).

Greg's request (an admin, trusted): "By default, initially just show a half dozen or so topic pills
on the logged in page above the shelf."

You may fix what you find, within this change's scope (src/web/shelf-narrow.ts,
src/web/ShelfTerms.tsx, src/web/PublicShelfTopics.tsx, the tests and docs in the diff). Do not
commit, do not touch git state, and report anything wider instead of changing it.

Check in particular:
1. The All N topics button now shows when `available.length > collapsed.length`. Any state where it
   reveals nothing, disappears while expanded with the row still expanded, or flips as pills are
   pressed in a way that moves the pressed pill?
2. The loading placeholder (ShelfTermsLoading): five ghost pills and the reservation for "All";
   does the placeholder still approximate the collapsed row's height at phone, iPad and desktop
   widths, so the swap does not jump more than before?
3. Anything that still assumes twelve.
4. Are the new tests ones that would fail if the change were reverted?

Run: npx vitest run tests/shelf-narrow.test.ts tests/shelf-topics.test.tsx
tests/shelf-topics-detail.test.tsx tests/public-shelf-page.test.tsx and npm run typecheck.

Write findings as a numbered list with severity and file:line, say what you changed for each, then
a final line "VERDICT: approve" or "VERDICT: revise".
