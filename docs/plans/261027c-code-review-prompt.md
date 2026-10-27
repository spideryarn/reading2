# Code review: Cited by's DOI confirmation (plan 261027c)

Read `CLAUDE.md` for the house rules, then the plan
`docs/plans/261027c-cited-by-confirms-a-doi-against-arxiv-own-record.md` (its § GPT Sol's plan
review lists what your plan review found and what was done). The change is
`git diff HEAD -- src/ tests/ docs/project/reception.md` in this worktree.

You may fix what you find inside the change's scope: `src/citation-index.ts`,
`src/article-registry.ts`, `src/situate-citers.ts`, `tests/citation-index.test.ts`,
`tests/article-registry.test.ts`, and the plan. Report anything wider rather than fixing it. Do not
commit. Run `npx vitest run tests/citation-index.test.ts tests/article-registry.test.ts
tests/article-registry-pipeline.test.ts tests/situate.test.ts` and `npm run typecheck` after any
edit.

Check in particular:

1. `confirms` and its three answers through every path: `askWork`, `answerFor` (fresh cache hit,
   just-written answer, stale fallback in `theList`), `theTopicList`, `confirmedWorkOf` (Situate).
   Can an `unavailable` from the registry ever serve a stale list whose identity was not confirmed,
   or turn into `unconfirmed`? Can `refused` ever list?
2. `authorListsAgree`: the 4-in-5 bar against both list sizes, `firstAndLast` applied to ours and
   theirs, `distinctNames` before or after the cut, and whether the existing tests of 261025a's
   exception still mean what they say.
3. `articleNameWords` and the `--` normalisation: false confirms, and the effect on the import's
   Crossref check (`withRegistryFacts`).
4. `once`: is the memo really request-scoped (never module-level), and is a rejected promise
   cached in a way that matters?
5. `targetAuthorsOf` / `firstAndLast`: equivalence with the old first-20 for ≤20 names; a null name
   in the middle; very long author lists (physics, thousands).
6. Whether the tests are real tests: each new one should fail against the code before the change.

Write findings with severity (P1/P2/P3) and file:line, then what you changed, then the checks you
ran and their results.
