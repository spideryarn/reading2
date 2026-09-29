# Narrow review: three identity/parse rule changes (260929g, commit b5c5fc72)

Read-only. Do not change any file. `git show b5c5fc72` — only src/citation-lookup.ts and
tests/citation-lookup.test.ts matter; the rest is prose.

You approved stages 1–2 (docs/plans/260929g-citations-say-what-we-saw-code-review-sol.md). A real
run on 14 cited works (plan § "Real runs") then showed three rules refusing correct results, and
this commit loosens them. The only question: **does any of the three let a wrong document's extract
be judged as this work's?** Specifically:

1. DOI row: DOI in the extract AND the title rule. Can a citing paper, a review, a dataset page or a
   later erratum pass? (The author-or-year rule is not applied on this branch.)
2. Truncated title: a prefix run of ≥5 tokens and ≥ half the title, plus author-or-year. Can a
   different paper sharing a long title prefix pass?
3. An over-cap quote now nulls only that field. Any way this shows something unverified?

Run `npx vitest run tests/citation-lookup.test.ts` yourself. Findings N-1…, P0–P3, file:line, and a
one-line verdict.
