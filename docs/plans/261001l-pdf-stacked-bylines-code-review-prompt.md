Code review of commit f662af42 (plan docs/plans/261001l-pdf-stacked-bylines.md). See it with `git show f662af42`. You may edit files to fix what you find; write a failing test first for each fix and say so. Do not commit, and do not run git commands that discard work.

Changed: src/pdf-authors.ts (verifyAuthors, new gapIsNobody, affiliationAt, printedAt, EMAIL/emailsIn), tests/pdf-authors.test.ts, new eval evals/pdf/bylines-score.ts, evals/pdf/bylines.mts, evals/pdf/bylines/cases.json, tests/pdf-bylines-eval.test.ts. Your plan review is docs/plans/261001l-pdf-stacked-bylines-review-sol.md.

IMPORTANT: the built rule is WIDER than the plan you reviewed. You reviewed "author i's own affiliations, then exactly one address". The eval showed that took 18 of 39 real bylines against the old check's 25, so it became: a block = the authors since the last gap that held anything; the gap may hold those authors' verified affiliations (each once), then addresses totalling exactly the block's size, then glue; no affiliation after the first address. Plan § The change explains, and § Result has the measured numbers.

The invariant: an author printed in the byline must never be silently dropped from a stored list or a names-only byline. Please:

1. Attack the block-of-k rule. Construct concrete bylineText + answer pairs where a printed author vanishes without refusal. Consider: blockStart bookkeeping (a "glue" gap continues the block; an "accounted" gap resets it), affiliations shared across block authors (multiset), dropping one author when one address is absent from the page, braced groups split across lines, the marked-affiliation trailing path, an author whose name word coincides with an email word.
2. Check the EMAIL regex: catastrophic backtracking, lookbehind correctness, the braced count, spaces around @ (only allowed in the braced form), fused tails.
3. Check that verifying every author's affiliations after a failure does not change the names-only arm's verdict in a bad way.
4. Check the eval scorer measures what the plan says (could it report 0 drops while the check is broken?).
5. Run: npx vitest run tests/pdf-authors.test.ts tests/pdf-bylines-eval.test.ts ; npx tsx evals/pdf/bylines.mts ; npm run typecheck.

Findings numbered with severity P0/P1/P2, what you fixed (files, tests), and a verdict line: "ready", "ready after the fixes made", or "not ready".
