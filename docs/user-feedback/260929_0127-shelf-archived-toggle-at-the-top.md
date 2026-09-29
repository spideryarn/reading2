# Shelf: the archived toggle belongs at the top, beside Unread

[SPIDERYARN-READING2-4V](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-4V) (2026-09-29
01:27 UTC), from Greg, in production, build `cba650a3`, on `/?archived=1&topics=neural+network`.

> On the Homepage Shelf, we have a "Show/hide archived" toggle at the very bottom.
>
> I think it would be better if it was a (default-hide-archived) toggle at the top (like for
> "Unread"), so that it's easy to show some/all (so we can use the faceted-search-topic-pills and/or
> sort to look through the Archived articles easily too).

**Ending: Shipped** — on `dev`, not deployed at the time of writing. The Overseer resolves the
Sentry issue from the debrief.

What we did: an **Archived** chip beside **Unread**, off by default. When on, archived articles join
the one list, so the sort, the search, Unread and the topics all work across them; each is marked
*Archived* and offers **Put back**. The section at the foot is gone. Plan:
[260929a](../plans/260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle.md).
