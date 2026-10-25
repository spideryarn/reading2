# Sources on six real articles: Search the literature against Reception, Cited by and Not cited

Owned by [investigations.md](../project/investigations.md). 2026-10-25. It informs the proposals in
[261025c](../plans/261025c-sources-proposals-what-it-shows-first-and-fewer-sub-modes.md), and
follows the spike and first runs in
[261024b](261024b-situate-spike-searches-into-one-read-cost-and-quality.md).

**The question.** Over 22 reports Greg has asked Sources for the same five things: who cited the
piece and whether they agreed; whether its citations hold up; value beyond paraphrasing the
article; the key themes and landmark papers; fewer sub-modes. *Search the literature* (the
experimental `situate` step, [sources.md § Where this piece sits](../project/sources.md#where-this-piece-sits))
was built to be the rich version and had had one real run. Before proposing what Sources should
be, does it work across the kinds of article people actually bring, and what do today's
Reception, Cited by and Not cited find on the same articles?

> I think both are relevant. It depends on whether this is an old or a new article, which is more
> relevant.
>
> — Greg, 2026-10-25, on whether *before* or *after* matters more

## How it was run

On the local stack, never production. Six articles already in the local database, chosen to span
the four kinds the brief named. Each paid step ran through the ordinary queue, as a press would,
so its cost is in the local `ai_calls` ledger under its step:

```
npx tsx scripts/stage.ts bibliography <slug>      # as on import, so Situate and Not cited see what production would
npx tsx scripts/stage.ts citation-blurbs <slug>
npx tsx scripts/stage.ts reception <slug>         # today's Reception: one web search for pages about the piece
npx tsx scripts/stage.ts situate <slug>           # Search the literature
npx tsx scripts/spikes/261025a-sources-trial.ts free <slug>   # Cited by and Not cited, OpenAlex, no model
npx tsx scripts/spikes/261025a-sources-trial.ts dump <slug>   # every artefact and the ledger
python3 -I scripts/spikes/261025a-sources-report.py <slug>    # one readable page per article
```

[`261025a-sources-trial.ts`](../../scripts/spikes/261025a-sources-trial.ts) refuses a database
that is not local. The outputs are in `output/sources-trial/` (gitignored, because they hold article
prose and model text); this page quotes what it needs. Situate's allowance is four runs an hour, so
the last two ran an hour after the first four. Claims was not run: it lists claims for the reader
to check, which Situate's searches already cover.

## Results

| Article | Kind | Reception | Cited by | Not cited | Search the literature |
|---|---|---|---|---|---|
| Clark & Chalmers, *The Extended Mind* (1998), PDF, no DOI | old, very well cited, philosophy | **0 rows** ($0.07) | **no-match**: OpenAlex holds it twice (5,514 and 673 citers), and two passing records count as none | 19 rows; 4 are **the piece itself** in translation or reprint, 1 the anthology that reprints it | theory / since. **10 findings, $0.26, 43 s** |
| Srivastava et al., *Dropout* (JMLR 2014), no DOI | old, ~33k citers, ML | **0 rows** ($0.07) | 33,410 via title; the top 15 (DenseNet, BatchNorm, EfficientNet…) say nothing about dropout | 22 rows; surveys, and the authors' own 2012 precursor (whether the piece cites it could not be checked: the local copy has no reference list) | empirical / since. **10 findings, $0.32, 37 s**, 36 citers' abstracts read |
| Gloaguen et al., *Evaluating AGENTS.md* (arXiv, Feb 2026) | recent, few citers | **0 rows** ($0.07) | 1 citer | 19 rows | empirical / now. **11 findings, $0.32, 41 s** |
| Anil Seth, *The Mythology of Conscious AI* (Noema essay, 2025), pasted, no address | non-academic essay | 1 row: a blog's "Part 1" summary, *nothing new here* ($0.07) | no DOI | 24 rows, a few relevant (Bengio & Elmoznino's *Illusions of AI consciousness*) | position / now. **9 findings, $0.31, 59 s** |
| Scott Alexander, *Heuristics That Almost Always Work* (blog, 2022) | blog post, no bibliography | 1 row: **Zvi Mowshowitz's reply**, *Rock is Strong* ($0.07) | no-match (no record) | 22 rows, against an empty bibliography, so every paper near the topic is "not cited" | position / since. **12 findings, $0.26, 47 s** |
| Butlin, Long et al., *Consciousness in AI* (arXiv 2023) | awkward: OpenAlex's record has another paper's title | 1 row: a Substack critique of its functionalism ($0.05) | before the fix: **unconfirmed**. After: **196 citers** | 18 rows, 5 excluded | review / since. **13 findings, $0.48, 50 s**, 30 citers' and 28 cited works' abstracts read |

### What Search the literature found, against what a careful reader would expect

**The Extended Mind.** Adams & Aizawa's *coupling–constitution fallacy* beside the passage it
attacks, with Clark's reply; Rupert's *embedded* rival and its simplicity argument turned against
the piece; the Notre Dame review of *Supersizing the Mind* on primacy and negative transfer; a
later Tetris study finding "complementary actions decrease with expertise", against the Kirsh &
Maglio case the piece leans on; *There Is No Argument that the Mind Extends* (J. Phil.) on the parity
principle; the Stanford Encyclopedia on cognitive bloat and the conscious-endorsement condition;
Menary's *second wave*, and enactivism; smartphone and "Google effect" studies; Clark's 2025
*Nature Communications* piece applying the thesis to generative AI. A philosopher of mind would
list nearly exactly these. Missing: the 2010 Menary anthology as the hub of the debate, and
Chalmers' own later retrospective. One source's title is a PDF's footnote ("For arguments in
support of HEC, see…"), which is the page's text, not a title.

**Dropout.** A 2017 JMLR paper's counterpoint to "prevents co-adaptation"; Wager et al. on dropout
as adaptive regularisation; Gal & Ghahramani's Bayesian reading, and Hron et al.'s pitfalls in it;
DropBlock on why plain dropout is weak in convolutional layers; the 2019 batch-norm "disharmony"
paper; a 2025 ACL paper on dropping dropout in LLM pre-training; Maxout's evidence that the
weight-scaling approximation holds. This is the history an ML researcher would tell. One *Not
cited?* (DropConnect) is fair; one *Reception* finding (Google's dropout patents) is true but
marginal.

**Evaluating AGENTS.md (angle *now*).** The best result of the six, because it is the kind a
reader could not find alone: the paper's wording **softened between arXiv versions** ("tend to
reduce task success" to "no significant effect", AGENTbench renamed CTXbench); the headline 7%
margin rests on p = 0.038 and the gain over no file is not significant; secondary reports quote an
earlier version's 4-point figure; two later small studies, a rule-file study it missed, and
SWE-bench Verified's contamination. Before and after, as Greg's answer expected for a new paper.

**The Mythology of Conscious AI.** It found the essay's scholarly twin, Seth's *BBS* target article,
and its ~50 commentaries, and put specific commentaries beside the passages they answer
(Reichert on what the argument actually shows; a commentary arguing prediction and self-maintenance
are computational); a 2026 *Nature* piece making the same false-positive asymmetry claim; the
numbers in Chalmers' paper that the essay does not give; Anthropic's introspection work. For an
essay with no DOI and two cited works, all of this came from the searches.

**Heuristics That Almost Always Work.** The weakest of the six, and the most instructive. Good:
fluvoxamine's later mixed record (a 2023 *JAMA* trial and a meta-analysis) beside the passage that
mocks the sceptic for condemning it; Taleb as the closest literature, which the author's own edit
raises; the forecasting newsletter that read it the other way. Weaker: several *Supported* findings
are background from neighbouring fields (hurricane-evacuation false alarms, information-cascade
models), true but not about this post. And it **missed the direct reply Reception found**, Zvi
Mowshowitz's *Rock is Strong*. A careful reader would want the replies by other writers first.

**Consciousness in AI, after the fix.** 13 findings, all kept: the authors' 2025 *TiCS* follow-up;
Pennartz's 2026 challenge and their reply; Seth's *BBS* biological naturalism; the 2025 *Nature*
adversarial collaboration and the workspace theorists' reply to it; an embodied agent claimed to
meet all four workspace indicators; the IIT "pseudoscience" letter. And **the trial's only
*Citation?* finding**: the report leans on Conwell & Ullman 2022, whose own abstract is starker
(about 22% of images matched basic relation prompts). The fix let the read see 30 citers'
abstracts, **but no finding cites one**: on this paper the citer list added evidence and no
finding. The cost, $0.48, is the highest of the six, because of the longer article and the 58
abstracts.

### Cost and time

Measured from the local ledger by
[`261025a-sources-cost.ts`](../../scripts/spikes/261025a-sources-cost.ts), for this trial's steps only:

| Step | Per article | Notes |
|---|---|---|
| Search the literature | **$0.26–0.48, mean $0.33**; 37–59 s | 18 calls: plan, 16 searches, read |
| Reception | $0.05–0.07; 11–17 s | 2–4 searches |
| Bibliography | $0.02–0.30 | already made on import in production |
| Cited by, Not cited | no model; 0.5–5 s | OpenAlex, anonymous allowance |

**The whole trial: $3.03** across the six articles. (The ledger also holds $0.84 of calls with no
article in the same window: other agents on the shared local database, not this trial.)
GPT Sol's two reviews and the Opus consultation were not metered calls.

## Failures, and what was fixed

1. **The "wrong DOI" was the right record with the wrong title** (fixed, `5ba104f5a`). OpenAlex's
   W4386113651 is arXiv 2308.08708: right DOI, right authors, and 196 citers that are plainly this
   report's (*The Edge of Sentience*, *Tests for consciousness in humans and beyond*). Zenodo
   deposits merged into its locations gave it one of their titles, *Cheap Correlate or
   Discriminating Property?…*, so the title check refused it, in Cited by and in Situate alike. Now
   an arXiv paper read from its own arxiv.org address, whose DOI that address names, is confirmed
   by two of its structured authors matched one-to-one; every other DOI keeps the title rule. GPT
   Sol reviewed it and tightened it twice (the address binding, and one-to-one author matching:
   [261025a-code-review-sol.md](261025a-code-review-sol.md)). The test was red before.
2. **A classic held twice in OpenAlex gets no Cited by** (not fixed; a rule someone chose).
   *The Extended Mind* is W393180982 (*Analysis*, 5,514 citers) and W4239232206 (Wiley's DOI, 673).
   `titleMatchOf` refuses when two records pass, and its test says so on purpose: *"the most cited
   is not evidence"*. Two records with the same whole title, the same authors and the same year are
   one work, and their citers could be taken together. Changing that loosens an identity rule, so it
   is in the proposals rather than done here.
3. **Not cited lists the piece itself** (not fixed). It excludes the piece by identity and title,
   and a translation (*La mente extendida*), a reprint with a translated title, or the anthology
   that reprints it is neither. Four of the 19 rows for *The Extended Mind*. A row that shares the
   piece's authors and is a version of its title should go.
4. **Reception found nothing about three of the six, and one page each about the other three**,
   and the three with nothing include two of the most discussed papers in their fields. On *The Extended Mind* the one page it reported was lost to the directness
   check; on Dropout and AGENTS.md it reported none. Its search is for pages *about this piece by
   name*, and a classic's reception is in papers that discuss its argument, which Situate's
   planned searches find and Reception's do not.
5. **Cited by's most-cited citers are the wrong sample for a classic, and the right one for
   anything smaller.** For a landmark, the most-cited papers that cite it cite it in passing.
   [`261025a-topic-citers.py`](../../scripts/spikes/261025a-topic-citers.py) asks OpenAlex for the
   citers whose title or abstract contain **OpenAlex's own top keyword for the work** (code-owned
   words, nothing a model wrote, nothing new sent), and keeps each query and answer:

   | Piece | All citers, most cited first | Filtered by its top keyword |
   |---|---|---|
   | Dropout | 33,410: DenseNet, BatchNorm, He et al., EfficientNet | *dropout*, 2,242: BatchNorm, Gal & Ghahramani's Bayesian dropout, CutMix, … |
   | *The Extended Mind* (both records) | 5,849: Clark's *Whatever next?*, *Supersizing the Mind*, … | *extended mind*, 556: Sterelny's *Minds: extended or scaffolded?*, Rupert's *Cognitive Systems and the Extended Mind*, Gallagher's *The socially extended mind*, … |
   | *Consciousness in AI* | 196: *The Edge of Sentience*, *Tests for consciousness in humans and beyond*, … | *artificial consciousness*, 10: the best two are lost, because the keywords are the merged Zenodo record's |
   | *AGENTS.md* | 1 | the same 1 |

   So for a piece with thousands of citers, filtering by its keyword gives a list close to the
   "landmark papers" Greg asked for, free. For a few hundred or fewer it gains nothing or loses the
   best ones. It is keyword matching, not judgment: it misses synonyms and papers without
   abstracts, and is a route into the debate rather than a claim about who matters. And on the one
   article where the read did see citers' abstracts with a good identity (*Consciousness in AI*, 30
   of them), **no finding cited one**; Dropout's 36 likewise produced none. Reading the right
   citers is untested; reading the most-cited ones did not pay.
6. **The query cleaner takes "AGENTS.md" out of queries and prose** (not fixed). `withoutAddresses`
   removes anything shaped like a host, and `.md` is Moldova's domain, so the first query was
   *"Evaluating : Are Repository-Level Context Files Helpful…"*. It is a defence against a page
   steering a search to an address (S3 in plan 261024o), so loosening it is not a quiet fix; it cost
   one query here.
7. **Citation? appeared once in six.** It needs an abstract note on a cited work (`A` evidence);
   only AGENTS.md (13) and *Consciousness in AI* (28) had linked works with notes, and the one
   finding is *Consciousness in AI*'s Conwell & Ullman. "Do its citations hold up" is still barely
   served.
8. **Bibliography linked no works on the two PDFs** (*The Extended Mind*, Dropout: "0 linked"),
   so Situate had no cited abstracts there either. Not investigated further here.

## What it decided

- **Search the literature found named debate on all six**, including a pasted essay and a blog
  post with no bibliography, for $0.26–0.48 (mean $0.33) and 37–59 seconds a run. On five of the
  six, what it found is what a careful reader in the field would point to; on the blog post it was
  thinner and missed the one direct reply. It is the only sub-mode that answered "who said what
  about this, for or against" on any of them, **but mostly from web searches**: it read citers'
  abstracts on two articles, and no finding came from one.
- **Reception, as one search for pages about the piece, adds little beside it**: three rows in
  six articles. Two are the kind it exists for, a named reply by another writer (Zvi Mowshowitz's
  *Rock is Strong*, which the dossier missed; a Substack critique of the consciousness report), so
  its search is worth keeping as one of the dossier's queries rather than as a sub-mode of its own.
- **Matching the piece to its own records is now the bottleneck**, not the model: a paper held
  twice, a retitled record, translations of itself, an essay's scholarly twin.
- **Citers filtered by OpenAlex's keyword are the cheapest real gain for a classic**, and close to
  the "landmark papers" ask; not for anything with a few hundred citers or fewer.

The proposals built on this are
[261025c](../plans/261025c-sources-proposals-what-it-shows-first-and-fewer-sub-modes.md).
