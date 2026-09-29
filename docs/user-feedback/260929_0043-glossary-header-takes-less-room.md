# The top of the Glossary band takes up too much room on a phone

[SPIDERYARN-READING2-4G](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-4G) (2026-09-29
00:43 UTC), from an admin, in production, build `cba650a3`, in Glossary on
`arxiv-2212-spya-u5293w` (overseer queue `qi-m2k852dt`, batched with `-4H`).

> The Glossary stuff at the top takes up too much space (e.g. on a phone) - for example, remove
> "Finds the words in this article and explains the passage. Not added to the list" text.
>
> And maybe move the "N words" onto the `order` row somehow - actually maybe we already show the "of
> N" so we don't need it.
>
> Perhaps hide "written for you" as a tooltip on something or just an icon.
>
> And get rid of the "order" text at the beginning of it.

**Ending: Shipped** — on `dev`, not deployed. Resolve 4G (this session runs on the pool account,
with no Sentry sign-in, so the next feedback sweep does the status write).

What we did: the hint line under Look up is gone (its "not added to the list" is in the button's
tooltip); the "order" word is gone; the head row is gone whenever the sort row is drawn, with the
count and the profile badge moved to the sort row's right-hand end — the count only outside
*prioritised*, where the threshold row already says *n of m*; and Glossary's badge is an icon, whose
panel now says in words which profile the list was written for. The other modes keep the worded
badge. [260929a-compact-glossary-header-and-kind-icons.md](../plans/260929a-compact-glossary-header-and-kind-icons.md).

**Reaches:** every glossary at once; nothing is regenerated.
