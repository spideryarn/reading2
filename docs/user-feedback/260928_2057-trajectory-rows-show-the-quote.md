# Trajectory's rows should show the quote, not a quotation mark

[SPIDERYARN-READING2-48](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-48) (2026-09-28
20:57 UTC), from an admin, in production, build `cba650a3`, in Trajectory at *Most* on
`arxiv-2508-spya-wrzxkg` (overseer queue `qi-q6ragxe5`).

> When including Quotes in Trajectory mode, include summarised and/or truncated version (with tooltip
> for full version) of the quote itself in the left-hand column, not just the double-quotes symbol

**Ending: Shipped** — on `dev`, not deployed. Resolve 48 (this session runs on the pool account,
with no Sentry sign-in, so the next feedback sweep does the status write).

What we did: the "double-quotes symbol" was the `〃` ditto mark a row drew when its section repeated
the row above's, and at *Most* that was most rows. Every row now shows the quote's own words, cut
at about 100 characters with the whole of them in a tooltip; the current row shows them whole,
which is also what a tap reaches on touch. The ditto is gone. We took the *truncated* half of
"summarised and/or truncated": a model-written summary of each quote is deferred, with the reason,
in [260928e-trajectory-rows-show-the-quote-words.md](../plans/260928e-trajectory-rows-show-the-quote-words.md).

**Reaches:** every existing route at once. Nothing is regenerated; the words are the stored Quotes.
