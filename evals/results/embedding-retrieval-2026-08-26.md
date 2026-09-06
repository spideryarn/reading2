# Which embedding model? Four candidates, measured on our own articles

**2026-08-26.** `npm run eval:embeddings` ([`evals/embedding-retrieval.ts`](../embedding-retrieval.ts)).
Raw output: [`embedding-retrieval-2026-08-26T0907.json`](embedding-retrieval-2026-08-26T0907.json)
(judged by Claude Sonnet 5) and [`embedding-retrieval-2026-08-26T0908.json`](embedding-retrieval-2026-08-26T0908.json)
(the same retrieval judged again by Claude Opus 5).

> **The literal baseline in this run searched a different corpus from the arms it was compared
> against, and a later run's baseline will not be comparable with this one.** Found on 2026-09-05
> while deleting the filesystem store: `literalBaseline` called `searchLibrary`, which walked the
> developer's own `data/` directory, while every embedding arm was scored over
> `tests/fixtures/data-root/data/`. On a fresh clone the baseline searched `example/` alone. It is
> now the same AND-scan written out over the `passages` the eval already loads, so baseline and arms
> finally see one corpus. **The recommendation below does not rest on the baseline** — it is a
> comparison between the four embedding arms, which were always scored over the same passages — but
> any baseline number quoted from this file is measuring something else, and the gap between the
> baseline and the arms is not a real margin.
> [260903f](../../docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md) § G6.

**Recommendation: `voyageai/voyage-4`.** It is statistically tied with the best arm on every measure
under both judges, it is 1024 dimensions rather than 1536, and it bills to OpenRouter credits, which
is where Greg wanted the billing. `openai/text-embedding-3-small` has the best point estimates but
does not beat it, so the tie-break decides — and the tie-break points away from BYOK.

**`baai/bge-m3` is out.** It loses to everything, clearly, on every measure, under both judges, with
no interval near zero. That was the cheapest option and the one originally preferred; it is the one
result here that is not close.

**Read the caveat about the OpenRouter account before acting on any of this** — the key currently
exported in Greg's shell cannot reach Voyage at all.

## What was run

495 gistable blocks — `data/constitution` (360), `data/noema-mythology-of-conscious-ai` (117),
`data/writes` (18). `example/` contributes nothing: it is a 34-block extract of the noema article
carrying **the same block ids**, so its 29 gistable blocks are dropped as duplicates.

18 queries, committed in the eval file, each written in a reader's words rather than the author's.
**221 (query, passage) pairs judged**, mean pool 12.3 passages per query, each judged once, blind,
and shared by every arm.

Five *arms*, because "which model" is not the whole question:

| arm | model | dims | $/M | billed to |
|---|---|---:|---:|---|
| `bge-m3` | `baai/bge-m3` | 1024 | 0.01 | OpenRouter credits |
| `voyage-4-lite` | `voyageai/voyage-4-lite` + `input_type` | 1024 | 0.02 | OpenRouter credits |
| `voyage-4-lite-untyped` | the same, `input_type` withheld | 1024 | 0.02 | OpenRouter credits |
| `voyage-4` | `voyageai/voyage-4` + `input_type` | 1024 | 0.06 | OpenRouter credits |
| `3-small` | `openai/text-embedding-3-small` | 1536 | 0.02 | **BYOK — Greg's OpenAI account** |

Voyage's API takes an `input_type` (`"query"` on a search string, `"document"` on a passage) and
**OpenRouter passes it through** — the vectors differ from the untyped ones at cosine 0.93. Running
Voyage without it would be running Voyage wrong and calling the result a fact about Voyage, so the
contenders are typed, and the untyped variant is carried as its own arm so the size of that choice
is visible rather than asserted. bge-m3 is trained for retrieval without a prefix and OpenAI has no
such convention, so those get plain text.

All four models are under pgvector's 2000-dimension index cap natively. Nothing is truncated.

## Retrieval quality

0 = irrelevant, 1 = partly, 2 = directly answers.

**Judged by Claude Sonnet 5:**

| arm | dims | P@3 | P@5 | strict P@5 | mean judged score | nDCG@5 | corpus cost |
|---|---:|---:|---:|---:|---:|---:|---:|
| `bge-m3` | 1024 | 44.4% | 37.8% | 22.2% | 0.600 | 0.492 | $0.00046 |
| `voyage-4-lite` | 1024 | 63.0% | 50.0% | 30.0% | 0.800 | 0.706 | $0.00073 |
| `voyage-4-lite-untyped` | 1024 | 59.3% | 48.9% | 30.0% | 0.789 | 0.666 | $0.00074 |
| `voyage-4` | 1024 | 66.7% | **61.1%** | 28.9% | 0.900 | 0.737 | $0.00219 |
| `3-small` | 1536 | **70.4%** | **61.1%** | **32.2%** | **0.933** | **0.777** | $0.00074 |

