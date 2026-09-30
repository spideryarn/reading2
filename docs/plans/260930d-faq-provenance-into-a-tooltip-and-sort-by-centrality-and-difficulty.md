# FAQ: the provenance line into an (i) tooltip, and sorts by the two scores behind "prioritised"

Two admin suggestions on FAQ mode, from the same article (`dongetal25-spya-vfmvmm`), batched.

[SPIDERYARN-READING2-62](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-62) — Greg:

> In FAQ mode, move this text "The quoted words are the article's own, checked against it. Which
> passage answers which question is the model's reading" into a tooltip, e.g. behind an `(i)` icon.

[SPIDERYARN-READING2-67](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-67) — Greg:

> In FAQ mode, we now have "prioritised" and "in order" ordering. Great. But the prioritisation must
> be based on some dimension (or more than one). Let's also make it possible to sort by that too
> (just as in Glossary we can sort by "hardest", "most central" etc, as well as by "prioritised"

Owner doc: [faq.md](../project/faq.md). The prioritised order came from
[260929g](260929g-faq-difficulty-centrality-and-a-threshold.md).

## What exists

- The promise (`FAQ_PROMISE`) is a line in the band's pinned foot, with the dropped-count line
  (`droppedNote`) under it and a job's progress beside them (`FaqPanel.tsx`).
- The prioritised order is `centrality × (1 − difficulty)`; **both scores are already stored on
  every `faq/4` question** (`FaqQuestion.difficulty`, `.centrality`). So 67 is a client change only:
  no prompt, no schema, no re-run, no model cost.
- Trajectory made exactly 62's move for SPIDERYARN-READING2-52: an `Info` button at the right of
  its head, a controlled `Tooltip` (hover, focus or tap), `.traj-about`. Quotes' *Why this one* is
  the same shape. Copy that.

## The change

**62.** The promise leaves the foot and becomes the card of a quiet `(i)` button — *About these
passages* — at the right-hand end of the order row, where the Glossary keeps its trailing slot.
The dropped-count line goes into the same card, since it is a footnote *to* the promise ("left out
in checking"), and a footnote alone in a pinned foot is the thing Greg asked to remove. The foot
then holds only a running job's progress, and is absent otherwise. For a pre-`faq/4` list, which
has no order buttons, the row is drawn with just the `(i)`. For an empty list (`FAQ_NONE`) there is
no `(i)`, as there is no promise today.

**67.** Two more orders, named as the Glossary names them:

| `?faqby=` | label | what |
|---|---|---|
| `prioritised` | prioritised | unchanged: the bar, `centrality × (1 − difficulty)` highest first |
| `document` | reading order | unchanged |
| `centrality` | most central | every question, highest centrality first |
| `difficulty` | hardest | every question, highest difficulty first |

As in the Glossary's `sortEntries`: **no bar** under the single-score orders (all questions shown,
the slider hidden), a missing score sorts last, ties keep reading order, and a row draws **only the
score it was placed by** (the Glossary's rule: a row shows the scores its position was decided on).
Each button is offered only when at least one question carries that score, as the Glossary does.
`FAQ_ORDERS` in `params.ts` gains the two values; its both-ways check keeps it and the type in step.

**`hardest`, not `most approachable`.** The prioritised order already puts approachable questions
first, so an "easiest first" sort would mostly repeat it. *Hardest first* is the view it does not
give — the deep objections the default buries — and it is the Glossary's word, which is what Greg
pointed at. Named here so it can be turned round in one line if he meant the other.

**`effectiveOrder`**: a URL asking for `centrality` or `difficulty` on a list that has no such
score (pre-`faq/4`) falls back to `document`, as `prioritised` already does — never a sort that
visibly does nothing.

## The simpler option passed over

Leaving the promise in the foot and adding a second, smaller `(i)` beside it — no. The request is to
take the text off the screen, and the Trajectory precedent is already the house shape.

For 67, only a `most central` sort (centrality is the dimension the bar leans on most) — rejected
because the compound is built from two, and Greg named both of the Glossary's.

## Tests

`tests/faq-order.test.ts`: `orderQuestions` for the two new orders — descending, unscored last,
ties by reading order, nothing hidden whatever the bar; `effectiveOrder` falls back for unscored
lists. `tests/faq-panel.test.tsx`: the promise is not in the page text until the `(i)` is opened
and is in the card after; the dropped note likewise; the buttons appear and push their order; a
row under `hardest` draws one bar, the difficulty one; no slider under the single-score orders.

## Docs

faq.md (the promise section and the order section), url-state.md (`faqby` values), a note per
report in `docs/user-feedback/`.

## Deferred

None of either request. Nothing sorts by the compound in reverse, and nothing gates the
single-score orders; the Glossary does neither.

## Progress

- [x] **Plan reviewed by GPT Sol** (`gpt-5.6-sol`, high, read-only; exit 0, answer file fresh).
  Verdict: approve with amendments, all taken —
  - F1 (P2) a single question gets no order buttons, as the Glossary offers no sort below two
    entries: `availableOrders` returns none for one question, and only the (i) is drawn.
  - F2 (P2) the tooltip tests now cover Trajectory's contract: tap opens and closes, focus opens,
    Escape and a press elsewhere close, the button sits outside the order group, no idle
    `.faq-foot`, no (i) on an empty list, a visitor gets the promise but never the owner-only
    dropped count, and a legacy list draws the (i) with no group.
  - F3 (P2) parser-level tests for `?faqby=` in `tests/url-state.test.ts`. `last-view.ts` needs no
    change: it already remembers `faqby` as an opaque value.
  - F4 (P3) stale "the foot says the promise" comments in `FaqPanel.tsx`, the panel test's header,
    `mode-catalog.ts` and `faq.css` updated; the catalog's `how` line names the new orders.
  - It agreed on *hardest* over *easiest*.
- [x] Built, tests and typecheck green
- [ ] Code reviewed by GPT Sol
- [ ] Browser check
- [ ] Docs and notes, pushed to dev
