**Approve with changes.**

1. **P2 — Prevent the end mark repeating in print.** The proposed `<tfoot>` ([plan:30](docs/plans/261005e-an-end-of-article-mark-and-the-publication-date-on-the-shelf-card.md:30)) has footer-group behavior: browsers may repeat it on every printed page. That would falsely announce several article endings. No reading-table print override exists. Keep the footer, add a scoped print rule setting `display: table-row-group`, and check a multipage print preview. [CSS table specification](https://www.w3.org/TR/CSS22/tables.html#table-display).

No other findings:

- Block selectors exclude the footer; the spine measures the first and last **block rows**, not table height ([Spine.tsx:188](src/web/Spine.tsx:188)). Navigation, selection, folding, marginalia and reading-time handling remain safe.
- No partial or streaming prose path was found. Unprocessed papers use a separate page ([ArticlePage.tsx:166](src/web/article/ArticlePage.tsx:166)); public visitors receive the article’s blocks. Export reads stored artifacts.
- `<tfoot>` is reasonable. An element after the table would need to reproduce its width and centring rules.
- The facts line is appropriate, including minimal papers. Missing dates leave no separator. Leaving `CARD_NOTES.published` unchanged is the simplest correct choice.
- The original `key={f}` could collide with an author/site equal to the year. Files changed during this review; the current code already addresses that with `${i}:${f}` ([ShelfEntry.tsx:271](src/web/ShelfEntry.tsx:271)).

I made no edits.