# A blurb per cited work: what it costs, what it covers, and how often it is right

Up: [investigations.md](../project/investigations.md). Plan this informs:
[261017h § Stage 2](../plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md#stage-2-spike-what-a-blurb-per-cited-work-costs-and-how-often-it-is-right).

**The answer.** Writing the blurbs from registry abstracts (arm A) costs **about a cent an
article: $0.006 for a 33-work paper and $0.010 for the 70-work Butlin paper**. That is
$0.0002 a work, and the evidence lookups are free. It covers **79% and 70%** of those two
bibliographies, and **0%** of an essay whose rows are descriptions rather than titles.
**4.6%** of its sentences go beyond the abstract (7 of 151). None describe the wrong work,
but one says the opposite of what Searle argues.

One Haiku web search per work (arm B) costs **$0.0079 a work**, about **$0.32 for a 40-work
article** and $0.55 for the Butlin paper. That is ten times "a few cents". Its blurbs are
**four times less faithful (17% of kept sentences unsupported)**, because the model fills
gaps from memory, and one of its 24 kept blurbs was written from the very article that cites
the work.

**So: arm A for every work when Bibliography is made, and no web search except for the one
work a reader opens.** A then B over every miss costs $0.06–0.17 an article, which fails the
cost gate, and B's sentences fail the faithfulness gate however much they cost.

Measured 2026-10-17 by `evals/citation-blurbs-spike.ts`. The raw run is
[`evals/results/citation-blurbs-spike-2026-10-17T23-08-14.json`](../../evals/results/citation-blurbs-spike-2026-10-17T23-08-14.json).

## The question

Greg, 2026-10-17 (`spya-m53cdk`, quoted in full in the plan):

> How expensive would it be to do this for all the citations when generating Sources mode? Run
> some spikes/evals. If we can do a decent enough job of it for a few cents for all the
> citations for a standard article, it's worth doing.

The plan's bar, and Greg's: *a sentence about the work from a source we fetched, labelled as
such, never the model's memory*, and *"better to say nothing than hallucinate"*.

## Gates, set before any result was seen

These came with the brief's update from the GPT Sol plan review
([261017h review, F3/F8](../plans/261017h-sources-blurbs-plan-review-sol.md)). They arrived
before the first lookup ran.

| Gate | Threshold |
|---|---|
| Coverage | ≥ 60% of an article's works get a blurb |
| Faithfulness | ≤ 1 unsupported sentence in 20 (≤ 5%) |
| Identity | 0 blurbs written from the wrong work |
| Cost | ≤ $0.05 for a 40-work article (production calls only; the judge is separate) |

## Method

**Three bibliographies**, read from production with SELECT only, inside a read-only
transaction. They were chosen for privacy as well as shape: each is either public or Greg's
own copy of a published paper, because the spike sends every cited title to Crossref,
Semantic Scholar, OpenAlex, arXiv and Exa.

- `arxiv-2308-08708-spya-xax6v4`, Butlin et al., *Consciousness in AI*: the reported article.
  70 works: 11 with arXiv links, 59 title-only. Philosophy and neuroscience, with books.
- `2608-13566v1-spya-yurten`, a public coding-benchmarks paper: 33 works. 21 arXiv, 1
  Zenodo DOI, 11 title-only, several of them blog posts.
- `rhizome-1000-plateaus-introduction-lambert-says-spya-jc9azw`, the public *A Thousand
  Plateaus* introduction: 19 works. This is the essay-shaped one. **No essay in production
  has a bibliography of 30 or more works.** This was the only one with 15 or more.

**Arm A, registries, free.** Every source was tried and recorded, not just the first hit:

1. arXiv's API `summary` for an exact arXiv id.
2. Crossref by DOI, keeping the `abstract` that `parseCrossref` drops today, and DataCite's
   Abstract when Crossref does not know the DOI.
3. For a title-only row, a Crossref bibliographic search. It keeps a record only on a strict
   rule: normalised titles equal (or equal up to a subtitle after a colon), a distinctive
   title, no "correction/reply/supplement" tail, **and** the year (±1) or the first author's
   surname agreeing.
4. OpenAlex by DOI, never by title.
5. Semantic Scholar: one batch for every row with an id, then a throttled title match under
   the same rule. Its `abstract` and its `tldr` are recorded as separate evidence types,
   because a TLDR is model-written. The cascade prefers an author's abstract from any source
   and falls back to a TLDR (4 works).

Author–year labels ("Zacks et al. (2007)") and description rows ("Freud's case of Little
Hans") are not searched, because there is no title to match.

Haiku 5.5 (`FRONT_MATTER_AUTHORS_MODEL` in `src/models.ts`) then wrote the blurbs in batches
of 20 through the gateway (job `citation-influence`, ledger scope `eval`). Each work got an
opaque index we supplied, and its details and evidence were each fenced with `untrusted()`.
The model had to return `{i, blurb, quote}`. Code dropped any blurb whose quote (four or more
words, normalised) is not in that work's evidence, and any blurb with an unknown or repeated
index. The prompt carries `plainWords("explain")`. The zero-model baseline is the abstract's
first one or two sentences, cut by code.

**Arm B, one web search per work**, on a sample of 12 per article. The sample is stratified
round-robin over id kind × whether A found evidence. It used `citation-find`'s request shape:
Haiku, `openrouter:web_search` with Exa, 5 results, *"Run ONE web search"*. The answer was
`{url, blurb, quote}`. Code kept the blurb only if `readFind` accepted the URL (a returned
result whose title or extract names the work) and the quote is in that result's extract.
`resultIsTheWork` (src/citation-lookup.ts) then classed the evidence as *primary* (the work's
own page) or *secondary* (a page about it).

**Arm A+B** is computed: A for every work, and B for A's misses at the rate B achieved on the
misses in its sample.

**Faithfulness.** An Opus subagent labelled every blurb sentence against the evidence it was
written from: *supported*, *not-in-evidence* or *wrong-work*. It also flagged blurbs that only
restate the title, checked whether the evidence is the cited work, compared each A blurb with
its baseline, and classified all 122 works by kind. The labels and the script that wrote them
are in the run directory (scratch, not committed). **I hand-checked 12 items** against their
evidence: Searle, Chalmers, van Vugt and Nagel in A, the Lamme TLDR, *The Intentional Stance*,
and in B Graziano, *Anti-Oedipus*, Rosenstiehl–Petitot, Agents in the Wild, SWE-bench and
MTEB. I agree with the judge on all 12. The one I would soften is *Anti-Oedipus*'s
"philosophers Deleuze and Guattari", which is pedantic. **The judge only checks prose against
evidence**, so I established identity by hand for every title-search match (below).

## Results

| | Butlin (70 works) | Coding benchmarks (33) | *Rhizome* essay (19) |
|---|---|---|---|
| **A** coverage | **70%** (49) | **79%** (26) | **0%** |
| A cost (gateway `usage.cost`) | $0.0096 | $0.0060 | $0 (no evidence, no call) |
| A wall time: lookups / model | 255 s / 50 s sequential | 161 s / 32 s | 125 s / – |
| **B** kept on its sample | 12/12 | 10/12 | 2/12 |
| B cost per work (measured) | $0.0078 | $0.0079 | $0.0080 |
| B over all works (extrapolated from the sample) | $0.55 | $0.26 | $0.15 |
| B median latency per work | 5.7 s | 5.4 s | 6.6 s |
| **A+B** coverage (extrapolated) | ~100% (B 4/4 on A's misses) | ~91% (2/4) | ~16% (2/12) |
| A+B cost (extrapolated) | $0.17 | $0.06 | $0.15 |

The A+B rows rest on 4, 4 and 12 sampled misses: read them as direction, not numbers.

**Faithfulness** (Opus judge, every sentence):

| | Blurbs | Sentences | Supported | Not in evidence | Wrong work | Only restates title |
|---|---|---|---|---|---|---|
| A (abstract or TLDR) | 75 | 151 | 144 | **7 (4.6%)** | 0 | 2 |
| B, all with a valid URL | 25 | 50 | 40 | 10 (20%) | 0 | 0 |
| B, kept by the quote check | 24 | 48 | 40 | **8 (17%)** | **1 by evidence** | 0 |

The quote check dropped **0 of 75** A blurbs and **1 of 25** B blurbs: SWE-bench, which was
written wholly from memory over an arXiv page with no abstract. It is the right drop, but
the check never fired on A, so it is a boundary rather than a filter. A paraphrase drift
next to an honest quote passes it, as Searle shows.

**Haiku against the baseline** (A, the 72 with an author's abstract): Haiku's blurb was more
informative in **69**, the same in 2, and worse in 1 (Searle). An abstract's opening is
usually background ("Text embeddings are commonly evaluated on…"), so the baseline mostly
fails to say what the work does. The code's sentence cut also breaks on an abstract with no
space after its full stops: MTEB's "baseline" came out as a URL fragment.

**Arm B's search count**: 38 billed searches over 36 calls. Median 1, p95 2, max 2. Two of 36
searched twice despite *ONE*. In the first B run, 5 of 36 answers were unreadable: Haiku on
this route thinks by default, and 800 tokens of thinking ate the whole ceiling. The run
reported here used 2,500. A build must size the ceiling for the thinking, or turn it off.

**Where the abstracts came from** (works with each; one work can have several):
arXiv 32 · Crossref 22 (all from title search; the DOI rows had none) · OpenAlex 32 ·
S2 56 abstracts + 63 TLDRs · DataCite 1. The cascade used arXiv 32, Crossref 22, OpenAlex 9,
S2 8, DataCite 1, S2 TLDR 4.

**By stratum** (A blurb / works; B kept / sampled):

| Stratum | A | B |
|---|---|---|
| arXiv id | 32/32 | 7/7 |
| DOI | 1/1 | 1/1 |
| title-only | 42/89 | 16/28 |
| paper | 67/80 | 16/17 |
| book | 5/15 | 4/4 |
| book chapter | 2/2 | – |
| web page or blog | 0/6 | 2/3 |
| description, not a title | 0/17 | 1/11 (and that one is the wrong-work case) |

Books, chapters, web pages and description rows are 41 of the 122 works (34%). Abstracts
exist for a third of the books and for none of the web pages.

## Examples, side by side

| Work | Evidence (opening) | Blurb | Verdict |
|---|---|---|---|
| Vaswani et al., *Attention is all you need* (A, arXiv) | "…We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely…" | "The paper introduces the Transformer, a sequence model built only from attention, with no recurrence or convolution. It reports better machine translation quality than earlier models, trained in less time." | supported; baseline was only the background sentence |
| Bryson, *Robots should be slaves* (A, Crossref) | "Robots should not be described as persons, nor given legal nor moral responsibility for their actions. Robots are fully owned by us…" | "Bryson argues that robots should not be treated as persons or held legally or morally responsible for what they do, since people own and direct them. She says treating robots as persons also leads to poor decisions about people's resources and responsibilities." | supported |
| Muennighoff et al., *MTEB* (A, OpenAlex) | "Text embeddings are commonly evaluated on a small set of datasets from a single task…" | "MTEB is a benchmark that tests text-embedding models (systems that turn text into numbers for computers to compare) on 58 datasets across 8 task types and 112 languages. Its main finding is that no single embedding method performs best on every task." | supported; gloss allowed |
| Lamme, *Towards a true neural stance* (A, **S2 TLDR**) | "It is argued that introspective or behavioral observations are considered the gold standard…" | "Lamme argues that introspective or behavioural reports are treated as the gold standard that brain measures must be matched to. He says this creates serious problems…" | supported, but by a machine summary, not the author |
| Chalmers, *Could a large language model be conscious?* (A, S2) | "…it is quite possible that these obstacles will be overcome in the next decade or so. I conclude that … we should take seriously the possibility that successors … may be conscious" | "…but that their successors may well be within a decade or so." | **not in evidence**: "may well be" overstates "take seriously the possibility" |
| Searle, *Minds, brains, and programs* (A, OpenAlex abstract of a Routledge reprint) | "…strong artificial intelligence must be false… The robot would have a television camera… Such a robot would have genuine understanding and other mental states." | "…He holds that a robot with cameras, limbs and a computer brain could have genuine mental states." | **not in evidence, and the opposite of Searle**: the "abstract" is stitched sentences that include the robot reply he rejects, and its quote passed |
| Graziano, *Rethinking Consciousness* (B, WorldCat) | "Neuroscientist and psychologist Michael S. A. Graziano puts forward a groundbreaking new theory…" | "This popular science book by Princeton neuroscientist Michael Graziano lays out his attention schema theory…" | **not in evidence**: "Princeton" and the theory's name are from memory |
| Rosenstiehl & Petitot on "command trees" (B, essay) | *A Thousand Plateaus* at theanarchistlibrary.org: the citing text itself | "This is a 1974 article by Rosenstiehl and Petitot, as Deleuze and Guattari quote it…" | **wrong evidence**: passed `readFind` as a page that names the work. `resultIsTheWork` said secondary, and the rule did not stop it |
| Chollet, *On the measure of intelligence* (B, arXiv, primary) | the arXiv abstract | "Chollet argues that measuring how well an AI or person does at one task … does not measure intelligence…" | supported |

## Failures, and their classes

1. **A garbled registry abstract.** Searle's OpenAlex "abstract" (a Routledge reprint chapter)
   is a stitch of sentences that includes the position he argues against. HTML entities
   (`&s;`) survive too. A quote check cannot catch this, because the quote is genuinely there.
   Prefer the author's abstract from Crossref, arXiv or S2 over OpenAlex for a reprint
   (`book-chapter` on a `10.4324/…` DOI), or skip reprints.
2. **Memory fills gaps on web evidence** (B: 8 of 48 sentences). Affiliations, model names,
   dataset sizes, and a whole blurb over an abstract-less arXiv page. The quote check caught
   only the last.
3. **The citing article as evidence** (B, the essay). For a description row, the only pages
   that "name the work" are the citing article and its copies. The kept page should never be
   a copy of the article being read, and secondary pages need a stronger rule than
   `readFind`'s.
4. **A review shares the book's exact title.** The strict title rule matched *The
   Intentional Stance* to DOI 10.2307/2185215, a journal record, and *Consciousness in Action*
   to a JSTOR record. Here the evidence S2 attached was the publisher's description of the
   book, so the blurb was right, but the identity was not proven. A book should be matched by
   type (book/monograph) or not by title at all.
5. **Rows with no title.** 17 description rows and every author–year label are out of A's
   reach by construction, and B's identity checks cannot hold for them. Bibliography's own
   extraction is the limit here, not the blurb. Two other production bibliographies were
   passed over for exactly this: `cf58f84…` (63 of 63 rows are labels like "Acemoglu
   (2025)") and `pnas-202123432…` (55 rows with no authors or years, and titles that are
   descriptions).
6. **The keyless registries are slow and unreliable.** Semantic Scholar returned 429s
   throughout. The lookups took 2–4 minutes an article, almost all of it S2's throttle and
   retries, and SWE-bench (on arXiv, but cited without a link) was missed. OpenAlex's keyless
   *search* budget for this box's IP was exhausted on the day ("Insufficient budget … resets
   at midnight UTC"), though single-DOI lookups still answered. The repo has no OpenAlex or
   S2 API key: `related-work.ts` sends only `mailto`.

## Gates

| Gate | A | B | A+B |
|---|---|---|---|
| Coverage ≥ 60% | **pass** on both papers (70%, 79%); **fail** on the essay (0%) | pass on the papers, fail on the essay | pass on the papers, fail on the essay |
| ≤ 5% unsupported sentences | **pass, narrowly** (4.6%), with one inversion | **fail** (17%) | fail (B's share) |
| 0 wrong work | **pass** (identity hand-checked; see failure 4) | **fail** (1 of 24) | fail |
| ≤ $0.05 / 40-work article | **pass** (~$0.008) | **fail** (~$0.32) | **fail** ($0.06–0.17) |

## Recommendation

- **Build arm A, run when Bibliography is made**, for every work with an arXiv id, a DOI, or a
  title the strict rule confirms. It costs about a cent an article and covers about
  three-quarters of a paper's works. Carry over from the spike: the opaque indices, the
  fences, the quote check, the strict title rule, the abstract-before-TLDR preference, and a
  label saying which (*from the abstract at arxiv.org* / *from a machine summary at Semantic
  Scholar*).
- **Fix before shipping:** prefer Crossref, arXiv or S2 over an OpenAlex reconstruction for a
  reprint chapter; refuse a title match to a non-book record for a book; strip entities; size
  Haiku's ceiling for its thinking. Get free API keys for S2 and OpenAlex (a question for
  Greg: they are accounts in his name), or the lookup stage stays minutes long and flaky.
- **No web search per work.** If B exists at all, it is the clicked work only, under
  `resultIsTheWork` (primary only, never secondary), with a quote check and a refusal of any
  copy of the citing article. At ~$0.008 a press, that is *Ask in chat*'s territory, and
  *Ask in chat* already does it with more care.
- **An essay gets no blurbs**, and should say nothing rather than guess. The fix for essays is
  Bibliography extracting real titles, not a blurb step.

**For Greg** (the product question the plan anticipated): run A on every work when
Bibliography is made (~1¢), or only when the band opens? The numbers say on every make: it is
cheaper than one web search.

## Spend

Production arms through the gateway, all recorded in the local ledger as `eval`. Arm A cost
$0.0156 per run, and ran twice (the first had one batch cut off by thinking). Arm B cost
$0.29 and then $0.28 (the first run hit the 800-token ceiling). **Total $0.61.** The Opus
judge was a Claude subagent: not OpenRouter, and not in these figures.

## After the build: the shipped code on the same fixtures (2026-10-18)

The design's § 7 *Eval after the build*
([261017h-stage-3-design-citation-blurbs.md](../plans/261017h-stage-3-design-citation-blurbs.md)):
a `production` phase in `evals/citation-blurbs-spike.ts` that calls the shipped `collectEvidence`
(src/citation-evidence.ts) and `writeBlurbs` (src/citation-blurbs.ts) — the writer, code's quote
and length rules, the separate check per work and its one retry — on every work of the three
fixture articles, title search on. No Semantic Scholar, no arXiv API, OpenAlex only for a DOI the
registries hold without an abstract. Then an Opus subagent judged every kept sentence, as in the
spike, and I checked every title-search match against Crossref's own record by hand.

**Clean runs** (no registry cooldown during the run):

| | Butlin (70 works) | Coding benchmarks (33) | *Rhizome* essay (19) |
|---|---|---|---|
| Works with an abstract | 30 | 21 | 0 |
| **Notes kept** (coverage) | **28 (40%)** | **21 (64%)** | **0 (0%)** |
| No note, by reason | not found 25 · no abstract 14 · no identifier or title 1 · failed check (too long) 2 | not found 8 · no abstract 3 · conflict 1 | not found 14 · no identifier or title 5 |
| Model calls (writer / check) | 3 / 31 | 3 / 24 | 0 |
| Refused by code, then retried | 5 refused, 3 not supported, 6 retried | 2 refused, 3 not supported, 5 retried | – |
| **Cost** (ledger, `withLedger`) | **$0.0161** | **$0.0092** | $0 |
| Wall time: lookups / model | 16 s / 56 s | 3 s / 34 s | 4 s / – |

**Faithfulness** (Opus judge, all 75 sentences of the 49 notes): **74 supported, 1 not in
evidence (1.3%), 0 wrong work**, 1 that only restates its title. The one: Dulberg et al.'s note
said the agents explored "rather than from an outside reward for trying new things", where the
abstract says only "intrinsic and emergent rather than extrinsically imposed". The spike's arm A was
4.6% with one inversion; the check call (G4) is the difference. 26 of the 49 notes have two
sentences, although the prompt asks for one by default.

**Identity of the title-search matches, by hand**: all 19 rows found by Crossref title search (17
kept notes, 2 failed checks) were fetched again from Crossref by their DOI and compared with the
citation: **19 of 19 are the cited work** (same title, or the title without its subtitle; same
first author; same year, Dulberg's preprint a year earlier). Four are whole-book records
(`edited-book`: Carruthers, Lau, Ginsburg & Jablonka, Clark), two are preprint servers'
`posted-content`, two `book-chapter` — each the work the article cites.

**Coverage against the 60% gate**: the coding paper passes (64%), **the reported paper fails
(40%)**, under the design's own estimate of ~56% without Semantic Scholar. Its misses are mostly
`not-found` (25 title searches Crossref could not match under the strict rule) and `no-abstract`
(14 records Crossref holds without an abstract — books and older journals). That is the keys
question, [q-ny49p3](../user-feedback/questions/q-ny49p3.md), again.

**Three of the five runs hit a Crossref cooldown, and that is a finding about the design.** The
first runs of all three articles, back to back, met a 429 or 503 from Crossref during the title
searches (or the cooldown one had left); the shared limiter then cools Crossref for a minute
(`bibliographic_services.cooldown_until`), and every row still to ask ends `transient:
cooling-down`: **9 of 19, 11 of 33, and 36 of 70**, which left Butlin at **13 notes (19%)** instead of 28.
A transient row is retried only by the next run, and by G2 only a publication or a press starts
one, so on a real article those works would show nothing until the owner made the list again or
pressed *Notes on cited works*. At the time, neither way out was built. The Stage 3 code review
then took the first: wait out a short shared cooldown inside the run when the lookup budget and
claim deadline allow, respecting Crossref's `Retry-After`; each retry still counts towards the
60-query cap. Letting the band's open read queue another run for a `:partial` artefact remains
unbuilt: it spends another model call, so it is a product decision rather than a review fix.

**Spend for this section: $0.045** over five runs (`withLedger`'s lines: $0.0107, $0.0090,
$0.0161, $0.0092, and $0 for the essay twice). The judge was a Claude subagent, not in it.

```
npx tsx evals/citation-blurbs-spike.ts production --fixture <bibliographies.json> --slug <slug> --work <dir>
```

## Reproduce

```
# fixture: [{slug, title, bibliography}] from a read-only SELECT on article_revisions (not committed)
npx tsx evals/citation-blurbs-spike.ts registry --fixture <bibliographies.json> --work <dir>
npx tsx evals/citation-blurbs-spike.ts blurbs --work <dir>          # spends ~$0.02
npx tsx evals/citation-blurbs-spike.ts search --per-article 12 --work <dir>   # spends ~$0.29
npx tsx evals/citation-blurbs-spike.ts judge-input --work <dir>
# judge: an Opus subagent writes <dir>/judge-labels.json (shape in reportPhase)
npx tsx evals/citation-blurbs-spike.ts report --work <dir>
```