**Judged by Claude Opus 5** — same retrieval, judged from scratch:

| arm | P@3 | P@5 | strict P@5 | mean judged score | nDCG@5 |
|---|---:|---:|---:|---:|---:|
| `bge-m3` | 48.1% | 43.3% | 22.2% | 0.656 | 0.512 |
| `voyage-4-lite` | 66.7% | 55.6% | 31.1% | 0.867 | 0.709 |
| `voyage-4-lite-untyped` | 59.3% | 51.1% | 32.2% | 0.833 | 0.640 |
| `voyage-4` | 72.2% | 62.2% | **34.4%** | 0.967 | 0.734 |
| `3-small` | **74.1%** | **63.3%** | **34.4%** | **0.978** | **0.772** |

The two judges agree exactly on **84.6%** of the 221 pairs and on **89.1%** of the relevant/not call.
The ordering is identical and no arm changes side of any conclusion below.

## Is the gap bigger than noise? Mostly not

Paired bootstrap over the 18 queries, 10,000 resamples, each arm against `3-small` (the leader).

| arm | measure | Sonnet 5 judge | Opus 5 judge |
|---|---|---|---|
| `bge-m3` | mean score | −0.333 [−0.500, −0.167] **behind** | −0.322 [−0.489, −0.167] **behind** |
| | precision@5 | −0.233 [−0.356, −0.111] **behind** | −0.200 [−0.311, −0.089] **behind** |
| | nDCG@5 | −0.285 [−0.425, −0.150] **behind** | −0.260 [−0.385, −0.140] **behind** |
| `voyage-4-lite` | mean score | −0.133 [−0.278, 0.011] *tied* | −0.111 [−0.278, 0.033] *tied* |
| | precision@5 | −0.111 [−0.189, −0.033] behind | −0.078 [−0.178, 0.022] *tied* |
| | nDCG@5 | −0.072 [−0.190, 0.036] *tied* | −0.063 [−0.181, 0.041] *tied* |
| `voyage-4` | mean score | −0.033 [−0.167, 0.078] *tied* | −0.011 [−0.133, 0.111] *tied* |
| | precision@5 | +0.000 [−0.089, 0.089] *tied* | −0.011 [−0.111, 0.089] *tied* |
| | nDCG@5 | −0.040 [−0.123, 0.041] *tied* | −0.038 [−0.126, 0.046] *tied* |

Per-query, by mean judged score, against `3-small`:

| arm | better | worse | tied | (Opus judge) |
|---|---:|---:|---:|---|
| `bge-m3` | 2 | 12 | 4 | 2 / 13 / 3 |
| `voyage-4-lite` | 2 | 7 | 9 | 3 / 7 / 8 |
| `voyage-4` | **6** | **6** | **6** | 5 / 6 / 7 |

**So there are two findings, and only one of them is a difference.**

*`bge-m3` is genuinely behind.* Six intervals, two judges, every one clear of zero. It also fails
outright — nothing relevant in its top 5 — on 3 of 18 queries where every other arm fails on at most
one, and it puts a directly-answering passage first on 8 or 9 of 18 against 12–15 for the others.

*`voyage-4` and `3-small` are tied and it is not close to being decidable.* Identical P@5 under one
judge, six per-query wins each, and every interval straddling zero under both judges. At n=18 this
harness cannot separate them, and a bigger point estimate is not evidence that it could. `voyage-4-lite`
sits just below both — tied on all three measures under Opus, tied on two of three under Sonnet — so
"slightly behind, not demonstrably so" is the whole of what can be said about it.

## `input_type` is worth sending

The untyped arm is the same model and the same corpus, so this is a clean within-model comparison:

| | mean score | nDCG@5 | P@3 |
|---|---|---|---|
| `voyage-4-lite` (typed) | 0.800 / 0.867 | 0.706 / 0.709 | 63.0% / 66.7% |
| `voyage-4-lite-untyped` | 0.789 / 0.833 | 0.666 / 0.640 | 59.3% / 59.3% |

*(Sonnet judge / Opus judge.)*

Each individual gap is small enough to be noise, but the direction is the same on every measure under
both judges, and it costs nothing to send. Withholding it is the one arm that is *behind* the leader
on all three measures under the Opus judge while its typed twin is tied on all three — which is a
reasonable summary of how much it matters: not a lot, and more than nothing.

## It is aim, not confidence

| arm | mean cosine over corpus | top-5 lift, in SDs of that spread |
|---|---:|---:|
| `bge-m3` | 0.390 | 3.14 |
| `voyage-4-lite` | 0.188 | 3.20 |
| `voyage-4-lite-untyped` | 0.307 | 2.98 |
| `voyage-4` | 0.187 | 3.29 |
| `3-small` | 0.177 | 3.29 |

