---
reports: spya-yd2c47, spya-mtyquy
ending: shipped
---
# Quotes in the spine, a card on each quote, and previous / next

Two suggestions from Greg (admin; `scripts/feedback-reporter.ts` exited 0 on both), reached through
Overseer queue item `qi-seg5mayh`.

Report `spya-yd2c47`, 2026-09-10, on `https://www.spideryarn.com/changelog#release-75`:

> Perhaps show Quotes in the spine (use the same colour we use for their outline-border)

Report `spya-mtyquy`, 2026-09-11, on an article in Diagram mode:

> For the highlighted-Quotes shown in the text (with an outline-border), tooltip to show our
> quantitative scores and perhaps Previous/Next icon-buttons to jump to the next Quote, and a button
> to open Quotes mode.
>
> And in Quotes mode, add fairly big Previous/Next icon-buttons to jump around, and use left/right to
> navigate between quotes.

**Ending: Shipped**, on `dev`. Plan
[261002h](../plans/261002h-quotes-in-the-spine-a-card-on-each-quote-and-previous-next.md), reviewed
by GPT Sol before and after the build.

What changed:

- **The spine** has a green strip down its left edge wherever there is a quote, in every mode, in
  the outline's colour and faded the same way. Quotes no longer appear as a search-coloured lane in
  Quotes or Skim mode.
- **Resting the pointer on an outlined quote** opens a card: both scores with their numbers, why it
  was chosen, ‹ › to the quote before or after it down the page, and *open in Quotes*. It waits a
  little longer than a glossary word's card (900ms), because the pointer often rests in a quote
  while you read it.
- **In Quotes mode**, big ‹ › buttons under the list and ← / → step through the quotes in the
  list's order; the selected row scrolls into view.

Left for later, by name: on a touch screen a tap on a quote still selects its paragraph rather than
opening the card — queued for Greg as its own item, since it trades one gesture for the other.
