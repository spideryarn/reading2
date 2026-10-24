---
reports: spya-htsjmf
ending: shipped
---
# A glossary term's underline fades each time it comes back

Report `spya-htsjmf` (#701, admin, 2026-10-24 17:19 UTC), on `arxiv-2308-08708-spya-xax6v4`.

> In this article, there's a few glossary terms that just show up over and over and over again.
> Consciousness is one. Indicator properties, I think, is another. And it gets quite distracting
> after a while to see the little orange dotted lines everywhere for the same word. I wonder if we
> could have some kind of function that drops off the prominence eventually towards zero after
> repeated examples of a given glossary term. So by the time consciousness has appeared five or ten
> times, it should basically not need an orange dotted line. Now it's possible someone skimmed to
> the bottom and is seeing it for the first time, but I think that's a pretty unlikely case, and we
> can accept that so it goes. I suppose one could be clever and take into account which bits
> they've read, but I think it's worth it. So in other words, you know, maybe the first, I don't
> know, half dozen examples get an orange dotted line, which fades according to a function you
> choose. And, you know, maybe even half dozen is too many, so maybe it should be a smooth function.

**Shipped** on `dev`. Each entry's occurrences are counted in document order and the n-th
underline is drawn at `1 / (1 + ((n − 1) / 3)³)` of full: 1, 0.96, 0.77, half at the fourth, 0.30
at the fifth, under a tenth by the eighth. A plateau then a smooth fall, chosen over an exponential
(which takes 30% off the second) and over a cutoff (a cliff). The card stays on every occurrence,
and hover brings the full line back. Occurrences in the folded abstract and other matter don't
count, and a comment sharing the words keeps its own line. The reasoning:
[261024s](../plans/261024s-a-glossary-underline-fades-with-each-repeat-of-its-term.md).
