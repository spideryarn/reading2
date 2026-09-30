# Shelf topics are coloured by which articles they share

**[SPIDERYARN-READING2-5N](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-5N)** · from an
admin (Greg), on `/` signed in · kind: suggestion. The time in the file name is when this session
picked the report up, not Sentry's First Seen, which this session could not read (no Sentry sign-in
on this account).

> Well, the topic pills on the homepage, the logged-in homepage, there's, we colour them, and my
> guess is that we colour them randomly. It strikes me that it would actually be great if they were
> coloured semantically somehow. […] Then you would naturally find that similar topics would get
> similar colours, and it would be easier to see which topics are related and which stand out. […]
> Use your judgment. Try to avoid something too, too complicated or expensive. It's not worth it.
>
> Follow-up thought. It just occurred to me we have an obvious clue. We could look at the
> correlations. So you can imagine a pairwise correlation or distance matrix between all of the
> different topics in terms of which articles they occur frequently in somehow […] if we can do this
> without resorting to calling AI providers for something as trivial as this, it would be nice.

**Ending: Shipped** — on `dev`, not deployed. Resolve 5N; the next feedback sweep does the Sentry
status write.

What we did: the colours were not random but keyed to each topic's rank, so they meant nothing. Now
topics that pick out the same articles get neighbouring hues, and a topic that shares nothing with the
rest gets a hue of its own.

- Each topic's colour comes from a new 32-step red-to-violet colour scale, all at the same
  brightness.
- It is worked out in the browser from data the shelf already has. There is no model call, and
  nothing is stored.
- It follows your follow-up (overlap between the articles each topic picks out). The one change is
  how the topics are put in a line. The first plan used MDS, and GPT Sol showed that it squashes
  unrelated topics onto a handful of colours, so a simple clustering order replaced it.
- A colour does not change when you click a topic or search.

On a local shelf of 38 articles, *neural activity*, *information* and *signals* came out in
neighbouring greens, and *AI* and *kids* at opposite ends.

Plan: [260930b](../plans/260930b-shelf-topic-colours-by-relatedness.md).
