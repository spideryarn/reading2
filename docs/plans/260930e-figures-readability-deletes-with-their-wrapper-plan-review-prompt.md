# Plan review: 260930e — figures Readability deletes with their wrapper

You are reviewing a plan before it is built. Read-only: do not edit anything.

Read, in this order:

1. `docs/plans/260930e-figures-readability-deletes-with-their-wrapper.md` — the plan.
2. `src/protect.ts` — the existing pass the plan adds a third rule to, with its fallback
   (`WITHDRAWALS`, `controlOptionsFor`, `keptWithdrawn`, `proseRetention`) and its header's
   reasoning about why a positive class token is dangerous.
3. `src/extract.ts` — `prepareDocument`, `readingArm`, `armThatKeptTheProse`.
4. `node_modules/@mozilla/readability/Readability.js` — `_cleanConditionally` (around line 2434) and
   `_prepArticle` (around line 782), and `grabArticle`'s DIV→P conversion.
5. The spike: `scratch-6a/rescue-lib.ts` (the rule as spiked), `scratch-6a/corpus.ts` (the corpus
   measurement), and the real pages it ran on, `scratch-6a/*.html` (Nature `nature.html`, Substack
   `raschka.html`, and three controls). Corpus fixtures are in `evals/extraction/fixtures/`.

You may run `npx tsx scratch-6a/corpus.ts` (about a minute) and write throwaway scripts under
`scratch-6a/` to test constructions.

The spike's result, for you to check rather than take: across 35 corpus fixtures and 5 live pages,
three pages are touched (Nature 1 → 9 images, Substack 15 → 24, Quanta 6 → 7), and no prose run of
25+ characters present in the control is missing from the treatment on any page.

Questions I most want answered:

- **Is the diagnosis right?** Both losses are `_cleanConditionally` removing a `div` wrapper whose
  only text is link text, with the picture inside. Is there a branch I have missed that would still
  delete the picture after the unwrap (for example the DIV→P conversion, `_cleanHeaders`, the
  "remove extra paragraphs" pass, or candidate selection)?
- **Can the unwrap lose prose or promote junk?** `protect.ts` records two cases where a rescue made
  a wrong element win candidate selection and cost the author's paragraphs. Construct the
  adversarial topology for this rule if one exists — for example a page whose article body is a
  `div` holding only a figure, or a gallery of many figures — and say whether the fallback
  (prose-retention against a control arm) catches it.
- **The control deletion** — dropping a link-only, picture-free child of an unwrapped wrapper. Is
  that narrow enough? What real content could be link-only inside a figure's wrapper next to its
  picture?
- **Is "link text > 0" the right gate**, and is the outward walk (a `div` whose only element child is
  the figure) bounded correctly?
- **Is the re-run list right** — in particular, is re-running `extract` then `blocks` then `assets`
  on a published web article safe for the block-id contract (`docs/project/block-ids.md`), and what
  else re-runs downstream when blocks change?
- Anything in the ranking (causes 2–5) that is wrong, or a simpler fix I passed over.

Write your findings to the output file as a numbered list, each with a severity (P0 blocks the
plan, P1 should change it, P2 worth noting), the evidence, and the change you propose. End with a
one-line verdict: *build as planned*, *build with changes*, or *do not build*.
