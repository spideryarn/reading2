---
reports: spya-mcsgxu
ending: shipped
---
# The Glossary's kind labels — `concept`, `work` — are distracting

[SPIDERYARN-READING2-4H](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-4H) (2026-09-29
00:45 UTC), from an admin, in production, build `cba650a3`, in Glossary on
`arxiv-2212-spya-u5293w` (overseer queue `qi-m2k852dt`, batched with `-4G`).

> In Glossary mode, we have a bunch of labels, e.g. `concept`, `work`. There don't seem to be many of
> them. And what is "work" anyway.
>
> Perhaps we can just get rid of these? Or at least replace them with icons with explanatory
> tooltips to reduce the amount of distracting text.

**Ending: Shipped** — on `dev`, not deployed. Resolve 4H (this session runs on the pool account,
with no Sentry sign-in, so the next feedback sweep does the status write).

What we did: the words became small faint icons with a tooltip each — a person, a place, an
organisation, an event, or a work (*"a book, paper, film, law or other named piece of work"*) — in
the panel and in the prose hover card. `concept` lost its mark entirely, because the prompt never
says how a concept differs from a term. `kind` is still stored, so nothing is lost.
[260929a-compact-glossary-header-and-kind-icons.md](../plans/260929a-compact-glossary-header-and-kind-icons.md).

**Reaches:** every glossary at once; nothing is regenerated.
