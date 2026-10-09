# Web research: the reviewer persona (someone asked to peer-review a manuscript)

Method: one WebSearch per topic, no deep page fetches. Most claims come from search-result summaries, not from reading the primary page. Anything I could not confirm is flagged "(unverified)". Gaps are listed at the end.

## 1. Goals: what a review must deliver

- Journals differ on whether novelty counts. PLOS ONE judges soundness only: seven criteria (original results, prior publication, technical quality, conclusions supported by data, language, ethics, reporting guidelines). Novelty and importance are explicitly not criteria. https://journals.plos.org/plosone/s/reviewer-guidelines , paraphrased via https://manusights.com/what-peer-reviewers-look-for (PLOS ONE's own criteria page was not fetched).
- Conferences ask for more. NeurIPS wants a short non-critical summary, then strengths and weaknesses, with technical substance over presentation. https://neurips.cc/Conferences/2024/ReviewerGuidelines
- NeurIPS says superficial, uninformed reviews without evidence are worse than no review. Criticisms should cite references so authors can respond; vague statements are hard to address. https://neurips.cc/Conferences/2025/ReviewerGuidelines
- NeurIPS says the paper checklist is a review aid. A "no" on a checklist item is not normally grounds for rejection, and honest disclosure of limitations should be rewarded. https://neurips.cc/Conferences/2025/ReviewerGuidelines
- Common guide pattern: major comments cover methods, unsupported conclusions and inconsistencies. Minor comments are optional suggestions. Comments should be specific and evidenced. https://brieflands.com/articles/ijem-120366.html and https://medschool.vanderbilt.edu/wp-content/uploads/sites/9/files/public_files/PaperReview.pdf
- A Vanderbilt guide advises against a formal accept/reject in the author-facing critique. It keeps that for the confidential note to the editor, where plagiarism or bias concerns also go. Journals differ. https://medschool.vanderbilt.edu/wp-content/uploads/sites/9/files/public_files/PaperReview.pdf
- COPE (v2.0, Sept 2017): be objective and constructive, no libellous or derogatory remarks. Only accept manuscripts you are qualified to assess and can do promptly. Declare conflicts. Keep the manuscript and the review confidential, and do not use what you learn for gain. https://publicationethics.org/sites/default/files/cope-ethical-guidelines-peer-reviewers-v2_0.pdf (via search summary; PDF not fetched).

## 2. Challenges and pain points

- Time. The largest group in one reviewer survey (41%) spends 2-4 hours per review. 31% spend 4-8 hours. 7% spend over 16 hours on some. The survey's author was not confirmed (unverified provenance). https://scipinion.com/scipoll-result/scipoll-insights-the-current-state-of-scientific-peer-review-activity/
- Aggregate effort: Publons 2018 reports about 68.5 million reviewer-hours a year and a 19.1-day average turnaround. https://www.uksg.org/?p=2625 , https://clarivate.com/news/publons-release-inaugural-global-state-of-peer-review-report/ . Aczel et al. estimate over 100 million hours in 2020. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8591820/
- I found no verified per-review median hours from a primary source.
- Fatigue and declining. Publons 2018 (about 11,800 researchers) warned of "reviewer fatigue". 10% of reviewers do 50% of reviews. 42% of respondents decline because they are too busy (secondary source). https://www.chemistryworld.com/news/peer-review-investigation-warns-of-growing-reviewer-fatigue-/3009501.article
- Expertise mismatch is a commonly cited reason for declining (secondary source, same article).
- Training is wanted: 88% of Publons respondents thought training would help. The most-wanted topic was constructing a review report. https://pmc.ncbi.nlm.nih.gov/articles/PMC10337866 (via search summary).
- Citation accuracy. Roughly 14-25% of quotations in the published literature are wrong, depending on definition; about half of the errors are classed major. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4627914/ (25.4%, Jergas and Baethge); https://ideas.repec.org/a/plo/pone00/0184727.html (14.5%, Mogull). I found no study of how often reviewers check references (see dead ends).
- Statistics: roughly half of psychology papers contain at least one inconsistent p-value, and about 1 in 8 has a decision-relevant inconsistency. https://blogs.lse.ac.uk/impactofsocialsciences/2018/02/28/statcheck-a-spellchecker-for-statistics/
- Overclaiming, ethics and data/code availability appear in publisher criteria (PLOS: conclusions must be supported by data; ethics; reporting guidelines). https://journals.plos.org/plosone/s/reviewer-guidelines . I found no study quantifying these as reviewer pain points.

## 3. Tasks, in the order reviewers usually do them

