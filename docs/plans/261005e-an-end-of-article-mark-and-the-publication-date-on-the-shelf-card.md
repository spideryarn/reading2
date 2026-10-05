# An end-of-article mark, and the publication date on the Shelf card

Up: [plans.md](../project/plans.md) · area docs:
[reading-view-overview.md](../project/reading-view-overview.md),
[library.md](../project/library.md)

Two small, independent changes from two of Greg's reports, both filed 2026-10-04 and both proven
his from the production row (`feedback-reporter.ts`, exit 0). One commit each.

## A. The end of the article (`spya-zgf8p2`)

> Add some subtle pleasant visual marker at the very end of the article in the text column to show
> that it is the end.
>
> — Greg, 2026-10-04

### What is already true

- The article is one `<table class="zoom reading only-prose">` with a single column, drawn by
  `src/web/TableView.tsx`. Each block is a `<tr data-block>` holding one `<td class="text">`, and
  the block's own HTML sits in a `.prose` box centred inside that cell.
- After the last block there is nothing: the page just stops, and a reader cannot tell the end of
  the piece from a page that has not finished loading.
- Everything that looks a block up does it through `tr[data-block]` or `td.text` (reading position,
  jumps, flashes, comment offsets rooted at `td.text .prose`). The table's cell rules are scoped to
  `table.zoom > tbody > tr > td`.

### What we build

**A `<tfoot>` with one row and one cell, `td.article-end`, holding a small ornament**: a short
hairline, a small diamond, a short hairline, centred on the same axis as the prose. Drawn in CSS
from the existing rule and ink tokens, so it needs no glyph from a font and follows light and dark.

```
        …the last paragraph of the piece.

                  ────  ◆  ────
```

- **A footer row, not a last body row and not CSS `::after` on the last cell.** A `tfoot` row has no
  `data-block` and is not a `td.text`, so no lookup, selection root, row hover, gutter or fold can
  mistake it for a block, and it inherits the column's width for free. `::after` on the last
  `td.text` was the simpler-looking option and was passed over: when the reader folds the last
  section the last block is not drawn and the mark would go with it, and the cell also holds
  marginalia and the quiz, which would sit between the text and the mark.
- **Centred with the prose**: the cell takes `td.text`'s inline padding (`--text-pad-l`,
  `--text-pad-r`) and the ornament `margin-inline: auto`, which is how `.prose` centres.
- **Not drawn for an article with no blocks** (a paper not read through yet has none).
- **Named for a screen reader**: the ornament is `aria-hidden`, and an `.sr-only` "End of article"
  sits beside it.
- **Drawn once in print.** A footer group is repeated on every printed page, so the `tfoot` is
  given `display: table-row-group`. GPT Sol's plan review found this (its only finding;
  [review](261005e-end-mark-and-shelf-date-plan-review-sol.md)).
- It shows in every mode, for the owner and for a visitor to a public article, because both are
  drawn by the same table.

### Tests

`tests/article-end-mark.test.tsx`, red first: the table draws exactly one `.article-end`, inside a
`tfoot`, in a row with no `data-block`; and draws none when the article has no blocks.

## B. The publication date on the Shelf card (`spya-cqjhbn`)

> Show the publication date in the logged-in homepage Shelf
>
> — Greg, 2026-10-04

### What is already true

- `LibraryEntry` already carries `publishedAt` (a day) or `publishedYear` (a year alone, for a paper
  whose registry record states no day — plan 261004h, migration `20261004165444`). One function
  reads the pair: `publishedOf` in `src/web/relative-time.ts`, giving `12 Mar 2024` or `2011`.
- The Shelf shows it in three places only: the card's bottom-left note *while sorted by Published*,
  the Table view's Published column (hidden until asked for, because with it the table was wider
  than a desktop window), and the row card in Table view.
- So in the default view, cards sorted by Last opened, no card says when its piece was published.

### What we build

**The date joins the card's facts line**, the one under the title, after the author and the site:

```
Rich Sutton · incompleteideas.net · 13 Mar 2019 · ~6 min · 21 blocks
Vaswani et al. · arXiv · 2017 · ~40 min · 310 blocks
```

- Printed by `publishedOf`, so a year-only paper says the year, and the card, the sort and the
  Metadata page cannot disagree about what counts as a date.
- **Bare, with no "published" in front.** It sits beside the author and the site, where a date
  reads as the piece's date; the added and opened times live on the bottom row.
- **A piece with no date shows nothing there**, like a piece with no author.
- A paper not read through yet shows it too.

### What does not change

- **Table view.** The Published column stays hidden by default, for the width reason above; the
  row card and the Columns menu still reach it.
- **The note while sorted by Published** still says "published 12 Mar 2024" / "no publication
  date". For a dated card that now repeats the facts line. The alternative, the note falling back
  to "added …" as it does for Title and Length, would make the bottom row say two different kinds
  of thing in one sort (dated cards "added…", undated "no publication date"). Left as it is; a
  question for Greg in the debrief.
- **The public shelf** (`/read/public`). The report says the logged-in Shelf.

### Tests

In `tests/shelf-card-published.test.tsx`, red first: a card with `publishedAt` prints the day in
its facts line; one with `publishedYear` prints the year; one with neither prints no date and no
stranded separator.

## Checks

`npm test`, `npm run typecheck`, lint on the touched files; GPT Sol on this plan and on the code; a
browser check at desktop, iPad and phone widths, light and dark, of the end of an article (also
with the last section folded, and in a band mode) and of the Shelf's cards.
