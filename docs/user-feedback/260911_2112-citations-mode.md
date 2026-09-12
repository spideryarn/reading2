# Citations mode — every work the piece cites, linked and prioritised

[SPIDERYARN-READING2-2Y](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2Y), report
`spya-xz7ajs`, 2026-09-11 21:12 UTC, `kind=suggestion`, from an admin, on
`temporal-context-reinstatement-spya-dhqkf9`:

> Add a Citations mode that looks at citations and looks at the bibliography and references and
> provides, you know, a link to all of them. And you can either order them by when they appear in the
> text, or how relevant they are, or how influential, or a prioritized score. (the default, with
> threshold bar, kinda like Glossary etc) It will need web search(es)

**Ending: Shipped** — on `dev`, behind the experimental switch, not deployed.

What we did: a new Citations mode — one model pass lists the works a piece cites, code verifies
where each is cited and takes each link from the article itself (DOI, arXiv, or the article's own
link; otherwise a Scholar search, labelled as one), four orders with Glossary's threshold bar
(prioritised the default), and a per-entry *Find it on the web* search. Deferred, and named in the
plan: Find more past 80 works, real citation counts for influence, marking citations in the prose,
visitors. [260911g-citations-mode.md](../plans/260911g-citations-mode.md).
