NO-SHIP

1. HIGH — The global pair pool can silently erase every drawable semantic edge.

   Evidence: `src/similar.ts:51-71` keeps the global top 240 block pairs before `src/web/graph.ts:813-847` discards same-section and sequence pairs. A deterministic 52-block probe produced 240 score-1.0 pairs within one section and zero cross-section pairs, despite available cross-section pairs scoring 0.9. The UI then incorrectly says nothing useful came back at `src/web/DiagramPanel.tsx:620-623`.

   Change: map blocks to the currently drawn nodes before applying the pool, then rank and cap only drawable node pairs.

2. HIGH — The request has no platform-safe overall deadline.

   Evidence: each attempt gets 45 seconds and five attempts at `src/embeddings.ts:68-71,132-179`; batches run sequentially at `src/embeddings.ts:273-279`; up to 1,500 blocks are accepted at `src/similar.ts:93-103`. One batch can consume roughly 345 seconds with slow retryable responses and maximum `Retry-After`, already exceeding Vercel’s 300-second limit at `vercel.json:9-12`.

   Change: give the shared computation an internal total deadline below the platform limit, make backoff abortable, and check it between batches. This should remain independent of individual callers’ cancellation.

3. MEDIUM — Vector dimensionality is validated per batch, not across batches.

   Evidence: `readVectors` resets `dims` for every call at `src/embeddings.ts:211-249`; `embedAll` concatenates batches unchecked at `src/embeddings.ts:269-280`; `dot` silently compares only the shorter length at `src/embeddings.ts:325-329`. A 97-input probe accepted 96 two-dimensional vectors followed by one three-dimensional vector.

   Change: establish the dimension from the first batch and reject every later batch that differs; also make `dot`/`cosine` reject unequal lengths.

4. MEDIUM — The anchor string scan rejects valid serialized HTML and corrupts displayed link text.

   Evidence: `src/web/graph.ts:511-536` uses `[^>]*` and strips tags without decoding entities. JSDOM serializes `<a title="1 > 0" href="#target">…</a>` exactly that way, but the regex finds no link. Link text `A &amp; B` becomes the literal footer text `A &amp; B`. This contradicts the scan’s justification at `src/web/graph.ts:672-684`.

   Change: parse the article HTML once in a detached DOM with row wrappers, then use attributes and `textContent`.

5. MEDIUM — The cache key does not cover all inputs that determine the answer.

   Evidence: eligibility depends on `gistable` and `words` at `src/similar.ts:142-149`, but the key at `src/similar.ts:165` uses `hashBlocks`, which hashes only `id` and `text` at `src/source-hash.ts:36-38`. Changing eligibility without changing prose returns the old block count and pairs.

   Change: hash the actual embedding recipe and selected inputs, including eligibility fields, model, thresholds and truncation limits.

6. LOW — The claimed LRU is FIFO.

   Evidence: a hit at `src/similar.ts:165-167` does not refresh insertion order, while eviction deletes the first inserted entry at `src/similar.ts:295-300`. The plan explicitly calls it an LRU at `docs/plans/260827d-force-diagram-links.md:193-197`.

   Change: delete and reinsert cache hits, or document FIFO instead.

7. MEDIUM — The 1,500-block truncation is not reported.

   Evidence: selection stops immediately at `src/similar.ts:147-149`; `SimilarResponse` contains only embedded count and pairs at `src/types.ts:876-880`. This contradicts `src/similar.ts:99-101`, which says the response reports how many were omitted.

   Change: scan all eligible blocks and return explicit `eligible`, `embedded`, `omitted` and `truncated` fields.

8. MEDIUM — Important breakages remain invisible to the focused tests.

   Evidence:

   - `tests/embeddings.test.ts:15-29` never tests `embedAll`, so cross-batch dimension corruption passes.
   - `tests/similar.test.ts:52-198` uses at most five blocks, never exercising the 240-pair pool, incremental trim, 1,500-block cap or eviction.
   - `tests/diagram-force-links.test.ts:416-568` tests layout metadata and `arrowPath`, not the rendered marker or CSS. Changing `refX`, `markerUnits`, arrow fill, stroke weights or semantic dash styling still passes.
   - There is no focused route or `useSimilar` test; POST gating, StrictMode behavior and slug transitions can break while all three suites stay green.

   Change: add boundary-sized server tests, an `embedAll` multi-batch test, hook/route tests, and a rendered SVG assertion covering marker attributes and link classes.

9. LOW — Passage evidence is computed but never shown.

   Evidence: semantic edges retain passage IDs at `src/web/graph.ts:789-840`, and the plan says the card names those passages at `docs/plans/260827d-force-diagram-links.md:175-178`. `src/web/DiagramPanel.tsx:460-469` discards `passages`; the card shows only section title and cosine.

   Change: carry the passage IDs through `Related` and render short excerpts or links, or remove the documentation claim.

10. LOW — Several comments still describe a different protocol or marker configuration.

   Evidence: the plan says GET at `docs/plans/260827d-force-diagram-links.md:153-155`; so do `src/web/useSimilar.ts:9`, `src/web/graph.ts:307` and `src/types.ts:864`, while the implementation is POST at `src/routes.ts:2692`. `src/web/DiagramPanel.tsx:673-676` says `markerUnits="strokeWidth"` while the marker uses `userSpaceOnUse`.

   Change: update these comments to match the implementation.

The arrow geometry itself is correct: with the 6×6 marker, `refX=6`, matching viewport and viewBox, and `userSpaceOnUse`, the triangle tip lands exactly at the path endpoint; trimming by `r + 5` leaves that tip five user-space pixels outside the target. The semantic strength cap is also defensible, and the incremental top-240 trim is mathematically sound.

Verification: all 56 focused tests passed. I excluded unrelated scatter-diagram edits that arrived concurrently in the shared worktree from this verdict; no files were changed.