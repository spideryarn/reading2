# Finding reviewers: what it costs an editor, and what a chat tool would need to get right

This is research for a possible Spideryarn sub-mode that helps a journal or conference **editor**
find candidate peer reviewers for a manuscript, through a multi-turn chat with tools and web search —
not the reviewer's own job, which is covered in
[the-job-and-the-policies.md](the-job-and-the-policies.md) and
[prior-art-and-cognitive-offloading.md](prior-art-and-cognitive-offloading.md). Those two files
already cover the basics of how Prophy, Web of Science Reviewer Locator, and Elsevier's Reviewer
Recommender match manuscripts to candidates, and the known bias failure modes in that matching. This
file goes past that: what the search actually costs an editor, what editors say they want and
distrust, conflict-of-interest rules in their actual numeric detail, what existing tools show
per-candidate, harms with numbers behind them, the public data that could back an automated
suggestion, and whether chat is even the right interface for this job.

Compiled 2026-08-31 from roughly 45 primary and secondary sources gathered by four parallel research
passes. Every claim is sourced in place; where a source could not be fetched directly (a 403, a
paywall, a bot-check) and the finding rests on a search-engine paraphrase, that is flagged where it
appears, not buried in a footnote.

**One correction to the existing research first.** The
[prior-art file's summary](prior-art-and-cognitive-offloading.md#3-matching-reviewers-to-manuscripts-the-known-failure-modes)
attributes the ~43,000-reviewer Frontiers gender-homophily finding to *Science Advances* 2021. That
dataset is actually [Helmer et al., *eLife* 2017](https://elifesciences.org/articles/21718) (9,000+
editors, 43,000 reviewers, 126,000 authors, 142 Frontiers journals, 2007–2015). The real *Science
Advances* 2021 paper — [Squazzoni et al.](https://www.science.org/doi/10.1126/sciadv.abd0299) — is a
separate, larger study: 145 journals, about 1.7 million authors, about 740,000 referees. Both studies
find editor gender-homophily in reviewer *selection*; Squazzoni's headline finding is additionally
that manuscript *outcomes* were not penalized by female authorship, even though selection-stage bias
existed. Worth fixing in the older file the next time someone edits it for something else.

---

## 1. What the search costs an editor

### Getting a "yes" is getting harder, and getting a delivered review is getting harder faster

The best editorial-records evidence found is
[Fox, Burns & Meyer, *Research Integrity and Peer Review* 2017](https://link.springer.com/article/10.1186/s41073-016-0022-7),
a study of actual invitation records from six ecology/evolution journals, 2003–2015. Across the six
journals, the share of invitations that led to a submitted review fell from **56% (2003) to 37%
(2015)**; for the four journals with the steepest decline, from **66% to 46%**. A companion paper,
["Recruitment of reviewers is becoming harder at some journals"](https://link.springer.com/article/10.1186/s41073-017-0027-x),
notes the decline is journal-specific — no decline at *Evolution* or *Methods in Ecology and
Evolution* — so "it's getting harder everywhere" is not quite right; it's getting harder unevenly.

More recent and more precise:
[Morley et al., *PRiMER* (STFM), 23 October 2025](https://journals.stfm.org/primer/2025/morley-2025-0090/),
analysed 2,951 discrete reviewer invitations across 459 manuscripts at one medical-education journal,
January 2017–July 2025. Invitation **acceptance peaked at 56.14% in 2020**, fell to **35.71% in
2024** and **38.58% in 2025** ("lowest since journal inception"). The sharper number: among reviewers
who *did* accept, **completion fell from 89.31% (2021) to 76.19% (2025)** — roughly one accepted
review in four was never delivered by 2025, up from about one in nine four years earlier. That is the
two-stage cost an editor actually feels: first find someone who says yes, then find out months later
whether they meant it.

### The reviewer pool problem is a distribution problem more than a scarcity problem

[Kovanis et al., *PLOS ONE* November 2016](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0166387),
modelled the global biomedical peer-review workload and found **20% of researchers perform 69–94% of
all reviews**, while aggregate supply exceeded demand by **15–249%** across the scenarios modelled.
There is enough reviewing capacity in the system; it is unevenly directed at a small, repeatedly-asked
group. That is a design problem a matching tool can make worse (rank everyone by h-index, and the
same names come out on top every time) or better (actively surface people who are qualified but rarely
asked) — the same mechanical lever either way.

Clarivate's ["Global State of Peer Review"](https://clarivate.com/academia-government/lp/global-state-of-peer-review-report/)
programme (ScholarOne/Web of Science/Publons data plus a survey of roughly 12,000 researchers) puts a
number on the geographic side of the same distribution problem: researchers in established regions
(US/UK/Japan) generate **1.95 reviews per submission**, against **0.66 reviews per submission** in
emerging regions ([IOP Publishing's writeup of the 2024 edition](https://ioppublishing.org/state-of-peer-review-2024-results/)).
The specific "invitations per completed review, 1.9 → 2.4 → projected 3.6" figure that circulates in
secondary blog coverage attributed to Publons could **not be verified against a primary Publons/
Clarivate document** in this research pass — the source PDF was not machine-readable and no page
surfaced the exact figures. Flag it as thin until someone reads that PDF directly.

### Why editors give up on a candidate

Across [Willis, *Learned Publishing* 2016](https://onlinelibrary.wiley.com/doi/10.1002/leap.1006) and
IOP's 2024 survey, the dominant reason a reviewer declines is plain **unavailability/lack of time**,
not topic mismatch and not being over-invited. A 2013 dataset from *American Political Science
Review* (cited via a secondary Scholarly Kitchen summary of editor Marijke Breuning's own account):
4,563 requests sent, about 60% of responders said yes, 23% declined outright — and only **14% of
decliners cited "too many requests"** as their reason. The "reviewer fatigue is about being asked too
often" story is real at the aggregate level (Kovanis above) but is not, on this one dataset, the
individual's own stated reason for saying no. IOP's 2024 own numbers: **47%** of reviewers get fewer
than one invitation a month; only **~3%** get more than eleven. Most people who could review are not
being over-asked; a small group is.

### Editor time-to-find-reviewer is barely documented

This is a real gap. One paywalled *Journal of Comparative Physiology A* editorial-records study
(2014–2021, could not be read past the paywall) reportedly puts time spent finding reviewers at
**1.9–2.3 days**, holding roughly steady over the period — but this number is unverified firsthand and
should be treated as thin. Nothing else in this research pass gave a number for how many candidates an
editor typically considers per manuscript, or how many searches (Google Scholar, memory, the
manuscript's own reference list) an editor runs before landing on an invitee list. This is the
single weakest-evidenced sub-question in the whole brief — worth a targeted follow-up read of
editor-facing publisher guides rather than academic literature, which mostly measures outcomes
(accept/decline rates) rather than editor process/effort.

---

## 2. What editors say they want, and what they distrust

### How editors search today

[Taylor & Francis's editor guide, "How to find peer reviewers"](https://editorresources.taylorandfrancis.com/managing-peer-review-process/how-to-find-peer-reviewers-an-editors-guide/)
describes the standard toolkit: searching the manuscript's own reference list for topically relevant,
respected names; asking the corresponding author for suggestions; using a "reviewer locator" tool
built into the submission system, increasingly AI-assisted. A widely repeated figure — **"60% of
editors have difficulty finding qualified peer reviewers"** — is attributed to Taylor & Francis's 2015
["Peer Review in 2015: A Global View"](https://authorservices.taylorandfrancis.com/wp-content/uploads/2022/11/White-paper-Peer-Review.pdf)
white paper (a 7,400+ respondent global survey), but the PDF itself returned a 403 to automated
fetch, so treat the exact figure as secondary-sourced until read directly.

[Phil Davis, "Difficulty in Finding Reviewers Taints Editorial Decisions," *The Scholarly Kitchen*,
16 October 2017](https://scholarlykitchen.sspnet.org/2017/10/16/difficulty-finding-reviewers-taints-editorial-decisions/)
covers a study of ~52,000 reviews across ~24,000 papers in six ecology journals with a striking
finding: **difficulty finding a reviewer independently predicted a lower manuscript score and higher
rejection, even after controlling for what the review actually said** — the friction of the search
itself leaks into the editorial decision, not just the review's content. The same piece quotes editor
Angela Cochran describing what editors fall back on when a search stalls: asking "the author to
suggest some names" — precisely the practice most COI guidance treats as a leniency risk (see §3).

### What editors distrust about automated suggestions

The clearest primary-adjacent evidence here is indirect: [Wiley's "ExplanAItions" survey of ~5,000
scholars](https://newsroom.wiley.com/press-releases/press-release-details/2025/AI-Adoption-Jumps-to-84-Among-Researchers-as-Expectations-Undergo-Significant-Reality-Check/default.aspx)
found researchers prefer human judgement over AI for **four of five peer-review-related tasks**, and
only **12%** reported using AI specifically to assist reviewing others' work — even as general AI
adoption for research tasks rose from 45% (2024) to 62% (2025). The gap between "I use AI for research
broadly" and "I'd trust AI near the reviewer-selection decision" is the load-bearing finding, even
though it is about AI in peer review generally rather than reviewer-matching narrowly.

[*The Scholarly Kitchen*, "Peer Review in the Era of AI: Risks, Rewards, and Responsibilities," 17
September 2025](https://scholarlykitchen.sspnet.org/2025/09/17/peer-review-in-the-era-of-ai-risks-rewards-and-responsibilities/)
names the concrete worry plainly: a matching engine trained on historical assignment data can
"unintentionally reinforce historical inequalities — for example, under-recommending early-career
researchers or scholars from underrepresented regions" — and warns that "reviewers or editors may
place too much trust in AI outputs, potentially weakening editorial oversight." Its own recommended
framing is the one worth carrying into design: **"AI tools provide evidence-based suggestions and
alerts, while human editors apply their knowledge, experience, and ethical judgement to make final
decisions."** Evidence before verdict, always attributable, never a bare rank.

COPE's ["How to recognise potential manipulation of the peer review process"](https://publicationethics.org/guidance/flowchart/how-recognise-potential-manipulation-peer-review-process)
flowchart (part of its [full flowchart index](https://publicationethics.org/guidance/flowchart/all-flowcharts))
is the field body's own artefact naming the sharpest version of "a suggestion that's plausible but
not what it looks like": a real researcher's name, paired with an author-controlled fake email
address, submitted as an author-suggested reviewer. This page returned a 403 to direct fetch here and
is worth reading in full before building anything that surfaces author-suggested names, since it is
the exact failure mode a chat tool that pulls candidate emails from the web could unintentionally
reproduce if it does not verify the address against an independent source.

### What makes a suggestion actionable rather than noise

The single most directly relevant piece of prior art found across all four research passes is
[Salinas, Giorgi & Cignoni, "ReviewerNet: Visualizing Citation and Authorship Relations for Finding
Reviewers," arXiv:1903.08004, March 2019](https://arxiv.org/abs/1903.08004). Its premise: good
candidate reviewers can be found among the authors of a small set of papers relevant to the manuscript
— and it frames the editor's real task as three things done together, not sequentially: (1) find
people who are topically relevant, (2) check they are distributed across the field, not always the
same names, (3) **check for conflicts of interest by examining co-authorship and institutional history
before ever presenting a name.** Its interface choice is a deliberate rejection of a ranked list: an
interactive citation/co-authorship *graph*, so an editor can see *why* a name is there — which papers,
which co-authors — not just trust a score. That "show your working, not just your answer" principle
maps directly onto what would make a chat-delivered suggestion trustworthy rather than a plausible-
looking name: provenance for every candidate (which papers, why this topic match), a visible COI check
rather than a silent filter, and a way to inspect the underlying evidence, not just accept or reject a
name in one turn.

---

## 3. Conflict of interest, concretely

### No two publishers use the same number

Every publisher agrees co-authorship and shared institution are conflicts. None of them agree on how
many years back a co-authorship conflict runs:

| Source | Co-authorship lookback | Notes |
|---|---|---|
| [COPE](https://publicationethics.org/guidance/guideline/ethical-guidelines-peer-reviewers) | 3 years | "recent mentors, mentees, close collaborators or joint grant holders within the past 3 years" |
| [Elsevier](https://www.elsevier.com/editor/perk/undisclosed-conflicts-of-interest) | 3 years | same section/department colleagues in the past 3 years |
| APS / [Physical Review](https://journals.aps.org/prb/referees) | 3 years | mentor/mentee/close collaborator/joint grant holder |
| Wiley (via [ACR journals COI guidelines](https://onlinelibrary.wiley.com/pb-assets/assets/25785745/Conflict%20of%20Interest%20Guidelines%20ACR%20Journals.pdf)) | 36 months | "collaboration ... including, but not limited to, publications and current submissions" |
| Taylor & Francis | 3 years | co-authorship or shared affiliation |
| ACM, general "collaboration" definition | 3 years | "written a paper or grant proposal together" — but *explicitly excludes* service collaborations: co-presenting a course, co-authoring a survey, or co-chairing a conference "does not in itself lead to a conflict of interest" |
| ACM ([TISSEC-specific policy](https://tissec.hosting.acm.org/content/process/conflict-of-interest-policy/)) | 48 months | the longest window found |
| [PLOS](https://journals.plos.org/plosone/s/competing-interests) | **5 years** | explicit, and stated as a floor: interests outside the window "must also be declared if they could reasonably be perceived as competing" |

PLOS's page (the only one of these that could be fetched directly rather than reconstructed from
search) is also the most granular in naming categories: same institution "currently or recently,"
current or recent collaboration, co-authorship in the past 5 years, **held grants with an author**
currently or recently, financial ties, personal relationships that prevent objective evaluation, and —
named explicitly — **"direct competition or a history of scientific conflict with any of the
authors."** That last category, the "known competitor," shows up by name in PLOS, ACM ("deep personal
animosity," "strong professional rivalry" — entirely on the reviewer's own judgement) and APS (which
narrows it usefully: "have a manuscript in preparation or under review that is very similar to the one
being considered"). Every publisher that names this category leaves it entirely discretionary. None
operationalises it beyond the reviewer's own say-so.

**Advisor/advisee is the one category multiple publishers treat as effectively permanent rather than
time-windowed.** ACM is explicit: "the lifelong relationship between Ph.D. student and Ph.D.
supervisor," extended even to "academic siblings" (same PhD advisor). Wiley lists "past or present PhD
students and postdocs" with no time limit stated. Contrast that with the same publishers' 3–4 year
windows for ordinary co-authorship — a tool that applies one lookback window to every COI category will
under-flag the relationship every publisher treats as the most durable one.

### "Same institution" is not as simple as it sounds

[NIH's grant peer-review COI guidance](https://grants.nih.gov/grants/peer/coi_information.pdf) is the
only source found that actually defines institutional granularity: departments within one university
("Biology and Chemistry within the same School of Arts and Sciences") count as *one* institution, but
formally separate legal/administrative components of a large university system — "the separate
affiliates of the Harvard system," or "Johns Hopkins Bayview Medical Center" versus "the School of Arts
and Sciences, Homewood Campus" of Johns Hopkins — count as *separate* institutions. Nobody else's
policy addresses this. A tool matching on a raw affiliation string ("Harvard University," "Johns
Hopkins") will systematically over-flag large multi-campus, multi-hospital institutions as conflicted
when they are not, in the specific way the rules actually intend, and there is no purely public source
that resolves this — it requires institution-specific administrative knowledge that isn't in Crossref,
ORCID, or OpenAlex affiliation strings.

### Even the written rules aren't reliably followed

A cross-sectional study, *Journal of Clinical Epidemiology* (ScienceDirect), September 2025, of 250
English-language medical journals (random sample of 277 from Clarivate's Journal Citation Reports,
data collected January–June 2024), found: **71%** of journals had a COI policy for editors, **70%**
for peer reviewers — but only **6%** publicly declared editor interests, and **1%** publicly declared
reviewer interests. Where a journal claimed to follow its publisher's stated policy, the journal's own
published text actually matched that policy in only **11%** of cases for editors and **9%** for
reviewers. This matters directly for an automated tool: hard-coding "the PLOS rule" or "the Elsevier
rule" is not the same as knowing what a given journal actually enforces, because journals routinely
claim a policy their own text doesn't match. (This ScienceDirect article could only be confirmed via
secondary summary here — worth a direct read before citing the exact percentages elsewhere.)

### What's checkable from public data, and what isn't

**Checkable**, with the caveats above: co-authorship history and its recency (Crossref, OpenAlex —
this is what Prophy/WoS/Elsevier already do); current and recent institutional affiliation (ORCID,
OpenAlex, though institutional sub-structure for large universities is not resolved by any of these);
grant co-investigator status, but only *partially* — US federal grants are public (NIH RePORTER, NSF
award search) but there is no universal public grants database, so this check is strong for US federal
funding and weak-to-absent everywhere else.

**Not checkable**: informal or unpublished collaboration; advisor/advisee relationships that were never
formally published anywhere machine-readable (some are inferable, weakly, from thesis acknowledgments
or co-authorship patterns during the PhD years — a noisy proxy, not a signal); personal relationships,
friendship, animosity; "known competitor" status, which every publisher that names it leaves to the
reviewer's own judgement and none operationalises beyond that. A tool built on public data can only
ever automate the first list. The second list has to stay a place where the editor's own local
knowledge, or the candidate's own disclosure, does the work — and the conversational interface's
"exclude anyone who..." instruction pattern is arguably a better fit for surfacing *that* list than for
the mechanically-checkable one, since it lets the editor supply exactly the informal knowledge no
database has.

---

## 4. What existing tools actually show per candidate

Building on what the prior-art file already established (Prophy's semantic matching against ~87–96M
profiles, WoS Reviewer Locator's 28M-author graph, Elsevier's auto-filter of co-authors from the last 3
years), here is what each tool's actual output screen shows an editor, where that could be verified:

| Tool | Workload/availability shown? | Prior review history with this journal? | Contact info shown? | Seniority/career stage shown? | COI: flagged or silent? |
|---|---|---|---|---|---|
| [Prophy](https://blog.prophy.ai/behind-the-scenes-at-prophy) | Claimed as ranking input; display unconfirmed | Not found | Not confirmed | Not found | Flagged — "every candidate explained" |
| [WoS Reviewer Locator](https://clarivate.com/academia-government/scientific-and-academic-research/publisher-solutions/web-of-science-reviewer-locator/) | Not stated on public page | Yes — full review history | **Yes** — latest email + "trusted sources" | Not stated | Flagged — "from the start" |
| [Elsevier Find Reviewers](https://www.elsevier.com/connect/recap-and-recent-enhancements-to-find-reviewers) | **Yes** — activity graphs showing "how busy and responsive" | Yes — explicit ranking factor | Implied, via linked EM profile | Yes — "years active," h-index, citations | **Flagged explicitly** — tags for "active reviews pending," "same country," "same institution," "author opposed," "forbidden as a reviewer" |
| Frontiers AIRA | Not documented publicly | Not documented | Not documented | Not documented | General COI-check mentioned; per-candidate display undocumented |
| ScholarOne Reviewer Locator | **Most explicit found** — default view shows current assignments plus assignments in the last 12 months | Implied via "peer reviews" field | Not confirmed | Not confirmed | "Enhanced" detection, display format undetailed |
| Publons Reviewer Connect (2018, now folded into WoS) | Dedicated, reviewer-controlled **"availability tool"** — reviewers set their own status rather than the system inferring it | Implied via "prior review performance" | Not confirmed | Not confirmed | Not detailed |

Elsevier's [September 2023 blog post on Find Reviewers](https://www.elsevier.com/connect/recap-and-recent-enhancements-to-find-reviewers)
is the most concrete public source found for any of these tools, and it gives the ranking order
explicitly, in this priority: also suggested by the corresponding author, then previous reviewing for
the journal, then content-similarity match score, then years active, then h-index/citations, then
publication count, then whether an Editorial Board Member. Worth naming because it means the field's
most-detailed public tool ranks *content match and journal history above sheer citation count* — a
useful counter-example to the "these tools just funnel everything to the most-cited person" worry
named in §5.

The honest gap: Prophy and Frontiers AIRA, the two tools most explicitly built around AI matching,
have the thinnest public feature documentation — vendor marketing copy without a verifiable screenshot
or walkthrough for either. Most of these products sit behind editorial-system logins, so what's public
is inherently thinner than for the two vendors (Clarivate, Elsevier) with detailed public blogs.

---

## 5. Known harms and failure modes

### Reviewer fatigue is concentrated, not universal — see §1's Kovanis figure (20% of researchers do 69–94% of reviews, against 15–249% aggregate over-supply). Repeated invitation of the same senior, well-cited people is a distribution failure a naive "rank by h-index" tool would reproduce mechanically.

### Gender and geography skew who gets asked, quantified

Two independent large-scale studies both find editor-side gender homophily in *selection*, not just
outcome:

- [Helmer et al., *eLife* 2017](https://elifesciences.org/articles/21718) — 43,000 reviewers, 142
  Frontiers journals, 2007–2015: **female editors selected female reviewers 33% of the time, versus
  27% for male editors.**
- [Squazzoni et al., *Science Advances* 2021](https://www.science.org/doi/10.1126/sciadv.abd0299) —
  145 journals, ~1.7 million authors, ~740,000 referees: gender homophily in referee selection found
  again, at much larger scale, though this study's headline finding is that manuscript *outcomes* were
  not penalized by female authorship — a useful nuance: selection-stage bias and outcome-stage bias are
  not the same claim, and this dataset finds one without the other.

On geography, the clearest quantitative figure is again Clarivate's 2024 report (§1): 1.95 vs. 0.66
reviews per submission, established versus emerging regions. Claims that early-career researchers and
Global South researchers are systematically under-invited appear repeatedly in secondary sources
(Elsevier's ["Peer review diversity in action"](https://www.elsevier.com/connect/peer-review-diversity-in-action),
a Cambridge Core blog on peer-review mentoring) but **no study with hard percentages comparable to the
gender-homophily numbers above turned up** for career stage or Global-South specifically. Flag this as
qualitatively well-established, quantitatively thin.

### Reviewer mills and fake identities are documented at real scale, and growing

The [Hindawi/Wiley mass retraction, announced 28 September 2022](https://retractionwatch.com/2022/09/28/exclusive-hindawi-and-wiley-to-retract-over-500-papers-linked-to-peer-review-rings/)
covered **511 papers across 16 journals**, retracted for coordinated peer-review rings — reviewers and
editors working together, detected via duplicated review-report text, abnormal turnaround times, and
misuse of reviewer-vetting databases. A separate "review mill" documented by [Chemistry
World](https://www.chemistryworld.com/news/review-mills-identified-as-a-new-form-of-peer-review-fraud/4018888.article)
found **85 near-identical review reports across 23 MDPI journals** between August 2022 and October
2023, most containing coercive self-citation demands. A more recent case (medRxiv preprint, 20 October
2025) documents a gynecologic-oncology review mill with **over 2,800 verified peer reviews** by
identified "review millers" registered with Web of Science as of that date — the largest documented
case by review count found in this research. The STM Integrity Hub exists specifically to catch this
class of fraud but **no published number for reviewer-fraud specifically detected by the Hub** was
found — its public throughput figure (20,000 manuscripts/month, >1% flagged for duplicate submission)
is about submissions, not reviewer identity fraud.

### AI-suggested reviewers going wrong — genuinely thin, and worth saying so plainly

No documented public case of an AI reviewer-recommendation tool causing a specific bad-match incident
or bias controversy that made news was found — no Retraction Watch or Scholarly Kitchen story names
Prophy, an MDPI reviewer-finder, or a publisher's in-house matching AI as the cause of a failure. What
exists is forward-looking structural concern (the Scholarly Kitchen piece quoted in §2) rather than an
incident. The closest adjacent finding — not the same claim, but nearby — is
["Identity Theft in AI Conference Peer Review," arXiv:2508.04024, 6 August 2025](https://arxiv.org/abs/2508.04024),
which documents fraudsters creating fake reviewer profiles to game algorithmic conference-matching
systems (Toronto-Paper-Matching-System-style), not the matching algorithm itself misjudging or biasing.
[NeurIPS's own December 2024 blog post on its revised paper-reviewer assignment algorithm](https://blog.neurips.cc/2024/12/12/neurips-2024-experiment-on-improving-the-paper-reviewer-assignment/)
shows the field actively engineering against gaming and diversity failure in algorithmic matching, but
again names no specific public scandal. **Treat "AI reviewer suggestion caused a documented public
failure" as an unfilled evidence gap, not a settled absence of risk** — the absence of a public case may
just mean nobody has looked hard enough yet, or that failures happen quietly inside editorial systems
without ever becoming a news story.

---

## 6. Public data that could back a suggestion

Seven candidate sources, assessed for author identity, affiliation/COI history, and topic matching:

| Source | Author identity | Affiliation / COI graph | Topic matching | Commercial licence | Verdict |
|---|---|---|---|---|---|
| [OpenAlex](https://openalex.org) | Good — real IDs, ML disambiguation aligned to ORCID; weaker on common non-Western names without ORCID | Good — per-institution history with years, plus "last known institution" | Good — ~4,500-topic model, ranked per author | **CC0, free**, no commercial restriction (API key required since Feb 2026) | **Backbone source** |
| [Semantic Scholar](https://www.semanticscholar.org) | Good — S2AND, the only one of these with a published, peer-reviewed, benchmarked accuracy figure (>50% B3-F1 error reduction) | Weak — affiliation field exists, no year-history | Good but "imperfect" by its own docs (S2FOS) | **Free tier is non-commercial only** — a paid product needs AI2's Expanded License | Best-evidenced COI mechanism (see below), but licence-gated for a commercial tool |
| [ORCID](https://orcid.org) | **Best** — self-asserted, with a trust-source flag (self-entered vs. institution-verified) | Good — structured, dated, trust-flagged | None | **Public API is explicitly non-commercial**; paid membership needed otherwise | Cross-check for identity/current affiliation, not a coverage engine |
| [Crossref](https://crossref.org) | Weak — no native ID, depends on publisher-supplied ORCID (inconsistent) | Weak — affiliation strings + ROR, no history rollup | Weak — Scopus category tags, work-level only | Free, no commercial restriction | Cross-check for ORCID/ROR linkage |
| PubMed / NCBI | Unusable generally — under 3% ORCID coverage, email curation discontinued in 2013 | Weak, no rollup | Good, but biomedicine-only (MeSH) | Free, US government data | Biomedicine-only supplement |
| [DBLP](https://dblp.org) | Weak — [own FAQ admits](https://dblp.org/faq/How+does+dblp+handle+homonyms+and+synonyms.html) "in many cases homonyms remain undetected" | Weak/sparse | None — no topic taxonomy | **CC0**, fully open | CS-only supplement, best co-authorship completeness within CS |
| [OpenAIRE](https://openaire.eu) | Weak — bounded by underlying ORCID/Crossref quality | Emerging — newer ROR-based "Persons" entity | Weak — funding/OA-oriented, not expertise | **CC-BY, explicitly commercial-friendly** | Cross-check, least mature author features |

### The purpose-built precedent

[Semantic Scholar's Peer Review API](https://medium.com/ai2-blog/conference-peer-review-with-the-semantic-scholar-api-24ab9fce2324)
(AI2, built with academic conferences) is the closest existing thing to exactly what Spideryarn would
need: editors submit candidate author IDs plus the manuscript's title/abstract/authors, and it returns
a **COI score** — a binary "has this candidate co-authored with any of the submission's authors" flag
— alongside a **matching score** built from SPECTER embedding distance to the candidate's three most
similar papers. This is worth a direct read before designing anything, since it was only reachable via
search snippet here (the Medium post 403'd on direct fetch). Its licence status is the same
non-commercial constraint as the rest of Semantic Scholar.

### Licensing is the real constraint, not coverage

Coverage differences between OpenAlex and Semantic Scholar are modest — one comparison found
reference-link coverage within a point of each other (98.6% vs. 98.3% in a guideline-search case
study, [PubMed 40250535](https://pubmed.ncbi.nlm.nih.gov/40250535/)). The decision that actually
matters for a commercial product is licensing: **OpenAlex (CC0) and OpenAIRE (CC-BY) impose no
commercial restriction; ORCID's free Public API and Semantic Scholar's free tier both explicitly
prohibit commercial use** without a paid membership or an AI2-negotiated Expanded License. For
Spideryarn specifically, that argues for OpenAlex as the backbone graph and topic source, ORCID used
only as a trust cross-check on identity where a researcher has a record (not as the primary co-
authorship source, since it's self-curated and often stale), and a conversation with AI2 before relying
on Semantic Scholar's COI mechanism at all.

### The recipe this points to

Use OpenAlex for author identity, affiliation history, and topic matching (free, unrestricted, best
combination of the three). Cross-check identity and current affiliation against ORCID where a record
exists, trusting institution-verified entries over self-entered ones. Treat NIH's institutional-
sub-structure logic (§3) as a reminder that raw affiliation-string matching will over-flag large
multi-campus institutions — worth a manual exceptions list for the largest few, rather than assuming
string match equals real institutional overlap. None of these sources solve the "informal
collaboration" or "known competitor" categories; that stays a job for the editor's own knowledge, which
is exactly what a conversational "exclude anyone who..." instruction is suited to capture and a form
field is not.

---

## 7. Is a conversational interface right for this job?

### The general evidence on conversational search cuts both ways, and the honest read is "supplement, not sole interface"

[Degachi, Kernan Freire, Niforatos & Kortuem, "Understanding Mental Models of Generative Conversational
Search," arXiv:2506.03807, 4 June 2025](https://arxiv.org/html/2506.03807v1) — a 16-participant mixed-
methods HCI study — found users hold "overly abstract" mental models of how conversational search
works, and **spontaneously build hybrid conversational-web workflows to compensate**: they don't trust
chat alone, so they fall back to browsing outside it. The paper's own recommendation is to "support
more seamless hybrid web-CA search workflows" rather than assume chat suffices on its own. One
participant, on trust: *"I'm a bit sceptical because I'm really afraid... I wouldn't trust GPT or AI
because I know that the technology is not that advanced yet."* Note the sample skews technical (13 of
16 held a Master's degree), so generalising to a broader editor population needs care.

A search-summarized (not directly verified) finding from a 2020 arXiv paper on conversational browsing
reports query-based/browsing interfaces succeeding roughly **3x more often** than pure conversational
search on the same tasks, while **~70% of participants still said they preferred the conversational
interface anyway** — a genuinely useful, if unverified, data point: people *like* chat more than it
performs, on structured comparison tasks specifically. Flag this pending a direct read of the primary
PDF, which could not be parsed here.

### The closest real products both default to structured UI, chat as an add-on

Elicit and Consensus — the two commercial tools closest in spirit to "chat that helps you find research
candidates" — both lead with a structured interface (Consensus: filters on journal tier, methodology,
citation thresholds; Elicit: a screening/extraction table) and treat chat as a secondary refinement
panel, not the primary surface. This is product precedent, not controlled research, but it is real-
world evidence from the two products doing the most similar job that neither bet on chat-as-primary.

### Expert-finding is an established field, and it has nothing to say about interface

[Balog et al., "Expertise Retrieval," *Foundations and Trends in Information Retrieval*,
2012](https://staff.fnwi.uva.nl/m.derijke/wp-content/papercite-data/pdf/balog-expertise-2012.pdf) is
the canonical survey of "expert finding" as an information-retrieval subfield — a mature, well-studied
ranking problem. It predates the LLM-chat era by about a decade and says nothing about conversational
or dialogue interfaces; neither does a 2016 successor survey. Worth citing for "this is a real,
established research problem with known ranking techniques," not for anything about interface choice.

### No prior art exists for chat specifically applied to reviewer-finding

This is the honest bottom line across every source found in this research pass: reviewer-recommendation
tooling today is either embedded ranked-list/search-filter functionality inside submission systems
(ScholarOne, Editorial Manager) or graph-visualization based (ReviewerNet, §2). **No commercial or
academic reviewer-recommendation tool built on a conversational interface turned up anywhere in this
research.** That is not evidence chat is wrong for the job — it may just be unexplored territory — but
it means there is no existing usage data, positive or negative, specific to this exact pairing to lean
on. The nearest transferable lessons are the general conversational-search findings above: build for a
hybrid, not chat-only (people will want to browse and compare candidates side by side, which chat
handles poorly on its own); make the evidence behind each suggestion visible and attributable, the way
ReviewerNet's graph and Elsevier's explicit COI tags both do, rather than a bare ranked name; and expect
users to distrust a suggestion that looks plausible but doesn't show its reasoning, which is exactly
what §2 already found editors say about automated suggestions generally.

---

## Where the evidence in this document is thin or contested

- Editor time-to-find-reviewer and number-of-candidates-considered: essentially undocumented. The one
  figure found (1.9–2.3 days, *J. Comp. Physiol. A*) is paywalled and unverified firsthand.
- The "1.9 → 2.4 → projected 3.6 invitations per review" trend, repeated across secondary blogs and
  attributed to Publons, could not be traced to a primary page or PDF in this pass.
- Early-career-researcher and Global-South under-invitation is qualitatively well-attested but has no
  quantitative study with hard percentages comparable to the gender-homophily numbers in §5.
- The 60%-of-editors-struggle figure (Taylor & Francis 2015) and the Wiley "4 of 5 tasks" / "12%"
  figures both rest on search-engine paraphrase of source PDFs that returned 403 on direct fetch —
  worth re-verifying before quoting precisely.
- The "3x higher success rate / 70% preferred chat anyway" conversational-browsing figures come from an
  unparseable PDF via search summary only.
- Documented public incidents of an AI reviewer-suggestion tool actually going wrong: none found. This
  may be a real absence of harm, or an absence of anyone looking — the research could not distinguish
  the two.
- The *Journal of Clinical Epidemiology* September 2025 study on COI-policy compliance (71%/70% have a
  policy, 6%/1% publicly declare it, 11%/9% match publisher policy) was confirmed only via secondary
  summary, blocked by a cookie-wall on direct fetch.
- Several vendor pages for Prophy and Frontiers AIRA returned 403s to automated fetch; what's reported
  here about their per-candidate display is closer to marketing copy than a verified feature audit,
  unlike the Elsevier and ScholarOne entries, which came from detailed public blog posts.

## Sources

**Cost and pain of the search**
- Fox, Burns & Meyer, *Research Integrity and Peer Review* 2017 — https://link.springer.com/article/10.1186/s41073-016-0022-7
- Fox et al., "Recruitment of reviewers is becoming harder at some journals," 2017 — https://link.springer.com/article/10.1186/s41073-017-0027-x
- Morley et al., *PRiMER*, 23 Oct 2025 — https://journals.stfm.org/primer/2025/morley-2025-0090/ (PubMed: https://pubmed.ncbi.nlm.nih.gov/41531847/)
- Kovanis et al., *PLOS ONE*, Nov 2016 — https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0166387
- Clarivate, "Global State of Peer Review" — https://clarivate.com/academia-government/lp/global-state-of-peer-review-report/
- IOP Publishing, "State of Peer Review 2024 results" — https://ioppublishing.org/state-of-peer-review-2024-results/
- Willis, *Learned Publishing* 2016, "Why do peer reviewers decline to review manuscripts?" — https://onlinelibrary.wiley.com/doi/10.1002/leap.1006
- Taylor & Francis, "Peer Review in 2015: A Global View" — https://authorservices.taylorandfrancis.com/wp-content/uploads/2022/11/White-paper-Peer-Review.pdf
- Taylor & Francis, "How to find peer reviewers – an editor's guide" — https://editorresources.taylorandfrancis.com/managing-peer-review-process/how-to-find-peer-reviewers-an-editors-guide/
- Davis, "Difficulty in Finding Reviewers Taints Editorial Decisions," *Scholarly Kitchen*, 16 Oct 2017 — https://scholarlykitchen.sspnet.org/2017/10/16/difficulty-finding-reviewers-taints-editorial-decisions/

**What editors want / distrust, and conversational-interface evidence**
- Wiley, ExplanAItions newsroom release — https://newsroom.wiley.com/press-releases/press-release-details/2025/AI-Adoption-Jumps-to-84-Among-Researchers-as-Expectations-Undergo-Significant-Reality-Check/default.aspx
- *Scholarly Kitchen*, "Peer Review in the Era of AI," 17 Sept 2025 — https://scholarlykitchen.sspnet.org/2025/09/17/peer-review-in-the-era-of-ai-risks-rewards-and-responsibilities/
- COPE, "How to recognise potential manipulation of the peer review process" — https://publicationethics.org/guidance/flowchart/how-recognise-potential-manipulation-peer-review-process
- Salinas, Giorgi & Cignoni, "ReviewerNet," arXiv:1903.08004 — https://arxiv.org/abs/1903.08004
- Degachi et al., "Understanding Mental Models of Generative Conversational Search," arXiv:2506.03807 — https://arxiv.org/html/2506.03807v1
- "Conversational Browsing," arXiv:2012.03704 — https://arxiv.org/abs/2012.03704
- "Conversational Search — Dagstuhl Seminar 19461 report," arXiv:2005.08658 — https://arxiv.org/abs/2005.08658
- Jannach, Manzoor, Cai & Chen, "A Survey on Conversational Recommender Systems," ACM Computing Surveys 2021 — https://arxiv.org/abs/2004.00646
- Balog et al., "Expertise Retrieval," Foundations and Trends in IR, 2012 — https://staff.fnwi.uva.nl/m.derijke/wp-content/papercite-data/pdf/balog-expertise-2012.pdf

**Conflict of interest policies**
- ICMJE, disclosure of interest — https://www.icmje.org/disclosure-of-interest/
- COPE, ethical guidelines for peer reviewers — https://publicationethics.org/guidance/guideline/ethical-guidelines-peer-reviewers
- Elsevier, undisclosed conflicts of interest — https://www.elsevier.com/editor/perk/undisclosed-conflicts-of-interest
- Springer Nature / Nature Portfolio, competing interests — https://www.nature.com/nature-portfolio/editorial-policies/competing-interests
- PLOS, competing interests policy — https://journals.plos.org/plosone/s/competing-interests
- Wiley, ACR journals COI guidelines PDF — https://onlinelibrary.wiley.com/pb-assets/assets/25785745/Conflict%20of%20Interest%20Guidelines%20ACR%20Journals.pdf
- APS / Physical Review B, referee guidelines — https://journals.aps.org/prb/referees
- ACM, TISSEC conflict-of-interest policy — https://tissec.hosting.acm.org/content/process/conflict-of-interest-policy/
- ACM, reviewer training course — https://reviewers.acm.org/training-course/assessing-your-suitability-to-review
- NIH, grants peer review COI information PDF — https://grants.nih.gov/grants/peer/coi_information.pdf
- Taylor & Francis, conflicts of interest policy — https://editorresources.taylorandfrancis.com/policies/conflicts-of-interest/
- Journal of Clinical Epidemiology, COI-policy compliance study, Sept 2025 — https://www.sciencedirect.com/science/article/pii/S0895435625003130

**What existing tools show per candidate**
- Prophy, "Behind the scenes at Prophy," 5 Aug 2024 — https://blog.prophy.ai/behind-the-scenes-at-prophy
- Clarivate, Web of Science Reviewer Locator — https://clarivate.com/academia-government/scientific-and-academic-research/publisher-solutions/web-of-science-reviewer-locator/
- Elsevier, "Recap and recent enhancements to Find Reviewers," 25 Sept 2023 — https://www.elsevier.com/connect/recap-and-recent-enhancements-to-find-reviewers
- Frontiers, "Artificial intelligence to help meet global demand for high-quality objective peer review," 1 Jul 2020 — https://www.frontiersin.org/news/2020/07/01/artificial-intelligence-to-help-meet-global-demand-for-high-quality-objective-peer-review-in-publishing
- Taylor & Francis, reviewer locator tools guide — https://editorresources.taylorandfrancis.com/managing-peer-review-process/how-to-find-peer-reviewers-an-editors-guide/reviewer-locator-tools/
- PR Newswire, "Publons Reviewer Connect," 17 Jul 2018 — https://www.prnewswire.com/news-releases/publons-reviewer-connect-powerful-new-tool-to-revolutionize-editorial-workflows-for-publishers-688376501.html

**Harms and failure modes**
- Helmer, Schottdorf, Neef & Battaglia, "Gender bias in scholarly peer review," *eLife* 2017;6:e21718 — https://elifesciences.org/articles/21718
- Squazzoni et al., "Peer review and gender bias," *Science Advances* 2021 — https://www.science.org/doi/10.1126/sciadv.abd0299
- Retraction Watch, "Hindawi and Wiley to retract over 500 papers linked to peer review rings," 28 Sept 2022 — https://retractionwatch.com/2022/09/28/exclusive-hindawi-and-wiley-to-retract-over-500-papers-linked-to-peer-review-rings/
- Chemistry World, "Review mills identified as a new form of peer review fraud" — https://www.chemistryworld.com/news/review-mills-identified-as-a-new-form-of-peer-review-fraud/4018888.article
- medRxiv preprint on gynecologic-oncology review mill, 20 Oct 2025 — https://www.medrxiv.org/content/10.1101/2025.10.20.25338343v1.full
- STM Integrity Hub — https://stm-assoc.org/what-we-do/strategic-areas/research-integrity/integrity-hub/
- "Identity Theft in AI Conference Peer Review," arXiv:2508.04024 — https://arxiv.org/abs/2508.04024
- NeurIPS blog, "Improving the Paper-Reviewer Assignment," 12 Dec 2024 — https://blog.neurips.cc/2024/12/12/neurips-2024-experiment-on-improving-the-paper-reviewer-assignment/

**Public data sources**
- OpenAlex, author object docs — https://docs.openalex.org/api-entities/authors/author-object
- OpenAlex, help centre, authors — https://help.openalex.org/data/authors/
- OpenAlex, rate limits and authentication — https://github.com/ourresearch/openalex-docs/blob/main/how-to-use-the-api/rate-limits-and-authentication.md
- Semantic Scholar, S2AND paper, arXiv:2103.07534 — https://arxiv.org/pdf/2103.07534
- Semantic Scholar, Peer Review API — https://medium.com/ai2-blog/conference-peer-review-with-the-semantic-scholar-api-24ab9fce2324
- Semantic Scholar, API licence — https://api.semanticscholar.org/license/
- ORCID, public client terms of service — https://info.orcid.org/public-client-terms-of-service/
- ORCID, record schema documentation — https://info.orcid.org/documentation/integration-guide/orcid-record/
- Crossref, REST API documentation — https://github.com/CrossRef/rest-api-doc
- Crossref, rate-limit changes announcement — https://www.crossref.org/blog/announcing-changes-to-rest-api-rate-limits/
- NCBI E-utilities, API key usage — https://eutilities.github.io/site/API_Key/usageandkey/
- DBLP, homonym/synonym handling FAQ — https://dblp.org/faq/How+does+dblp+handle+homonyms+and+synonyms.html
- OpenAIRE, licence — https://graph.openaire.eu/docs/license/
- DeSci Labs, AI Reviewer Finder — https://www.desci.com/products/ai-reviewer-finder
- Comparison of OpenAlex/Semantic Scholar reference coverage, PubMed 40250535 — https://pubmed.ncbi.nlm.nih.gov/40250535/
