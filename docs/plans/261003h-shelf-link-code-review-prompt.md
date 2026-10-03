You are reviewing code built from a small plan. Repo: Spideryarn (TypeScript, React client in src/web/). You may FIX what you find, inside these files only: src/web/library-hits.ts, src/web/search-hits.ts, src/web/Library.tsx (function `marked` only), tests/library-hits.test.ts. Report anything wider rather than fixing it. Do not commit.

Plan: docs/plans/261003h-shelf-link-sends-the-hits-own-spelling-and-foldwithmap-offsets.md (includes the answer to your plan review, docs/plans/261003h-shelf-link-plan-review-sol.md).
The diff under review: docs/plans/261003h-shelf-link-code-review.diff (against HEAD; the working tree has it applied).
Callers to read: src/web/Library.tsx (`marked`, `Passage`, and line 447's `queryTerms`), src/web/search-hits.ts (`findLiteral`, `MIN_FIND_CHARS`), src/library-search.ts (`fold`).

What was claimed, for you to check rather than believe:
1. `foldWithMap(s).folded === serverFold(s)` for every string. A scratch fuzz over every Unicode scalar in four contexts plus 300,000 random strings reported 0 disagreements after U+FF9E/FF9F were added to the cluster regex. Try to break it. In particular: is the `whole.length === folded.length` guard sound, and can `cased.toLowerCase()` ever differ from the per-cluster lowercase in a way that makes the map wrong while lengths agree?
2. `starts`/`ends` have one entry per UTF-16 unit of `folded`, are monotonic, and `s.slice(starts[i], ends[i+n-1])` is the source text under a folded match.
3. `libraryHitHref` sends a `find` that the real `findLiteral` finds in the same paragraph, whenever the paragraph's rendered text contains the hit's text unchanged. Check `ownSpelling`'s widening (the two regexes `/^./su` and `/.$/su`, trimming, an astral neighbour, start 0, end at text length).
4. `marked` in Library.tsx is correct with the new map and needed no edit.
5. Performance: `foldWithMap` runs per passage per render in `marked` and again in `libraryHitHref`. Is the regex walk a regression worth caring about against the old per-code-point loop for a paragraph-sized string?
6. The tests: would a wrong implementation pass them? Is any test unable to fail?

Run: npx vitest run tests/library-hits.test.ts tests/search-hits.test.ts tests/library-search.test.ts

Give findings as P0/P1/P2 with file:line, say what you changed if anything, then a one-line verdict (SHIP / FIX FIRST).
