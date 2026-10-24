# Situating a paper in the literature: how researchers read and check

Owned by [research.md](../project/research.md). Report `spya-w95xmq` (#689), session `fbw95xmq-sources-situate`. Written 2026-10-24.

**What this is for.** We are about to build a hands-free first pass for Sources: many cheap web searches
about a paper and its claims, read by a mid-size model, shown as margin annotations beside the passages
they concern plus a structured panel. This doc is the evidence on what to look for, what to ask, and how
to show it. It adds to, and does not repeat, the earlier work:
[261009b (what a reviewer needs)](261009b-what-a-peer-reviewer-needs-and-where-sources-and-referee-divide.md),
[261009b (Sonnet web pass)](261009b-peer-reviewer-web-pass-sonnet.md), and the evidence files
[07](261010a-reading-and-learning-evidence/07-trusting-ai-text-vs-the-source.md),
[18](261010a-reading-and-learning-evidence/18-critical-reading-and-sourcing.md) and
[19](261010a-reading-and-learning-evidence/19-search-and-foraging.md) (skimmed headings only).

**How to read the source tags.** **[fetched]** means I read the page this session. **[summary]** means I
saw it only in a search-result summary (a model's gist of the page), so the figure is second-hand. Several
primary pages (PMC, PeerJ, ACM, scite) refused the fetch tool (403, or a browser check); those are marked
**[summary]** even where the paper is well known.

## The short answer

- **Check citations by claim, not by reference.** About one citation in seven to four does not support
  what it is cited for (pooled 14.5% by Mogull 2017, 25.4% by Jergas and Baethge 2015; the gap is
  mostly method). Over half of those errors are "major": the source does not back, is unrelated to, or
  contradicts the claim. So the cheap, high-yield check is: for each load-bearing claim with a
  citation, fetch the cited paper's abstract or text and ask "does this say that?" Spend it on
  load-bearing, specific, number-carrying claims, not on "see X for a review".
- **The strongest post-publication signal is rare, so say so when it is absent.** Citing sentences
  that disagree are well under 1% of all citation statements (scite's own data, second-hand), and about
  93% merely mention. A first pass will usually find nothing contrasting. Silence must not be shown as
  "all clear"; show "searched these places, found nothing".
- **Retraction and correction checks are cheap and near-deterministic: do them first and for every
  reference, not just the paper.** Crossref exposes the Retraction Watch data free through the REST API.
  Most papers that cite a retracted paper do not say so (5.4% acknowledged it in one large biomedical
  sample), so a reader will not notice unaided. This is the one place a firm flag is justified.
- **"What has changed since" has four distinct kinds, and each wants a different search:** (1) the
  paper itself retracted/corrected/under concern; (2) a replication or failed replication; (3) a later
  meta-analysis or review that supersedes it; (4) a critique (PubPeer thread, comment, letter).
  Replications are rare (about 1% of psychology papers are replications), so absence is normal, and
  the first three can only be found by title-and-claim search, not by the citation graph alone.
- **Ask different questions by type and age.** Empirical paper: sample, measures, effect size against
  later estimates, replication. Review or theory: scope and omissions, who disputes the framing,
  what the field calls this now. New paper: preprint or published, what changed between versions
  (7-17% of preprint abstracts had a conclusion change; most were small), who has reacted. Old paper:
  what has been said since, whether the method or the data have since been questioned.
- **Margin notes should be forward-citation commentary anchored to a passage, few, and dismissible.**
  The only controlled evidence (CiteRead, 12 scientists, second-hand) says localised citing-paper
  context beat a plain list of citing papers for comprehension and retention. CiteSee's logs: 88.6% of
  inline citations were left unaugmented on purpose, and the highlighted minority drew 4.5 times its
  share of opens. Selectivity is the feature.
- **Cap categories and density; offer a list view for the rest.** CiteSee users were "initially
  overwhelmed by five augmentation types" and the authors added a list view. The Semantic Reader
  survey: "too few highlights will present the guise of an inept tool, and too many will slow a
  reader down." We found no published number for "too many margin notes"; treat the cap as something
  to measure in our own use.
- **Make every note checkable in one click, with the quoted sentence and a link.** AI tools that cite
  sources are often wrong about what the source says: in a 2023 audit of generative search engines only
  51.5% of statements were fully supported by their citations and 74.5% of citations supported their
  statements, while answers were rated highly fluent. A margin note that asserts "this citation does
  not support the claim" without both passages side by side is a verdict we cannot back.
- **Word findings as observations with their uncertainty, never as verdicts.** "The cited paper
  reports X in mice; this passage says humans" invites the reader to look; "this is wrong" replaces
  their reading. This matches the vision and the finding that reviewers miss most planted errors anyway
  (see 261009b), so the opportunity is prompting attention.
- **Avoid:** citation counts as quality signals in the margin (rich-get-richer bias, flagged by the
  Semantic Reader authors); classifier labels shown as fact (scite's own supporting and contrasting
  labels are 64% and 59% accurate per its developers, second-hand); and unbounded "related work"
  lists, which are what Connected Papers-style tools already give.

## 1. How researchers situate a paper

**What the surveys say.** Tenopir and King's long-running faculty surveys (US science faculty,
self-reported, repeat reads counted separately) **[fetched]**
([dlib 2008](https://dlib.org/dlib/november08/tenopir/11tenopir.html)):

- Where readings came from, 1977 to 2005: browsing fell from 58.5% to 33.9%; automated searching rose
  from 0.7% to 23.1%; following citations rose from 6.7% to 14.9%.
- Age matters. Recent articles are mostly found by browsing (52.6% of 2005 articles). For articles more
  than ten years old nearly 80% are found by search or citation links. For pre-1996 articles, citations
  gave 46.9% and searching 32.8%.
- Time per reading fell from 48 to 31 minutes; readings per year roughly doubled; total reading time
  about 144 hours a year. Only 37.8% of readings were "absolutely essential" to the main purpose.
- The authors argue reading has broadened while citing has narrowed: many more articles are read than
  cited.

**What this implies.** Citations are a major route to older work, so for an old paper the reader
likely arrived by a citation chain and has not seen newer work; for a new paper they arrived by
browsing or an alert and have no idea what has come since. Readers have about half an hour for a
paper, which is the budget for any annotation layer.

**Forward and backward chaining.** Library guides present backward searching (read the references)
and forward searching ("Cited by" in Google Scholar, Scopus, Web of Science) as a pair, and say forward
chaining is how you find what came after **[summary]**
([Williams College guide](https://libguides.williams.edu/citationsearching/forward),
[ResearchRabbit](https://www.researchrabbit.ai/articles/backward-vs-forward-citation-search)).
A study of Cochrane reviews found 172 reviews reported backward citation searching and only 18
forward **[summary]** ([PMC7079050](https://pmc.ncbi.nlm.nih.gov/articles/PMC7079050)). Even
professional searchers skip the forward direction, which is the one that tells you whether a paper has
been overtaken. That is the gap an automatic first pass can fill.

**Reading method guides.** Keshav's "How to Read a Paper" (three passes; the first is five to ten
minutes and decides whether to continue; also covers literature surveys) **[summary]**
([PDF](https://www.cs.princeton.edu/courses/archive/fall10/cos597B/papers/howtoread-keshav.pdf)).
It is advice, not behavioural evidence. Our skim mode already follows its shape.

**Dead end.** I found no interview or observational study of *how researchers decide a paper is still
current* (what they type, which sites, in what order). The searches returned library how-to guides
only. Treat the Google Scholar / Semantic Scholar / PubPeer / blog / X workflow as practitioner
folklore, not evidence. A small interview round with two or three of Greg's academic contacts would
be worth more than another search.

## 2. Citation accuracy

**Pooled error rates.**

- Jergas and Baethge 2015, *PeerJ*: 28 studies from 559 screened; total quotation error 25.4% (95%
  CI 19.5-32.4); major about 11.9%, minor about 11.5%; lowest single estimate 6.7%; no sign of
  publication bias. Accuracy defined as whether the reference supports the statement. A major error is
  a reference "not at all coherent" with the claim. **[summary]**
  ([PMC4627914](https://pmc.ncbi.nlm.nih.gov/articles/PMC4627914/),
  [PeerJ](https://peerj.com/articles/1364))
- Mogull 2017, *PLoS ONE*: recalculated per quotation rather than per reference, 15 studies, 14.5%
  (95% CI 10.5-18.6). Of the content errors, 64.8% major (source fails to back, is unrelated to, or
  contradicts the claim) and 35.2% minor (oversimplification, overgeneralisation). Improper indirect
  citations (citing a secondary source for a primary claim) 10.4%, counted separately. **[summary]**
  ([PMC5599002](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5599002/))
- A 2025 update by Baethge and Jergas in *Research Integrity and Peer Review* reports quotation
  inaccuracy remains prevalent with no sign of improvement; I did not retrieve its pooled figure.
  **[summary]** ([Peer Review Congress abstract](https://peerreviewcongress.org/abstract/quotation-inaccuracy-in-medicine-a-systematic-review-and-meta-analysis/),
  [Cologne repository](https://kups.ub.uni-koeln.de/80931/))
- Why 14.5% and 25.4% differ: 25.4% pools figures that mix per-reference and per-quotation counts;
  Mogull argues per-quotation is the right unit. Say "roughly 15 to 25%, in medicine".
- These studies are in **medical** journals. I found no equivalent pooled figure for computer science,
  economics or humanities. Do not claim the rate transfers.

**Which kinds are wrong.** From the two reviews above: the major kind (source does not support, is
unrelated, or contradicts) outnumbers the minor kind (overstated, oversimplified), and indirect
citation is a distinct fault. The reviews I could reach do not give a breakdown by claim type
(statistics vs background). My inference, not a finding: numbers, causal claims and "has been shown
that" sentences are the likeliest to be distorted, and "for review see" the least checkable.

**Citation distortion.** Greenberg 2009, *BMJ*: a citation network of 242 papers and 675 citations on
one claim (beta-amyloid in inclusion body myositis). Authority grew through citation bias against
papers that weakened the claim, through "amplification" by papers with no data on it, and through
"invention" (a hypothesis cited until it read as fact); the same pattern appeared in NIH grant text.
**[summary]** ([PubMed 19622839](https://pubmed.ncbi.nlm.nih.gov/19622839/),
[PMC2714656](https://pmc.ncbi.nlm.nih.gov/articles/PMC2714656)). Secondary commentary reports that
six of the ten most authoritative papers had no primary data; I could not verify that.
Implication: a claim cited many times is not thereby supported. The useful check is "trace the claim
back to the paper that has the data", which is a backward chain of one or two hops.

**Citing retracted work.** Of 13,252 post-retraction citation contexts in biomedicine, 722 (5.4%)
acknowledged the retraction, and retraction did not change how the paper was cited. Other samples
range from 6% to about 26% **[summary]**
([PMC9520488](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9520488/),
[Retraction Watch 2015](https://retractionwatch.com/2015/07/14/half-of-anesthesiology-fraudsters-papers-continue-to-be-cited-years-after-retractions)).
Same implication: a paper's reference list is a place to look for retracted work, and it is cheap.

**What fraction is worth checking.** There is no study answering this. A paper has about 40 inline
citations (CiteSee's logs, **[fetched]**); at 14 to 25% bad, an average paper would hold 5 to 10
unsupported citations, but most of them are on background sentences nobody leans on. My suggestion:
check the five to ten claims the paper's own argument rests on, which is what the Claims mode
already extracts, and check them against the abstract first.

## 3. What changes the picture after publication

**Retractions, corrections, concern.**

- Crossref publishes the Retraction Watch data (daily updates). Retractions appear in the `update-to`
  field; filter `update-type:retraction`; each record's `source` says `publisher` or
  `retraction-watch`. Also a CSV from `gitlab.com/crossref/retraction-watch-data`. **[fetched]**
  ([Crossref docs](https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/))
- Size: over 25,000 by April 2021 and over 37,000 by end of 2022 **[summary]**
  ([Retraction Watch](https://retractionwatch.com/2021/04/02/25000-thats-how-many-retractions-are-now-in-the-retraction-watch-database),
  [2022 review](https://retractionwatch.com/2022/12/27/nearing-5000-retractions-a-review-of-2022)).
  A figure of 63,000 appeared on a commercial page I could not verify; do not quote it.
- OpenAlex has an `is_retracted` flag derived from Retraction Watch, but it collapses any
  update notice into "retracted", so it produced false positives in a 2024 pull (47,720 records,
  some wrong), and lags Crossref **[summary]**
  ([Hauschke and Nazarovets](https://arxiv.org/pdf/2403.13339)). Use Crossref as the source and
  OpenAlex only for discovery.
- Zotero warns on retracted items via the Retraction Watch data, for items with a DOI or PMID
  (about three-quarters of the data), and does not alert on "cause for concern" notices **[summary]**
  ([University of Melbourne](https://blogs.unimelb.edu.au/researcher-library/?p=3790)). So
  expressions of concern are the poorly covered category: search for them by text.

**Replications.** Open Science Collaboration 2015: 100 psychology studies from 2008; 36% of
replications significant against 97% of originals; mean replication effect under half the original; 50%
in cognitive and 25% in social psychology **[summary]**
([CASRAI summary](https://casrai.org/guides/psychology-replication-crisis)). Makel et al. 2012:
roughly 1% of publications in the top 100 psychology journals are replications, 14% of those direct
(the exact 1.07% was not visible) **[summary]**
([Perspectives on Psychological Science](https://www.psychologicalscience.org/journals/perspectives/volume/7/issue/6/)).
So: a replication exists for few papers, a failed one is rarer still, and a search that finds
none is the common, unremarkable result. Where one exists it is worth a margin note.

**Preprint to journal.** Early-pandemic bioRxiv and medRxiv: 7.2% of non-COVID and 17.2% of COVID
abstracts changed conclusions by publication, most not qualitatively; a medRxiv study found 48.9% of
prevention preprints published within 12 months, 4.4% with a major change in effect estimate **[summary]**
([PMC8806067](https://pmc.ncbi.nlm.nih.gov/articles/PMC8806067),
[medRxiv](https://www.medrxiv.org/content/10.1101/2023.05.26.23290551v1)). For a preprint, "is there a
published version, and does the abstract differ" is a cheap, valuable question.

**Citing statements and sentiment.** scite classifies citing sentences as supporting, contrasting or
mentioning. Second-hand figures: about 92.6% mentioning, 6.5% supporting, around 1% or less
contrasting; developer-reported classifier accuracy 97% (mentioning), 64% (supporting), 59% (contrasting)
**[summary]** ([paper](https://scite.ai/reports/scite-a-smart-citation-index-keppkgL5),
[HKUST library guide](https://library.hkust.edu.hk/sc/trial-scite/)). The original was
behind a 403. Meaning: the contrasting class is tiny and the classifier is weakest on exactly that class.
Authors rarely criticise in print, so absence of "contrasting" is weak evidence.

**Critique venues.** PubPeer has browser extensions (Chrome, Firefox) that show a banner when
a page has PubPeer comments, about 4,000 Firefox users **[summary]**
([Firefox listing](https://addons.mozilla.org/addon/pubpeer/)). PubPeer says journals mostly decline
to show its comments themselves. I found no figure for the share of papers with comments; assume
small. Treat a PubPeer thread as a lead that needs reading, since comment quality varies.

**Meta-analyses superseding.** I found no data on how often a paper is overtaken by a meta-analysis.
It is found by searching for the paper's claim (not its title) with "meta-analysis" or "systematic
review", then checking that the paper is among the included studies.

## 4. Questions by paper type and age

The evidence here is thin. Reviewer checklists (CONSORT, PRISMA and the rest of the EQUATOR
network; CASP) exist per study design, but I did not fetch any, and I found no study of whether
tailoring questions by type changes outcomes. What follows is design inference from the above, to be
tested. The shape of the earlier peer-review work in
[261009b](261009b-what-a-peer-reviewer-needs-and-where-sources-and-referee-divide.md) still stands: help
the reader notice; never judge.

| Paper | Ask outwards |
|---|---|
| Empirical result | Is it retracted, corrected, or under concern? Has anyone replicated it or failed to? Do later meta-analyses include it, and with what pooled effect? Does the cited basis for the method say what it is cited for? |
| Review or survey | What recent work does it omit (forward search from its date)? Do its headline claims cite primary data or other reviews (indirect citation, 10.4%)? Have later reviews reframed the field? |
| Theory, opinion, essay | Who answered it, and what did they say? Do its strongest factual claims carry citations that support them? What do others call this idea now? |
| New (under a year) | Preprint or published? If both, what differs? Who has responded so far (PubPeer, blogs, social media)? |
| Old (over five years) | What has been said since (forward chain, restricted to the last few years)? Have its data, method or main claim been challenged? What does the field now call these terms? |
| Any | For each load-bearing claim: does the cited source say it? Any cited paper retracted? |

Tenopir's age finding (old papers reached by citations, new by browsing) supports putting the "since"
question first for old papers and the "where does it sit now" question first for new ones.

## 5. Tools and interface research

**CiteRead (Rachatasumrit, Bragg, Zhang, Weld; IUI 2022)** - the closest precedent to our margin notes.
Places commentary from later citing papers in the margin of the paper, at the sentence it concerns
(or the nearest section header when the localiser is unsure), with a click-through to the citing
paper, the citance, its paragraph and abstract. A model filters citing papers for relevance.
Lab study of 12 scientists: better comprehension and retention of follow-on work than a plain list
of citing papers and sentences. **[summary]** (the ACM page returned 403; sources:
[Semantic Scholar author page](https://openreader.semanticscholar.org/CiteRead),
[Matuschak note](https://notes.andymatuschak.org/z4kayGbfikK87vCDdevq5a5),
[Semantic Reader overview text](https://ar5iv.labs.arxiv.org/html/2303.14334) **[fetched]**, which
says the localisation problem is that "inline citations ... do not typically reference specific
locations in the cited paper".) I did not obtain the formative-study findings or margin-note counts.

**CiteSee (Chang et al.; CHI 2023)** **[fetched]**
([arXiv 2302.07302 via ar5iv](https://ar5iv.labs.arxiv.org/html/2302.07302)). Highlights and
annotates inline citations by the reader's own history.

- Lab study, 10 researchers, 417 ratings: citations the reader had met before ("reencountered") were
  rated more useful for a literature review than SPECTER similarity (about 88% against 58% agree), and
  global citation count and linear order did no better than chance.
- Field study, 6 people, 1-2 weeks: about 41 inline citations a paper, 88.6% left unaugmented;
  reencountered citations were 8.2% of citations but 37% of card opens; 57% of saved papers came
  from inline citations; four of six still used it 62 to 121 days later.
- Noise: some users were "initially overwhelmed by five augmentation types"; highlighted share
  crept up to 13% in the second half-week (an over-saturation risk); a cold start, with no history,
  gave little signal; scroll-time signals were mixed. Users preferred in-context augmentation to a
  list, but the authors added a list view anyway.
- Caveats: tiny, self-selected samples; three papers; short.

**The Semantic Reader survey (Lo, Chang, Head et al. 2023)** **[fetched]**
([ar5iv 2303.14334](https://ar5iv.labs.arxiv.org/html/2303.14334)). Ten prototypes, more than 300
participants **[fetched, abstract]**. Lessons relevant to us: density ("too few highlights will present
the guise of an inept tool, and too many will slow a reader down"); context-switching costs hurt
sensemaking; systems should "enable triage" rather than maximise speed; "even slight model errors can
harm readers"; citation-based signals risk a rich-get-richer effect, so add similarity signals;
efficiency tools may lead readers to shortcuts that produce incorrect understanding. Threddy (clip
related-work sentences into threads) and Relatedly (re-rank related-work paragraphs by what you have
explored) are about literature review across papers, so they are less relevant to a single-paper
first pass. ScholarPhi (definitions on demand) had a usability study showing benefit at all experience
levels **[summary]** ([arXiv 2009.14237](https://arxiv.org/abs/2009.14237v2)).

**scite** (Smart Citations; browser extension; Reference Check): shows the sentence in which each
citing paper cites the target, with the supporting, contrasting, mentioning label. See section 3 for
its numbers. A free "Reference Check" screens a manuscript's reference list for retracted work, one
check a month **[summary]** ([SMU library](https://library.smu.edu.sg/topics-insights/citing-paper-check-if-it-retracted-first)).
I found no user study of the badge.

**PubPeer extension, Zotero/Retraction Watch alerts:** see section 3. Both are badge-style:
a count or banner that links out, with no passage anchoring. No usability data found.

**Elicit, Consensus, Undermind, "deep research".** Only one rigorous test surfaced: a 2025 Cochrane
paper comparing Elicit's search with four completed systematic reviews found sensitivity around
39-40% against about 94.5% for the original searches, with precision about 42% against 7.6%; it is
"a plausible supplementary or preliminary search tool" but not a replacement **[summary]**
(reported in a [search summary](https://intuitionlabs.ai/pdfs/citation-reliability-ai-literature-reviews.pdf);
I did not find the Cochrane page itself). A newsletter's informal comparison of Elicit, Consensus and
scite is not worth citing. The Liu et al. 2023 audit gives the general citation-support figures quoted
in the short answer **[fetched]** ([ar5iv 2304.09848](https://ar5iv.labs.arxiv.org/html/2304.09848));
it also found fluency and perceived helpfulness were high while citation support was poor, and an
inverse correlation (r = -0.96) between citation precision and perceived utility. Implication: a
first pass should be recall-friendly (its job is to find leads), and each lead should be shown with
its evidence for the reader to weigh.

**Connected Papers, ResearchRabbit, Litmaps:** graph views of related papers for building a reading
list. Not fetched; no user studies found. They answer "what is nearby", not "what bears on this
claim", and are a different job from margin notes.

**Hypothesis:** a web annotation layer with shared margin notes. I searched but found no study of
annotation density in shared layers. Not covered.

**Dead end: annotation density.** I found no published threshold for how many margin notes per page a
reader tolerates. The nearest evidence is CiteSee's 8-13% of citations highlighted, and the Semantic
Reader quotes above. Plan to measure ours.

## 6. Retrieval and cost pointers

- **Citing sentences.** The Semantic Scholar Graph API returns, per citation, `contexts` (the
  sentences where the target is mentioned), `intents` (background, method, result), and
  `isInfluential`; reference and citation endpoints take a `fields=` list. Paging up to 1,000 records;
  an unauthenticated client was reported at about 100 requests per five minutes **[summary]**
  ([Python client docs](https://semanticscholar.readthedocs.io/en/stable/s2objects/Citation.html),
  [SMC notebook](https://media.sciencemediacenter.de/share/mewikoco-ds/12_s2_reference_details.html)).
  I did not read the official reference; check field names and limits before building. This is the
  CiteRead input and costs no model tokens.
- **Retractions and notices.** Crossref REST, free, daily updated (section 3). One request per DOI.
- **Replications, critiques, superseding reviews.** No structured source. Run web searches built from
  the claim text and DOI ("<claim> replication", "<claim> meta-analysis", "<title> failed to
  replicate", "<title> PubPeer"), then have the model read the top snippets. This is the part that
  needs a model and is the part most likely to produce plausible-sounding mistakes.
- **Cheapest order (inference):** (1) free structured checks for the paper and each reference
  (retraction, preprint-to-published); (2) citing sentences for the paper from Semantic Scholar,
  localised by the model; (3) fetch the cited abstract for each load-bearing claim and ask a
  yes/no/unclear support question; (4) open-web search for replication, critique, supersession.
  The model's judgement is needed only in 2 to 4, and the expected hit rate falls from 1 to 4.
- **Not costed.** I found no published per-paper cost for such pipelines; measure ours.

## What I could not verify

- Exact pooled figures of the 2025 Baethge and Jergas update.
- scite's paper: all its numbers are second-hand.
- CiteRead's formative-study findings and any margin-note counts.
- The Cochrane test of Elicit (summary of a secondary report).
- Any behavioural study of how researchers judge currency; any pooled citation-error figure outside
  medicine; any annotation-density study; any rate for "paper later superseded by a meta-analysis".
- Reviewer-checklist content per study design (EQUATOR, CASP): named, not read.

## Search log

Searches run on 2026-10-24, standard mode: Jergas and Baethge; CiteRead; Greenberg; scite; Tenopir;
retracted citation rates; Mogull; Semantic Scholar API; replication rates; PubPeer; Semantic Reader
family; currency-judging behaviour (dead end); AI research assistants (thin); preprint changes and
Retraction Watch and OpenAlex; Liu et al.; Makel; Keshav; Zotero alerts. Fetch refusals: PMC and PeerJ
(captcha, 403), ACM (403), scite reports (403), PubMed (cookie wall), an arXiv id I guessed (wrong
paper, discard).
