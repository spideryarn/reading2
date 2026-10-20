# Marginalia's tooltips: the prose's citation card on a *Cites* line, and the item's own words where the line is cut

Report `spya-gdbsq2` (#623, SPIDERYARN-READING2-KG), from Greg as admin, 2026-10-19, on
`tinbergen1963onethology` with `margin=1`:

> The Marginalia mode tooltip for a citation is pretty unhelpful. It's just a kind of generic
> message. I feel like we have more information than that for a citation if I hover over it in the
> text. So let's try and reuse that same tooltip. And the same goes for other stuff in the Marginalia
> mode - their tooltips should be the best we can make them, and ideally reuse what tooltip
> machinery we already have for that kind of marginalia-annotation.
>
> — Greg, 2026-10-19 (spya-gdbsq2)

Prior work: [marginalia.md § Every note says where it came from](../project/marginalia.md#every-note-says-where-it-came-from)
(the house card on every note, 261002g), [261018i](261018i-marginalia-notes-that-save-a-click.md)
(the *Cites* line opens to what the work says), [tooltips.md § Every card on a mode's mark has a way
into its mode](../project/tooltips.md#every-card-on-a-modes-mark-has-a-way-into-its-mode) (the table
of which marks have which card). Nothing for this report had landed on `origin/dev` on 2026-10-20.

## What each margin item's card is today, and what exists elsewhere for its kind

| Margin item | Card today | A richer card for the same kind elsewhere? |
|---|---|---|
| *Cites* line (Bibliography) | the delegated house card: "A work the article cites…" — the same words for every work | **Yes: `CiteCard`**, the prose `mark.cite`'s card: title and link, by-line, the checked note from the abstract, the reference entry, what we have read, the verdict, *cited in N paragraphs* with a jump to each, *Does it say that?*, *Ask in chat*, *Open in Sources* |
| FAQ, *When* (Timeline), *Others say* (Reception), comments | the delegated house card, per kind | No. None of these marks the prose with a card (tooltips.md's table); their bands draw rows, not cards |
| Question, relation word, model note stamps, idea stamp | a house card of their own, per kind (the idea's carries its statement and provenance) | No |
| A model note's link to another passage | `BlockLinkCard`, the block link's card | already the shared machinery |

So **the citation is the one kind with richer machinery to reuse**, which is exactly Greg's
example. For the rest, "the best we can make them" has one gap worth closing now: **a shut line is cut
off with an ellipsis**, and its card says what the *kind* is but never what *this* item says, so a
reader hovering a cut-off FAQ question learns "A question a careful reader might ask" and still
cannot read the question without pressing.

## What we build

### 1. The *Cites* line's card is `CiteCard` (the prose's own)

- `CiteCard` is exported from `ProseHoverCard.tsx` unchanged and drawn, one per work, in an
  **interactive `Tooltip`** on the *Cites* line — the shape Skim's term chips already use to show
  the prose's `TermCard` (`TermChip` in `SkimPanel.tsx`, tooltips.md § interactive). Several works
  beside one block stack, as two works on one prose mark do.
- The line loses `data-marg-tip`, so the delegated house card does not also open on it.
- **Its buttons work**: *Ask in chat*, *Does it say that?* (about the block the line sits beside,
  which is a citing block — `citedAt` is checked by `CiteCard` itself), *Open in Sources*, and the
  numbered jumps (aimed with `citePassageKey`, as the prose does). They are Reader's own senders
  (`askWork`, `checkCitedWorkInChat`, `openCitedWorkFromCard`, `jumpTo`), handed down through a
  small React context rather than a prop through `MarginNotesSlot`, because `marginNotes` is a memo
  that `memo(TableView)` relies on and those senders are defined after it. The column is
  owner-only for citations (`marginaliaBibliography` is null for a visitor), so the context is only
  ever an owner's.
- **The card does not open while the line is pressed open.** The panel under the line already shows
  the by-line, the entry and the note; a card over it would hide it. A press closes the card.
- **Where the card was lost**: the house card's sentence "From Sources' Bibliography, where AI read
  the article's references…" is not in `CiteCard`. The prose card never had it either, and
  `CiteCard`'s foot says where each link came from and ends in *Open in Sources*. The `citation`
  row is deleted from `MARG_TIPS`, so the `Record` does not carry a card nobody draws.

### 2. A cut-off shut line's card says the item's own words

- In the delegated card (`BlockLinkCard.tsx` § MARG_NOTE), when the trigger's label is **actually
  cut** (`scrollWidth > clientWidth` on `.marg-shut-label`, read when the card opens), the card puts
  the line's full words between `what` and `how`, through `ControlTip`'s existing `drawn` slot —
  "what this control produced for the article in front of the reader", which is exactly this.
- **In the item's own face** ([fonts.md](../project/fonts.md)): `ShutNote` already knows the line's
  voice, and puts it on the trigger as `data-marg-voice`; `ControlTip` gains an optional
  `drawnVoice`. A count ("3 questions") is ours and never cut in practice; it is shown the same way
  if it ever is.
- Not when the line is open (it wraps, so it is not cut) and not when it fits: repeating visible
  words is noise.

## Simpler options passed over

- **Leave the delegated card and add the work's title to it.** The title is already the line; the
  report is that the prose has the by-line, the note, the jumps and the buttons, and the margin does
  not.
- **Draw `CiteCard` inside the delegated card**, keeping one Floating UI instance for the column.
  That card is not one a pointer can enter (BlockLinkCard.tsx header), so `CiteCard`'s buttons and
  jumps would be unreachable; making it enterable is the second implementation tooltips.md warns
  about. One `Tooltip` per *Cites* line instead costs an instance per block that has a citation note
  — tens, not the thousands the delegation was for — and the content is rendered only while open.
- **Make the *Cites* line's press pin the card and drop its panel.** That changes a press 261018i
  designed and Greg did not ask about; deferred, named below.

## Deferred, named

- **A count line's card listing its items** ("3 questions" → the three). The press already lists
  them; no richer machinery exists to reuse.
- **A press on *Cites* opening the card instead of the panel**, so the line has one surface rather
  than two that overlap in content.
- **Cards for `mark.cmt` and chat anchors in the prose** — already queued as `qi-yr7hx7t8`; a
  comment line in the margin would reuse that card once it exists.

## Touch

On a touch screen the Marginalia column is drawn on wide iPads. The card is controlled by the line
(`open`/`onOpenChange`), so `Tooltip`'s `mouseOnly` stops a tap's synthesised `mouseenter` opening
it, and the tap's press opens the panel, which keeps the card shut. A finger therefore gets what it
got before — the panel — and never a card it cannot dismiss.

## Tests

- `tests/marginalia-note-cards.test.tsx`: the *Cites* line no longer carries `data-marg-tip`;
  hovering or focusing it opens a dialog with the work's by-line and *Open in Sources*; pressing
  *Open in Sources* and a jump calls the context's senders; pressing the line closes the card and
  opens the panel. Written first, red, then green.
- A delegated-card test: a shut line whose label is cut shows its words in the card, in the item's
  voice class; one that fits does not (jsdom's widths stubbed).
- `tests/no-native-title.test.ts` and the doc-links test unchanged and green.

## Docs

marginalia.md § Every note says where it came from (the citation's card is the prose's, and the cut
line's words), tooltips.md's table gains a line for the *Cites* line, and the ControlTip `drawn`
comment names its second user.

## GPT Sol's plan review, and what changed

[261020g-marginalia-tooltips-plan-review-sol.md](261020g-marginalia-tooltips-plan-review-sol.md),
six findings, all *should*, all taken:

- **F1, a tap focuses before it clicks**, and `mouseOnly` covers hover, not focus. The line records
  a touch or pen `pointerdown` and refuses to open its card for that press (TermChip's rule); a
  cancelled press clears it.
- **F2, the card must stay shut while the line is open**, not only close on the press: the disclosure
  state is `ShutNote`'s, and the `Tooltip` is `enabled={!open}` on the button itself.
- **F3, *Open in Sources* and a jump close the card first**, as the prose does; the test asserts the
  dialog goes, not only that the sender fired.
- **F4, the cut line's words would be stale once it opens**: the trigger carries `data-open` too and
  the delegated card observes it, so opening re-reads and the words go. A window resized under an
  open card is not re-read; the card goes on the pointer's next move.
- **F5, the context value is memoised** in Reader from the four senders, so a scroll does not
  re-render every *Cites* line.
- **F6, the card scrolls inside a height tied to the window** (`.marg-cite-card`, the
  `.skim-term-card` rule), so its row of buttons is reachable on a short screen.
