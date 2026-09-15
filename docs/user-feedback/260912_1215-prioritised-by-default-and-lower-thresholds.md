# Search opens prioritised, and every prioritised bar lets most entries in

**[SPIDERYARN-READING2-3S](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3S)** · reported
2026-09-12 10:46 UTC and
**[SPIDERYARN-READING2-3Z](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3Z)** · reported
2026-09-12 12:15 UTC · kind: suggestion · from an admin (Greg) · *shipped*

## What the reader said

> Make prioritized the default submode for search.

> We have a few different modes that involve a prioritized submode with a kind of thresholding.
> Let's set the threshold lower, i.e. more permissive, so that for all of these different modes,
> most of the entries are coming in by default.

Build `d358f773`. Both links he was on had bars he had dragged down by hand (`gate=0.00`,
`bar=0.30`; `gate=0.00`, `bar=0.00`).

## What we found

Four modes have a prioritised order with a threshold slider: Glossary, Quotes, Search and
Citations. Debate has a slider too, but it isn't a prioritised order — it decides whether a page is
about this article at all — so it was left alone. There was no single place the four starting
positions lived, because each is on a different scale.

Measured on the articles on our dev database, the old starting positions showed about a third of a
glossary, about half of a quote list, and just under half of a citation list.

## What we did

**Shipped on `dev`:**

- Search now opens on *prioritised*. A link that says `order=document` still shows everything in
  place order.
- The bars start lower: glossary 0.30 → **0.10**, quotes 0.80 → **0.60**, citations 0.40 →
  **0.25**, search confidence 50 → **30**. On the dev articles that puts roughly 85–90% of a typical
  list on screen by default and still hides the weakest few. Search is set lower still, because it's
  the one that just became the default: at 30 it hides nothing on the searches we have.
- The heavy underline on quotes in the article still starts at 0.80, so heavy and light still look
  different when you first open a piece.

Two side effects we accepted: an old search link with no `order=` in it now opens prioritised, and
if that link also carried a dragged bar (`conf=`), the bar now applies.

The numbers come from our dev copy of the articles, not production. If they feel off on real
articles, the slider is one drag, and the plan says how to re-measure:
[260915d](../plans/260915d-prioritised-by-default-in-search-and-lower-default-thresholds-everywhere.md).

**Not yet on production**, which is Greg's to deploy.
