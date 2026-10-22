---
reports: spya-gdbsq2
ending: shipped
comment: Shipped: a Cites line in Marginalia now shows the same card a citation in the text does, buttons and all, and a cut-off line's card shows its whole words. Named in the plan, not built: a count line's card listing its items.
---
# Marginalia's tooltips reuse the prose's citation card

`spya-gdbsq2` (#623, suggestion, Sentry SPIDERYARN-READING2-KG), from Greg (admin;
`feedback-reporter.ts` on the production row, no addenda). Filed 2026-10-19 17:34 UTC, build
`cb956387`, on `tinbergen1963onethology-spya-ks84se` with `margin=1`. Queue item `qi-bwpg8743`.
This session ran on an account with no Sentry sign-in and did not write the Sentry status; the next
sweep does.

> The Marginalia mode tooltip for a citation is pretty unhelpful. It's just a kind of generic
> message. I feel like we have more information than that for a citation if I hover over it in the
> text. So let's try and reuse that same tooltip. And the same goes for other stuff in the Marginalia
> mode - their tooltips should be the best we can make them, and ideally reuse what tooltip
> machinery we already have for that kind of marginalia-annotation.

**Ending: shipped** on `dev`, simplest version first. Plan
[261020g](../plans/261020g-marginalia-tooltips-reuse-the-prose-citation-card-and-say-the-item.md),
with both GPT Sol reviews (six plan findings, five code findings, all taken).

- **The citation.** Pointing at or tabbing to a *Cites* line shows `CiteCard`, the card a citation
  in the prose shows, with *Ask in chat*, *Does it say that?*, *Open in Sources* and a jump to each
  citing paragraph. It stays shut while the line is pressed open, and a finger's tap opens the line
  as before. Checked in a browser: the margin's card and the prose mark's card had identical text
  and buttons.
- **The rest.** No other kind of margin item has a card in the prose to reuse (tooltips.md's table),
  so each keeps its house card, which now also shows **the item's full words when its line is cut
  off** by the ellipsis, in their writer's typeface. Unit-tested; no local article had such a line
  to check in a browser.
- **Named, not built** (plan § Deferred): a count line's card ("3 questions") listing its items, and
  a press on *Cites* opening the card instead of the panel.
