Three findings: two P0s and one P1.

## Findings

**F1 — P0 — Long article titles count as quotations, allowing the wrong document through.**  
[src/debate.ts:1641](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/debate.ts:1641), [src/shingles.ts:147](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/shingles.ts:147)

`evidence` includes headings, including the H1, and `articleShingles` shingles every supplied block. Therefore, an article title of at least eight words and forty characters is itself sufficient to earn `quoted`.

Concrete input:

- Article H1: `A careful guide to building reliable artificial intelligence systems at scale`
- A page about a same-named 2026 successor repeats that title and says: `The new 2026 edition overturns the earlier advice...`
- `articleReferenceQuote` is the shared title.

My production-path reproduction returned:

```text
kept: 1
level: quoted
hit: "A careful guide to building reliable artificial intelligence"
```

Thus the row clears the default threshold and is shown as reception of the older article—the exact false-output class Stage P addresses. The fixture title in `tests/shingles.test.ts` has only seven words, so it cannot expose this.

Exclude the title-identical heading from quotation shingles, or define quotation evidence over prose blocks rather than every body block.

**F2 — P0 — The density ceiling rejects a genuine fisking and tells the reader it was a copy.**  
[src/shingles.ts:209](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/shingles.ts:209), with the drop at [src/debate.ts:825](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/debate.ts:825)

The classifier judges a search extract, not the page. A search engine can return a long blockquote plus one short rebuttal from a genuine response.

Concrete extract:

```text
Read the original article at https://example.com/article.
Every harbour office keeps a tide clock where handwritten warnings
gather beneath storms and changing skies each winter.
That conclusion is completely unsupported.
```

With the quoted sentence in the article, `sourceQuote` set to the final rebuttal, and the opening sentence as `articleReferenceQuote`, every other check passes. My reproduction produced:

```text
extractWindows: 22
density: 0.5
kept: 0
sourceIsCopy: 1
```

The panel then says the page “turned out to be a copy … rather than a reply,” which is false.

The five-window floor provides less protection than it appears to: these are overlapping windows, so five matches can come from one contiguous twelve-word quotation rather than five independent passages.

Given that no reported mirror row demonstrates a positive case, I would not ship this as a hard drop. Defer it until a real row exercises it, or require row-level evidence such as the verified `sourceQuote` itself also being article text.

**F3 — P1 — A linked page can be assigned `named` and hidden because link detection examines only the model-selected witness.**  
[src/debate.ts:817](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/debate.ts:817)

`namesArticleBy` receives `articleReferenceQuote`, while quotation matching receives the full extract. The model is required to supply one valid witness, not every witness.

Concrete input:

```text
Extract:
Read the original at https://example.com/article.
What the tide clock cannot tell you is wrong because the caveat nobody
reads cannot make an instrument honest.

articleReferenceQuote:
What the tide clock cannot tell you
```

Although the complete extract contains the exact article URL, my reproduction stored only:

```text
identifies: [{ kind: "named", ... }]
level: named
```

The default bar therefore hides a genuine linked response, and the tooltip does not list every signal found. Keep the witness-based directness check, but derive the `linked` signal from the complete extract.

## Other conclusions

I found no silent counter or compatibility defect:

- `sourceIsCopy` reaches `lossesOf`, `keptNote`, and the reader-facing sentence.
- Missing legacy `sourceIsCopy` becomes zero.
- Missing legacy `identifies` becomes `named`; the default consequently fails closed.
- The visible direct list, slider count, hidden count, header count, and foot line share the same threshold result.
- Claim rows do not enter the bar.
- Unknown `?name=` values resolve safely to the `quoted` default.
- `quoteFinder` retains the old `findQuote` control flow; only cached haystack preparation moved outside repeated calls.
- Block IDs remain the addressing mechanism.

Tests run:

```text
tests/shingles.test.ts
tests/debate-bar.test.ts
tests/debate-identification.test.ts
→ 42 passed

tests/quote-match.test.ts
tests/debate-panel.test.tsx
tests/url-state.test.ts
tests/threshold.test.ts
→ 161 passed
```

No database run is needed for these findings, and I made no edits.