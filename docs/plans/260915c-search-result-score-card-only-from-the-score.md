# A search result's card opens from its score, not from the row

Sentry `SPIDERYARN-READING2-3T`, 2026-09-12 10:48Z, from an admin (Greg), so trusted input. Overseer
queue item `qi-8qx67emk`.

**Status as of 2026-09-15: built in `4b512dae`; review fixes and final checks are recorded below.**

> When I click on an entry, like one of the Search results, it shows me a rich explanatory tooltip
> that doesn't seem to go away, and it's just too intrusive. I think it should only show that rich
> tooltip (that explains what the bar and the score is) if I click on the bar and the score, not on
> the entry itself, because I want to be able to click on the entry to be taken to that place in
> the text.
>
> — Greg, 2026-09-12

## What is happening

`Hit` in [`SearchPanel.tsx`](../../src/web/SearchPanel.tsx) wraps the **whole row button** in a
`Tooltip`. That tooltip opens on hover *and* on focus (`useFocus` in
[`Tooltip.tsx`](../../src/web/Tooltip.tsx)), so a click opens it in two ways at once: the pointer
entering the row, and the button taking focus on `mousedown`. The click does jump to the passage, but
the card, placed to the right of the row, lands over the prose the jump just scrolled to. It stays
there while the pointer rests on the row, and on a touch screen, where no `mouseleave` comes until
you tap something else, it stays indefinitely.

[search.md § What the number means](../project/search.md#what-the-number-means-which-printing-it-does-not-say)
chose this on purpose on 2026-08-26: *"The card opens wherever on the row you are hovering, the
number included."* Greg's report reverses that choice, and this plan writes the reversal in.

## The other rows that draw a score

The sweep asked for a check of the other modes that share the ranked-entry row. Glossary, Quotes and
Citations all draw their scores through [`ScoreBars.tsx`](../../src/web/ScoreBars.tsx), and its
`Tooltip` is on the bars' own `<span>` rather than on the row. Pressing a glossary term or a quote
therefore opens no card, and the `span` is not focusable, so focusing the row opens none either.
They already behave the way Greg is asking for. Ideas, Timeline and Claims have no card on a row.
**Search is the only row that has the problem.** One regression test pins the `ScoreBars` shape, so
that nobody later "fixes" it by moving that card up onto the row too.

## The change

1. **The gutter becomes its own button, beside the row's button and not inside it.** The gutter is the
   left-hand column holding the hue dot, the confidence number and the place bar. The `<li>` becomes
   the flex row, and it carries the row's box, its hue edge and its *open* state, because to the eye
   the two buttons are still one row. The words button keeps `.srch-hit-btn` and still jumps; pressing
   it opens nothing. (The first draft had a `<span>` with an `onClick` and `stopPropagation()`
   inside the one row button. GPT Sol's plan review turned that down: it breaks two lint rules, and
   it leaves a second action that only a pointer can reach, inside a button whose accessible action
   is still *jump*.)
2. **A press on the gutter shows the card and does not jump.** This is Greg's rule in full: the score
   explains and the entry navigates. Hovering the gutter or focusing it opens the card as well, so
   the card keeps a keyboard route. The gutter's `aria-label` spells out everything it draws (which
   search found it, the confidence, how far in), and the marks inside it are `aria-hidden` so a
   screen reader hears that once.
3. **The tooltip is controlled** (the `open` / `onOpenChange` arm of `Tooltip`), and a press on the
   gutter *sets* it open rather than toggling it. That is the same shape as the quotes row's ⓘ, for
   the same reason: a touch screen has nothing to hover with, so without a click route the card
   would not exist there. Being controlled also turns on `mouseOnly`, so a tap's synthesised
   `mouseenter` cannot open the card on its way to becoming a jump. It is *open*, not *toggle*, because
   a mouse pointer hovers before it clicks: by the time the click lands the card is usually already
   open, and a toggle would shut it. It closes the way every card here does — the pointer leaving,
   Escape, or a press anywhere else (`useDismiss`).