Synthesised from published how-to guides. This is not an empirical study of what reviewers do.
1. Decide whether to accept: check expertise, conflicts and time. https://publicationethics.org/sites/default/files/cope-ethical-guidelines-peer-reviewers-v2_0.pdf
2. First pass, a skim of abstract, introduction, figures and conclusions. Ask what is claimed as new, whether the evidence supports it, and whether there is a fatal flaw. https://reviewer.thesify.ai/blog/how-to-peer-review-a-paper
3. Detailed pass, section by section: methods support results, figures match text, statistics are appropriate, limitations are acknowledged. Same source.
4. Check references and related work, data/code availability, ethics and reporting guidelines. https://journals.plos.org/plosone/s/reviewer-guidelines
5. Draft: a summary, major comments, minor comments. https://neurips.cc/Conferences/2024/ReviewerGuidelines , https://brieflands.com/articles/ijem-120366.html
6. Recommendation, plus confidential comments to the editor. https://medschool.vanderbilt.edu/wp-content/uploads/sites/9/files/public_files/PaperReview.pdf
- Other step lists exist and were not read: Wiley https://authorservices-ppd.wiley.com/Reviewers/journal-reviewers/how-to-perform-a-peer-review/step-by-step-guide-to-reviewing-a-manuscript.html ; EASE 10-step https://ease.org.uk/communities/peer-review-committee/peer-review-toolkit/how-to-write-a-review

## 4. Policies on AI in peer review (this matters most)

Pattern: do not upload manuscripts to AI tools. Beyond that, publishers diverge on whether AI may assist the thinking at all.

- NIH, NOT-OD-23-149, 23 June 2023: reviewers may not use generative AI to analyse applications or write critiques. Uploading application content or critiques into online generative AI tools breaches peer-review confidentiality. Sanctions can include removal from service and debarment referral. https://grants.nih.gov/grants/guide/notice-files/NOT-OD-23-149.html (via search summary).
- Elsevier: reviewers must not upload a manuscript or any part of it to a generative AI tool. The confidentiality duty extends to the review report; they should not upload it even for language polish. AI should not assist the scientific assessment, because "critical thinking and original assessment" is out of its scope. https://www.elsevier.com/about/policies-and-standards/the-use-of-generative-ai-and-ai-assisted-technologies-in-the-review-process . A third-party summary says Elsevier allows limited uses such as literature search; I could not confirm this in Elsevier's own text (unverified). https://www.casrai.org/guides/elsevier-generative-ai-authorship-policy
- Springer Nature (covers Nature Portfolio): reviewers should not upload manuscripts to generative AI tools, citing confidentiality and AI errors. SN says it is exploring safe AI tools for reviewers. If AI supported any part of evaluating the claims, reviewers should declare it in the report. https://www.springer.com/us/editorial-policies/artificial-intelligence--ai-/25428500 . Its wider guidance says assessments must be made and verified by humans. https://group.springernature.com/br/group/ai/ai-guidance-for-our-researchers-and-communities
- IOP Publishing: does not currently allow AI in peer review. https://ioppublishing.org/news/reviewers-increasingly-divided-on-the-use-of-generative-ai-in-peer-review/
- ICLR 2026: LLM use by reviewers must be disclosed; the reviewer is responsible for hallucinations. A confidentiality breach via an LLM is a Code of Ethics violation, with sanctions up to desk rejection of the reviewer's own submissions. https://iclr.cc/FAQ/LLM , https://blog.iclr.cc/2025/11/19/iclr-2026-response-to-llm-generated-papers-and-reviews/
- NeurIPS 2025 (secondary source): sharing submissions with LLMs is prohibited. Limited use for background understanding or language polish is allowed with confidentiality preserved. https://arxiv.org/pdf/2606.10159 . Not checked against the official NeurIPS page (unverified).
- CVPR 2026 (same secondary source): explicitly bans LLMs for writing reviews, local or API. https://arxiv.org/pdf/2606.10159 (unverified).
- A June 2026 Elsevier policy update was claimed by one secondary source and not verified. https://reviewer.thesify.ai/blog/ai-in-peer-review
- Reality vs policy: Frontiers (Dec 2025, n=1,645) reports 53% of reviewers use AI. https://www.frontiersin.org/news/2025/12/15/most-peer-reviewers-now-use-ai-and-publishing-policy-must-keep-pace . IOP (Sept 2025, n=348) reports about a third, against 12% in Wiley's 2024 survey. https://ioppublishing.org/news/reviewers-increasingly-divided-on-the-use-of-generative-ai-in-peer-review/ . Samples differ, so the figures are not comparable.

## 5. Existing tools and how reviewers regard them

