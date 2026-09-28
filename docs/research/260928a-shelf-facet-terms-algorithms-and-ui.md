# Filter terms for the shelf: the algorithms and the UI

Research done 2026-09-28 for [260928a-shelf-facet-terms.md](../plans/260928a-shelf-facet-terms.md),
by two Sonnet subagents with web search (one on the UI, one on the algorithms and libraries) and one
Opus spike that ran candidate pipelines over the local database. The plan says what we built; this
says what else was on the table and why not. Sources are as fetched on 2026-09-28; npm numbers are
from `registry.npmjs.org` and `api.npmjs.org/downloads` on that day.

> Delegate to a new agent that does some simple keyword/clustering on the articles in my shelf so I
> can easily filter to different kinds of article. It should choose terms that somehow enable me to
> filter overlapping subsets (and ideally cover pretty much all of the articles in some form).
>
> — Greg, 2026-09-28 (the whole request is quoted in the plan)

## The shape of the answer, in one paragraph

Clustering is the wrong primitive, and the literature that fits is older than it. k-means, HDBSCAN,
LDA and NMF all hand back **partitions** (or a soft spread over a few topics), and Greg asked for
**overlapping** subsets: an article about reinforcement learning for robots should be findable under
both. What fits is the faceted-search line of work — extract candidate phrases per document, then
choose a *set* of terms over the collection by **coverage with a redundancy penalty**, bounded by
document frequency so no term is so rare it is useless or so common it filters nothing. That is two
cheap, deterministic steps, and neither needs an LLM or an embedding model.

## The algorithms

### Per-article keyphrase extraction

The four families, all benchmarked on the same datasets (Inspec — 2,000 scientific abstracts;
SemEval-2010 Task 5 — full ACM papers; KP20k; DUC news):

| Family | Examples | What it costs | Verdict here |
|---|---|---|---|
| Frequency | TF-IDF over n-grams, **RAKE** (split at stopwords, score by co-occurrence degree) | nothing; RAKE needs no corpus | the base we use — the stopword split is RAKE's, the weighting is TF-IDF over the reader's own shelf |
| Graph | TextRank, SingleRank, **PositionRank** (ACL 2017: bias toward early positions), TopicRank | a POS tagger and a PageRank per article | the one idea worth taking is position: title and headings count extra |
| Multi-feature statistical | **YAKE!** (casing, position, frequency, context, dispersion) | arithmetic only; **no maintained JS port** | the upgrade path if phrase quality is the weak point — ~100 lines to port |
| Embedding | **KeyBERT**, BERTopic's c-TF-IDF | a sentence-embedding model (~23 MB quantized `all-MiniLM-L6-v2` via `@huggingface/transformers` 4.3.0) | not for v1: model load on every cold start, a new class of dependency, and it answers "semantic gist", which filter terms don't need |

