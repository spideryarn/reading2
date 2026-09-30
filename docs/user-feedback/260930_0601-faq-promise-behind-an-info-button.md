---
reports: spya-br6j7e
ending: shipped
---
# The FAQ's promise moves behind an (i)

[SPIDERYARN-READING2-62](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-62), from Greg
(admin), a suggestion filed on `/read/dongetal25-spya-vfmvmm?mode=faq&at=spya-vskg4b`. The time in
the file name is when this session picked the report up. The report text came in the brief.

> In FAQ mode, move this text "The quoted words are the article's own, checked against it. Which
> passage answers which question is the model's reading" into a tooltip, e.g. behind an `(i)` icon.

**Ending: Shipped.** It is on `dev` and not deployed. Resolve 62; the next feedback sweep does the
Sentry status write, because this session ran on a pool account with no Sentry sign-in.

What we did:

- The two sentences are no longer on the page. They are the tooltip of a small **(i)** button,
  *About these passages*, at the right-hand end of the row of order buttons. Hover, keyboard focus
  or a tap opens it. The words are unchanged.
- The line that counts what checking left out went into the same tooltip, since it is a footnote
  to the first sentence.
- The band's foot now shows only a running job. A list with no scores (made before `faq/4`) has no
  order buttons, so its row holds just the (i).
- It is the same move Trajectory made for [52](260929_0149-trajectory-promise-into-a-tooltip.md).

Batched with [67](260930_0602-faq-sort-by-most-central-and-hardest.md). Plan:
[260930d](../plans/260930d-faq-provenance-into-a-tooltip-and-sort-by-centrality-and-difficulty.md).