- statcheck: free tool that recomputes p-values from APA-style reports. It reads only about 60% of reported statistics because of formatting. https://blogs.lse.ac.uk/impactofsocialsciences/2018/02/28/statcheck-a-spellchecker-for-statistics/ . A preregistered quasi-experiment (Nuijten and Wicherts, 2024; more than 7,000 articles, two journals using statcheck vs two controls) found inconsistencies fell more steeply at the statcheck journals; the authors call this preliminary. The 2024 study was seen only in a search summary: https://repository.tilburguniversity.edu/items/1fd3ec2f-1a7f-41ce-aff3-010b372585b7
- scite Smart Citations: classifies citing sentences as supporting, contrasting or mentioning. ACS piloted it so authors, editors and reviewers can check references. It does not judge soundness. https://www.niso.org/niso-io/2022/08/acs-and-scite-partner-smart-citations . I found no evidence of reviewer adoption.
- Distrust of "AI writes the review": 57% of IOP respondents would be unhappy if a reviewer used generative AI to write a report on their own paper. https://ioppublishing.org/ai-and-peer-review-2025-results/ . Junior researchers were more positive; women and senior people more sceptical. Same page. Enago's small survey (n=124): confidentiality is non-users' top concern, and support hinges on transparency and institutional approval. https://www.enago.com/academy/ai-assisted-peer-review-early-findings/
- Quality of LLM reviews: fluent but weak on weaknesses and critique. https://arxiv.org/abs/2509.19326v1 (1,683 papers, 6,495 expert reviews). They can praise an empty paper and can be steered by hidden text in the manuscript. https://arxiv.org/abs/2412.01708
- Not found: named "AI reviewer" products and what reviewers say about them. Searched; no sources.

## 6. What reviewers miss

- Schroter et al., BMJ 2004: reviewers were sent manuscripts with errors inserted. Trained groups found more major errors than controls (3.14 and 2.96 vs 2.13, P<0.001), but the benefit had faded by six months; the authors judged short training only slightly useful. https://www.bmj.com/content/328/7441/673 , https://pmc.ncbi.nlm.nih.gov/articles/PMC381220
- Schroter et al., J R Soc Med 2008: 607 reviewers, 3 test papers, each with 9 major and 5 minor errors. At baseline reviewers found on average 2.58 of 9 major errors. Biased randomisation was among the best caught (over 60% of those who rejected). https://researchonline.lshtm.ac.uk/id/eprint/6900
- Godlee, Gale and Martyn, JAMA 1998: blinding reviewers to authors, or requiring signed reports, did not change error detection. https://jamanetwork.com/journals/jama/article-abstract/2556112 . I could not confirm the number of errors planted or the group means (unverified).
- My inference, not a stated finding: from 2.58 of 9, reviewers catch under a third of seeded major errors.

## Implications for a tool that helps reviewers notice, not write

1. Confidentiality is the gating issue. Nearly every policy bans uploading the manuscript to external AI (NIH 2023, Elsevier, Springer Nature, ICLR 2026). A tool that sends the manuscript to a third-party model may be a breach for many reviewers. Spideryarn's data handling, and how it tells the reviewer, must be explicit, possibly with a no-retention or local mode. This needs a decision by Greg, and probably a check with publishers, not an assumption.
2. "Write the review" is distrusted and forbidden in several places (Elsevier, NIH, CVPR 2026, IOP). Features that surface things (claims, the passage behind a claim, figures, stated methods, citations) fit the policies better than ones that evaluate. Even Elsevier bars AI from the "scientific assessment", so the tool should avoid looking like it assesses.
3. Reviewers miss most seeded methodological errors (about 2.6 of 9). Support for a systematic second pass is the opportunity: claims vs evidence, figure vs text, statistics consistency (statcheck-style), accuracy of cited work (quotation errors run 14-25%).
4. Time (2-8 hours typical) means efficient depth is valued. Navigation by claim and by block id fits.
5. A summary / major / minor / recommendation scaffold is conventional. Giving the reviewer their own blank notes organised that way helps without drafting for them.
6. Disclosure: Springer Nature and ICLR ask reviewers to declare AI use. An exportable log of what the tool did could help a reviewer comply.

## Addendum after coordinator's note: task sequence, time, what is missed, the literature around a paper

