You are reviewing code in the repository at the current directory (Spideryarn; read CLAUDE.md). You may FIX what you find, inside this change's scope, by editing files; report anything wider for me to decide. Do not commit, do not touch git state, do not write to any database or network service, and make no paid model calls.

The change: uncaptioned PDF figures are now recovered by the existing figure locator (a vision model), asked by the prose either side of the figure instead of a caption, with a position veto and a run-order check. Plan with your earlier review decisions: docs/plans/261019j-uncaptioned-pdf-figures-located-by-their-neighbours.md (section "After GPT Sol's plan review" says what was taken from your plan review, docs/plans/261019j-uncaptioned-pdf-figures-plan-review-sol.md, and why finding 2's reserved-attribute fix was not). Measurement: docs/investigations/261019a-uncaptioned-pdf-figures-located-on-rovelli.md (25/28 on Rovelli, all verified correct by eye, 76 s).

The scoped diff is docs/plans/261019j-uncaptioned-pdf-figures-code-review.diff (also `git diff HEAD`). Main files: src/pdf-figure-locate.ts (LocateSubject, FigureNeighbours, judgeNeighbourOrder, runKey, disorderedRuns, prompts), src/pdf-figure-region.ts (anchorBox), src/collect-pdf-figures.ts (subjectOf, LOCATABLE, separate allowances, ordering, per-page cache windowRead/mergeReads, inNeighbourOrder, run check), src/collect-assets.ts (pdfFigureNeighboursIn, assetsInputHash, policy /7), src/pipeline.ts, src/web/rehost.ts (alt text). Tests: tests/pdf-uncaptioned-located.test.ts, tests/collect-pdf-figures.test.ts (describe "an uncaptioned figure, located by its neighbours"), tests/rehost.test.ts.

Look hard for:
- correctness bugs: wrong y-direction in judgeNeighbourOrder/disorderedRuns (PDF coords, y up), the cache returning stale/mismatched page data or growing unbounded, eviction mistakes when the uncaptioned pass restarts from low pages, the run grouping in pdfFigureNeighboursIn (empty blocks, captioned neighbours, start/end of document), anything that lets a wrong picture through or that silently never runs;
- the invariant that every marker gets exactly one manifest entry (held → fail path for uncaptioned markers, caps reached, abort);
- whether the captioned path is byte-for-byte unchanged in behaviour (prompt text, caps, order now captioned-first — any regression?);
- freshness: anything a decision depends on that is not in assetsInputHash;
- tests that cannot fail, or that pass for the wrong reason; missing tests for the cache and for the "beside" rule;
- comments made stale by the change (search for "eight", "caption-only", "only asked about captioned", "Stage B" in src/ and docs/project/).

Run, as far as the sandbox allows: `npx vitest run tests/pdf-uncaptioned-located.test.ts tests/collect-pdf-figures.test.ts tests/collect-pdf-composite-figures.test.ts tests/collect-assets.test.ts tests/rehost.test.ts tests/pdf-figure-locate.test.ts` and `node --import tsx scripts/typecheck.ts`.

Answer with numbered findings (severity, file:line, what, and whether you fixed it), the commands you ran with their results, and a final line: SHIP, SHIP AFTER MY FIXES, or DO NOT SHIP.
