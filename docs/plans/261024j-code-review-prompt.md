You are reviewing the code for plan
docs/plans/261024j-author-lookup-tries-harder-reads-the-author-s-page-and-proposes-likely-addresses.md
— read it in full, including "Revision 1", which records how your own plan review
(docs/plans/261024j-plan-review-sol.md) was taken. The scoped diff is docs/plans/261024j-code-review.diff;
read the changed files themselves too:

- src/author-page.ts (new: fetch the author's page, render with image markers, decode addresses)
- src/author-candidates.ts (new: computed confidence, colleague patterns, assembly)
- src/author-lookup.ts (prompt, rule 2 narrowed by R1, guesses, follow-up page reads, notes)
- src/admin-author-gifts.ts (wire types, shared constants)
- src/db/schema.ts + drizzle/20261024043226_author_lookup_candidates.sql (the new table)
- src/store/pg-author-gifts.ts (`finishLookup` writes candidates; the listing reads them)
- src/author-lookup-start.ts, src/mcp/tools.ts
- src/web/AdminAuthorGifts.tsx (`PossibleAddresses`, `chooseAddress`, provenance wording)
- the tests: tests/author-page.test.ts, tests/author-candidates.test.ts, tests/author-lookup.test.ts,
  tests/author-gifts.test.ts, tests/admin-author-gifts.test.tsx, tests/mcp-tools.test.ts

**Fix what you find inside this change** — edit the files directly, keep fixes minimal and in the
code's own style, and add or adjust a test for each real defect (a test that fails without your fix).
Do not commit, do not run git commands that change the index or the tree (no stash, reset, checkout,
restore), and do not touch production or .env files. You may run `npm run typecheck` and
`npx vitest run <files>` (the local database is available).

Look especially for: any way a candidate, a decoded or a guessed address reaches the draft or an email
without the administrator's own press; the R1 rule (a colleague's seen address auto-filling); SSRF or
unbounded work in the page read; decoder false positives that would put prose on the list; confidence
that is not computed as the plan says; a finish that is lost still writing rows; the table's checks
disagreeing with what the store writes; the page's button acting on a non-draft or racing Send; tests
that would pass with the guard removed.

Then write your answer: a numbered list of findings, each with severity, file:line, what was wrong,
and what you changed (or, for anything wider than this change, what you recommend instead of
changing it). End with a one-line verdict.