The YAKE! paper (Campos et al., *Information Sciences* 2020,
<https://repositorio.inesctec.pt/bitstreams/ef121a01-a0a6-4be8-945d-3324a58fc944/download>) reports
it beating RAKE and TextRank on nearly all of ~20 collections and being among the two fastest.
PositionRank (<https://www.cs.uic.edu/~cornelia/papers/acl17.pdf>) is the evidence that where a
phrase first appears matters. On multi-topic, news-like prose — closer to a web essay than an
abstract is — plain single-document TF-IDF is the weakest option (survey:
<https://encyclopedia.pub/entry/3541>). That is a claim about picking *one document's* best phrases;
ours is a collection problem, where TF-IDF across the shelf is doing different work.

### Choosing the shelf's terms

- **c-TF-IDF** (BERTopic, Grootendorst 2022, <https://arxiv.org/abs/2203.05794>): score a term by
  how concentrated it is in the set of documents that carry it versus the rest. Borrowed as an idea,
  without BERTopic's clustering.
- **Castanet** (Stoica, Hearst & Richardson, HLT-NAACL 2007, <https://aclanthology.org/N07-1031/>):
  builds facet hierarchies from WordNet — more than we need — but its **pruning band** is directly
  reusable: drop a term that covers almost nothing or almost everything.
- **Dakka & Ipeirotis** (SIGIR 2006 workshop; ICDE 2008,
  <https://ipeirotis.org/wp-content/uploads/2012/01/icde2008.pdf>): the closest prior art —
  automatic facet terms from free text, chosen by a collection-level utility with redundancy control.
  The research agent could not extract their equations from the PDFs, so we cite the *shape*
  (greedy coverage with redundancy control) and not a formula.
- **Greedy weighted maximum coverage** is the standard near-optimal approximation: repeatedly take
  the term that adds the most not-yet-covered weight, *discounting* rather than removing articles
  already covered, so later picks can still overlap. It is O(terms × articles) per pick.

### Libraries (npm, 2026-09-28)

| Package | Weekly | Latest | Notes |
|---|---|---|---|
| `natural` | 1.48M | 8.1.1, 2026-02 | TfIdf, Porter stemmer, tokenisers, stopwords. MIT, typed. |
| `compromise` | 1.07M | 14.17.0, 2026-09 | rule-based POS, `.nouns()`; zero deps. MIT, typed. |
| `wink-nlp` + `wink-eng-lite-web-model` | 186k | 2.4.0, 2025-06 | full typed pipeline, ~1 MB model. MIT. |
| `stopword` | 297k | 3.1.5, 2025-06 | lists only; untyped. |
| `keyword-extractor` | 450k | 0.3.0 | **misleading name** — stopword removal only, not a ranker. |
| `retext-keywords` | 10k | 8.0.2, 2024-10 | unified ecosystem; low adoption. |
| RAKE ports (`rake-js`, `node-rake`), `textrank` | < 300 | 2017–18 | dead. RAKE's algorithm is ~40 lines. |
| YAKE | — | — | no maintained JS port. |
| `ml-kmeans` | 175k | 7.0.1, 2026-06 | fine, but partitions — wrong primitive. |
| `hdbscan` | 347 | alpha, 2021, GPL-3.0 | unusable. |

The decision between hand-rolled candidates and `compromise` noun phrases was settled by the spike
below, not by argument.

## The UI

**Tag clouds lose.** Hearst's own studies found people rarely click a cloud to navigate; size is a
poor way to show magnitude and absence is invisible (<https://www.perceptualedge.com/articles/guests/whats_up_with_tag_clouds.pdf>,
<https://thenoisychannel.com/2008/10/21/tag-clouds-the-good-the-bad-and-the-ugly/>). The shape every
serious tool converged on is **a list of values with counts, plus the selected values as removable
chips** — Flamenco (<https://flamenco.berkeley.edu/papers/flamenco02.pdf>), NN/g on filter
categories (<https://www.nngroup.com/articles/filter-categories-values/>), Baymard on filter UI
(<https://baymard.com/blog/ecommerce-filter-ui>).

- **AND across selected terms.** With one kind of facet, each click should narrow. Readwise Reader's
  query language (<https://docs.readwise.io/reader/guides/filtering/syntax-guide>) is the power
  version and is not for v1.
- **Live counts** against the current selection (Baymard), and a term that would give zero results
  **greyed in place, not hidden**, so the list does not jump.
- **Pinboard's related tags** (<https://pinboard.in/faq/>): after one selection, what co-occurs with
  it — which live counts give us for free, since the list re-ranks to the current subset.
- **Zotero marks automatic tags as automatic** and lets you hide the class
  (<https://zotero-manual.github.io/tags/>). Worth borrowing the honesty: these are chosen by a
  program, and the UI should say so.
- **Evidence, not a bare label.** A term alone is unfalsifiable; showing the articles that use it
  most is what makes it trustworthy (<https://arxiv.org/pdf/2110.00462>).
- **How many.** Progressive disclosure at around 15–20 visible, the rest behind "more"; a
  well-chosen 20–40 beats every phrase the extractor found.
- **Touch.** Never put the only copy of anything behind hover
  (<https://uxpickle.com/alternatives-to-hover-interaction-on-touchscreens/>). Our `Tooltip` already
  opens on tap ([tooltips.md](../project/tooltips.md)).

Tools compared: Zotero (tag selector shows tags present in the current set), Readwise Reader
(filtered views), Pinboard (cloud + related tags), Raindrop (tags with counts), arXiv (a curated
taxonomy — the opposite end), Semantic Scholar (a small fixed "field" facet plus a sparse phrase
layer), Obsidian (tag pane with counts), Mendeley/Paperpile (manual folders; nothing to borrow).

## Dead ends, and why

- **k-means / HDBSCAN / LDA / NMF** — partitions, and a label per cluster is a second problem on top.
- **An LLM tagging pass per article** — Greg allowed it if it earns its cost. It does not for v1: the
  deterministic version is measured below, it re-runs identically, and an LLM's tags drift between
  runs, which is exactly what a filter must not do. Revisit if the measured term quality is poor.
- **Postgres `ts_stat` over the existing `revision_blocks.fts` column** — free stems and document
  frequencies with no new code, but single lexemes only, stemmed beyond display ("mytholog"), and no
  phrases. Greg asked for phrases if possible.
- **Embeddings** — see KeyBERT above. The repo does embed passages (`src/embeddings.ts`, `voyage-4` via
  OpenRouter) for the Force and Drift pictures, but that is a paid call per article, held in memory
  rather than stored, so it is not free input for this.

## Measured on the local database

An Opus spike on 2026-09-28 prototyped both candidate generators (hand-rolled RAKE-style runs, and
`compromise` noun phrases) under the same selection step, against the local database's one real
shelf (38 active articles, 30 distinct works, ~357k words) and a degenerate 6-article shelf. The
numbers, the chosen configuration and the term list are in the plan's § Measurements, which is where
they are kept up to date. The findings that are about *method* belong here:

- **The hand-rolled generator won on quality as well as cost.** `compromise` tags *Indigenous* and
  *Aboriginal* as adjectives and lost a whole group of articles (coverage 0.71 vs 0.92); it was 27×
  slower (82 vs 3 ms per 1k words) and a 4.7 MB import taking 0.5–1.3 s cold.
- **Absolute count thresholds break on long documents.** "Occurs twice" gave 100% coverage and a
  list of junk (*system, world, past, run*) because a 152k-word book contains every common word
  twice. Membership has to scale with length.
- **Per-article top-M membership is too narrow on a varied shelf**: most of an article's top terms
  are unique to it, so selection stalled at 7–15 terms and 34–76% coverage.
- **Duplicate copies of one article invent topics.** Counting near-duplicates (Jaccard ≥ 0.6 on the
  top-150 keys) as one work removed three single-work "topics".
- **Reference lists are not footnote-flagged** in PDF-derived articles; they had to be skipped by
  heading.
- **Below ~8 distinct works nothing survives** the document-frequency band, correctly.
