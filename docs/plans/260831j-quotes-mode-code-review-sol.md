Verdict: not ready. The verbatim safety property still has two concrete holes.

## Findings

1. **Blocker — `authorVoice` is bypassable**

[`authorVoice`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/quotes.ts:245) only inspects characters immediately outside the selected span.

Concrete block:

```text
Lamport wrote: “If you are thinking without writing, you only think you are thinking.”
```

Both of these pass:

- Model includes the curly quotation marks.
- Model excludes the final period, leaving `.”` after the span.

Single-quoted British-style attribution also always passes because apostrophes are excluded. The real trade is therefore not merely emphasis versus attribution: ordinary direct quotations using `‘…’` get through.

`locate` compounds this by returning one first match before `authorVoice` runs. If a quote block contains the sentence first and the author repeats it later, the valid later occurrence is never considered.

Do instead: detect quotation context independently of the model’s boundaries, including delimiters inside the span and punctuation before the closer; support paired single quotation marks; continue searching after a rejected occurrence. Provenance remains the only complete solution.

Also align the weakened product promise everywhere: [`SYSTEM`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/quotes.ts:657) and several type/code comments still say “the author’s words.” [`discardedNote`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/QuotesPanel.tsx:288) falsely says “quoted from somewhere else”; an author’s self-quotation disproves that. Say “appeared as a quotation” instead.

2. **High — Unicode case folding corrupts the stored slice**

[`reduce`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/quote-match.ts:124) records one map entry per input code unit, but lowercasing can emit more than one. `İ`.toLowerCase() is two code units. [`endOf`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/quote-match.ts:158) then reads the wrong entry or defaults to `1`.

Reproduced:

```text
text/model: This sufficiently long sentence ends in İstanbul
span:       { start: 0, end: 1 }
stored:     T
```

It passes the 30-character check before matching, then stores a one-character quote without incrementing any drop counter.

Do instead: iterate code points and add a map entry for every emitted folded code unit, including an exclusive-end map. The existing `foldCase` pattern in [`search-hits.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/search-hits.ts:217) shows the shape.

The boundaries you specifically named are otherwise fine: collapsed trailing whitespace is excluded intentionally, block-end returns `text.length`, and dash folds remain one-to-one.

3. **High — `start` can select the wrong rendered occurrence**

[`resolveOne`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/search-hits.ts:393) passes an offset measured in `block.text` as `near` while searching rendered text. `nearestIndex` maps reduced rendered offsets back into rendered space; it cannot translate an offset originating in another string.

A reproduction using a table processed by `splitIntoBlocks` produced:

```text
block.text first occurrence: 120
rendered occurrences:        60, 126
resolved occurrence:         126
```

So the second identical sentence is marked.

Because server-side `locate` always selects the first occurrence, the simple fix is to omit `start` for Quotes and let the client select the first rendered occurrence. The general fix is an occurrence ordinal or an explicit block-text-to-rendered-text map.

The mode/lane wiring itself is fine: separate state plus the `mode` switch in [`App.tsx`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:1553) prevents a departing quote cleanup from erasing another mode’s marks. `slot: 0` is safe while selection remains singular.

4. **Medium — the slider’s right-end promise is still false**

[`barMax`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/QuotesPanel.tsx:209) returns the top score rounded down to a `0.05` band:

```text
priorities: .62, .61, .20
barMax:     .60
promoted:   .62 and .61
```

Those are not tied top scores. With all scores `0`, `canPrioritise` is true, but no threshold can divide the list: `0` promotes everything and anything higher promotes nothing. `?bar=.63` is also accepted while the range uses `step=.05`, producing an off-grid value.

So: not implementing observed-score stops is a mistake if you retain “all the top-scored quotes.” Either implement those stops, or honestly call the result the “top score band,” quantise URL values, and require `canPrioritise` to have a reachable split.

The most valuable tests are:

- off-grid top plus a second score in the same band;
- all-equal/all-zero scores;
- `canPrioritise` versus reachable slider positions;
- the actual group at `barMax`, not merely the numeric endpoint.

The newly added [`quotes-panel.test.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/quotes-panel.test.ts:92) covers the helpers broadly, but its `.90` tied-top case misses this failure. `effectiveRank` is fine: one effective value drives the pressed state, grouping, slider, and row scores.

## Other checks

`discarded` is complete: `overCap` is incremented before the copy at [`buildQuotes`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/quotes.ts:519). A pre-field artefact also loads without crashing because the runtime validator only requires a non-empty `quotes` array and `discardedNote(undefined)` is tolerated. That makes the TypeScript “required” field looser at runtime, but this stage has no existing production artefacts.

One disclosure gap remains: visitors never receive `discarded`; [`publicQuotes`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/public/dto.ts:367) strips it and the panel reads it only from the owner object. Decide whether “the reader is told” includes visitors.

The same `evidence` array is passed to both `articleText` and `buildQuotes`; I found no divergence path.

The verbatim prompt is adequate because the deterministic slice, not prompt obedience, is authoritative. The reason ban will probably relocate into nominalised praise such as “A concise distillation of the central tension.” That is still page-description register, but it is not a safety blocker.

The vacuous tests are the storage/public seams: `store-roundtrip` proves absent Quotes remain absent, artefact-copy deliberately omits Quotes, the manifest exempts it, deploy fixtures omit it, and public DTO tests pass `quotes: null`. Add one synthetic non-null artefact spanning filesystem/Postgres round-trip and public projection.

Focused Vitest could not start under this review’s read-only sandbox because Vite attempted temporary writes. The concrete failures above were reproduced with direct read-only module probes. No files were changed.