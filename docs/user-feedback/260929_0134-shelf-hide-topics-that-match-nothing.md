# Shelf: once a topic is picked, hide the topics that would match nothing

[SPIDERYARN-READING2-4Y](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-4Y) (2026-09-29
01:34 UTC), from Greg, in production, build `cba650a3`, on
`/?topics=neural+network,language+model`.

> On the Homepage Shelf, if I pick one of the faceted-search-topic-pills, it should hide (or shunt to
> the right) any topic-pills that match 0 of the filtered articles on the shelf, i.e. so it's easier
> to pick a topic-pill and then immediately see which other topic-pills will help filter further
> (and not be distracted by topic pills that will lead to empty results).

**Ending: Shipped** — on `dev`, not deployed at the time of writing. The Overseer resolves the
Sentry issue from the debrief.

What we did: hidden rather than shunted. A topic that matches nothing in the current view is no
longer drawn, in the pill row or the detail view; a topic you have chosen always stays so you can
remove it; and the first twelve are counted after the hiding, so the row refills rather than leaving
gaps. Plan:
[260929a](../plans/260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle.md).