4. **The two buttons tile the row with no gap between them**, so no part of it is dead. The gutter is
   as tall as the row (`align-self: stretch`; the marks stay at the top because the column is
   `justify-content: flex-start`), and it gets `cursor: help`. The target grows from about 1.5rem
   high to the full row, and a mouse reader sees before pressing that this part explains rather
   than goes somewhere. It does cost a second tab stop per row. `ScoreBars` argues against that for a
   decoration, but the gutter is now a second thing the row does, which is what a tab stop is for.
5. **The card's words do not change.** It still leads with the longer passage, then *found by*, the
   confidence explanation and *N% in*.

## Passed over

- **Drop the passage from the card, now that it hangs off the score.** The card would then be only
  about the numbers, which is how Greg describes it. Not done: he did not ask for it, `found.long`
  exists only for this card, and on a desktop the longer passage is still the one preview available
  before you press. It is a separate question for Greg if he wants it.
- **A clickable `<span>` inside the one row button**, which was this plan's first draft: no new tab
  stop and no re-laid CSS. Turned down in review (point 1 above).
- **Keep the card on the row but close it on click.** Only half of what Greg asked for: the card
  would still come up on every hover of every row, which is most of the intrusion.

## Tests

[`tests/search-hit-card-on-the-score.test.tsx`](../../tests/search-hit-card-on-the-score.test.tsx),
written red first against the current code:

- pressing the words (hover, focus and click, in the order a browser sends them) opens no card and
  jumps;
- focusing the row from the keyboard opens no card;
- hovering the gutter opens the card, with the confidence explanation in it;
- pressing the gutter shows the card and does not jump (hover first, so a toggle would fail it);
- focusing the gutter opens the card, and its name carries the numbers;
- a tap on the gutter with no hover before it (the touch route) opens the card;
- it closes when the pointer leaves, on Escape, on a press elsewhere, and when the reader then
  presses the words, which still jumps;
- **a real browser, with touch generated by the browser itself** (CDP `Input.dispatchTouchEvent`),
  because [touch.md](../project/touch.md) records 24 synthetic-event tests passing over a touch
  feature that never worked. It taps the score, then the words, then a tap elsewhere, and it taps the
  empty lower half of the gutter to show that the taller target is real;
- `ScoreBars` inside a row button: pressing the row opens no card, and hovering the bars does. This
  one is a pin rather than a reproduction, since it is green today.

## Results

- The reproduction test was red against the old code: five search-row cases failed because pressing
  the words opened the card, focusing the words opened it, the gutter opened nothing, and pressing
  the gutter jumped.
- Before review, the focused four-file run passed 38 tests, `npm run typecheck` exited 0, and Biome
  reported no findings in the two changed TSX files.
- In Chrome, both touch and mouse checks separated the actions: the words jumped without a card;
  the full-height gutter opened one without jumping; pointer leave and an outside press closed it.
  The touch checks used CDP touch events rather than synthetic DOM events.
- The code review found no P0/P1 implementation defect. It strengthened the tests around the two
  buttons' accessibility contract and around pointer-leave after a mouse press. Each of the four
  requested mutations made the focused test fail before it was restored.
- After review, the focused four-file run again passed 38 tests (exit 0), and Biome on the two TSX
  files exited 0. The sandbox refused `npm run typecheck` at tsx's local IPC socket (exit 1);
  `node --import tsx scripts/typecheck.ts`, the same script without that CLI socket, checked all four
  TypeScript projects successfully (exit 0). `npm test` was also attempted and stopped before the
  suites because this sandbox cannot connect to the local Postgres service (exit 1).
- Outside the reviewer's sandbox, on the reviewed tree: the same four files passed 38 tests (exit 0)
  and the real `npm run typecheck` exited 0.
