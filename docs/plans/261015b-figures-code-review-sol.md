VERDICT: approve with changes

1. **The caption reservation can orphan the image's caption and misclassify it.** In
   `picture → "Table 1" → native table → "Table 2"`, the picture reserves `Table 1` for the
   native table ([src/figures.ts:137](../../src/figures.ts#L137)), but the native table follows
   `captionOf`'s ordinary after-before priority and takes `Table 2` instead. `Table 1` remains
   unclaimed, the picture remains a figure, and the per-kind ordinals are then wrong. The same
   happens when the native table has its own non-empty `<figcaption>`. Reserve the caption only
   when the following table will actually fall back to its preceding caption.

2. **Roman table identifiers are needlessly incomplete.** `TABLE_CAPTION` accepts only `I`, `V`,
   `X`, and `L` ([src/figures.ts:107](../../src/figures.ts#L107)), so image captions such as
   `Table C`, `Table D`, and `Table M` remain figures. The plan review explicitly called for the
   complete Roman numeral alphabet; accepting `C`, `D`, and `M` preserves the number requirement
   without admitting the deliberately excluded `Table A` form.

3. **A native table's own HTML caption is invisible to `captionOf`.** The owned-caption parser
   recognizes `<figcaption>` only ([src/figures.ts:42](../../src/figures.ts#L42)), while a native
   `<table>` owns a `<caption>`. Besides returning the wrong caption for the table, this makes the
   reservation check believe the table needs the separate caption before it and take that caption
   away from an image. Treat both caption elements as owned captions.

The Structure change has no correctness finding. Both drawn and hidden two-column rows render the
same `Row` in `StructurePanel`, and both drawn and hidden list rows render the same `RowBody` in
`OutlinePanel`, so the 14px SVG and 0.8rem count affect measurement and paint identically.
`--ink-soft` is also the base unread-row ink in both faces. Its light-theme value is explicitly
defined as `oklch(0.36 0 0)`, so the mark stays dark and visible on the light page rather than
inheriting the dark-theme direction of the scale.

## Changes made

- Expanded `TABLE_CAPTION` to the complete Roman-numeral alphabet.
- Made caption ownership recognize both a figure's `<figcaption>` and a native table's
  `<caption>`.
- Replaced the unconditional reservation with `tableClaimsCaptionBefore`: it reserves a caption
  only when the following table has no owned or available following caption and will actually
  claim the caption before it. It walks forward through adjacent caption/table runs, so each table
  in a run keeps its own preceding caption without double-claiming one; the existing `claimed` set
  remains the final ownership guard.
- Added regressions for image and native-table captions on both sides, owned captions, claimed-set
  interactions, per-kind ordinals, table runs, and Roman `C` / `D` / `M`. The ownership/ordinal and
  Roman tests both failed before the fixes; changing the native owned-caption case to valid
  `<caption>` failed before that parser fix.
- Removed the useless `\|` escape reported by Biome in the new caption fixture.

Post-fix verdict: **approve**.

Validation:

- `npx vitest run tests/figures.test.ts tests/structure-figure-marks.test.tsx tests/skim-figures.test.tsx`
  — 44 tests passed.
- `npm run typecheck` — attempted, but this sandbox refused `tsx`'s Unix IPC socket with `EPERM`
  before the checker ran. Running the same script without the `tsx` CLI socket,
  `node --import tsx scripts/typecheck.ts`, passed all four TypeScript projects and confirmed all
  3,751 source files are covered.
- `npx biome lint --max-diagnostics=none src/figures.ts src/web/FigureMark.tsx src/web/styles/structure-mode.css tests/figures.test.ts`
  — clean.
- `git diff --check` — clean.
