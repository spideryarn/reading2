# Who has already built this, and what happens to a reader's own judgment when a tool helps

Research for Spideryarn's "Referee mode" — a possible feature to help scientific peer reviewers.
Compiled 2026-08-31.

See also [the-job-and-the-policies.md](the-job-and-the-policies.md) for what a reviewer is actually
asked to do and what publishers and funders will let AI touch.

---

## 1. Tools that already assist peer review or manuscript screening

### Checking the reporting, not the science

**[StatReviewer](https://www.ariessys.com/blog/streamlining-peer-review-with-ai-powered-reviewer-search-and-ranking/)**
(Aries Systems/Editorial Manager integration) runs thousands of algorithmic tests on statistical and
reporting integrity — numerical errors, appropriate test choice (a t-test on skewed data), decimal
precision, methodological reporting. Used by journals like *Psychological Science*. It checks stats
reporting mechanically and does not judge originality or argument quality — an explicit
decision-support layer, not a reviewer replacement. No independent published accuracy evaluation was
found.

**[SciScore](https://sciscore.com/)** ([Rigor and Transparency Index paper,
PMC7644557](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7644557/), 2020) is an NLP/ML tool from
Research Square/Digital Science that scores a Methods section 1–10 against NIH rigor/reproducibility
criteria (randomization, blinding, sample-size justification, reagent identifiability via RRIDs).
Deployed at FASEB journals and Research Square, in
[beta since 2020](https://www.sspnet.org/community/news/research-square-launches-beta-testing-for-sciscore-automated-assessment-tool/).
The RTI paper is the closest thing to a published validation — it shows the score correlates with
manual rigor assessment across a large corpus, but it is a *completeness* checker (is a resource named
and identifiable), not a correctness checker.

**[Ripeta](https://www.digital-science.com/blog/2021/04/ripeta-joins-the-digital-science/)** (acquired
by Digital Science 2021) sits in the same category as SciScore: NLP extraction of reproducibility
elements (data/code availability statements, funding, purpose) from 22M+ papers, integrated into
Editorial Manager as ripetaReview. Ripeta's own self-description names the ceiling of this whole tool
class: it "assesses the quality of the reporting... rather than the quality of the science."

**[Paperpal Preflight](https://cactusglobal.com/media-center/paperpal-preflight-the-one-stop-solution-for-all-editorial-checks-publishers-and-authors-need/)**
(Cactus/Editage) runs 30+ pre-submission checks in under two minutes — IMRaD structure completeness,
table/figure citation matching, metadata and required-statement presence (COI, ethics, funding),
language quality, reference age. Live on 150+ journals across major publishers, and also markets a
[fraud-detection angle](https://cactusglobal.com/media-center/detecting-fraudulent-submissions-using-paperpal-preflight-for-editorial-desk/).
No independent peer-reviewed evaluation was found — vendor claims only.

**[Penelope.ai](https://www.penelope.ai/blog)** (partnered with Peerwith) checks manuscript structure
and completeness against a specific journal's submission guidelines — title page, citation style,
required statements. Purely administrative and formatting, not a scientific-content checker.

### Reading tools that touch citations and literature

**[Scite.ai](https://scite.ai/features)** ([validation paper, MIT Press QSS
2021](https://direct.mit.edu/qss/article/2/3/882/102990/scite-A-smart-citation-index-that-displays-the))
classifies 1.6B+ citation statements as supporting, contrasting, or mentioning, using a deep-learning
classifier trained on citation context rather than just count. A reviewer can check whether a claim's
supporting citations are actually being disputed elsewhere, or whether a cited paper has been
retracted. Review coverage flags a caveat worth keeping: the "high supporting / low contrasting"
scores are noted as "subjective and often inaccurate" in places — treat as context, not verdict.

**[Elicit](https://elicit.com/)** is the most rigorously evaluated general research-assistant tool for
this purpose, because it has been tested specifically as a *systematic-review data extractor* — the
task structurally closest to "extract claims and methods from a manuscript." Two independent
evaluations exist:

- A [feasibility study, Cambridge Research Synthesis Methods
  2025](https://www.cambridge.org/core/journals/research-synthesis-methods/article/using-elicit-ai-research-assistant-for-data-extraction-in-systematic-reviews-a-feasibility-study-across-environmental-and-life-sciences/C97DAEC70C3173A260F0B12E729E7250):
  of 90 prompts tested, about 78% hit an 87% accuracy threshold on training articles, but that
  **fell to about 69% on unseen articles** — a real generalization loss.
- [Hilkenmeier et al., 2025, SAGE](https://journals.sagepub.com/doi/10.1177/08944393251404052): Elicit
  as second reviewer scored 81.4% accuracy versus 86.7% for humans, not statistically different — but
  **re-running the same extraction with different accounts gave only 46% and 30% agreement on
  supporting quotes/reasoning respectively**, even though final values agreed 90% of the time.
  Promising as a second-pass checker, not as a reproducible source of "why" — the justification text
  is unstable even when the answer is stable. That is directly relevant to any Spideryarn feature that
  shows the AI's *reasoning* for a claim, not just the claim.

**[Scholarcy](https://www.scholarcy.com/article-summarizer)** is a structured section-based summarizer
plus a "Robo-Highlighter" for key claims plus auto flashcards. Evidence is mixed: one
postgraduate-student study found it useful, but multiple reviews note the "flashcards" are often
copy-pasted spans rather than genuine synthesis — it can look like comprehension while only being
extraction.

**Consensus / SciSpace / Explainpaper** are evidence-engine-style Q&A tools over papers. Consensus
emphasizes a "Consensus Meter" (in-text scientific agreement at a glance) and quality-filtered search
by journal quartile; SciSpace adds structured data extraction and specialist agents; Explainpaper is a
plain-language line-by-line explainer. No independent accuracy studies were found for any of the
three, only vendor comparison blogs — and that absence is itself a finding: **the most popular "read a
paper with AI" consumer tools have essentially no independent evaluation literature**, unlike Elicit,
which was built review-facing enough that methodologists tested it.

**[Enago Read](https://www.read.enago.com/)** (formerly Rax) does summarization plus a "Copilot" Q&A
over a specific paper plus related-paper discovery. Reviews note it is "well-regarded... but offers
limited automated feedback for original drafts... performs best on published articles" — built for
reading existing literature, not evaluating a submission.

**Paper Digest** appears in numerous vendor round-ups as a summarizer but returned no independent
study; treat it as a commodity summarization tool, not an evidence-backed one.

### Screening for fraud, image manipulation, and integrity

**[Clear Skies "Papermill Alarm"](https://clear-skies.co.uk/about/)**, the first AI-based paper-mill
detection tool, gives a traffic-light (red/orange/green) rating from network analysis of citation
patterns and known paper-mill signatures. Public version launched 2022, tuned initially for cancer
research. Integrated into
[STM Integrity Hub](https://stm-assoc.org/what-we-do/strategic-areas/research-integrity/integrity-hub/),
Editorial Manager, ScholarOne, Morressier, Silverchair.

**[STM Integrity Hub](https://www.csescienceeditor.org/article/the-stm-integrity-hub/)** is shared
cloud infrastructure (run by STM Solutions) pooling integrity signals across publishers rather than
each building its own stack, with two flagship apps: Paper Mill Checker and Duplicate Submission
Checker. Concrete usage: **35+ publishers (IEEE, ACS, Taylor & Francis, Sage, PeerJ...), screening
125,000+ manuscripts a month, intercepting about 1,000 suspected paper-mill submissions a month.**
This is the strongest "it actually works at scale" data point found in the whole tools category.

**[ImageTwin](https://imagetwin.ai/image-manipulation-detection/) /
[Proofig](https://www.proofig.com/)** do AI image forensics for duplication, manipulation
(scale/rotate/flip/contrast), and copy-move forgery in western blots and microscopy, checked against
160M+-figure databases. Proofig claims validation "on large real-world datasets... low false-positive
rates" across hundreds of thousands of manuscripts — a vendor claim, not independently published as
far as found.

**[Argos](https://www.bitnos.com/info/argos)** (Scitility) flags authors with a record of misconduct
and journals disproportionately affected by fraudulent submissions; used, for example, by Impact
Journals/Oncotarget as part of their integrity process.

**[ReviewerZero](https://www.reviewerzero.ai/)**, founded 2023 by Daniel Acuña (CU Boulder), runs 65+
integrity checks across 12 dimensions — image manipulation including AI-generated panel detection,
statistical validation, citation verification — plus an "AI Review" module producing structured
peer-review-style feedback from a model fine-tuned on scholarly content and real reviews. Won a 2026
SSP EPIC Award (Silver). Worth noting for its product boundary: it explicitly separates *integrity
screening* from *substantive review feedback* as two products under one platform.

**[Signals](https://research-signals.com/)** (Research Signals) offers 30+ automated "signals" for
manuscript credibility, backed by a "Signals Data Graph" of publication data, and also powers
reviewer-recommendation. Positioned to editors, not authors or reviewers directly.

### Matching a manuscript to a reviewer

**[Prophy](https://blog.prophy.ai/how-prophy-matches-manuscripts-to-expert-reviewers-the-core-recommendation-engine)**
matches manuscripts to a database of about 87M researcher profiles via full-text semantic similarity
(concept extraction, not keyword match), then filters and ranks by COI, availability,
geographic/gender diversity, and seniority (h-index). Published methods paper:
[Harvey et al. 2024, Information Services &
Use](https://content.iospress.com/articles/information-services-and-use/isu230196).

### A fully automated reviewer misses its own genre of mistake

**[Sakana AI Scientist](https://spectrum.ieee.org/ai-for-science-2)** is a fully autonomous
idea-to-experiment-to-paper-to-review pipeline; its review module was purpose-built so the system
would not need a human to gate its own output. Independent evaluation
([arXiv 2502.14297](https://arxiv.org/html/2502.14297v3)) found the **automated reviewer consistently
missed significant flaws in the system's own generated papers, and was over-critical of human-written
papers** — a failure that runs in both directions at once, worse at self-critique than at
other-critique. Separately, 42% of the system's own experiments failed from coding errors, and its
literature-novelty checks (keyword search) misclassified well-established ideas as novel. Not close to
a substitute for judgment; useful mainly as an illustration of the failure mode "a reviewer that
reviews its own genre of output tends to miss its own genre of mistake."

### What it looks like deployed at real scale

**[Springer Nature / Snapp](https://group.springernature.com/gp/group/media/press-releases/ai-tools-support-less-friction-and-increased-author-satisfaction/27849346)**
had, by 2025, about 60 AI tools across screening, editorial evaluation, and integrity, live on more
than half of Springer Nature journals. Concrete numbers: the **Editor Evaluation tool used on about
500,000 manuscripts**, the **Peer Reviewer Recommender generated 400,000+ recommendations.** Vendor-
reported (Springer Nature's own press release), not independently audited, but the scale is real and
public.

---

## 2. What academic systems that generate reviews have actually found

**[Liang, Zhang et al., Stanford, "Can Large Language Models Provide Useful Feedback on Research
Papers?"](https://arxiv.org/abs/2310.01783)** (2023, journal version
[NEJM AI 2024](https://ai.nejm.org/doi/abs/10.1056/AIoa2400196)) is the landmark study in this area. It
compared GPT-4 feedback to human reviewer feedback on 3,096 papers across 15 Nature-family journals
plus ICLR. In a prospective user study, **57.4% of users found GPT-4 feedback helpful or very helpful;
82.4% found it more beneficial than feedback from at least some of their human reviewers**, with
substantial overlap between LLM and human comments. The paper's own conclusion is a real hedge, worth
quoting directly: LLM feedback "could benefit researchers, especially when timely expert feedback is
not available and in earlier stages of manuscript preparation" — explicitly *not* proposed as a
peer-review substitute.

**[Wang, Sakhrani, et al., "ReviewerGPT? An Exploratory Study on Using Large Language Models for Paper
Reviewing"](https://arxiv.org/abs/2306.00622)** (2023) is narrower and more skeptical. The authors
constructed 13 CS papers, each with a deliberately inserted error; GPT-4 caught errors in **7 of 13**.
Checklist-style targeted questions ("does the paper report X?") outperformed asking for a free-form
review. Their conclusion, stated plainly: LLMs are promising as reviewing assistants for narrow,
specific tasks, "but not (yet) for complete evaluations." This is the strongest single citation for
"use AI to check specific things, not to hand it the whole judgment."

**[MARG (arXiv 2401.04259)](https://arxiv.org/abs/2401.04259)** is a multi-agent architecture — a
leader and worker agents each handling a paper chunk, plus specialist "expert" agents for experiments,
clarity, and impact — built specifically to get around single-LLM context limits and generic-comment
problems. It reduced the rate of generic, non-actionable comments from 60% to 29%, and raised "good
comments per paper" 2.2x. A relevant precedent for "decompose review into typed sub-tasks handled
separately," rather than one big prompt.

**[ReviewRobot (arXiv 2010.06119, INLG 2020)](https://arxiv.org/abs/2010.06119)** builds knowledge
graphs from the target paper, its cited related work, and a large background corpus, then compares
graphs to predict scores with cited evidence. Its headline number: **71.4% accuracy predicting
novelty score using the knowledge-graph method, versus 28.6% for abstract-only baselines** — evidence
that grounding review judgments in explicit extracted structure, rather than raw LLM reading, helps
substantially for at least one axis.

**[AgentReview (EMNLP 2024, arXiv 2406.12708)](https://arxiv.org/abs/2406.12708)** simulates the
*entire* conference review process — reviewers, authors, area chairs, discussion phases — with LLM
agents, at scale (53,800+ generated documents across 500+ ICLR submissions). Headline finding: **37.1%
of variation in paper decisions was attributable to simulated reviewer social/behavioral biases**
(social influence, "altruism fatigue," authority bias) — a study of the review *process*, not a
review-quality tool, but direct evidence that outcomes are highly contingent on reviewer psychology
and dynamics independent of paper quality. That is exactly the class of failure a well-designed
reading tool might reduce, or, badly designed, might reproduce.

**[Reviewer2 (arXiv 2402.10886)](https://arxiv.org/abs/2402.10886)** is a two-stage fine-tuned model:
first generate "aspect prompts" (what should this review cover), then generate the review conditioned
on those prompts. Built on a 27k-paper / 99k-review training set. Framed as *pre-submission author
feedback*, not a reviewer replacement.

**[OpenReviewer (arXiv 2412.11948)](https://arxiv.org/abs/2412.11948)** is an open-source 8B model
fine-tuned on 79,000 real conference reviews. Evaluated on 400 held-out papers, its reviews were rated
**significantly more critical and realistic than GPT-4 or Claude-3.5 output**, and its average score
(5.4) matched the real human-reviewer score distribution almost exactly. A smaller, specifically
fine-tuned model can out-calibrate a much larger general model on this task — matching score
distribution is not the same as matching correctness, but it is a meaningfully different failure mode
than generic LLMs, which tend toward blanket positivity.

**[Paper SEA (EMNLP Findings 2024, arXiv 2407.12857)](https://arxiv.org/abs/2407.12857)** is a
three-module pipeline (Standardize, generate, Analyze with a novel "mismatch score" checking
review-content consistency) — chiefly useful here as an example of explicitly measuring whether a
generated review's claims actually match what is in the paper, i.e. a built-in hallucination check for
the review itself.

**[DeepReviewer / DeepReviewer 2.0 (arXiv 2503.08569,
2604.09590)](https://arxiv.org/abs/2604.09590)** is a cascaded pipeline — novelty verification,
structured multi-dimensional review, reliability check — producing a "traceable review package" with
anchored annotations and localized evidence, refusing to export until minimum traceability and
coverage are met. On 134 ICLR 2025 submissions it won 71.6% of blind micro-averaged comparisons
against a human review committee and had better major-issue coverage than Gemini-based baselines. Its
design thesis is worth carrying into Spideryarn's own design: **"automated reviewing should be judged
less by how persuasive it sounds and more by whether its judgments are checkable."** Positioned
explicitly as assistive, not a decision proxy.

### Large-scale institutional experiments

**[ICLR 2025 Review Feedback Agent (arXiv 2504.09737, Nature Machine
Intelligence)](https://arxiv.org/abs/2504.09737)** is a genuine RCT, not a demo. It fed feedback to a
randomized half of over 20,000 ICLR 2025 reviews over four weeks, flagging vague or unconstructive
comments. **27% of reviewers who got feedback updated their review; 12,000+ suggestions were actually
incorporated.** This is the best available causal evidence that AI feedback *on the review itself*,
rather than on the paper, measurably changes reviewer behavior for the better, at scale, with a proper
control group — the strongest methodological evidence in this whole research area.

**[AAAI-26 AI Review Pilot (arXiv 2604.13940)](https://arxiv.org/abs/2604.13940)** gave every one of
22,977 main-track submissions one identified AI review, generated in under a day. A survey of authors
and PC members found they **preferred AI reviews to human reviews on technical accuracy and
research-suggestion dimensions**, but flagged errors reading equations and tables, poor prioritization
of issue severity, and reviews longer than people wanted to read. A useful concrete failure-mode list
for UI design: severity signaling and length control matter as much as raw correctness.

**["Can AI Solve the Peer Review Crisis?" (Pataranutaporn, Powdthavee, Maes, MIT Media Lab, arXiv
2502.00070)](https://arxiv.org/abs/2502.00070)** ran 27,090 evaluations of 9,030 economics papers
across GPT-4o, Claude 3.5, Gemma 3, and LLaMA 3.3. **LLMs distinguish quality reasonably well but
systematically rate papers higher when author identity signals top institutions, male authors, or
renowned economists** — the exact same de-anonymization bias problem humans have, reproduced and
possibly amplified by the model. LLMs also struggle to tell high-quality AI-generated papers from
genuine top-tier ones. **Direct design implication: any Spideryarn reviewer-support feature must strip
or refuse to use author/institution identity signals**, or it inherits this bias by default.

**[Nature/Science editorial policy divergence](https://www.science.org/content/article/science-funding-agencies-say-no-using-ai-peer-review)**:
Science/AAAS banned AI-generated review text outright in January 2023, treating a violation as
misconduct, then softened to a disclosure model by November 2023. ICLR 2026 requires disclosure but
does not ban; CVPR 2026 bans LLM-written reviews and meta-reviews outright; ICML 2026 lets each side
(author, reviewer) declare its own policy. Field consensus has **not converged** — worth naming
explicitly so a product write-up does not assume a stable norm.

### The gaming and detection arms race is active, and it's a live security boundary

- **[Prompt Injection Attacks on LLM-Assisted Peer Review (arXiv
  2508.20863)](https://arxiv.org/abs/2508.20863)** and companion papers
  ([2509.09912](https://arxiv.org/abs/2509.09912), [2509.10248](https://arxiv.org/abs/2509.10248))
  hide invisible instructions (white text, tiny font) inside a submitted PDF telling an LLM reviewer
  to give a positive review. **Simple injections reached up to 100% "accept" scores** in tested setups;
  the effect held for English/Japanese/Chinese injected text, and was weaker for Arabic. This is
  directly load-bearing for Spideryarn if we ever feed a full manuscript PDF to a model and ask for
  judgment — the untrusted-content boundary (per this repo's own
  [security-map.md](../../project/security-map.md)) is the manuscript text itself, not just the user.
- **"Gaming AI-Assisted Peer Reviews Poses New Risks" (arXiv 2606.10159)**, covered fully in
  [the-job-and-the-policies.md](the-job-and-the-policies.md), and detection efforts
  ([Sem-Detect](https://arxiv.org/abs/2605.21713), Pangram) — one report found **only 43% of ICLR 2026
  reviews were entirely human-written; 21% were fully AI-generated.** The arms race between generation
  and detection is active and unresolved.
- **["Impact of LLMs on peer review opinions, fine-grained" (arXiv 2604.19578,
  Scientometrics)](https://arxiv.org/abs/2604.19578)** measured stylistic drift in ICLR reviews since
  LLM adoption (longer sentences and words, more nominal-subject constructions); a companion estimate
  put **≥15.8% of ICLR 2024 reviews as AI-assisted.**

---

## 3. Matching reviewers to manuscripts — the known failure modes

**How the leading systems work:**

- **[Prophy](https://blog.prophy.ai/how-prophy-matches-manuscripts-to-expert-reviewers-the-core-recommendation-engine)**:
  semantic full-text concept extraction against ~87M researcher "fingerprints," then filters on COI
  (shared co-authorship/affiliation), availability, geographic/gender diversity, seniority (h-index,
  article count, "academic age").
- **[Web of Science Reviewer
  Locator](https://clarivate.com/academia-government/scientific-and-academic-research/publisher-solutions/web-of-science-reviewer-locator/)**
  (Clarivate; absorbed Publons' reviewer-recognition function) mines the WoS citation, publication, and
  peer-review-history graph across 28M+ authors, surfacing a "360° profile" including COI flags, bio
  info, keywords, institutional affiliation.
- **[Elsevier Reviewer
  Recommender](https://service.elsevier.com/app/answers/detail/a_id/29385/supporthub/publishing/~/reviewer-recommender-in-editorial-manager/)**
  (in Editorial Manager, powered by Scopus) surfaces up to 100 candidates within 24 hours of
  submission, auto-filters known co-authors from the last 3 years, and lets an editor refine by
  h-index/expertise.
- **[Farber et al. 2024, Learned
  Publishing](https://onlinelibrary.wiley.com/doi/10.1002/leap.1638)**, "Enhancing peer review
  efficiency: A mixed-methods analysis of AI-assisted reviewer selection across academic disciplines,"
  is a rare independent (non-vendor) look at whether these tools actually help — worth a closer read
  if reviewer matching becomes a priority feature, since most other matching evidence above is vendor
  self-reported.

**Failure modes named consistently across sources:**

- **Bias reproduction from training data.** If historical review/publication data encodes gender or
  geographic skew, matching systems trained on it reproduce that skew
  ([survey, arXiv 2507.01903](https://arxiv.org/pdf/2507.01903); corroborated by the economics-paper
  bias study in §2).
- **Gender homophily.** A large empirical study of about 43,000 Frontiers reviewers (and 9,000
  editors, across 142 journals, 2007–2015) found women underrepresented in the reviewer pool, and
  **editors of both genders show substantial same-gender preference**
  ([Helmer et al., *eLife* 2017](https://elifesciences.org/articles/21718)). This was first written up
  here as *Science Advances* 2021, which is a different and larger study
  ([Squazzoni et al.](https://www.science.org/doi/10.1126/sciadv.abd0299), ~740,000 referees) that
  also finds selection-stage homophily. The correction was made on 2026-09-01, after a second research
  pass flagged it and proposed *Murray et al., eLife 2019* — which is wrong too. The paper with these
  numbers is eLife 21718, and the lesson is the one this repo already writes down: check the finding,
  including the one correcting a finding.
- **Imperfect anonymization leaking into matching and bias.** Even with blinded manuscripts,
  institutional and geographic cues leak author identity, which both human and algorithmic matching
  picks up on.
- **Over-suggesting the already-famous.** Not independently quantified in what this research found,
  but repeatedly named as a structural risk in the survey literature: systems ranking by h-index or
  citation count mechanically funnel review load toward already-prominent researchers — the opposite
  of "diversify the reviewer pool," even though most of these tools also market diversity filters as a
  mitigation.
- **COI detection is necessary but narrow.** All three major systems (Prophy, WoS, Elsevier) detect
  COI mechanically via co-authorship or affiliation history — catching the easy cases (a recent
  co-author) but not informal or undisclosed relationships.

---

## 4. Tools for reading a paper critically, not for reviewing it

**[Hypothes.is](https://web.hypothes.is/)** is an open social annotation layer over any web page or
PDF, and it is the best-evidenced tool in this whole category for actual pedagogical outcomes. A
meta-analysis (Novak et al. 2012, widely cited) links social annotation to "improved critical
thinking, meta-cognitive skills, and reading comprehension." Vendor-reported classroom stats claim a
32% retention increase, doubled comprehension scores, and a 24% grade improvement — self-reported, so
treat with appropriate skepticism, but the underlying mechanism (annotation at different depths:
vocabulary, thesis, cross-reference) is a genuinely useful framework, since it maps onto different
comprehension levels. **This is the closest existing tool to Spideryarn's own philosophy: it augments
engagement with the original text rather than replacing it with a derivative.**

**Scholarcy, Elicit, Consensus, SciSpace, Explainpaper, Enago Read** (see §1 for detail) are all
primarily convert-and-summarize tools rather than "read the original more deeply" tools. The recurring
theme across every review found: they are good for *triage* — should I read this at all, what is it
broadly about — and weak or unvalidated for *extraction fidelity* — what exactly does it say, can I
trust the specific numbers and quotes.

**Petal**, a reference manager and knowledge-base Q&A tool, did not surface evidence as a
critical-reading aid specifically — it is more a literature-organization tool. "Paper Piles" as named
in the original brief did not surface as a distinct product; the closest match, Paperpile, is a
citation manager with an annotation feature, not an AI reading tool. Noting this gap rather than
guessing at what it might be.

**No evidence was found either way** for whether any of these tools specifically *induce*
over-reliance versus genuinely aid comprehension — that evidence exists at the more general level
covered in §5, not in tool-specific studies. That absence is itself a finding: **the reading-tool
vendors have not been independently studied for comprehension outcomes**, only for time saved and user
satisfaction, which is a different, weaker claim.

---

## 5. What happens to a reader's own judgment when AI helps — the direct evidence

### The landmark study: effort drops, and critical thinking doesn't vanish, it moves

**[Lee, Toscano-Miranda et al. (Microsoft Research + Carnegie Mellon), "The Impact of Generative AI on
Critical Thinking," CHI
2025](https://www.microsoft.com/en-us/research/publication/the-impact-of-generative-ai-on-critical-thinking-self-reported-reductions-in-cognitive-effort-and-confidence-effects-from-a-survey-of-knowledge-workers/)**
surveyed 319 knowledge workers across 936 first-hand GenAI use examples. Its core findings are
directly relevant to a reviewer-support tool:

- **Higher trust in AI correlates with less critical thinking; higher self-confidence correlates with
  more critical thinking.** Trust in the tool and trust in oneself pull in opposite directions.
- Reported effort reduction on cognitive activities was large and specific: "much less/less effort"
  was reported by 79% of respondents for Comprehension tasks, 72% for Analysis, 76% for Synthesis.
- Critical thinking does not vanish — it **shifts**, from generating content to *verifying* AI output,
  integrating it, and stewarding the task. This reframing (verification-as-critical-thinking) is a
  useful design target: build the tool assuming the user's actual job becomes verification, and
  support that specifically, rather than assuming deep original reading continues unchanged.
- Separately measured: AI-tool access produced **less diverse outputs** for the same task across
  users, read by the authors as evidence of a homogenizing, not just effort-reducing, effect.

### Anchoring: showing the AI's opinion first shifts the human's opinion, including toward the AI's mistakes

**["How was my performance? ... anchoring bias in AI-assisted decision making"
(ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S0268401225000076)** found an AI
recommendation's presence and direction (a high or low anchor) measurably shifted human performance
ratings, and, in the sharpest sentence found in this whole research area: **"anchoring makes humans
less likely to catch errors when the AI is wrong."** If a Referee mode shows any kind of AI-generated
score, flag, or draft judgment *before* the human forms their own view, it will bias that view,
including toward propagating an error.

Design mitigations named in the general HCI literature (not tool-specific): **elicit the human's own
assessment before showing any AI recommendation; show ranges rather than point estimates; separate the
AI's output from the primary judgment UI rather than embedding it inline.** These are concrete,
actionable patterns.

### Automation bias, more broadly

A [systematic review, PubMed 21335679](https://pubmed.ncbi.nlm.nih.gov/21335679/) establishes
automation bias as a real, replicated phenomenon in decision support generally, though under-defined
and under-measured as a field. A healthcare-specific finding worth citing directly: in one study, when
a clinical decision-support system intentionally gave incorrect suggestions, **clinicians followed the
wrong suggestion in about half the intentionally-wrong cases** — a stark number for how much a wrong
AI suggestion actually gets caught. The closest thing to an official methodological-community verdict,
directly analogous to peer review, comes from systematic-review guidance:
**["Current evidence does not support generative AI use in systematic reviews without meaningful human
involvement"](https://libguides.ohsu.edu/systematic-reviews/ai)**.

### Summaries specifically — the closest analog to "the reviewer reads an AI gist instead of the section"

An **Etkin et al. finding**, cited across multiple secondary sources in the "AI and reading
comprehension" literature, is striking and counterintuitive, and worth flagging hard: **students with
high pre-existing comprehension skill showed *worse* comprehension after reading AI summaries versus
originals**, because simplified text strips the contextual cues skilled readers actually use.
**Summarization tools may hurt your best, most skilled users most** — close to the inverse of what a
naive "help weaker readers" framing would predict.

A cross-experiment finding (7 experiments, 10,000+ participants, cited in secondary coverage) found
that **advice written after using AI summaries was shorter, less factual, more similar across users**,
and that **people felt less invested in forming their own view** after reading a summary rather than
the source — a second concrete "surrender" data point beyond the Microsoft/CMU study above.

There is a positive counter-finding worth keeping, because it is directly actionable:
**providing full text upfront produced the best comprehension, and letting people open the full
article *after* seeing a summary — rather than never — largely eliminated the comprehension deficit.**
The deficit is not intrinsic to summaries existing; it is intrinsic to summaries as a *terminus*
rather than an *entry point*. That maps directly onto Spideryarn's own philosophy of augmenting rather
than replacing the read.

A related study,
[comparing structural and conversational AI summarisation, Interactive Learning Environments
2025](https://www.tandfonline.com/doi/full/10.1080/10494820.2025.2604649), is a time-constrained
academic reading study comparing summary formats for graduate students — flagged here as a follow-up
source for format-specific guidance (structural versus conversational summary), beyond the scope of
this note.

---

## Sources

1. [Aries/StatReviewer integration](https://www.ariessys.com/blog/streamlining-peer-review-with-ai-powered-reviewer-search-and-ranking/)
2. [Penelope.ai blog](https://www.penelope.ai/blog)
3. [SciScore](https://sciscore.com/)
4. [Rigor and Transparency Index paper, PMC7644557](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7644557/)
5. [Digital Science / Ripeta acquisition](https://www.digital-science.com/blog/2021/04/ripeta-joins-the-digital-science/)
6. [Paperpal Preflight](https://cactusglobal.com/media-center/paperpal-preflight-the-one-stop-solution-for-all-editorial-checks-publishers-and-authors-need/)
7. [Scite: smart citation index, MIT Press QSS](https://direct.mit.edu/qss/article/2/3/882/102990/scite-A-smart-citation-index-that-displays-the)
8. [Elicit feasibility study, Cambridge 2025](https://www.cambridge.org/core/journals/research-synthesis-methods/article/using-elicit-ai-research-assistant-for-data-extraction-in-systematic-reviews-a-feasibility-study-across-environmental-and-life-sciences/C97DAEC70C3173A260F0B12E729E7250)
9. [Elicit as second reviewer, SAGE 2025](https://journals.sagepub.com/doi/10.1177/08944393251404052)
10. [Prophy matching engine](https://blog.prophy.ai/how-prophy-matches-manuscripts-to-expert-reviewers-the-core-recommendation-engine)
11. [Prophy methods paper, Information Services & Use 2024](https://content.iospress.com/articles/information-services-and-use/isu230196)
12. [Clear Skies Papermill Alarm](https://clear-skies.co.uk/about/)
13. [STM Integrity Hub overview](https://www.csescienceeditor.org/article/the-stm-integrity-hub/)
14. [ImageTwin manipulation detection](https://imagetwin.ai/image-manipulation-detection/)
15. [Proofig](https://www.proofig.com/)
16. [Argos (Scitility)](https://www.bitnos.com/info/argos)
17. [ReviewerZero](https://www.reviewerzero.ai/)
18. [Signals (Research Signals)](https://research-signals.com/)
19. [Scholarcy article summarizer](https://www.scholarcy.com/article-summarizer)
20. [Enago Read](https://www.read.enago.com/)
21. [Sakana AI Scientist evaluation, arXiv 2502.14297](https://arxiv.org/html/2502.14297v3)
22. [IEEE Spectrum on AI Scientist controversy](https://spectrum.ieee.org/ai-for-science-2)
23. [Springer Nature AI tools press release](https://group.springernature.com/gp/group/media/press-releases/ai-tools-support-less-friction-and-increased-author-satisfaction/27849346)
24. [Liang et al., "Can LLMs Provide Useful Feedback," arXiv 2310.01783](https://arxiv.org/abs/2310.01783)
25. [ReviewerGPT, arXiv 2306.00622](https://arxiv.org/abs/2306.00622)
26. [MARG, arXiv 2401.04259](https://arxiv.org/abs/2401.04259)
27. [ReviewRobot, arXiv 2010.06119](https://arxiv.org/abs/2010.06119)
28. [AgentReview, arXiv 2406.12708](https://arxiv.org/abs/2406.12708)
29. [Reviewer2, arXiv 2402.10886](https://arxiv.org/abs/2402.10886)
30. [OpenReviewer, arXiv 2412.11948](https://arxiv.org/abs/2412.11948)
31. [Paper SEA, arXiv 2407.12857](https://arxiv.org/abs/2407.12857)
32. [DeepReviewer 2.0, arXiv 2604.09590](https://arxiv.org/abs/2604.09590)
33. [ICLR 2025 Review Feedback Agent RCT, arXiv 2504.09737](https://arxiv.org/abs/2504.09737)
34. [AAAI-26 AI Review Pilot, arXiv 2604.13940](https://arxiv.org/abs/2604.13940)
35. ["Can AI Solve the Peer Review Crisis?", arXiv 2502.00070](https://arxiv.org/abs/2502.00070)
36. [Science/AAAS AI peer review policy, science.org](https://www.science.org/content/article/science-funding-agencies-say-no-using-ai-peer-review)
37. [Prompt Injection Attacks on LLM-Assisted Peer Review, arXiv 2508.20863](https://arxiv.org/abs/2508.20863)
38. ["Impact of LLMs on peer review opinions, fine-grained," arXiv 2604.19578](https://arxiv.org/abs/2604.19578)
39. [Web of Science Reviewer Locator](https://clarivate.com/academia-government/scientific-and-academic-research/publisher-solutions/web-of-science-reviewer-locator/)
40. [Elsevier Reviewer Recommender](https://service.elsevier.com/app/answers/detail/a_id/29385/supporthub/publishing/~/reviewer-recommender-in-editorial-manager/)
41. [Farber et al., AI-assisted reviewer selection, Learned Publishing 2024](https://onlinelibrary.wiley.com/doi/10.1002/leap.1638)
42. [Helmer et al., Gender bias in scholarly peer review, eLife 2017](https://elifesciences.org/articles/21718) · [Squazzoni et al., Science Advances 2021](https://www.science.org/doi/10.1126/sciadv.abd0299)
43. [Hypothesis (Hypothes.is)](https://web.hypothes.is/)
44. [Microsoft Research + CMU, CHI 2025 critical thinking study](https://www.microsoft.com/en-us/research/publication/the-impact-of-generative-ai-on-critical-thinking-self-reported-reductions-in-cognitive-effort-and-confidence-effects-from-a-survey-of-knowledge-workers/)
45. [Anchoring bias in AI-assisted decision making, ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0268401225000076)
46. [Automation bias systematic review, PubMed](https://pubmed.ncbi.nlm.nih.gov/21335679/)
47. [OHSU systematic reviews AI guidance](https://libguides.ohsu.edu/systematic-reviews/ai)
48. [Comparing structural/conversational AI summarisation, Interactive Learning Environments 2025](https://www.tandfonline.com/doi/full/10.1080/10494820.2025.2604649)
