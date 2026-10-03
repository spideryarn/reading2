---
reports: spya-ntyes8
ending: shipped
---
# Shelf topics as concepts: a topic model, clustering, or a model

Report `spya-ntyes8`, from Greg (admin), 2026-09-30 07:15 UTC, in production, on `/?archived=1`.
Overseer queue item `qi-evce3r2y`. This run had no Sentry sign-in, so the Sentry short id and its
status are left for the next sweep.

> Somehow the topic pills on the logged-in homepage still don't feel they're working that well. By
> that what I mean is I look at the topics and they don't seem like high-level concepts that I would
> use to group and organize my articles myself if I was coming up with them. Or at least some of
> them do, like, you know, there's one for Buddha, one for AI. So we're getting there. But there's
> others like "principles" and "writers" that seem a bit generic/arbitrary.
>
> But it just occurred to me maybe there is a cleaner way, which would be to run something like a
> Topics model (as in Blei, LDA, etc), or are there other modern text clustering models that I might
> not have heard of (e.g. Bayesian clustering or something like that), that would come up with a
> smaller number of really nice clusters. Ideally the algorithm wouldn't have many parameters that
> we need to optimise (or sensible defaults that work well), would work robustly for small and large
> numbers of papers, would pick the number of clusters automatically (or there'd be some kind of
> standard method for choosing the number of clusters), would run within seconds even on thousands
> of papers, would run in the browser, etc. There might be other criteria I haven't thought of. see
> docs/reusable/third-party-library-selection.md
>
> We might have to come up with different ways of labeling the topic pills if we used a more complex
> algorithm like Topics that doesn't have an obvious way to label its clusters... But if the actual
> topics end up being more meaningful, then perhaps that'd be worth it.
>
> Maybe this requires an eval with a few dozen sample papers?
>
> Alternatively, maybe this is all overkill, and we just use an LLM or two. But if that's what you
> conclude, I'd want to discuss carefully about costs (so that it can scale to thousands of papers
> for a given user while costing at most pennies per paper).
>
> I'm hoping there's a way to do this that won't be enormously complex. If this is going to be
> complex, do a bit of research and planning, but stop before implementing, and we can discuss
> options.

**Ending: Shipped** — on `dev`, not deployed at the time of writing. It was first written up as
*Awaiting Greg*, because the conclusion was the one he had asked to discuss; on 2026-10-03 he
answered, asked for a broad-to-fine tree and for new articles to be included automatically, and
said *"Yes, build the first version."*

**What shipped.** A model (GPT-6 Luna) now names the shelf's topics from each article's title and
one-sentence summary, as a tree: broad subjects first (*Neuroscience · Buddhism · Woodworking*),
finer topics inside each, three levels deep, each pill carrying how broad it is from 0 to 1.
Choosing a subject hides the unrelated pills and brings its finer topics forward; the colours are
unchanged. A new article is sorted into the existing topics by itself, for about a two-hundredth of
a penny; the whole tree is re-thought when the shelf has changed by a quarter. The phrase pills
remain as the fallback. Plan, with his words, the evals and GPT Sol's three reviews:
[261003f](../plans/261003f-shelf-topics-named-by-a-model-as-concepts-not-phrases.md). How it works
now: [shelf-terms.md § Topics a model names](../project/shelf-terms.md#topics-a-model-names-broad-to-fine).

**What did not ship, each with a queue entry.**

- **Shelves over 150 works** get no re-think yet (his example was a thousand papers): a rare
  subject would be missed by sampling and the job could not be relied on to finish. Queued as
  *Shelf topics for shelves over 150 works*.
- Removing the old scoring call's code and table. Queued.
- A *Redo topics* button, and editing topics. Queued.

**Not checked.** His own shelf: this session was refused the production read twice, so the trees
measured are on synthetic shelves. And the whole path in a browser: the shared local database could
not take the new migration (a peer's unmerged migration is in its ledger), so the row was looked at
in Chrome with the server's answer replaced by a made-up tree over the local shelf's articles. That
checked the row, the narrowing, the cards, More detail and the URL rule in light and dark and at
phone width; it did not check a real re-think arriving.

The topic-model and clustering options he asked about are in
[research 261003a](../research/261003a-topic-models-and-clustering-for-shelf-topics.md), and the
first eval in [investigation 261003b](../investigations/261003b-shelf-topics-as-concepts-not-phrases.md).
