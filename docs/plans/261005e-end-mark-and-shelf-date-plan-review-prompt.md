# Plan review: an end-of-article mark, and the publication date on the Shelf card

You are reviewing a plan before it is built. Read-only: do not edit anything. You may run one test
file (`npx vitest run tests/<one>.test.tsx`) or a `tsx` script if it helps.

The plan: `docs/plans/261005e-an-end-of-article-mark-and-the-publication-date-on-the-shelf-card.md`.
It covers two small, independent UI changes that Greg asked for and that are to be built in the
simplest version that gets most of the value.

Read the plan, then the code it names:

- `src/web/TableView.tsx` (the `<table>`, around the `<tbody>` and the block rows) and the styles
  `src/web/styles/table.css`, `src/web/styles/prose.css`, `src/web/styles/gutter.css`
- `src/web/scroll.ts`, `src/web/selection.ts`, `src/web/flash.ts` and anything else that walks the
  table's rows
- `src/web/ShelfEntry.tsx` § `ShelfCard`, `src/web/library-columns.tsx` § `CARD_NOTES`,
  `src/web/relative-time.ts` § `publishedOf`
- `docs/project/library.md` § Sorting the shelf

Questions, in order of weight:

1. **Part A.** Is there anything that would mistake a `<tfoot>` row for a block, or be thrown off
   by it: a selector, a row walk, a height or scroll measurement (the spine, the reading position,
   reading time, the "how far through" figure), sticky offsets, keyboard movement, folding, the
   marginalia column, print or export? Name the file and line. Is a `tfoot` the right place, or is
   an element after `</table>` simpler and as well aligned?
2. **Part A.** Is there a state in which the mark would be wrong to show: a filtered or partial
   article, a streaming ingest, a paper not read through, a public visitor's gated view?
3. **Part B.** Is the facts line the right place, and is there a case where it prints something
   misleading or breaks the line (the `key={f}` on each fact, a year equal to another fact, a
   minimal paper)? Is leaving the Published-sort note as it is the simpler correct choice?
4. Anything in either part that is more complicated than it needs to be, or a simpler version that
   was missed.
5. Check the plan's own conclusions, not only its steps: if a "what is already true" claim is
   false, say so with the file and line.

Answer with a verdict first (approve / approve with changes / rework), then findings numbered and
ranked P0 to P2, each with the evidence. Be brief. Say plainly if you found nothing.
