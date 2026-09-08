# The monkeys illustration doesn't load

**[SPIDERYARN-READING2-2B](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2B)** · reported
2026-09-07 07:35 UTC · kind: problem · *shipped*

## What the reader said

> The illustration of the smoking & drinking monkeys doesn't load/show

## What we did

It is the article's own figure, not a generated plate — the block's caption is *"David Teniers the
Younger (–1690), Smoking and drinking monkeys, c. 1660, oil on panel."*

The article's publisher, `asteriskmag.com`, wraps each figure in a `<picture>` whose first child is
an AVIF `<source>` — and serves those `.avif` files as `content-type: text/plain` with
`x-content-type-options: nosniff`. Chrome's opaque-response blocking refuses them outright
(`net::ERR_BLOCKED_BY_ORB`), and `<picture>` has no way back to the working PNG in the `<img>`
beneath. Production was running `84521f3b` at the time, which still hot-linked the article's own
images, so that is what the reader got: a blank box, and nothing of ours to log.

**The reported symptom was already cured.** Stage E (`5f79493b`, committed 38 minutes after the build
the reader was on, and about fourteen hours before the report) serves the figure from us and deletes
the `<source>` elements on the way past. It reached production later on 2026-09-07, *after* the
report, and the log shows all three of this article's images served `200` from `/api/asset/…` at
17:31. Reproduced locally on the same source URL — same 97 blocks, same three manifest hashes — and
checked by looking: the figure draws, under its caption.

**One real fix did land here**, found by GPT Sol reviewing the plan. Holding a copy is not enough: if
*delivery* fails, the second draw restores the publisher's markup verbatim — and that restores the
unusable `<source>` with it, so the figure stays blank for the rest of the read. `ImagePlacement`
gains an `unverified` case that keeps the publisher's `src` — the one URL we actually fetched — and
drops every candidate we never checked: the `<source>` elements, and the `<img>`'s own `srcset` and
`sizes`. Sol's second review caught that the first version of this fix kept the `srcset`, which was
the same bug one level down: with `w` descriptors a `srcset` replaces the `src` rather than ranking
above it, so a broken candidate has nothing to fall back to.

The `<picture>` guard had also been written against a synthetic fixture, because the corpus had no
`<picture>` in it; this article is the first real one, and it is now a fixture in
`tests/rehost.test.ts` alongside the synthetic one.

**Two things left for Greg**, both in the plan doc: the `src` we store is this publisher's 300 px
thumbnail while the `srcset` we throw away ran to 1920, so the ⤢ has nothing to enlarge; and an image
we hold **no** copy of is still exposed to the same trick, for which the right answer is an
`error`-driven retry that needs its own plan.

[The plan](../plans/260908a-the-monkeys-illustration-did-not-load.md);
[article-images.md § And a fourth reason](../project/article-images.md#and-a-fourth-reason-found-by-a-reader-rather-than-reasoned-out)
is the doc.