Worth recording because it rules out the obvious rescue for bge-m3. Its cosines live in a much
narrower, higher band — 0.39 against a paragraph picked at random, where the others sit at 0.18 —
which invites the theory that it is merely "less discriminating" and would come good with a
threshold or a rescaling. **It would not.** In standard deviations of its own spread it separates
its top 5 as sharply as anything else here. It is confidently retrieving different paragraphs, and
on this corpus they are worse ones.

The practical corollary matters separately: **any absolute similarity cut-off is model-specific.**
0.5 means "barely related" to bge-m3 and "strongly related" to the other three.

## What semantic search buys over what we already ship

| matcher | judged-relevant passages in its top 5 | queries with anything relevant in the top 5 |
|---|---:|---:|
| `searchLibrary` as shipped (AND over terms) | 0 / 81 | **0 / 18** |
| generous word matching (OR over content words, ranked) | 18 / 81 (22.2%) | 14 / 18 |
| `bge-m3` | — | 15 / 18 |
| `voyage-4` | — | 17 / 18 |
| `voyage-4-lite` | — | **18 / 18** |
| `3-small` | — | 17 / 18 |

The first row is true and slightly unfair: [`src/library-search.ts`](../../src/library-search.ts)
ANDs every term and these queries are whole sentences, so it returns **nothing at all** for all
eighteen — not a bad answer, no answer. Nobody claimed an AND matcher answers questions, so the
second row is the one to argue against: the strongest thing word matching can do without embeddings.
It finds under a quarter of the relevant passages. That gap is what the embeddings are buying.

## Two caveats that change how these numbers may be used

**The absolute numbers are pool-dependent; only within-run comparisons are valid.** Relevance is
judged one query at a time over the union of every arm's top 5, so adding an arm lengthens the list
the judge is calibrating against and it grades a little more strictly. An earlier two-arm run of this
same harness put `3-small` at P@5 64.4% and `bge-m3` at 42.2%; here, with five arms and a pool of
12.3 rather than 8, the same two arms read 61.1% and 37.8%. The retrieval did not change and neither
did the gap. **Do not quote a number from one run beside a number from a run with a different arm
set** — re-run instead, which costs about a penny.

**Eighteen queries is a small sample, and three English prose articles is a narrow corpus.** The
intervals above are wide on purpose. And bge-m3 is the multilingual model of the four: if the shelf
stops being English-only, this measurement stops applying.

## The OpenRouter account blocks Voyage — read this before choosing Voyage

The `OPENROUTER_API_KEY` exported in Greg's shell and the one in `.env.local` are **different keys on
different accounts**, and [`src/env.ts`](../../src/env.ts) deliberately lets the exported one win.

| model | shell key | `.env.local` key |
|---|---|---|
| `baai/bge-m3` | 200 | 200 |
| `openai/text-embedding-3-small` | 200 | 200 |
| `voyageai/voyage-4-lite` | **404** | 200 |
| `voyageai/voyage-4` | **404** | 200 |

The 404 body reads *"No endpoints available matching your guardrail restrictions and data policy"*,
which looks like a bad model id and is not: it is that account's privacy settings refusing every
upstream that serves Voyage. This run was made with the `.env.local` key
(`env -u OPENROUTER_API_KEY npm run eval:embeddings`). The eval now detects this case and fails with
the explanation rather than a bare 404.

**So choosing Voyage has a prerequisite:** whichever account's key reaches production must have
Voyage's providers allowed at <https://openrouter.ai/settings/privacy>. If that cannot be arranged,
`3-small` is the fallback and the BYOK billing comes with it.

## The tie-break, stated explicitly

`voyage-4` and `3-small` cannot be separated on quality here. So:

| | `voyage-4` | `3-small` |
|---|---|---|
| quality | tied | tied |
| dims | **1024** | 1536 (≈2KB more per block, ~2MB per thousand) |
| $/M | 0.06 | **0.02** |
| whole corpus, measured | $0.0022 | **$0.0007** |
| billing | **OpenRouter credits** | BYOK → Greg's OpenAI account |
| availability | needs the account's privacy settings opened | works on both keys today |

Price is the only column `3-small` wins outright, and it wins it by a seventh of a penny per
500-block article — call it $1.50 per thousand articles against $0.50. Against that, `voyage-4` is a
third smaller in storage and bills where Greg asked for it to bill.

**`voyage-4` on quality-and-billing; `voyage-4-lite` if the 3× token price ever matters** (same
$/M as OpenAI, same 1024 dims, same billing, a hair behind on quality but not demonstrably so);
**`3-small` only if the Voyage account problem cannot be fixed.** `bge-m3` is not a candidate.
