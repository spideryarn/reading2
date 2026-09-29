# Trajectory's deeper passes stop showing the snippets you have just read

[SPIDERYARN-READING2-4P](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-4P) (2026-09-29,
at or before 01:07 UTC — the time the overseer queued it as `qi-amm7ytak`; this pool-account
session cannot read Sentry's First Seen, so the sweep should rename the note if it differs), a
suggestion from an admin (Greg), in production, build `cba650a3`, in Trajectory at More on
`arxiv-2212-spya-u5293w`.

> In Trajectory mode, it's a bit annoying for the more detailed levels of granularity to reuse the same snippets as the coarser levels if I've just read the coarser level. So I wonder if we should say that the more detailed levels have to us different snippets, and perhaps longer snippets? At the same time, I suppose it's possible that a user might jump straight to the more detailed levels... but I suspect they won't. Hmm. Or maybe the coarser levels make more use of Summary or Glossary, and the more detailed levels make more use of Quotes and Ideas? Dunno, I'm not at all sure that that will make things better or be a good blanket rule. The main thing is to ensure that there's diversity within levels, and perhaps ideally between them.

**Ending: Shipped** — on `dev`. The next feedback sweep does the Sentry status write.

- **Measured first**: on the six local routes, 43% of the More walk and 46% of the Most walk were
  stops already walked at a shallower pass, because the passes contained one another. Within Gist
  and More, stops rarely shared an idea (one pair each).
- **What changed**: More now walks only the stops More adds, and Most only the ones Most adds. No
  prompt change, nothing re-planned, nothing spent.
- **Deferred**, with reasons in the plan: longer snippets at deeper levels, Summary or Glossary
  stops at the coarser levels, and variety within Most (which is every quote, so its runs come
  from Quotes).

Plan: [260929e](../plans/260929e-trajectory-each-pass-walks-only-its-new-stops.md).
