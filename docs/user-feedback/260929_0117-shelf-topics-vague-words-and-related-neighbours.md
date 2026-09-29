# Shelf topics: vague words, and two related topics side by side

[SPIDERYARN-READING2-4T](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-4T) (2026-09-29
01:17 UTC), from Greg, in production, build `cba650a3`, on `/?topicsView=detail`.

> The new faceted-text-pills on the Homepage Shelf for filtering articles are working better.
>
> But I noticed that it listed "neural networks" and "neural activity" as the first two. That's not
> necessarily bad - they are distinct. And I think I'd already requested that you look at the
> correlation in which articles the terms pick out and avoid (near-consecutive) terms that match too
> many overlapping articles. I suppose we could also have a bias against overlapping words?
>
> The other thing I noticed is that it suggested words like "following" and "entered", which seem
> pretty vague and as a user I can't imagine wanting to filter by them. I was going to say something
> like "they're too common" - but that said, other common words (like "rat") might be good for
> picking out animal neuroscience articles. Are we using something like TF/IDF (or maybe there's a
> better algorithm now) to require that words that are common in English need to be
> frequently-occurring in order to count? Or even a measure of "concreteness" (preferable), or even
> preferring proper nouns or noun phrases adjectives or something like that? Dunno, maybe that's too
> crude.
>
> Minor tweaks might be sufficient - it's not working terribly as things stand.

**Ending: Shipped** — on `dev`, not deployed at the time of writing. The Overseer resolves the
Sentry issue from the debrief.

What we did: a single word that the Glasgow Norms rate as abstract (concreteness, as he preferred)
now counts for an article only where the article uses it heavily — his "common words need to be
frequently-occurring" — so *following* (via *follow*) in passing makes no topic, while concrete *rat*
and words the norms do not rate (technical terms, names) are unaffected. The Glasgow Norms were
chosen for their licence (CC BY 4.0): the larger Brysbaert concreteness list carries none, and a
SUBTLEX-US frequency list was built, then withdrawn when the review found its permission did not
cover us. A topic sharing a word with the chip before it no
longer comes next when another reaches as many new articles. *Entered* could not be reproduced as a
single word (the existing rules already reject it); it most likely arrived inside a phrase, and
phrases are deliberately left alone. Details, numbers and the licence decision:
[260929a](../plans/260929a-shelf-topics-round-three-concreteness-zero-pills-archived-toggle.md).
