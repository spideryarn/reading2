# Narrow re-check of N-1 and N-2's fixes (260929g, commit 61a6e6c2)

Read-only. Do not change any file. Your findings N-1 and N-2 are in
docs/plans/260929g-citations-identity-fixes-review-sol.md. Their fix is `git show 61a6e6c2`
(src/citation-lookup.ts `titleNamesWork`, `NOTICE_TAIL`, `resultIsTheWork`; the tests beside it).
Discovery is closed: check **only** whether N-1 and N-2 are now closed, and whether the fix itself
opened a hole of the same kind (a wrong document's extract judged as this work's). Run
`npx vitest run tests/citation-lookup.test.ts`. Answer: N-1 closed / open, N-2 closed / open, any
new hole with a concrete title that passes; one line each.
