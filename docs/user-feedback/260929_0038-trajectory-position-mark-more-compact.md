---
reports: spya-qx08ep
ending: shipped
---
# Trajectory's "where in the article" mark took too much width

[SPIDERYARN-READING2-4D](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-4D) (2026-09-29
00:38 UTC), from an admin (Greg), in production, build `cba650a3`, in Trajectory on
`arxiv-2212-spya-u5293w` (overseer queue `qi-hmsgxajb`, batched with 4K, 4M and 4N).

> In Trajectory mode, I like that we now have a visual indicator of where in the article it's from.
> But that visual indicator takes up too much horizontal space, especially on a narrow screen. Can
> we make it more compact (e.g. if it was a vertical instead of horizontal line, or if it came at
> the end of the block's text/title so it didn't need dedicated space of its own, or something else
> that you think looks good (try to take a screenshot to make sure you have a sense of what things
> look like).

**Ending: Shipped** — on `dev`, not deployed. Resolve 4D (this session runs on the pool account,
with no Sentry sign-in, so the next feedback sweep does the status write).

What we did: took the first of your suggestions. The mark is now a short **vertical** hairline under
each row's number, with the dot on it — the top of the line is the start of the article and the
bottom its end, the way the spine already draws the article. It lives in the number's column, which
was there anyway, so it costs no width; the horizontal track had a column of its own, about 53px of
a band that can be 280px wide. The current stop's dot is still in the accent, and a screen reader
still hears "about 70% of the way through". Screenshots before and after, at desktop and phone
widths, are in the plan,
[260929a](../plans/260929a-trajectory-opens-on-stop-one-two-end-of-pass-doors-centred-jumps-compact-position.md)
§ 4.

**Reaches:** every route at once; nothing is regenerated.