Cross-check: an earlier pass exists at docs/research/260831e-helping-peer-reviewers/ (README lists its conclusions: uploading a manuscript to third-party AI is a confidentiality violation everywhere; the ICLR 2025 Review Feedback Agent RCT is the strongest evidence for feedback on a reviewer's own draft). I read only the README, not the two long files, and did not re-check the policies for changes after Aug 2026 beyond the searches above. My Section 4 agrees with it.

### (a) Sequence and time budget
- Best evidence on time and process: the ReviewFlow study. Novices reported prior reviews took 6.4 hours and were cognitively demanding; experienced reviewers about 4.75 hours. Novices' top struggles were understanding background literature and judging novelty. Experts follow a sense-making, annotating, synthesising-notes workflow. https://arxiv.org/pdf/2402.03530 (via search summary; not fetched).
- Typical advice is a skim with notes, sorting concerns into major and minor, then a second read after the paper has "sunk in". Drafting starts with a summary restating the central claim, which shows you read it, then numbered major concerns. https://medschool.vanderbilt.edu/wp-content/uploads/sites/9/files/public_files/PaperReview.pdf
- Other published sequences (not read): https://ptglab.com/news/blog/how-to-review-a-scientific-paper-in-10-easy-steps , https://cancernurse.eu/wp-content/uploads/2023/02/EONS-RWG-Peer-review-tips.pdf , https://www.yegor256.com/2023/12/17/how-to-review-research-paper
- Format varies. eLife reviewed preprints have no accept/reject: reviewers write a public review (strengths and weaknesses, whether claims are justified by data) and separate private recommendations for authors; the editors write an assessment of significance and strength of evidence. https://elifesciences.org/inside-elife/14e77604 , https://reviewer.elifesciences.org/reviewer-guide/review-process
- Review Commons guidance: searched, nothing found.

### (b) What reviewers miss
- Baxt et al. 1998, Annals of Emergency Medicine: reviewers of a fictitious manuscript missed two thirds of major errors. Via search summary: https://pmc.ncbi.nlm.nih.gov/articles/PMC2586872 (the page returned was the Schroter paper; Baxt itself not confirmed, unverified).
- Schroter 2008 (above): 2.58 of 9 major errors; authors conclude editors should not assume reviewers detect most major errors. https://researchonline.lshtm.ac.uk/id/eprint/6900
- A 2010 orthopaedic-journal study: reviewers found more errors in the no-difference version of a paper than the positive-result version (0.85 vs 0.41, P<0.001). So an expected result lowers vigilance. https://pubmed.ncbi.nlm.nih.gov/21098355 (via search summary; unverified).
- Quotation errors in published papers: 14-25% (Section 2). I found no study of whether reviewers check quotations.
- Not found: post-publication-correction rates attributable to review failure; reproducibility audits tied to reviewers.

### (c) In reviewers' own words
- Mostly absent. I found no first-person blog or social-media thread material in these searches. The closest sources are surveys. eLife's early-career survey (n=264, 51 PhD students): 37% of PhD students reviewed without an advisor's help; respondents asked for training. https://elifesciences.org/inside-elife/982053f4 . A Sense about Science figure cited by BMC: only 3.2% of established reviewers actively train younger colleagues during a review. https://blogs.biomedcentral.com/bmcblog/2015/04/09/peer-review-throw-early-career-researchers-deep-end/
- A food-technology journal survey: 42% decline because too busy; over half would accept more if funders recognised reviewing. https://pmc.ncbi.nlm.nih.gov/articles/PMC7029384

### (d) Using the literature around the paper
- Reviewers do flag missing related work: ICML and EC added a reviewer-form question asking whether important work is missing from the bibliography. https://arxiv.org/pdf/2203.17239 . A dataset of reviewer-flagged missed citations exists as a task for recommenders. https://arxiv.org/pdf/2403.01873
- Self-interest caveat: in an eLife analysis of over 37,000 reviews at four open-review journals, reviewers who asked authors to cite their own work were much less likely to approve the article. https://elifesciences.org/articles/108748 . So "missing related work" requests are a known source of bias; a tool that surfaces candidates should show why each is relevant.
- Retraction Watch notes reviewers are human and will miss relevant references. https://retractionwatch.com/2016/02/23/ask-retraction-watch-what-to-do-when-papers-omit-relevant-citations
- Not found: how reviewers actually use "cited by" lists, Google Scholar or Connected Papers, or what they do with preprints' citing papers.

Added implication: the strongest "notice" targets are the ones with the least-supported reviewer habits: checking that a cited work says what is claimed, and finding what is missing. Both have documented error or bias rates, but no evidence of how reviewers currently do them.

## Dead ends and gaps
- Review Commons guidance, first-person reviewer blogs/threads, reviewers' citation-checking behaviour, and "cited by" usage: nothing found (see addendum).

- No primary source for per-review median hours; only a survey of unclear provenance.
- Sense about Science 2009 survey: not found.
- ACM reviewer guide, eLife, BMJ, Nature's own reviewer guide, "Ten simple rules for reviewers": not retrieved.
- No study of whether reviewers check references.
- No verified statistic on reviewers' struggles with statistics, or on overclaiming.
- No reviewer-sentiment data on specific tools (scite, statcheck, "AI reviewer" products).
- Official NeurIPS/CVPR AI-policy pages were not fetched; I relied on a secondary arXiv paper.
- NIH notice and COPE PDF were seen only through search summaries.
