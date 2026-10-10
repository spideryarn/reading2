# 261010d — every annotation card on the prose opens its mode

Report `spya-zux9w6` (#521), Greg, 2026-10-09, in the reading view of `arxiv-2609-01481`:

> Citation tooltips should include a link to take you to the citations mode, just like I think
> quotes do, and hopefully the glossary as well. Anything else that's an annotation on the text
> should, you know, should have a tooltip, and there should be a way to take you to its mode.
>
> — Greg, 2026-10-09 (`spya-zux9w6`)

Owners: [tooltips.md](../project/tooltips.md) (the cards),
[citations.md](../project/citations.md) and [sources.md](../project/sources.md) (the citation half),
[glossary.md](../project/glossary.md), [quotes.md](../project/quotes.md).

## The survey: every kind of mark on the prose today

From `annotate.ts`, `ProseHoverCard.tsx`, `BlockLinkCard.tsx`, `passages.ts` and `Reader.tsx`
(dev at `b2f8edcf`).

| Mark | Drawn | Card on hover | Way into its mode from the card |
|---|---|---|---|
| Glossary term `mark.term` | every mode | `TermCard` | **Yes**, *Open glossary* — but it only selects the entry (`?term=`); it sets no `termFocus`, so on a long glossary the row may be off-screen |
| Quote `mark.hit[data-quote]` | every mode | `QuoteCard` | **Yes**, *open Quotes*, hidden while Quotes is the mode. Uses `setMode`, not `showBand` |
| Citation `mark.cite` | every mode (owner) | `CiteCard` | **No.** *Ask in chat* and *search Scholar* only. Reader already has `openBibliographyWork` (261009l), which brings a work's row into view in Bibliography; the card is not given it |
| Cross-reference `mark.xref` | every mode | `BlockLinkCard` | n/a — it *is* a link to another passage, and is not a mode's |
| Highlight, comment, comment with AI, Referee placement `mark.cmt` (a whole-block bookmark draws none) | every mode | **none** | a click opens the comment's dialog (`?note=`); a coloured highlight is also a Quotes row |
| Chat anchor `mark.chat` | every mode | **none** | a click opens the floating conversation (`?thread=`), not a mode |
| Hits `mark.hit` (Search, Ideas, Timeline, Referee, Skim) | **only while their mode is open** | none | n/a — the mode is already open, and its band lists the item |
| Article hyperlinks, footnote markers | every mode | `LinkCard`, `NoteCard` | n/a — the author's, not a mode's |
| Maths | every mode | none | n/a — rendering, not an annotation |

Nothing else draws into the prose: Sources' Reception and Claims, FAQ, Structure, Summary, Diagram,
Learn and Marginalia draw nothing there (`passages.ts`).

So the gaps Greg named are: citations (no way in), glossary (a way in that may land off-screen), and
the two always-visible marks with no card at all — comments and chat anchors.

## The one consistent way

**Every card on a mark a mode made ends its foot with the same button — `Open in <Mode>` — which
opens that mode and brings this item's row into view, selecting it where the mode has a selection**
(Glossary `?term=`, Quotes `?quote=`; Bibliography has none — its focus is a one-shot scroll,
item-focus.ts, and there is still no `?cite=`, GPT Sol's F7). One component,
`OpenInModeButton` in `ProseHoverCard.tsx`, with the mode's Dock label (`MODE_LABEL`), so the three
look and read alike ([controls.md § Controls that do the same job look the
same](../project/controls.md#controls-that-do-the-same-job-look-the-same), Greg 2026-10-07).

- **Citation** → *Open in Sources*: Reader's existing `openBibliographyWork(work.id)` — focus and
  move in one write, lowers `?citebar=` if the bar hides the row, clears the band's away state.
  Owner only, as the marks already are.

**Back.** Each press is one pushed history entry where it changes the address (mode, sub-mode,
`?term=`, `?quote=`). Bringing back a band that had stepped aside, in the mode it is already in, is
component state and Back does not put it away again — `showBand`'s deliberate rule (GPT Sol's F9).
- **Glossary** → *Open in Glossary* (was *Open glossary*): `openTermInGlossary` **plus**
  `setTermFocus(focusOn(id))`, as `openOrigin` already does, so the row lands in view — and
  `VisitorGlossaryBand` is given the same `focus` / `onFocusTaken` the owner's band has, or a visitor
  still lands nowhere (GPT Sol's F2).
- **Quote** → *Open in Quotes* (was *open Quotes*): `revealQuote` then `showBand("quotes")` rather
  than `setMode`, so a band stepped aside comes back (the same reason `showBand` exists).

**Shown in its own mode too.** The quote card hid its button while Quotes was open ("nothing to
open"). But the press also selects the item and brings its row into view, which is worth having
when the band is open beside a long list — and a button that comes and goes with the mode is a
second rule to learn. The label `Open in <Mode>` stays true in both states. *(Changed decision —
flagged for the plan review.)*

**Wording.** *Open glossary* was Greg's own ask on 2026-10-03 ("a label that says what pressing it
does"); *Open in Glossary* keeps that and adds the mode's name as the Dock writes it, which is what
makes the three one control.

### Not built here: cards on comment, chat and hit marks

Drafted as a Stage 2 and **cut on GPT Sol's plan review** (F1, F3–F6, F8), because each half is its
own design rather than a small extension:

- **Comments and highlights.** A `mark.cmt` is a highlight, a comment, a comment with AI, or a
  Referee placement (`comment-nav.ts`); a coloured highlight is also a row in Quotes; a whole-block
  bookmark draws no prose mark at all. So "its mode" is not one place, and a press on the mark opens
  the comment's dialog (`?note=`), not a mode — *Open in Comments* would be false.
- **Chat anchors.** A press opens the floating conversation (`?thread=`) and leaves the mode alone;
  the anchor's data has a title and a turn count but no first question.
- **Both**: the marks are not focusable, so a keyboard route needs designing (the same open cost
  [glossary.md](../project/glossary.md) records), and one `<mark>` can carry several ids of each kind
  plus a term or citation, with a click-precedence rule a card must match.
- **Hits** (Search, Ideas, Timeline, Referee, Skim): drawn only while their own mode is open, so the
  way into the mode is met; a card would say something different for each of five modes.

They are one Overseer queue entry, `qi-yr7hx7t8` (proposed 2026-10-10), so the "every annotation has a
tooltip" half is held somewhere that gets picked up rather than in this sentence.

## The simpler option passed over

Adding one *open Sources* button to `CiteCard` alone, copying the quote's. It answers the first
sentence of the report and leaves the three buttons drawn three ways (*open Quotes*, *Open
glossary*, and a third), which is the inconsistency Greg's "and hopefully the glossary as well"
is pointing at. The shared button costs one small component.

## Tests

- `CiteCard` with `onOpenWork` draws *Open in Sources*; a press calls it with the work id and closes
  the card. Without it (visitor), no button.
- Term card's *Open in Glossary* press: Reader-level wiring sets the focus — tested at the hook
  boundary if Reader is too heavy (the existing term-card tests are the model).
- Quote card: the button is present in Quotes mode too, and calls `onOpenInQuotes`.
- Each test written red first.
- A visitor's Glossary band takes a focus and lands the row (F2).
- A phone-width integration case: *Open in Sources* from a stepped-aside band brings the band back,
  as *Open glossary* already is tested at `tests/a-band-link-steps-the-band-aside-on-a-phone.test.tsx`.

Browser check (Sonnet, Playwright): hover a citation, press *Open in Sources*, land on the row;
same for a term far down a long glossary; a quote in Quotes mode.

## Docs

`tooltips.md` gets a short section, **Every card on a mode's mark has a way into its mode** — the
narrower truth, since hits, comments and chat anchors still have no card (F8) — holding the table
above as the single home and naming the queued gap; citations.md, glossary.md and quotes.md each
replace their own sentence about the button with a pointer to it. CiteCard's *"A selected row in
Citations mode. There is no `?cite=`"* is reworded rather than deleted: still no selection and no
`?cite=`, but now a way to bring the row into view.

## Plan review

GPT Sol, 2026-10-10: [261010d-plan-review-sol.md](261010d-plan-review-sol.md), verdict REWORK —
cut Stage 2. All nine findings taken: F1, F3–F6 and F8 cut Stage 2 into a queue entry and corrected
the survey; F2 adds the visitor's focus; F7 corrects the selection claim; F9 keeps the button in its
own mode and records the Back rule.

## Code review

GPT Sol, 2026-10-10: [261010d-code-review-sol.md](261010d-code-review-sol.md), APPROVE WITH FIXES
(made). C1: *Open in Sources* pressed while Bibliography was already the list, with the band
stepped aside, pushed an empty Back step; `openBibliographyWork` now skips a same-value write, as
`showBand` does. C2: whole-App tests for the quote's one-push history and the in-mode press. C3: the
citation foot's old wrap rule removed, so `.prose-card-foot-wraps` / `.prose-card-acts` own it.

## Seen in a browser

Sonnet subagent, Playwright on the box, local dev-admin, a 27-work paper
(`fd-src-jco-2005-01-libre-…`), 2026-10-10. All four passed:

- **Citation, 1440px:** foot *Ask in chat · Open in Sources* on one row inside the card; the press
  gave `?mode=sources`, Bibliography, and the work's row fully in view
  ([shot 1](261010d-shot-1-citation-card-1440.png), [shot 2](261010d-shot-2-sources-opened-1440.png)).
- **Glossary, 1440px:** the last of ten terms; *Ask in chat · Hide · Open in Glossary* on one row;
  `?term=` set and the row in view ([3](261010d-shot-3-glossary-card-1440.png),
  [4](261010d-shot-4-glossary-opened-1440.png)).
- **Quote, in Quotes mode:** the card shows *Open in Quotes*; three quotes pressed, each `?quote=`
  matching the card's *N of 12* and the row in view ([5](261010d-shot-5-quote-card-1440.png),
  [6](261010d-shot-6-quotes-opened-1440.png)).
- **390px:** the citation foot on one row, no horizontal overflow; the press brought the band up
  with the row in view ([7](261010d-shot-7-citation-card-390.png),
  [8](261010d-shot-8-sources-opened-390.png)). A desktop viewport, not WebKit.

**Rows land at the band's bottom edge**, not centred: `useLandOnItem` scrolls with
`block: "nearest"`, which is that hook's existing rule for every opener, so it is left as it is.
Two oddities were seen and not chased, both on quote marks and neither in this change's code. The
first: one early, less careful hover on a mark that also carried a term showed *11 of 12* and
selected the 10th; three pure quote marks did not reproduce it. The second: one pure quote mark
(" and ") opened no card.
