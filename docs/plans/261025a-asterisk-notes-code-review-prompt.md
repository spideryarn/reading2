You are reviewing code built from a plan you already reviewed. Repo: Spideryarn (TypeScript).

Read first:
- docs/plans/261025a-asterisk-and-dagger-notes-at-the-back-of-a-book-link-to-their-markers.md
  (the plan as built, including "What GPT Sol's plan review changed" and "Measured")
- docs/plans/261025a-asterisk-notes-plan-review-sol.md (your plan review)
- docs/plans/261025a-asterisk-notes-code-review.diff (the change: src/pdf-read.ts,
  tests/pdf-footnotes.test.ts, docs/project/content-extraction.md)
- In src/pdf-read.ts: `writtenAsMarker`, `wordBefore`, `candidatesIn`, `findMarkers`,
  `symbolEndnotes`, `renderHtml` and its caller (search `baselineFor(pass, p.page)`).
- src/pdf.ts `baselineFor`, `pageLines`, `mendHyphens`, `Pass0`.

Evidence (scripts in data/261025a/, not committed; production read-only): Rovelli's current 36
stored chunk readings with the PDF's text layer link 11 of 11 `*` notes correctly and leave the
125 numbered links unchanged; across all 33 production PDFs (493 chunks), old vs new renderHtml
without a text layer is byte-identical for 32, and the 33rd (another Rovelli copy) loses one
wrong `*` link.

Your job: find correctness bugs in the change and FIX them in place, inside this stage's files
(src/pdf-read.ts, tests/pdf-footnotes.test.ts, the plan doc's text if a claim is wrong). Each fix
gets a test that is red without it. Check especially:
1. Can `symbolEndnotes` ever link a note to the wrong place, given the rules it claims? Think about
   `wordBefore` on both sides (NFKC, curly quotes, hyphen mending in baselineFor vs the model's
   joined words, a marker at a line start in the text layer, maths), the ±1 page tolerance, and the
   reverse-uniqueness check.
2. Does anything change output for an article with no symbol endnotes (numeric footnotes,
   endnotes, symbol footnotes)? Compare `writtenAsMarker` with the old inline checks exactly.
3. Marker id ordering and the `claimed` set between the numbered pass and the symbol pass.
4. `renderHtml`'s new optional parameter: every caller, and whether a re-extraction from cached
   chunks reaches it with the text layer.
5. Anything in the docs that is now untrue.

Do not run anything against production. Do not commit. Write your findings, each with severity,
the failing input, and what you changed (or why you did not), as your final answer. Run
`npx vitest run tests/pdf-footnotes.test.ts` and `npm run typecheck` before you finish and report
both results.
