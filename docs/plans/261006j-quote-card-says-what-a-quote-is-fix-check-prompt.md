# Fix check: F8 only — the sentence about the purple, on a scored quote only

A narrow second pass. Discovery is closed; this checks one repair that was not in your snapshot.
**The tree is read-only: do not change any file**, and do not mutate source even temporarily (a
browser check is reading the same tree).

## The candidate

Committed: `6cee2c751`, on top of `48b835bb5` (which you reviewed). `git show 6cee2c751`.
Your own fixes for F9–F13 are in it unchanged; look only at what differs from what you left for F8:

- `src/web/ProseHoverCard.tsx` — `QUOTE_CARD_SAYS` is now the definition alone; a new
  `QUOTE_CARD_PURPLE` (*"Stronger purple means a higher Importance or Striking score."*) is appended
  only when `scores.length > 0`. The two JSDoc blocks were also moved above `QuoteCard`'s own.
- `tests/quote-hover-card.test.tsx` — the scored fixture must carry the purple sentence; the
  unscored one must not mention purple or scoring in that paragraph.
- the plan, § The change and § Reviews.

## Your finding, verbatim

> **F8 — P1 — established:** An unscored quote said both “the higher it scored” and “Not scored.”
> The card now says scored quotes use their higher available score, while unscored quotes use the
> lightest purple.

Disposition: taken, with a different repair, because your sentence was 29 words on every card. Mine
says less: nothing about the purple on an unscored quote.

## The question, and its floor

Is this statement accurate: *on every `Quote` that can reach `QuoteCard`, each sentence the
paragraph draws is true of that quote* — scored on both axes, scored on one, unscored? In
particular, is *"Stronger purple means a higher Importance or Striking score."* true of a quote
with only one score, given `priorityOf`, `quoteTier` and `quoteAlpha` in `src/web/QuotesPanel.tsx`?
And does the test fail if the purple sentence is drawn on the unscored fixture? (Reason about that
from the test's text; do not edit to try it.)

You may run `npx vitest run tests/quote-hover-card.test.tsx`.

Answer with: F8 **closed** or **still open** (and, if open, what establishes it and the smallest
fix). Anything else you notice goes in one short list at the end, marked as outside this check.
End with `VERDICT: F8 closed` or `VERDICT: F8 still open`.
