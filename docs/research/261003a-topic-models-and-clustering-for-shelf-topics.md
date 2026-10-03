# Topic models and clustering for the shelf's topics

Research done 2026-10-03 for report `spya-ntyes8`
([note](../user-feedback/260930_0715-shelf-topics-as-concepts-topic-model-or-clustering.md)), by one
Sonnet subagent with web search. The eval it led to is
[261003b-shelf-topics-as-concepts-not-phrases.md](../investigations/261003b-shelf-topics-as-concepts-not-phrases.md);
what we propose to build is
[plan 261003f](../plans/261003f-shelf-topics-named-by-a-model-as-concepts-not-phrases.md). This doc is
the options that were on the table and why most of them are not.

> But it just occurred to me maybe there is a cleaner way, which would be to run something like a
> Topics model (as in Blei, LDA, etc), or are there other modern text clustering models that I might
> not have heard of (e.g. Bayesian clustering or something like that), that would come up with a
> smaller number of really nice clusters. Ideally the algorithm wouldn't have many parameters that
> we need to optimise (or sensible defaults that work well), would work robustly for small and large
> numbers of papers, would pick the number of clusters automatically (or there'd be some kind of
> standard method for choosing the number of clusters), would run within seconds even on thousands
> of papers, would run in the browser, etc.
>
> — Greg, 2026-09-30 (the whole report is in the note)

**How far to trust this.** npm and pricing pages were fetched on 2026-10-03. Paper details are from
search snippets and the agent's background knowledge. Nothing here was benchmarked by the agent;
what we measured ourselves is in the investigation. Anything marked *unverified* was not checked.

## The answer in one paragraph

The pills are generic because of **where the labels come from**, not because of how the articles
are grouped. Today a label has to be a phrase the articles literally use, and no article about
predictive coding says "computational neuroscience". A classical topic model does not fix that: its
"label" is a list of its most likely words, which is the same kind of thing. An embedding
clustering groups articles well enough but has no label at all until something names the group, and
the only thing that names a group at the level a person files under is a language model. So every
route to *Buddhism* and *AI* ends with a model writing the label. The remaining question is whether
a program should do the grouping first (embeddings and clustering) or the model should do both, and
that is what the eval measured.

## Classical topic models

| Method | Picks its own topic count? | On our data | JavaScript |
|---|---|---|---|
| **LDA** (Blei et al. 2003) | No, you set K | Needs word co-occurrence across hundreds of documents. On a shelf of 10 to 50 it returns noise, and its topics are word lists | `lda` on npm: 0.2.0, September 2017, abandoned |
| **HDP** (the Bayesian version that infers K) | Yes | Slow, unstable between runs, sensitive to its priors | none found |
| **GSDMM** (Yin & Wang 2014; built for short text) | Roughly: K is an upper bound and empty clusters die | Assumes **one topic per document**, the opposite of what two pills chosen together need. Sensitive to its two parameters, and published tuning disagrees with the common defaults (<https://arxiv.org/html/2507.13793v1>) | none maintained |
| **BTM** (biterm topic model) | No | Python and R only | none |
| **NMF** | No | Fast and repeatable, but K is still ours to pick | none maintained |

All of them fail three of Greg's criteria at once: they are not robust on a small shelf, most do not
pick K, and none produces a label. That is the same conclusion the 2026-09-28 research reached from
the other direction ([260928a](260928a-shelf-facet-terms-algorithms-and-ui.md) § Dead ends); it has
not changed.

## Embedding and clustering

Turn each article into a vector (a list of numbers placing it near articles about similar things),
then find groups among the vectors.

- **BERTopic's recipe** (Grootendorst 2022, <https://arxiv.org/abs/2203.05794>): embed, squash with
  UMAP, cluster with HDBSCAN, label with c-TF-IDF keywords. K is automatic, but HDBSCAN calls many
  documents outliers, which is bad on a small shelf, and there are several knobs. No maintained
  HDBSCAN port in JavaScript (*unverified beyond the 2021 alpha the earlier research found*).
- **Agglomerative clustering** (`ml-hclust` 4.0.0, November 2025): runs in JavaScript, but somebody
  has to choose where to cut the tree.
- **Louvain community detection on a nearest-neighbour graph** (`graphology-communities-louvain`
  2.0.2, December 2024, about 238k downloads a week): link each article to its few nearest
  neighbours, then find the groups that are more linked inside than outside. The number of groups
  falls out of the graph, the one parameter (resolution) has a sensible default, and thousands of
  articles take under a second. **This is the clustering method that best fits Greg's criteria**, so
  it is the one the eval ran. Louvain is about seventy lines, so the eval wrote its own rather
  than adding a dependency.
- **Affinity propagation**: automatic K, but it depends on a "preference" parameter and is slow.

**Where the vectors come from.** In the browser: `@huggingface/transformers` 4.3.0 with
`all-MiniLM-L6-v2` is a download of about 23 MB, and a thousand short texts take seconds to tens of
seconds (*from memory, unmeasured*). On the server: we already call `voyage-4`
([`src/embeddings.ts`](../../src/embeddings.ts)) at $0.06 per million tokens, so a thousand
title-and-gist pairs cost about half a cent, once. Either way the vectors would need storing, which
this repo has so far declined to settle (the header of `src/embeddings.ts` says why).

**What clustering cannot do by itself.** It gives each article exactly one group, so choosing two
pills never narrows anything; overlap has to be bolted on afterwards. And the groups still need
names.

## A language model does the grouping

- **TopicGPT** (Pham et al., NAACL 2024, <https://aclanthology.org/2024.naacl-long.164>): prompt a
  model to propose topics from the documents, merge and refine them, then assign each document.
  Topics are plain-language labels with descriptions. Reported to agree with human categories
  better than LDA or BERTopic (harmonic-mean purity 0.74 against 0.64).
- **LLooM** (Lam et al., CHI 2024, <https://arxiv.org/abs/2404.12259>): induces high-level
  "concepts" with explicit inclusion criteria and scores every document against every concept. It is
  multi-label by design; the per-pair scoring is what costs at scale.
- **Cluster, then have a model name each cluster**: the cheap hybrid. Model cost grows with the
  number of clusters, not the number of articles.

The failure modes the literature names: the topics drift between runs, the granularity is uneven,
near-duplicate labels appear, and a topic can be invented that few documents support. The standard
mitigations are to say what level you want, to freeze the accepted list, and to file new documents
against that list rather than starting again.

## How to tell whether topics are good

- **Coherence scores** (NPMI, C_v) need a large reference corpus, are noisy on a few dozen
  documents, and correlate poorly with what people think (Hoyle et al. 2021,
  <https://arxiv.org/abs/2107.02173>).
- **A model as judge** tracks human ratings better than those scores (Stammbach et al., EMNLP 2023,
  <https://aclanthology.org/2023.emnlp-main.581>).
- **The reader's own filing** is the best evidence: a couple of dozen of Greg's articles with the
  pills he would put them under. We do not have it, and the eval says so.

## The simpler options this passed over

- **A longer list of banned generic words.** It is whack-a-mole, and it does nothing for the
  missing umbrella: with *principles* gone there is still no *productivity*.
- **Let today's scoring model be harsher.** It already scores *principles* against a rubric; it
  cannot score a candidate it was never offered.

Up: [research.md](../project/research.md)
