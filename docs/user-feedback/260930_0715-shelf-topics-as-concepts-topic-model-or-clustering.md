---
reports: spya-ntyes8
ending: awaiting
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

**Ending: Awaiting Greg.** Researched, measured and planned; nothing built, because the conclusion
is the one he asked to discuss first. The pills are generic because a label must be a phrase the
articles use, so the umbrella is never a candidate. A topic model does not fix that and clustering
still needs a model to name its groups. In an eval over six synthetic shelves, GPT-6 Luna proposing
the topics itself won all six against today's list, and all six against the one embedding-clustering
pipeline we built, with blind judges. Asking about a whole shelf costs about $0.00003 an article, so
re-thinking the topics each time the shelf has grown by a tenth comes to about a thirtieth of a
penny per article, however large the shelf. GPT Sol reviewed the plan and its simpler re-think rule
became the proposal. His own shelf was not in the eval. The three questions are in
[261003f § The questions for Greg](../plans/261003f-shelf-topics-named-by-a-model-as-concepts-not-phrases.md);
the options are in
[research 261003a](../research/261003a-topic-models-and-clustering-for-shelf-topics.md) and the
numbers in [investigation 261003b](../investigations/261003b-shelf-topics-as-concepts-not-phrases.md).
