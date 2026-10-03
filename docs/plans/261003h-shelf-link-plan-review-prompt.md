You are reviewing a small plan before it is built. Read-only: do not edit files. Repo: Spideryarn (TypeScript, React client in src/web/).

Plan: docs/plans/261003h-shelf-link-sends-the-hits-own-spelling-and-foldwithmap-offsets.md
Umbrella: docs/plans/261003f-fifth-codebase-sweep-umbrella.md (cluster 4's row, and item 4 under it).
Evidence: docs/investigations/261003b-fifth-sweep-web-client.md (W11), docs/investigations/261003b-fifth-sweep-review-sol-on-server-and-web.md (W11 and "What the client doc missed" item 1), docs/investigations/261003b-fifth-sweep-review-opus-on-defences.md (F1, M7).
Code: src/web/library-hits.ts (fold, foldWithMap, queryTerms, libraryHitHref), src/web/Library.tsx (function marked, around line 1387), src/web/search-hits.ts (foldCase, literalSpans, findLiteral, MIN_FIND_CHARS), src/library-search.ts (the server's fold, line 103).
Tests: tests/library-hits.test.ts, tests/search-hits.test.ts, tests/library-search.test.ts.

Check, by running code where you can (node/tsx one-liners are fine; do not edit the repo):

1. The plan's central claim: folding per cluster (regex /\P{M}\p{M}*|\p{M}+/gu), NFKD each cluster, strip U+0300-036F, map punctuation, concatenate, then lowercase the WHOLE string once, gives exactly the server's fold(s) for every input. Try to find a counterexample: a character with non-zero canonical combining class that is not General_Category M; a non-mark whose decomposition begins with a non-starter; Hangul; pointed Hebrew/Arabic; anything where whole-string toLowerCase changes length after NFKD and mark stripping.
2. Every folded UTF-16 unit maps to its cluster's whole source span. Is there an input where slicing hit.text by starts[i]..ends[i+len-1] yields a string that the real findLiteral (case-fold only, substring, over renderedText(block.html)) would NOT find in the same paragraph? Note hit.text is the server's block.text and the reading view searches rendered html text; say if that difference can bite for a single term.
3. The one-character needle rule (widen right by one code point, else left, else next term, else ?at= only). Is it right, and is there a simpler rule that is still correct?
4. Does marked() in Library.tsx stay correct with the new map with no edit?
5. Importing MIN_FIND_CHARS from search-hits.ts into library-hits.ts: any cycle or bundle problem?
6. Tests proposed: anything missing that would let a wrong implementation pass? Anything simpler that is still correct?

Give findings as P0/P1/P2 with file:line, then a one-line verdict (GO / REVISE).
