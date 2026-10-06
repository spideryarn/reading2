# The card on a quote in the prose says what a quote is

Up: [plans.md](../project/plans.md) · Area: [quotes.md](../project/quotes.md),
[tooltips.md](../project/tooltips.md)

Overseer queue item `qi-c2dbrccn`. Feedback report `spya-tpmde9` (Sentry SPIDERYARN-READING2-DX),
from an admin: provenance proved against the production row with `scripts/feedback-reporter.ts`,
exit 0. No screenshot.

> Add a tooltip for Quotes, so readers know what they are (and any further information about them)
>
> — Greg, 2026-10-06 (`spya-tpmde9`), filed from an article open in **Citations** mode
> (`?mode=citations&margin=1`)

## What this is for

Quotes are the passages a model picked out of an article as worth keeping. Once made, they are
filled in purple in the prose **in every mode**, so a reader meets them without ever opening Quotes
mode. Greg was in Citations mode. What he could see of Quotes there was the purple fills.

## What already says what a quote is, and the one place that does not

| Where a reader meets Quotes | Has a card? | Says what a quote is? |
|---|---|---|
| The Quotes button in the bottom bar | yes (`MODE_CATALOG.quotes`, since 260907b) | yes |
| The (i) in the Quotes band's corner | yes (`AboutMode`, since 261001m) | yes, with *More in Help →* |
| **A purple fill in the prose, any mode**, under a pointer (except where a cross-reference's card wins) | yes (`QuoteCard` in `ProseHoverCard.tsx`, since 261002h) | **no, until this plan** |
| The purple strip down the spine | no | no |

The card on a fill read `❝ quote · 3 of 14`, the score bars, the model's reason, who chose it and
when, ‹ › and *open Quotes*. Every line of it assumed the reader already knew what a quote is. A
reader who has never opened Quotes mode, which is the reader this report is about, learned that the
purple passage is a quote, saw that the AI chose it and any scores it gave, but was not told what
Quotes are or what the purple means.

**Assumption, since there is no screenshot and nobody to ask:** "Quotes" in the report is the purple
fills, because in Citations mode the Quotes surfaces on screen are the bar's button, which already
has the full card, the 2px strip in the spine, and the fills, which are where the reader is reading.
If Greg meant the strip in the spine, that is the deferred item below.

## The change

**As built, after GPT Sol's plan review cut it down (§ Reviews).** Two small things in `QuoteCard`,
and nothing anywhere else in the code:

1. **One short paragraph under the label saying what a quote is and what the strength of the purple
   means** (`QUOTE_CARD_SAYS`):

   > A passage the AI picked out as worth keeping, in the article's own words. The stronger the
   > purple, the higher it scored.

   Checked against the code, because a card's explanation is where a plausible invention goes
   ([tooltips.md](../project/tooltips.md) § `ControlTip`):
   - *a passage*, not a line: the prompt says so in those words (`src/quotes.ts` § `SYSTEM`). The
     first draft of this plan said "line" and Sol caught it (F1).
   - *the AI picked out*: only model quotes get this card. `QuoteCardSource.listed` is `Quote[]`
     and the card ends with `aiProvenance`; a reader's own highlight is a different mark. Find more
     adds ordinary model quotes and Skim only points at existing ones.
   - *in the article's own words*: the stored text is sliced from the article
     ([quotes.md § What is stored is the article's characters](../project/quotes.md#what-is-stored-is-the-articles-characters-not-the-models)).
     It deliberately does not say "the author's words": the mode cannot tell a quotation the article
     left unmarked from its own prose (`MODE_CATALOG.quotes.how`).
   - *the stronger the purple, the higher it scored*: `quoteTier` and `quoteAlpha` both read
     `priorityOf`, the higher of the two scores printed just below. True in that direction only: the
     fade has a floor, so two low scores can draw alike, and an unscored quote draws lightest and
     the card says *Not scored.*
   - It is from the viewer's side with no *you*, so it is true for a visitor on a shared article.

2. **A *More in Help →* link at the end of that paragraph**, to `helpHref(modeAnchor("quotes"))`,
   the same words and the same helper the band's (i) uses. The card can already be entered by the
   pointer (it holds buttons), so the link needs no new machinery. It closes the card when followed.
   `/help` is public, so a visitor can follow it.

```
❝ QUOTE                                3 of 14
A passage the AI picked out as worth keeping, in
the article's own words. The stronger the purple,
the higher it scored. More in Help →

Importance  ▓▓▓▓▓▓▓░░  0.85
Striking    ▓▓▓░░░░░░  0.40

"This is the sentence the whole case turns on."     (the model's reason, in its face)
Chosen by the AI · 3 Oct 2026
‹ ›                                     ❝ open Quotes
```

### What was passed over

- **Simpler: only the help link.** Passed over because it makes the reader leave the article to
  find out what the purple is, which is what a tooltip is for avoiding.
- **More: what each score measures, printed under its bar.** This was in the first draft, as the
  "any further information" half of the report. Dropped on Sol's F3 and F5: two more lines on every
  quote's card, on a card with no height cap that can already be stacked under a term and a
  citation, for words (*Importance*, *Striking*) a reader can mostly guess. The meanings stay where
  they were, in the `title` on each score row, and are now a click away in Help.
- **More complex: the explanation behind an (i) inside the card.** A tooltip inside a tooltip.
- **Cost of the chosen one, named:** the card is about three lines taller on every quote, for
  readers who already know what a quote is as well as those who do not. It opens only after the
  pointer has rested 900ms, so it is not in anyone's way.
- **Not changed: `LABEL` in `QuotesPanel.tsx` still says "this line"**, as the prompt's own score
  definitions do (`src/quotes.ts`, *"rests on this line"*). It is not printed anywhere new, and
  rewording it is rewording next to a prompt, so it is left.

## Docs and help in the same stage

- [quotes.md § In the spine, on a card, and one at a time](../project/quotes.md#in-the-spine-on-a-card-and-one-at-a-time):
  the card's bullet says it now opens by saying what a quote is.
- `/help`, `src/web/help/help-modes.tsx` § quotes: its sentence listing what the card shows gains
  "what a quote is". Two sentences there were also false before this work and are corrected (Sol's
  F2): the card does not always show two scores or a reason, the *open Quotes* button is absent
  inside Quotes, and a row shows two numbers only under *prioritised* (`rowScores`).
- Nothing in [tooltips.md](../project/tooltips.md) changes: no new rule, no new mechanism.

## Tests

`tests/quote-hover-card.test.tsx`, red first (3 failed before the change, 14 pass after):

- on a scored and on an unscored quote, the card's first line under the label says what a quote is
  (the four claims, matched separately, and no *you*), and it holds a link whose `href` is
  `helpHref(modeAnchor("quotes"))`;
- the card stays open with the pointer on that link past the close delay, and closes when the link
  is followed.

## Done looks like

`npm run typecheck`, the touched suites and `tests/doc-links.test.ts` green; the full suite once at
the end; a real browser on the box showing the card on a quote in Citations mode at 1440 wide, light
and dark, and in a short window; GPT Sol's code review read and its findings checked.

## Deferred, by name

- **A card for the purple strip in the spine.** The strip is 2px wide and has no card of its own.
  The spine's band card could say "3 quotes in this section". Not built: the report asks what quotes
  *are*, and the fills answer that where the reader is reading. Its own queue entry.
- **A tap opening the card on a touch screen.** Already queued as `qi-hrr5p2qn`; until it lands,
  this explanation reaches pointer users only, and a phone reader still has the bar's card and the
  Quotes band's corner (i).
- **What each score measures, printed in the card** (above). Not queued: nobody has asked for it.

## A question for Greg, not blocking

**Is 900ms too long to wait for this card?** A quote's card opens after the pointer has rested on it
for 900ms; a glossary term's opens after 320ms. The longer wait was chosen on 2026-10-02 because a
quote is often a whole paragraph the reader's pointer is resting in while they read, so a quick card
would keep popping up over the text. The cost is that a reader may never discover the card exists,
and this report (asking for a tooltip where one already is) is a little evidence of that. Shortening
it gives discoverability and costs cards appearing unasked over long quotes. Left at 900ms here; a
queue entry marked as needing Greg carries the question.

## Reviews

- **Plan review, GPT Sol**:
  [prompt](261006j-quote-card-says-what-a-quote-is-plan-review-prompt.md),
  [answer](261006j-quote-card-says-what-a-quote-is-plan-review-sol.md). Exit 0, verdict
  *do not build*, on two established P1s, both about sentences rather than the design, and both
  taken with its replacement wording, so it was built without a second plan round:
  - F1 (P1) "a line" is false, the prompt says a quote is a passage. **Taken.**
  - F2 (P1) Help's existing sentences about the card and the rows are false for an unscored quote,
    inside Quotes, and outside *prioritised*. **Taken**, checked against `rowScores` and `QuoteCard`.
  - F3 (P2) the simplest adequate option, the sentence alone, was not weighed. **Taken**: the two
    score captions are dropped.
  - F4 (P2) tests should cover the unscored arm and that the link closes the card. **Taken**, except
    a half-scored fixture, which tests behaviour this change does not touch.
  - F5 (P2) the card has no height cap and can be stacked. **Answered by F3** (three lines, not
    five) and a short-window case in the browser check.
  - F6 (P2), F7 (P3) the table and two sentences in this plan overstated. **Corrected above.**
- **Code review, GPT Sol**: (to be filled in)

## What landed

(to be filled in)
