# Summaries and the glossary should explain the jargon, in simpler words

[SPIDERYARN-READING2-44](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-44) (2026-09-26
02:38 UTC, `kind=suggestion`), from an admin, in production, build `3a556849`, in the glossary on
`bf03197835-spya-qfwsw2` (overseer queue `qi-qpsx92kg`).

> we want the summaries to really use simpler language, because half the problem is we may not know
> what the jargon means, and the glossary as well especially should explain in simpler language.

**Ending: Shipped** — on `dev`, not deployed. Resolve 44.

What we did: the rule both prompts had since 2026-09-03 kept "the article's own words for the things
it names", which exempted every piece of jargon. Summary lines now keep the author's term only as a
handhold and must make the sentence understandable without already knowing it. Glossary entries are
written for a reader from outside the field: the plain meaning first, and no second hard word. Both
say plainer must not mean vaguer. On three jargon-heavy local articles, a blind, shuffled
side-by-side found the new lines plainer in 70 of 91 pairs (the old prompt against itself: 55–46),
with fidelity problems as rare on each side. The cost is named in the plan: depth-1 summary lines run
past their 25-word limit more often.
[260926a-plainer-summaries-and-glossary.md](../plans/260926a-plainer-summaries-and-glossary.md).

**Reaches:** summaries on newly added articles only (existing trees keep their lines until their
stage is re-run). Every owner's existing glossary shows a *written by a different version* banner
with *Find them again*.

**Left for Greg:** the same change for chat, Explain and the glossary's *Check the web* answer, which
share the older wording; and whether a depth-1 line of 28 plain words is better than one of 24 dense
ones.
