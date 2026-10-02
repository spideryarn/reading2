# A paper card on the article links under each shelf topic

Report `spya-f28vqj` (Greg, 2026-09-29, the shelf's topics, *More detail*). The first half — the
count bar's card, *N of M* removed, narrower bars — shipped in `7ce6b35bc`
([261001j](261001j-five-small-feedback-tooltips-and-labels.md),
[note](../user-feedback/261001_1200-five-small-tooltips-and-labels.md)). This is the rest, which
nothing picked up:

> And also: add rich tooltips (see `tooltips.md`) to the paper-links that are matched for each
> faceted-text-search-pill. In fact, better still, maybe create a reusable component for
> paper-tooltips that we use anywhere there's a link to a paper that shows title, authors, metadata
> (e.g. when added, when last opened, faceted-text-search-pills, and maybe some kind of preview or
> summary).
>
> — Greg, 2026-09-29

## What we build

1. **`src/web/PaperCard.tsx`** — the reusable part. Two exports:
   - `paperCardFacts(entry, topics)` → plain data (the house pattern from `rowCardFacts`, so a test
     checks data, not markup): title; a byline line (`byline · siteName`, either may be absent);
     the gist as the preview; facts — *Added* (exact), *Last opened* (exact, or *never*), *Length*
     (*N min · N words*, or *not read yet — title and abstract only* for a `processing: 'minimal'`
     paper, whose counts are 0), *Archived* (exact, when it is), *Shared* when public; and the
     topics it is in.
   - `PaperCard` — draws that with the existing `.tip-*` classes (`tip-title`, `tip-gist`,
     `tip-facts`), plus one new rule for the byline and one for the topic list, so it reads as the
     same kind of card as the shelf table's row card. Topics are drawn as small labels each with
     its `TopicDot`, so the hue matches the pill; **not pressable** — the card has nothing to click,
     so it stays an ordinary non-interactive `Tooltip` (tooltips.md § A card the pointer can enter:
     a card with nothing to press keeps the old behaviour).
   - Knows nothing about the shelf topics view: it takes a `LibraryEntry` and a list of
     `{ label, slot }`, so the next caller (anywhere a link names a paper on your shelf) passes the
     same two things.

2. **Wire it into the detail view's links** (`ShelfTermsDetail.tsx` § `Titles`): each link is
   wrapped in a `Tooltip` whose content is the `PaperCard`, `placement="bottom-start"`, inside the
   view's existing `TooltipGroup` so scrubbing down the list opens neighbours instantly. A slug with
   no entry on the loaded lists keeps the bare link.
   - `useShelfTopics` gains `entryOf(slug)` next to `titleOf` (same map, holding the entry).
   - `TermTipScope` gains `entryOf` and `topicsOf(slug)`; `ShelfTerms` builds `topicsOf` once per
     server answer from **every** topic the server chose (not only those drawn), in rank order, with
     the hue each already wears — so an article's card names the same topics whatever the view is
     narrowed to.

### Decisions, and the simpler options passed over

- **The card repeats the title**, against tooltips.md's "don't repeat what is on screen". Greg
  listed title first, and a reusable paper card needs it everywhere else it will go (a link may be
  a slug, a short label, or truncated). Here it is one line, and it anchors the byline.
- **A `Tooltip` per link, not a delegated panel.** At most three links per topic row × the topics
  drawn (~20–40) is well under the hundreds where tooltips.md says a per-trigger Floating UI
  instance stops being cheap; the chips beside them are already one each. Delegated
  (`BlockLinkCard`'s shape) is the move if the card spreads to a list of hundreds.
- **No touch reveal.** A tap follows the link, as the table row card's title does
  (library.md § The table's row card). The detail view itself is the touch answer for topics.
- **Preview = the gist** (`LibraryEntry.gist`, the tree root's one sentence), already on the wire.
  No new fetch, no abstract, no first paragraph: those would need a new endpoint.
- **Topics capped at six**, then *+N more*: a paper in a dozen topics would otherwise make the card
  a list of topics.

### Deferred — named, not built

- **The card elsewhere**: the shelf's cards view and table (the table already has a row card defined
  by subtraction — merging the two is its own decision), the chip's own card (a card inside a card),
  `/read/public`, and links from inside an article to another on your shelf. Each is one `Tooltip`
  around a link once the caller has the `LibraryEntry`; the topic list needs the shelf's terms,
  which only the shelf page loads.
- **Touch reveal-then-commit** on these links.

## Stages

1. `PaperCard.tsx` + CSS + unit test of `paperCardFacts` and a jsdom hover test on a detail-view
   link (red first: no card before).
2. Wire into `ShelfTermsDetail`, `ShelfTerms`, `useShelfTopics`; docs (tooltips.md table row,
   shelf-terms.md line).
3. Browser check (Sonnet subagent, Playwright on the box): hover a link in `?topicsView=detail`,
   computed background opaque, card content right, narrow window.
4. GPT Sol code review; gates; commit; push to dev.
