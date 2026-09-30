# The FAQ sorts by most central and by hardest

[SPIDERYARN-READING2-67](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-67), from Greg
(admin), a suggestion filed on `/read/dongetal25-spya-vfmvmm?mode=faq`. The time in the file name is
when this session picked the report up. The report text came in the brief.

> In FAQ mode, we now have "prioritised" and "in order" ordering. Great. But the prioritisation must
> be based on some dimension (or more than one). Let's also make it possible to sort by that too
> (just as in Glossary we can sort by "hardest", "most central" etc, as well as by "prioritised"

**Ending: Shipped.** It is on `dev` and not deployed. Resolve 67; the next feedback sweep does the
Sentry status write, because this session ran on a pool account with no Sentry sign-in.

The prioritised order is built from two scores, and every question made since `faq/4` already
stores both: **centrality** and **difficulty**. It ranks by `centrality × (1 − difficulty)`. So this
was a change to the page only. No prompt change, no re-run and no model cost.

What we did:

- Two more order buttons, named as the Glossary names them: **most central** and **hardest**. The
  row now reads *prioritised · reading order · most central · hardest*.
- They work like the Glossary's. Every question is shown, with no threshold. The highest score comes
  first, and a question the model did not score goes last. Each row shows only the one score it was
  sorted by.
- **Hardest first, not easiest first.** The prioritised order already starts with the approachable
  questions, so easiest first would mostly repeat it. Hardest first shows the dense questions that
  the default pushes down. If you meant the other way round, it is a one-line change.
- A button only appears when some question has its score, and a single question gets no buttons.
  The URL is `?faqby=centrality` or `?faqby=difficulty`.

Batched with [62](260930_0601-faq-promise-behind-an-info-button.md). Plan:
[260930d](../plans/260930d-faq-provenance-into-a-tooltip-and-sort-by-centrality-and-difficulty.md).
